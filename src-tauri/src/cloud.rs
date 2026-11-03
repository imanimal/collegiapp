//! Sync across devices through your own Firebase project (the free Spark plan, no server of
//! ours): Google sign-in on the web app's link page, handed back to a loopback address, then
//! Firestore over REST with the system curl. Setup is in docs/SYNC.md.
//!
//! One document per Item at `users/{uid}/items/{id}`: `j` is the Item's JSON, `c` its course's
//! (so a device without that course can add it), `d` the device that wrote it and `s` the
//! server's time of the write. A pull asks for what was written after the newest `s` it has seen,
//! so device clocks never hide a change. Merging is the core's last-write-wins
//! (`collegiapp_core::sync`), and imported items already share their id on every device
//! (`stable_id`), so two devices reading the same feed meet on one document.
//!
//! Every 5 s the loop looks for local changes (an item whose `updated_at` isn't the version this
//! device last pushed or pulled) and every 60 s it pulls. A cycle pulls first, then pushes what's
//! newer here, so an offline edit never overwrites a newer one from another device. A deletion
//! pulled from another device puts the local version in the trash. The sample item never syncs.
//!
//! Settings that follow you (the look, the calendar feed links, the Google class picks:
//! `Settings::synced` in store.rs) and the courses, each as "course.<id>" (null once deleted),
//! are one more document, `users/{uid}/meta/settings`: `j` the core's `SyncedSettings` as JSON
//! (each key with its value and the time and device of its last change), `d` and `s` as above.
//! Each cycle reads it before the items, merges it key by key (`merge_settings`, later change
//! wins) and writes it back when this device has something newer. The store stamps a key when
//! it changes here, so a new device's defaults never win over the account's. A course with a
//! key there comes only from there, never from an item's `c` again, so an edit or a delete made
//! elsewhere sticks.
//!
//! The project is the one in `ui/js/cloud-config.js`, built in, so the app and the web app share
//! it with nothing to fill in; the Sync dialog can set another. Beside the store: `cloud.json`
//! holds that other project's config (a Firebase web key and project ID, neither secret) and the
//! sync marks; `cloud.session` holds the Firebase refresh token, uid and email. Neither is in
//! Settings, and neither is ever uploaded. The feed links are the one secret that syncs, by
//! your choice, and only into your own settings document, which the rules lock to your uid.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use chrono::{DateTime, SecondsFormat, Utc};
use collegiapp_core::{merge_settings, Course, Item, SyncedSettings};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::store::{lock, SharedState};

const PUSH_BATCH: usize = 200;
/// Bigger than a push batch, so a full page always holds more than one write time (see `trim_page`).
const PULL_PAGE: usize = 300;
const PULL_EVERY: Duration = Duration::from_secs(60);
const RETRY_AFTER: Duration = Duration::from_secs(60);
/// A local change waits this long, so typing in a note pushes once it settles.
const SETTLE: i64 = 3;
/// Firestore's limit is 1 MiB a document; an item past this stays on this device.
const MAX_DOC: usize = 900_000;

/// Your Firebase project: the web app's `apiKey` and `projectId`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct CloudConfig {
    pub api_key: String,
    pub project_id: String,
}

impl CloudConfig {
    fn ready(&self) -> bool {
        !self.api_key.is_empty() && !self.project_id.is_empty()
    }

    /// The web app's origins on Firebase Hosting; the link page is on the first.
    fn origins(&self) -> [String; 2] {
        let p = &self.project_id;
        [
            format!("https://{p}.firebaseapp.com"),
            format!("https://{p}.web.app"),
        ]
    }

    fn check(mut self) -> Result<CloudConfig, String> {
        for v in [&mut self.api_key, &mut self.project_id] {
            *v = v.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
        }
        let plain = |v: &str| {
            v.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        };
        if self.api_key.is_empty() || !plain(&self.api_key) {
            return Err("The API key is the apiKey in your Firebase web app's config.".into());
        }
        if self.project_id.is_empty()
            || !self
                .project_id
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        {
            return Err("The project ID is the projectId in the config: lowercase letters, digits and dashes.".into());
        }
        Ok(self)
    }
}

/// The project in `ui/js/cloud-config.js` (`window.CA_CLOUD`), read at build time.
fn built_in() -> CloudConfig {
    parse_web_config(include_str!("../../ui/js/cloud-config.js"))
}

/// `apiKey` and `projectId` from a web config: cloud-config.js, or the block the Firebase console
/// shows. Anything unreadable is no config.
fn parse_web_config(src: &str) -> CloudConfig {
    let src = src.split_once("CA_CLOUD").map_or(src, |(_, r)| r);
    let pick = |k: &str| {
        let (_, r) = src.split_once(k)?;
        let r = r.trim_start_matches(['"', '\'']).trim_start();
        let r = r.strip_prefix([':', '='])?.trim_start();
        let q = r.chars().next().filter(|c| *c == '"' || *c == '\'')?;
        r[1..].split(q).next().map(str::to_string)
    };
    CloudConfig {
        api_key: pick("apiKey").unwrap_or_default(),
        project_id: pick("projectId").unwrap_or_default(),
    }
    .check()
    .unwrap_or_default()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
struct Marks {
    /// The newest server write time seen.
    last_pull: Option<DateTime<Utc>>,
    /// Each item's version on the server as far as this device knows: its `updated_at`.
    pushed: BTreeMap<Uuid, DateTime<Utc>>,
    /// The newest setting change in the settings document as far as this device knows.
    settings: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Saved {
    config: CloudConfig,
    marks: Marks,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Session {
    uid: String,
    email: String,
    refresh_token: String,
}

/// What the Sync dialog shows; also the "cloud" event's payload.
#[derive(Debug, Clone, Default, Serialize)]
pub struct CloudStatus {
    pub configured: bool,
    pub signed_in: bool,
    pub signing_in: bool,
    pub busy: bool,
    pub email: Option<String>,
    pub project_id: String,
    /// The project is the built-in one (cloud-config.js), not one set in the Sync dialog.
    pub built_in: bool,
    pub last_sync: Option<DateTime<Utc>>,
    pub error: Option<String>,
    /// Items changed here and not uploaded yet.
    pub pending: usize,
}

struct Inner {
    dir: PathBuf,
    saved: Saved,
    built_in: CloudConfig,
    /// The link page this sign-in opened, to open again if asked.
    link: Option<String>,
    session: Option<Session>,
    token: Option<(String, Instant)>,
    signing_in: bool,
    busy: bool,
    last_sync: Option<DateTime<Utc>>,
    error: Option<String>,
    next_pull: Instant,
    next_try: Instant,
}

impl Inner {
    /// The project in use: one set in the Sync dialog, else the built-in one.
    fn config(&self) -> &CloudConfig {
        if self.saved.config.ready() {
            &self.saved.config
        } else {
            &self.built_in
        }
    }

    fn write_saved(&self) {
        if let Ok(j) = serde_json::to_vec_pretty(&self.saved) {
            let _ = fs::write(self.dir.join("cloud.json"), j);
        }
    }

    fn write_session(&self) {
        let p = self.dir.join("cloud.session");
        match &self.session {
            Some(s) => {
                if let Ok(j) = serde_json::to_vec(s) {
                    let _ = fs::write(p, j);
                }
            }
            None => {
                let _ = fs::remove_file(p);
            }
        }
    }

    /// Forget the account here: the session, the token and what was synced (a new sign-in,
    /// maybe to another account, starts from a full pull).
    fn sign_out(&mut self) {
        self.session = None;
        self.token = None;
        self.saved.marks = Marks::default();
        self.write_session();
        self.write_saved();
    }
}

pub struct Cloud(Mutex<Inner>);

impl Cloud {
    pub fn load(store_path: &Path) -> Cloud {
        let dir = store_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default();
        let read = |name: &str| fs::read_to_string(dir.join(name)).ok();
        let saved = read("cloud.json")
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let session = read("cloud.session").and_then(|t| serde_json::from_str(&t).ok());
        let now = Instant::now();
        Cloud(Mutex::new(Inner {
            dir,
            saved,
            built_in: built_in(),
            link: None,
            session,
            token: None,
            signing_in: false,
            busy: false,
            last_sync: None,
            error: None,
            next_pull: now,
            next_try: now,
        }))
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn syncs(it: &Item) -> bool {
    it.source.adapter != "sample"
}

/// Items whose version here isn't the one on the server. A tombstone the server never had
/// stays local.
fn unpushed<'a>(items: &'a [Item], marks: &'a Marks) -> impl Iterator<Item = &'a Item> + 'a {
    items.iter().filter(move |it| {
        let known = marks.pushed.get(&it.id);
        syncs(it) && known != Some(&it.updated_at) && !(it.deleted && known.is_none())
    })
}

fn status(app: &AppHandle) -> CloudStatus {
    let cloud = app.state::<Cloud>();
    let c = cloud.lock();
    let pending = if c.session.is_some() {
        let st = app.state::<SharedState>();
        let g = lock(&st);
        unpushed(&g.data.items, &c.saved.marks).count()
    } else {
        0
    };
    CloudStatus {
        configured: c.config().ready(),
        signed_in: c.session.is_some(),
        signing_in: c.signing_in,
        busy: c.busy,
        email: c.session.as_ref().map(|s| s.email.clone()),
        project_id: c.config().project_id.clone(),
        built_in: !c.saved.config.ready() && c.built_in.ready(),
        last_sync: c.last_sync,
        error: c.error.clone(),
        pending,
    }
}

fn emit(app: &AppHandle) {
    let _ = app.emit("cloud", status(app));
}

// ---- the loop --------------------------------------------------------------------------

/// Start the sync loop (desktop; set up after the store is managed).
#[cfg(desktop)]
pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        if due(&app) {
            cycle(&app);
        }
    });
}

fn due(app: &AppHandle) -> bool {
    let cloud = app.state::<Cloud>();
    let c = cloud.lock();
    let now = Instant::now();
    if c.session.is_none() || !c.config().ready() || c.busy || c.signing_in || now < c.next_try {
        return false;
    }
    if now >= c.next_pull {
        return true;
    }
    let st = app.state::<SharedState>();
    let g = lock(&st);
    let settled = Utc::now() - chrono::Duration::seconds(SETTLE);
    let seen = c.saved.marks.settings;
    let waiting = unpushed(&g.data.items, &c.saved.marks).any(|it| it.updated_at <= settled)
        || g.data
            .synced
            .values()
            .any(|s| seen.is_none_or(|t| s.at > t) && s.at <= settled);
    waiting
}

fn cycle(app: &AppHandle) {
    let cloud = app.state::<Cloud>();
    cloud.lock().busy = true;
    emit(app);
    let r = run(app, &cloud);
    {
        let mut c = cloud.lock();
        c.busy = false;
        let now = Instant::now();
        match r {
            Ok(()) => {
                c.error = None;
                c.last_sync = Some(Utc::now());
                c.next_pull = now + PULL_EVERY;
            }
            Err(e) => {
                c.error = Some(e);
                c.next_try = now + RETRY_AFTER;
            }
        }
        c.write_saved();
    }
    emit(app);
}

fn run(app: &AppHandle, cloud: &Cloud) -> Result<(), String> {
    let (cfg, session) = {
        let c = cloud.lock();
        (
            c.config().clone(),
            c.session.clone().ok_or("Not signed in.")?,
        )
    };
    let token = id_token(app, cloud, &cfg, &session)?;
    let root = format!("projects/{}/databases/(default)/documents", cfg.project_id);
    // the courses before the items, so a new device takes the account's and not the items'
    // older copies; its error waits until the items are through, so a project whose rules
    // predate the settings document still syncs them
    let settings = sync_settings(app, cloud, &token, &root, &session.uid);
    pull(
        app,
        cloud,
        &token,
        &format!("{API}/{root}/users/{}", session.uid),
    )?;
    push(app, cloud, &token, &root, &session.uid)?;
    settings
}

const API: &str = "https://firestore.googleapis.com/v1";

/// A Firebase ID token, refreshed when it has less than 5 minutes left.
fn id_token(
    app: &AppHandle,
    cloud: &Cloud,
    cfg: &CloudConfig,
    s: &Session,
) -> Result<String, String> {
    if let Some((t, until)) = cloud.lock().token.clone() {
        if Instant::now() + Duration::from_secs(300) < until {
            return Ok(t);
        }
    }
    let form = format!(
        "grant_type=refresh_token&refresh_token={}",
        enc(&s.refresh_token)
    );
    let url = format!(
        "https://securetoken.googleapis.com/v1/token?key={}",
        enc(&cfg.api_key)
    );
    let v = match call(&url, Body::Form(&form), None) {
        Ok(v) => v,
        Err(e)
            if [
                "TOKEN_EXPIRED",
                "INVALID_REFRESH_TOKEN",
                "USER_DISABLED",
                "USER_NOT_FOUND",
            ]
            .iter()
            .any(|k| e.contains(k)) =>
        {
            cloud.lock().sign_out();
            emit(app);
            return Err("Signed out: sign in with Google again.".into());
        }
        Err(e) => return Err(e),
    };
    let t = v["id_token"]
        .as_str()
        .ok_or("Firebase didn't send a token.")?
        .to_string();
    let secs = v["expires_in"]
        .as_str()
        .and_then(|x| x.parse().ok())
        .unwrap_or(3600);
    let mut c = cloud.lock();
    if let (Some(rt), Some(sess)) = (v["refresh_token"].as_str(), c.session.as_mut()) {
        if rt != sess.refresh_token {
            sess.refresh_token = rt.to_string();
            c.write_session();
        }
    }
    c.token = Some((t.clone(), Instant::now() + Duration::from_secs(secs)));
    Ok(t)
}

/// One item document as a pull returns it.
#[derive(Debug, Clone)]
struct Remote {
    at: DateTime<Utc>,
    item: Option<Item>,
    course: Option<Course>,
}

fn remote(e: &Value) -> Option<Remote> {
    let f = &e.get("document")?["fields"];
    let at = DateTime::parse_from_rfc3339(f["s"]["timestampValue"].as_str()?)
        .ok()?
        .with_timezone(&Utc);
    let text = |k: &str| f[k]["stringValue"].as_str();
    Some(Remote {
        at,
        item: text("j").and_then(|j| serde_json::from_str(j).ok()),
        course: text("c").and_then(|j| serde_json::from_str(j).ok()),
    })
}

/// A full page may end partway through one write time's documents; drop that time's tail so the
/// next page (after the newest time kept) reads it whole.
fn trim_page(docs: &mut Vec<Remote>, full: bool) {
    if !full {
        return;
    }
    if let Some(last) = docs.last().map(|d| d.at) {
        if let Some(i) = docs.iter().rposition(|d| d.at != last) {
            docs.truncate(i + 1);
        }
    }
}

fn pull(app: &AppHandle, cloud: &Cloud, token: &str, user: &str) -> Result<(), String> {
    for _ in 0..200 {
        let since = cloud.lock().saved.marks.last_pull;
        let mut q = json!({ "structuredQuery": {
            "from": [{ "collectionId": "items" }],
            "orderBy": [{ "field": { "fieldPath": "s" }, "direction": "ASCENDING" }],
            "limit": PULL_PAGE,
        }});
        if let Some(t) = since {
            q["structuredQuery"]["where"] = json!({ "fieldFilter": {
                "field": { "fieldPath": "s" }, "op": "GREATER_THAN",
                "value": { "timestampValue": t.to_rfc3339_opts(SecondsFormat::Micros, true) },
            }});
        }
        let v = call(
            &format!("{user}:runQuery"),
            Body::Json(&q.to_string()),
            Some(token),
        )?;
        let rows = v.as_array().cloned().unwrap_or_default();
        let found = rows.iter().filter(|r| r.get("document").is_some()).count();
        let mut docs: Vec<Remote> = rows.iter().filter_map(remote).collect();
        trim_page(&mut docs, found >= PULL_PAGE);
        if docs.is_empty() {
            return Ok(());
        }
        apply(app, cloud, &docs);
        if found < PULL_PAGE {
            return Ok(());
        }
    }
    Ok(())
}

/// Merge pulled documents into the store (last write wins, `collegiapp_core::merge`). Returns
/// whether the store changed and the local versions a remote deletion replaced, for the trash.
fn merge_remote(
    items: &mut Vec<Item>,
    courses: &mut Vec<Course>,
    marks: &mut Marks,
    synced: &SyncedSettings,
    docs: &[Remote],
) -> (bool, Vec<(Item, String, bool)>) {
    let (mut changed, mut gone) = (false, Vec::new());
    for r in docs {
        if marks.last_pull.is_none_or(|t| r.at > t) {
            marks.last_pull = Some(r.at);
        }
        let Some(item) = &r.item else { continue };
        marks.pushed.insert(item.id, item.updated_at);
        if let (Some(cid), Some(c)) = (&item.course_id, &r.course) {
            let synced_here = synced.contains_key(&format!("course.{cid}"));
            if &c.id == cid && !synced_here && !courses.iter().any(|x| &x.id == cid) {
                courses.push(c.clone());
                changed = true;
            }
        }
        match items.iter_mut().find(|i| i.id == item.id) {
            Some(local) => {
                let m = collegiapp_core::merge(local, item);
                if m != *local {
                    if m.deleted && !local.deleted {
                        gone.push((local.clone(), "Deleted on another device".to_string(), true));
                    }
                    *local = m;
                    changed = true;
                }
            }
            None if !item.deleted => {
                items.push(item.clone());
                changed = true;
            }
            None => {}
        }
    }
    (changed, gone)
}

fn apply(app: &AppHandle, cloud: &Cloud, docs: &[Remote]) {
    let changed = {
        let mut c = cloud.lock();
        let st = app.state::<SharedState>();
        let mut g = lock(&st);
        let data = &mut g.data;
        let (changed, gone) = merge_remote(
            &mut data.items,
            &mut data.courses,
            &mut c.saved.marks,
            &data.synced,
            docs,
        );
        if changed {
            g.trash_put(gone);
            if let Err(e) = g.save() {
                eprintln!("collegiapp: synced items not saved ({e})");
            }
        }
        c.write_saved();
        changed
    };
    if changed {
        let _ = app.emit("items-changed", "sync");
        crate::presence::refresh(app);
    }
}

fn push(app: &AppHandle, cloud: &Cloud, token: &str, root: &str, uid: &str) -> Result<(), String> {
    for _ in 0..50 {
        let batch: Vec<(Item, String, Option<String>)> = {
            let mut c = cloud.lock();
            let st = app.state::<SharedState>();
            let g = lock(&st);
            let mut out = Vec::new();
            let mut big = Vec::new();
            for it in unpushed(&g.data.items, &c.saved.marks) {
                let j = serde_json::to_string(it).map_err(|e| e.to_string())?;
                if j.len() > MAX_DOC {
                    big.push((it.id, it.updated_at));
                    continue;
                }
                let course = it
                    .course_id
                    .as_ref()
                    .and_then(|cid| g.data.courses.iter().find(|x| &x.id == cid));
                out.push((
                    it.clone(),
                    j,
                    course.and_then(|x| serde_json::to_string(x).ok()),
                ));
                if out.len() == PUSH_BATCH {
                    break;
                }
            }
            // too big for one document: it stays on this device
            for (id, at) in big {
                c.saved.marks.pushed.insert(id, at);
            }
            out
        };
        if batch.is_empty() {
            return Ok(());
        }
        let writes: Vec<Value> = batch
            .iter()
            .map(|(it, j, course)| {
                let mut fields = json!({ "j": { "stringValue": j }, "d": { "stringValue": it.updated_by } });
                if let Some(c) = course {
                    fields["c"] = json!({ "stringValue": c });
                }
                json!({
                    "update": { "name": format!("{root}/users/{uid}/items/{}", it.id), "fields": fields },
                    "updateTransforms": [{ "fieldPath": "s", "setToServerValue": "REQUEST_TIME" }],
                })
            })
            .collect();
        let body = json!({ "writes": writes }).to_string();
        call(
            &format!("{API}/{root}:commit"),
            Body::Json(&body),
            Some(token),
        )?;
        let mut c = cloud.lock();
        for (it, _, _) in &batch {
            c.saved.marks.pushed.insert(it.id, it.updated_at);
        }
        c.write_saved();
    }
    Ok(())
}

/// The settings document's map from a `batchGet` answer; a missing or unreadable one is empty.
fn remote_settings(v: &Value) -> SyncedSettings {
    v.as_array()
        .into_iter()
        .flatten()
        .find_map(|r| r["found"]["fields"]["j"]["stringValue"].as_str())
        .and_then(|j| serde_json::from_str(j).ok())
        .unwrap_or_default()
}

/// Read the settings document, take what's newer there, and write it back if this device has
/// something newer. One read a cycle; a write only after a change.
fn sync_settings(
    app: &AppHandle,
    cloud: &Cloud,
    token: &str,
    root: &str,
    uid: &str,
) -> Result<(), String> {
    let name = format!("{root}/users/{uid}/meta/settings");
    let v = call(
        &format!("{API}/{root}:batchGet"),
        Body::Json(&json!({ "documents": [name] }).to_string()),
        Some(token),
    )?;
    let remote = remote_settings(&v);
    let (report, merged, device) = {
        let st = app.state::<SharedState>();
        let mut g = lock(&st);
        let mut merged = g.data.synced.clone();
        let report = merge_settings(&mut merged, &remote);
        for k in &report.pulled {
            g.data.set_synced(k, &merged[k].v);
            // a new feed link starts a new log, as when it's pasted here (commands.rs set_feed)
            match k.as_str() {
                "canvas_feed_url" => g.data.feeds.canvas = Default::default(),
                "gcal_feed_url" => g.data.feeds.gcal = Default::default(),
                _ => {}
            }
        }
        if merged != g.data.synced {
            g.data.synced = merged.clone();
            g.save()?;
        }
        (report, merged, g.device_id())
    };
    if !report.pulled.is_empty() {
        settings_pulled(app, &report.pulled);
    }
    if report.push {
        let j = serde_json::to_string(&merged).map_err(|e| e.to_string())?;
        let body = json!({ "writes": [{
            "update": { "name": name, "fields": { "j": { "stringValue": j }, "d": { "stringValue": device } } },
            "updateTransforms": [{ "fieldPath": "s", "setToServerValue": "REQUEST_TIME" }],
        }]});
        call(
            &format!("{API}/{root}:commit"),
            Body::Json(&body.to_string()),
            Some(token),
        )?;
    }
    cloud.lock().saved.marks.settings = merged.values().map(|s| s.at).max();
    Ok(())
}

/// Settings or courses came from another device: the windows reload (the main one takes the
/// look), presence follows the courses, a new feed link is read now, and new class picks
/// re-import the Google calendar this device reads.
fn settings_pulled(app: &AppHandle, keys: &[String]) {
    let _ = app.emit("items-changed", "sync");
    if keys.iter().any(|k| k.starts_with("course.")) {
        crate::presence::refresh(app);
    }
    let gcal = {
        let st = app.state::<SharedState>();
        let g = lock(&st);
        g.data.settings.gcal_feed_url.is_some()
    };
    let links = keys.iter().any(|k| k.ends_with("_feed_url"));
    let picks = gcal && keys.iter().any(|k| k.starts_with("gcal_"));
    if links || picks {
        let app = app.clone();
        std::thread::spawn(move || {
            let r = if links {
                crate::feeds::refresh(&app)
            } else {
                crate::feeds::reimport_gcal(&app)
            };
            if let Err(e) = r {
                eprintln!("collegiapp: synced feed settings not applied yet ({e})");
            }
        });
    }
}

// ---- HTTP ------------------------------------------------------------------------------

enum Body<'a> {
    Json(&'a str),
    Form(&'a str),
}

fn enc(s: &str) -> String {
    utf8_percent_encode(s, NON_ALPHANUMERIC).to_string()
}

fn call(url: &str, body: Body<'_>, bearer: Option<&str>) -> Result<Value, String> {
    let (code, text) = post(url, body, bearer)?;
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if (200..300).contains(&code) {
        Ok(v)
    } else {
        Err(api_error(code, &v))
    }
}

/// Google's error as a sentence, with the code words kept (id_token matches on them).
fn api_error(code: u16, v: &Value) -> String {
    let e = &v["error"];
    let msg = e["message"]
        .as_str()
        .or(v["error_description"].as_str())
        .or(e.as_str())
        .unwrap_or("")
        .to_string();
    let hint = if msg.contains("OPERATION_NOT_ALLOWED") {
        "Turn on Google in Firebase › Authentication › Sign-in method."
    } else if msg.contains("INVALID_IDP_RESPONSE") || msg.contains("audience") {
        "Google's answer was for another project: the app and the web app need the same one."
    } else if msg.contains("API key not valid") || msg.contains("API_KEY_INVALID") {
        "The API key isn't right: copy apiKey from the web app's config again."
    } else if code == 403 && e["status"].as_str() == Some("PERMISSION_DENIED") {
        "Firestore said no: publish the rules in firestore.rules (docs/SYNC.md)."
    } else if code == 404 && msg.to_lowercase().contains("database") {
        "This project has no Firestore database yet: create one in the Firebase console."
    } else {
        ""
    };
    let msg = if msg.is_empty() {
        format!("Google answered {code}.")
    } else {
        format!("{msg} ({code})")
    };
    if hint.is_empty() {
        msg
    } else {
        format!("{hint} {msg}")
    }
}

/// POST with curl. Everything goes on stdin as a curl config, the token and the body included,
/// so neither shows in the process list. Returns the status code and body.
#[cfg(desktop)]
fn post(url: &str, body: Body<'_>, bearer: Option<&str>) -> Result<(u16, String), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let (ctype, data) = match body {
        Body::Json(d) => ("application/json", d),
        Body::Form(d) => ("application/x-www-form-urlencoded", d),
    };
    let mut cmd = Command::new(crate::feeds::curl_program());
    cmd.args([
        "--silent",
        "--show-error",
        "--proto",
        "=https",
        "--max-time",
        "60",
        "--user-agent",
        "Collegiapp",
        "--config",
        "-",
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start curl ({e})."))?;
    // a quoted config value: no line breaks, backslashes and quotes escaped (JSON from serde has
    // its control characters escaped already)
    let q = |s: &str| {
        s.chars()
            .filter(|c| !c.is_control())
            .collect::<String>()
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
    };
    let mut config = format!("url = \"{}\"\nheader = \"Content-Type: {ctype}\"\n", q(url));
    if let Some(t) = bearer {
        config.push_str(&format!("header = \"Authorization: Bearer {}\"\n", q(t)));
    }
    config.push_str(&format!(
        "data-binary = \"{}\"\nwrite-out = \"\\n%{{http_code}}\"\n",
        q(data)
    ));
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(config.as_bytes());
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    let (body, code) = text.rsplit_once('\n').unwrap_or(("", text.as_str()));
    let code: u16 = code.trim().parse().unwrap_or(0);
    if !out.status.success() || code == 0 {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "Couldn't reach Google ({}).",
            err.trim().trim_start_matches("curl: ")
        ));
    }
    Ok((code, body.to_string()))
}

#[cfg(mobile)]
fn post(_url: &str, _body: Body<'_>, _bearer: Option<&str>) -> Result<(u16, String), String> {
    Err("This device can't sync yet.".into())
}

// ---- sign-in ---------------------------------------------------------------------------

/// The value of `key` in a form (`a=1&b=2`: a query or a POST body).
fn form_field(form: &str, key: &str) -> Option<String> {
    form.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| {
            percent_encoding::percent_decode_str(&v.replace('+', " "))
                .decode_utf8_lossy()
                .into_owned()
        })
    })
}

/// One request to the loopback address: method, headers (names lowercased) and body.
struct Request {
    method: String,
    headers: Vec<(String, String)>,
    body: String,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

/// Read a request of 32 KB at most (a Google ID token is about 1 KB).
fn read_request(s: &mut impl std::io::Read) -> Request {
    const MAX: usize = 32 * 1024;
    let (mut buf, mut n) = (vec![0u8; MAX], 0);
    let mut want = None;
    while n < MAX && want.is_none_or(|w| n < w) {
        match s.read(&mut buf[n..]) {
            Ok(0) | Err(_) => break,
            Ok(k) => n += k,
        }
        if want.is_none() {
            if let Some(end) = buf[..n].windows(4).position(|w| w == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&buf[..end]).to_lowercase();
                let len = head
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:"))
                    .and_then(|v| v.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                want = Some((end + 4 + len).min(MAX));
            }
        }
    }
    let text = String::from_utf8_lossy(&buf[..n]).into_owned();
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let mut lines = head.lines();
    let method = lines
        .next()
        .and_then(|l| l.split_whitespace().next())
        .unwrap_or("")
        .to_string();
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_string()))
        .collect();
    Request {
        method,
        headers,
        body: body.to_string(),
    }
}

/// What the link page sent, if it's the answer to this sign-in: a POST carrying this sign-in's
/// `state`, which only the page the app opened knows. Gives the Google ID token, or the page's
/// error.
fn link_answer(req: &Request, state: &str, origins: &[String]) -> Option<Result<String, String>> {
    if req.method != "POST" {
        return None;
    }
    // A post names the site it came from, and another site's is refused. A browser may say "null"
    // instead (a strict referrer policy, https to http, a privacy add-on), so the state decides.
    if req
        .header("origin")
        .is_some_and(|o| o != "null" && !origins.iter().any(|x| x == o))
    {
        return None;
    }
    if form_field(&req.body, "state").as_deref() != Some(state) {
        return None;
    }
    if let Some(e) = form_field(&req.body, "error") {
        return Some(Err(e));
    }
    form_field(&req.body, "id_token")
        .filter(|t| !t.is_empty())
        .map(Ok)
}

/// Wait (10 minutes at most) for the link page to post the Google ID token to the loopback
/// address.
#[cfg(desktop)]
fn wait_for_token(
    listener: std::net::TcpListener,
    state: &str,
    origins: &[String],
) -> Result<String, String> {
    use std::io::Write;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(600);
    loop {
        let mut s = match listener.accept() {
            Ok((s, _)) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err("Sign-in timed out. Try again.".into());
                }
                std::thread::sleep(Duration::from_millis(200));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        let _ = s.set_nonblocking(false);
        let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
        let req = read_request(&mut s);
        let answer = link_answer(&req, state, origins);
        if answer.is_none() && req.method != "POST" {
            // the browser asking for a favicon
            let _ = s.write_all(
                b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
            continue;
        }
        // a post that isn't this sign-in's answer is turned away, and the app keeps waiting
        let (code, text) = match &answer {
            Some(Ok(_)) => ("200 OK", "Collegiapp is signing in. You can close this tab."),
            Some(Err(_)) => ("200 OK", "Sign-in didn't finish. Go back to Collegiapp and try again."),
            None => ("403 Forbidden", "This isn't the sign-in Collegiapp is waiting for. In Collegiapp, choose Sign in again."),
        };
        let page = format!(
            "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><title>Collegiapp</title><body style=\"font:16px system-ui;display:grid;place-items:center;height:90vh;margin:0;padding:16px;background:#efe9dc;color:#1b1915\"><p>{text}</p>"
        );
        let _ = s.write_all(format!("HTTP/1.1 {code}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{page}", page.len()).as_bytes());
        if let Some(answer) = answer {
            return answer.map_err(|e| format!("The sign-in page said: {e}"));
        }
    }
}

/// Trade the Google ID token for a Firebase session of this device's own.
fn finish(cfg: &CloudConfig, id_token: &str) -> Result<(Session, String, u64), String> {
    let body = json!({
        "postBody": format!("id_token={}&providerId=google.com", enc(id_token)),
        "requestUri": "http://localhost",
        "returnSecureToken": true,
    });
    let url = format!(
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key={}",
        enc(&cfg.api_key)
    );
    let f = call(&url, Body::Json(&body.to_string()), None)?;
    let s = |k: &str| f[k].as_str().unwrap_or("").to_string();
    let session = Session {
        uid: s("localId"),
        email: s("email"),
        refresh_token: s("refreshToken"),
    };
    if session.uid.is_empty() || session.refresh_token.is_empty() {
        return Err("Firebase didn't start a session.".into());
    }
    let secs = s("expiresIn").parse().unwrap_or(3600);
    Ok((session, s("idToken"), secs))
}

/// Open the web app's link page, which signs in with Google and posts the ID token back here.
/// Asked again while it waits, it opens the same page again.
#[cfg(desktop)]
fn begin_sign_in(app: &AppHandle) -> Result<(), String> {
    let cloud = app.state::<Cloud>();
    let cfg = {
        let mut c = cloud.lock();
        if let (true, Some(link)) = (c.signing_in, c.link.clone()) {
            drop(c);
            return crate::commands::open_link(link, app.clone(), app.state());
        }
        if !c.config().ready() {
            return Err("Fill in your Firebase project first.".into());
        }
        c.signing_in = true;
        c.error = None;
        c.config().clone()
    };
    let fail = |e: String| {
        cloud.lock().signing_in = false;
        e
    };
    let listener =
        std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|e| fail(e.to_string()))?;
    let port = listener
        .local_addr()
        .map_err(|e| fail(e.to_string()))?
        .port();
    let state = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let origins = cfg.origins();
    let link = format!("{}/link.html#port={port}&state={state}", origins[0]);
    cloud.lock().link = Some(link.clone());
    crate::commands::open_link(link, app.clone(), app.state()).map_err(fail)?;
    let app = app.clone();
    std::thread::spawn(move || {
        let r = wait_for_token(listener, &state, &origins).and_then(|t| finish(&cfg, &t));
        let cloud = app.state::<Cloud>();
        {
            let mut c = cloud.lock();
            c.signing_in = false;
            c.link = None;
            match r {
                Ok((session, token, secs)) => {
                    c.saved.marks = Marks::default();
                    c.session = Some(session);
                    c.token = Some((token, Instant::now() + Duration::from_secs(secs)));
                    c.error = None;
                    let now = Instant::now();
                    (c.next_pull, c.next_try) = (now, now);
                    c.write_session();
                    c.write_saved();
                }
                Err(e) => c.error = Some(e),
            }
        }
        emit(&app);
        bring_back(&app);
    });
    Ok(())
}

/// After the browser, bring the app back to the front.
#[cfg(desktop)]
fn bring_back(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg(mobile)]
fn begin_sign_in(_app: &AppHandle) -> Result<(), String> {
    Err("Sign in on a computer for now.".into())
}

// ---- commands --------------------------------------------------------------------------

#[tauri::command]
pub fn cloud_status(app: AppHandle) -> CloudStatus {
    status(&app)
}

/// Save another project, or with an empty config go back to the built-in one. A different
/// project or key signs out (its marks belong to the old one).
#[tauri::command]
pub fn cloud_config(app: AppHandle, config: CloudConfig) -> Result<CloudStatus, String> {
    let config = if config == CloudConfig::default() {
        config
    } else {
        config.check()?
    };
    {
        let cloud = app.state::<Cloud>();
        let mut c = cloud.lock();
        let old = c.config().clone();
        c.saved.config = config;
        let new = c.config();
        let moved = old.project_id != new.project_id || old.api_key != new.api_key;
        c.error = None;
        if moved && c.session.is_some() {
            c.sign_out();
        } else {
            c.write_saved();
        }
    }
    emit(&app);
    Ok(status(&app))
}

/// Open Google's sign-in in the browser; the answer comes back as a "cloud" event.
#[tauri::command]
pub fn cloud_sign_in(app: AppHandle) -> Result<CloudStatus, String> {
    begin_sign_in(&app)?;
    emit(&app);
    Ok(status(&app))
}

/// Stop syncing here. Your data stays on this device and in your Firebase project.
#[tauri::command]
pub fn cloud_sign_out(app: AppHandle) -> CloudStatus {
    {
        let cloud = app.state::<Cloud>();
        let mut c = cloud.lock();
        c.sign_out();
        c.error = None;
        c.last_sync = None;
    }
    emit(&app);
    status(&app)
}

/// Sync within 5 s instead of waiting for the minute.
#[tauri::command]
pub fn cloud_sync_now(app: AppHandle) -> CloudStatus {
    {
        let cloud = app.state::<Cloud>();
        let mut c = cloud.lock();
        let now = Instant::now();
        (c.next_pull, c.next_try) = (now, now);
    }
    status(&app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use collegiapp_core::ItemKind;

    fn item(title: &str, at: &str) -> Item {
        let t = DateTime::parse_from_rfc3339(at)
            .unwrap()
            .with_timezone(&Utc);
        Item::new(title, ItemKind::Task, t, "dev-a")
    }

    fn doc(it: &Item, at: &str) -> Remote {
        Remote {
            at: DateTime::parse_from_rfc3339(at)
                .unwrap()
                .with_timezone(&Utc),
            item: Some(it.clone()),
            course: None,
        }
    }

    fn post(origin: &str, body: &str) -> Request {
        let raw = format!("POST / HTTP/1.1\r\nHost: 127.0.0.1:5000\r\nOrigin: {origin}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        read_request(&mut raw.as_bytes())
    }

    #[test]
    fn the_link_page_answer_needs_its_origin_and_state() {
        let origins = CloudConfig {
            api_key: "k".into(),
            project_id: "collegiapp-1234".into(),
        }
        .origins();
        let ok = post(
            "https://collegiapp-1234.firebaseapp.com",
            "state=s1&id_token=eyJ.a%2Bb.c",
        );
        assert_eq!(ok.method, "POST");
        assert_eq!(
            link_answer(&ok, "s1", &origins),
            Some(Ok("eyJ.a+b.c".to_string()))
        );
        assert_eq!(link_answer(&ok, "s2", &origins), None);
        let elsewhere = post("https://evil.example", "state=s1&id_token=x");
        assert_eq!(link_answer(&elsewhere, "s1", &origins), None);
        // Firefox posts from https to http with "Origin: null" unless the page's referrer policy is "origin"
        let null = post("null", "state=s1&id_token=t");
        assert_eq!(
            link_answer(&null, "s1", &origins),
            Some(Ok("t".to_string()))
        );
        assert_eq!(link_answer(&null, "s2", &origins), None);
        let cancelled = post(
            "https://collegiapp-1234.web.app",
            "state=s1&error=cancelled",
        );
        assert_eq!(
            link_answer(&cancelled, "s1", &origins),
            Some(Err("cancelled".to_string()))
        );
        let get = read_request(&mut &b"GET /favicon.ico HTTP/1.1\r\nHost: x\r\n\r\n"[..]);
        assert_eq!(link_answer(&get, "s1", &origins), None);
    }

    #[test]
    fn a_pull_merges_by_last_write_and_trashes_what_another_device_deleted() {
        let mine = item("mine", "2026-11-01T10:00:00Z");
        let mut older = mine.clone();
        older.title = "older".into();
        older.updated_at = DateTime::parse_from_rfc3339("2026-11-01T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let gone = item("gone", "2026-11-01T10:00:00Z");
        let mut deleted = gone.clone();
        deleted.deleted = true;
        deleted.updated_at = DateTime::parse_from_rfc3339("2026-11-01T11:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let new = item("from the phone", "2026-11-01T10:30:00Z");
        let mut items = vec![mine.clone(), gone.clone()];
        let (mut courses, mut marks) = (Vec::new(), Marks::default());
        let synced = SyncedSettings::new();
        let docs = [
            doc(&older, "2026-11-01T12:00:01Z"),
            doc(&deleted, "2026-11-01T12:00:02Z"),
            doc(&new, "2026-11-01T12:00:00Z"),
        ];
        let (changed, trashed) = merge_remote(&mut items, &mut courses, &mut marks, &synced, &docs);
        assert!(changed);
        assert_eq!(items[0].title, "mine"); // newer here: kept, and still to push
        assert!(items[1].deleted);
        assert_eq!(items[2].title, "from the phone");
        assert_eq!(trashed.len(), 1);
        assert_eq!(trashed[0].0.title, "gone");
        assert_eq!(marks.last_pull, Some(docs[1].at));
        let left: Vec<&str> = unpushed(&items, &marks).map(|i| i.title.as_str()).collect();
        assert_eq!(left, ["mine"]);
        // pulling the same documents again changes nothing
        let (again, _) = merge_remote(&mut items, &mut courses, &mut marks, &synced, &docs[1..]);
        assert!(!again);
    }

    /// An item's `c` adds a course only while the settings document has no say on it: once it
    /// has a key there (edited, or deleted as null), the item's older copy never brings it back.
    #[test]
    fn an_items_course_comes_only_when_the_account_has_none() {
        let mut it = item("hw", "2026-11-01T10:00:00Z");
        it.course_id = Some("cs16-f26".into());
        let mut d = doc(&it, "2026-11-01T12:00:00Z");
        d.course = Some(Course::new("cs16-f26", "CMPSC 16"));
        let mut deleted = SyncedSettings::new();
        deleted.insert(
            "course.cs16-f26".into(),
            collegiapp_core::Setting {
                v: Value::Null,
                at: d.at,
                by: "dev-b".into(),
            },
        );
        let (mut items, mut courses, mut marks) = (Vec::new(), Vec::new(), Marks::default());
        merge_remote(
            &mut items,
            &mut courses,
            &mut marks,
            &deleted,
            std::slice::from_ref(&d),
        );
        assert!(
            courses.is_empty(),
            "deleted on another device: stays deleted"
        );
        assert_eq!(items.len(), 1, "the item still comes");
        let (mut items, mut courses, mut marks) = (Vec::new(), Vec::new(), Marks::default());
        let none = SyncedSettings::new();
        merge_remote(
            &mut items,
            &mut courses,
            &mut marks,
            &none,
            std::slice::from_ref(&d),
        );
        assert_eq!(
            courses.len(),
            1,
            "no say yet: the item's copy is all there is"
        );
    }

    #[test]
    fn the_sample_and_never_synced_tombstones_stay_local() {
        let mut sample = item("welcome", "2026-11-01T10:00:00Z");
        sample.source.adapter = "sample".into();
        let mut tomb = item("old", "2026-11-01T10:00:00Z");
        tomb.deleted = true;
        let fresh = item("new", "2026-11-01T10:00:00Z");
        let items = vec![sample, tomb.clone(), fresh];
        let mut marks = Marks::default();
        assert_eq!(unpushed(&items, &marks).count(), 1);
        // a tombstone of something the server has goes up
        marks
            .pushed
            .insert(tomb.id, tomb.updated_at - chrono::Duration::minutes(1));
        assert_eq!(unpushed(&items, &marks).count(), 2);
    }

    #[test]
    fn a_full_page_drops_the_tail_of_its_last_write_time() {
        let it = item("x", "2026-11-01T10:00:00Z");
        let mut docs = vec![
            doc(&it, "2026-11-01T12:00:00Z"),
            doc(&it, "2026-11-01T12:00:01Z"),
            doc(&it, "2026-11-01T12:00:01Z"),
        ];
        trim_page(&mut docs, false);
        assert_eq!(docs.len(), 3);
        trim_page(&mut docs, true);
        assert_eq!(docs.len(), 1);
    }

    #[test]
    fn a_config_is_cleaned_and_checked() {
        let c = CloudConfig {
            api_key: " \"AIzaSyA-1_b\" ".into(),
            project_id: "collegiapp-1234".into(),
        }
        .check()
        .unwrap();
        assert_eq!(c.api_key, "AIzaSyA-1_b");
        let bad = CloudConfig {
            project_id: "My Project".into(),
            ..c
        };
        assert!(bad.check().is_err());
    }

    #[test]
    fn a_web_config_is_read_from_the_file_or_the_console_block() {
        let file = "/* apiKey, projectId and appId */\nwindow.CA_CLOUD = { apiKey: \"AIza-x\", projectId: \"collegiapp-1234\", appId: \"1:2:web:3\" };";
        let c = parse_web_config(file);
        assert_eq!(
            (c.api_key.as_str(), c.project_id.as_str()),
            ("AIza-x", "collegiapp-1234")
        );
        let console =
            "const firebaseConfig = {\n  \"apiKey\": 'AIza-y',\n  projectId: \"p-1\",\n};";
        assert_eq!(parse_web_config(console).project_id, "p-1");
        assert!(!parse_web_config("window.CA_CLOUD = { apiKey: \"\", projectId: \"\" };").ready());
        built_in(); // the shipped file reads, empty or not
    }

    #[test]
    fn the_settings_document_is_read_from_a_batch_get() {
        let j = r#"{"look.pal":{"v":"P13","at":"2026-11-02T10:00:00.250Z","by":"web-1"}}"#;
        let found = json!([{ "found": { "name": "x", "fields": {
            "j": { "stringValue": j }, "d": { "stringValue": "web-1" }, "s": { "timestampValue": "2026-11-02T10:00:01Z" },
        }}, "readTime": "2026-11-02T10:00:02Z" }]);
        let s = remote_settings(&found);
        assert_eq!(s["look.pal"].v, json!("P13"));
        let missing = json!([{ "missing": "x", "readTime": "2026-11-02T10:00:02Z" }]);
        assert!(remote_settings(&missing).is_empty());
        assert!(remote_settings(&Value::Null).is_empty());
    }

    #[test]
    fn google_errors_get_a_next_step() {
        let v = json!({ "error": { "code": 400, "message": "OPERATION_NOT_ALLOWED", "status": "INVALID_ARGUMENT" } });
        assert!(api_error(400, &v).starts_with("Turn on Google"));
        let v = json!({ "error": "invalid_grant", "error_description": "Bad Request" });
        assert_eq!(api_error(400, &v), "Bad Request (400)");
        assert_eq!(api_error(502, &Value::Null), "Google answered 502.");
    }
}
