//! Local-first persistence: one JSON snapshot in the app data dir, rewritten atomically on
//! every change. (SQLite can replace this later; the snapshot shape is the sync unit anyway.)
//!
//! Location: `<app_data_dir>/collegiapp.json`, e.g.
//! `%APPDATA%\io.github.imanimal.collegiapp\collegiapp.json` on Windows,
//! `~/Library/Application Support/io.github.imanimal.collegiapp/collegiapp.json` on macOS.
//! Set `COLLEGIAPP_DATA` to a folder to use that instead (tests, a second profile).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use chrono::Utc;
use collegiapp_core::webwork::WwCourse;
use collegiapp_core::{
    default_views, stamp_settings, Course, Item, ItemKind, Status, SyncedSettings, View,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::feeds::Feeds;
use crate::focus::FocusLevel;
use crate::start::StartApp;
use crate::trash::{self, Trash};

pub const SNAPSHOT_VERSION: u32 = 1;
pub const FILE_NAME: &str = "collegiapp.json";

/// User settings (stub; grows over time).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Browser used for links: a program name the OS can launch ("firefox", "chrome",
    /// "Safari") or None for the system default. Falls back to the default on failure.
    pub browser: Option<String>,
    /// Canvas calendar feed URL (Canvas > Calendar > Calendar Feed). See `feeds.rs`.
    pub canvas_feed_url: Option<String>,
    /// Google Calendar "Secret address in iCal format" (Settings > your calendar > Integrate).
    pub gcal_feed_url: Option<String>,
    /// UIDs of the Google series you marked as classes. None = not chosen yet: series that
    /// name one of your courses count as classes.
    pub gcal_series: Option<Vec<String>>,
    /// UIDs of the picked series that are sections (discussion, lab). None = not chosen yet:
    /// series whose title reads as a section ("Lab", "Dis", "Section").
    pub gcal_sections: Option<Vec<String>>,
    /// Series UID -> course id, for classes and sections whose title doesn't name the course.
    pub gcal_courses: BTreeMap<String, String>,
    /// UIDs of Google series hidden from the Classes list (right-click > Hide): never classes.
    pub gcal_hidden: Vec<String>,
    /// Gradescope is connected: its courses' assignments are imported with the session you
    /// signed in with (gradescope.rs).
    pub gradescope: bool,
    /// The WeBWorK courses you signed in to; their homework lists are read with those sessions
    /// (webwork.rs).
    pub webwork_courses: Vec<WwCourse>,
    /// Process blocklist for Hard/Lockdown focus. Empty = built-in default list.
    pub focus_blocklist: Vec<String>,
    /// Level used by the tray's "Focus 25 min".
    pub tray_focus_level: FocusLevel,
    /// Windows: a lone Win key and clicks on the taskbar's Start key and search box open Pocket
    /// Start instead of Windows' Start and Search (start.rs).
    pub start_win_key: bool,
    /// Pocket Start's pinned apps. None = the pins of Windows' Start.
    pub start_pins: Option<Vec<StartApp>>,
    /// Apps hidden from Pocket Start's All apps and search, by id (start/menu.rs).
    pub start_hidden: Vec<String>,
    /// Most the trash keeps on disk, in MB (trash.rs); the oldest go first past it.
    pub trash_limit_mb: u32,
    /// The Appearance drawer's choices that sync (lab.js `look()`), null for one at its
    /// default. None until the UI first sends them.
    pub look: Option<BTreeMap<String, Value>>,
}

/// The settings that follow you to your other devices (cloud.rs): the calendar feed links, the
/// Google class picks and the tray's focus level, plus the look as "look.<name>". The feed
/// links are secret; you chose (2026-11-02) to keep them in your own uid-locked settings
/// document rather than paste them on each device. Sign-ins, the browser, the blocklist
/// (Windows program names), Pocket Start and the trash limit stay on each device.
const SYNCED: &[&str] = &[
    "canvas_feed_url",
    "gcal_feed_url",
    "gcal_series",
    "gcal_sections",
    "gcal_courses",
    "gcal_hidden",
    "tray_focus_level",
];

impl Settings {
    /// This device's synced settings by key, for `collegiapp_core::stamp_settings`.
    pub fn synced(&self) -> BTreeMap<String, Value> {
        let all = serde_json::to_value(self).unwrap_or_default();
        let mut out: BTreeMap<String, Value> = SYNCED
            .iter()
            .map(|k| (k.to_string(), all[*k].clone()))
            .collect();
        for (k, v) in self.look.iter().flatten() {
            out.insert(format!("look.{k}"), v.clone());
        }
        out
    }

    /// Take another device's value for a synced key. A value this version can't read, or a
    /// key it doesn't sync, is skipped.
    pub fn set_synced(&mut self, key: &str, v: &Value) {
        if let Some(k) = key.strip_prefix("look.") {
            self.look
                .get_or_insert_default()
                .insert(k.to_string(), v.clone());
        } else if SYNCED.contains(&key) {
            let mut all = serde_json::to_value(&*self).unwrap_or_default();
            all[key] = v.clone();
            if let Ok(s) = serde_json::from_value(all) {
                *self = s;
            }
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            browser: Some("firefox".into()),
            canvas_feed_url: None,
            gcal_feed_url: None,
            gcal_series: None,
            gcal_sections: None,
            gcal_courses: BTreeMap::new(),
            gcal_hidden: Vec::new(),
            gradescope: false,
            webwork_courses: Vec::new(),
            focus_blocklist: Vec::new(),
            tray_focus_level: FocusLevel::Hard,
            start_win_key: true,
            start_pins: None,
            start_hidden: Vec::new(),
            trash_limit_mb: crate::trash::DEFAULT_LIMIT_MB,
            look: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    #[serde(default)]
    pub version: u32,
    pub device_id: String,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub courses: Vec<Course>,
    #[serde(default)]
    pub items: Vec<Item>,
    #[serde(default)]
    pub views: Vec<View>,
    /// Last fetch of each calendar feed, and the Google series list for the class picker.
    #[serde(default)]
    pub feeds: Feeds,
    /// When and where each synced setting last changed, here or on another device: `save`
    /// stamps changes made here, and cloud.rs merges the account's in.
    #[serde(default)]
    pub synced: SyncedSettings,
}

impl Snapshot {
    pub fn fresh() -> Snapshot {
        let device_id = format!("desktop-{}", uuid::Uuid::new_v4().simple());
        let now = Utc::now();
        let mut welcome = Item::new(
            "Welcome to Collegiapp: press Ctrl/Cmd+Shift+Space and try \"hw4 130a fri 11:59p ~2h !!\"",
            ItemKind::Task,
            now,
            &device_id,
        );
        welcome.status = Status::Inbox;
        welcome.tags = vec!["sample".into()];
        welcome.source.adapter = "sample".into();
        Snapshot {
            version: SNAPSHOT_VERSION,
            device_id,
            settings: Settings::default(),
            courses: Vec::new(),
            items: vec![welcome],
            views: default_views(),
            feeds: Feeds::default(),
            synced: SyncedSettings::new(),
        }
    }

    /// Live items outside excluded courses: what presence and alerts look at.
    pub fn visible_items(&self) -> Vec<Item> {
        let excluded = |cid: &String| self.courses.iter().any(|c| &c.id == cid && !c.included);
        self.items
            .iter()
            .filter(|i| !i.deleted && !i.course_id.as_ref().is_some_and(excluded))
            .cloned()
            .collect()
    }
}

pub struct AppState {
    pub data: Snapshot,
    pub path: PathBuf,
    /// Deleted items and undone versions, in `trash/` beside the store.
    pub trash: Trash,
}

pub type SharedState = Mutex<AppState>;

/// Lock ignoring poisoning (a panicked command must not brick the app).
pub fn lock(state: &SharedState) -> MutexGuard<'_, AppState> {
    state.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    pub fn load_or_init(path: PathBuf) -> Result<AppState, String> {
        let data = match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<Snapshot>(&text) {
                Ok(mut s) => {
                    if s.views.is_empty() {
                        s.views = default_views();
                    }
                    s
                }
                Err(e) => {
                    // keep the unreadable file for recovery, start fresh
                    let backup =
                        path.with_extension(format!("corrupt-{}.json", Utc::now().timestamp()));
                    let _ = fs::rename(&path, &backup);
                    eprintln!(
                        "collegiapp: snapshot unreadable ({e}); moved to {}",
                        backup.display()
                    );
                    Snapshot::fresh()
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Snapshot::fresh(),
            Err(e) => return Err(format!("cannot read {}: {e}", path.display())),
        };
        let trash = Trash::new(path.with_file_name("trash"));
        let mut st = AppState { data, path, trash };
        st.save()?;
        Ok(st)
    }

    /// Stamp the synced settings that changed (cloud.rs sends them), then write atomically:
    /// temp file + rename.
    pub fn save(&mut self) -> Result<(), String> {
        let d = &mut self.data;
        stamp_settings(
            &mut d.synced,
            &d.settings.synced(),
            &Settings::default().synced(),
            Utc::now(),
            &d.device_id,
        );
        write_atomic(&self.path, &self.data)
    }

    pub fn device_id(&self) -> String {
        self.data.device_id.clone()
    }

    pub fn trash_limit(&self) -> u64 {
        trash::limit_bytes(self.data.settings.trash_limit_mb)
    }

    /// Trash snapshots `(item, why, gone)`; a failure only costs the trash, never the save.
    pub fn trash_put(&mut self, snaps: Vec<(Item, String, bool)>) {
        let limit = self.trash_limit();
        if let Err(e) = self.trash.put(snaps, limit) {
            eprintln!("collegiapp: trash not written ({e})");
        }
    }

    /// Upsert items saved by the UI. Keeps `created_at`, stamps `updated_at`/`updated_by`.
    ///
    /// The trash gets the version a save throws away when it matters: a deleted item's last
    /// version ("Deleted", or the `why` of an undone add), and with a `why` ("Undone rename")
    /// the version an undo replaced. An item that comes back drops its "gone" entries.
    pub fn save_from_ui(&mut self, items: Vec<Item>, why: &BTreeMap<Uuid, String>) {
        let (now, device) = (Utc::now(), self.device_id());
        let (mut snaps, mut back) = (Vec::new(), Vec::new());
        for mut item in items {
            item.priority = item.priority.min(3);
            if let Some(existing) = self.data.items.iter().find(|i| i.id == item.id) {
                item.created_at = existing.created_at;
                let reason = why.get(&item.id);
                match (existing.deleted, item.deleted) {
                    (false, true) => {
                        let r = reason.map_or("Deleted", |r| r.as_str());
                        snaps.push((existing.clone(), r.to_string(), true));
                    }
                    (true, false) => back.push(item.id),
                    (false, false) => {
                        if let Some(r) = reason.filter(|_| !same_content(existing, &item)) {
                            snaps.push((existing.clone(), r.clone(), false));
                        }
                    }
                    (true, true) => {}
                }
            }
            item.touch(now, &device);
            self.upsert(item);
        }
        self.trash_put(snaps);
        if let Err(e) = self.trash.revived(&back) {
            eprintln!("collegiapp: trash not updated ({e})");
        }
    }

    /// Insert or replace by id.
    pub fn upsert(&mut self, item: Item) {
        match self.data.items.iter_mut().find(|i| i.id == item.id) {
            Some(slot) => *slot = item,
            None => self.data.items.push(item),
        }
    }
}

/// Same item apart from when and where it was last saved.
pub fn same_content(a: &Item, b: &Item) -> bool {
    let mut a = a.clone();
    (a.created_at, a.updated_at, a.updated_by) = (b.created_at, b.updated_at, b.updated_by.clone());
    a == *b
}

fn write_atomic(path: &Path, data: &Snapshot) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    let json = serde_json::to_vec_pretty(data).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("cannot replace {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact shape `itemOut` in ui/js/store.js sends to `save_items`: nulls for empty
    /// options, ISO times with milliseconds, a blank `updated_by`.
    #[test]
    fn accepts_the_ui_item_shape() {
        let js = r#"{"id":"054bfb7b-b27c-44d5-bc72-a9cb2d362e4c","title":"quick","kind":"task","status":"inbox",
            "course_id":null,"due":"2026-11-05T06:59:00.000Z","end":null,"est_minutes":null,"priority":0,"weight_pct":null,
            "tags":[],"links":[{"label":"x.com","url":"https://x.com"}],"location":null,"notes":"","interrupt":"none",
            "source":{"external_id":"event-assignment-4","url":null,"kind":"info","adapter":"canvas"},"snoozed_until":null,
            "created_at":"2026-11-01T07:38:18.573Z","updated_at":"2026-11-01T07:38:18.573Z","updated_by":"","deleted":false}"#;
        let it: Item = serde_json::from_str(js).unwrap();
        assert_eq!(it.title, "quick");
        assert_eq!(it.status, Status::Inbox);
        // the reader's kind rides along in the source, so a kind you pick stays yours
        assert_eq!(
            (it.source.adapter.as_str(), it.source.kind),
            ("canvas", Some(ItemKind::Info))
        );
        assert_eq!(it.due.unwrap().to_rfc3339(), "2026-11-05T06:59:00+00:00");
    }

    /// What the UI's saves leave in the trash: deletes, undone versions, and nothing for plain
    /// edits; an item that comes back takes its delete out of the trash.
    #[test]
    fn ui_saves_fill_the_trash() {
        let dir = std::env::temp_dir().join(format!("ca-store-{}", Uuid::new_v4().simple()));
        let mut st = AppState::load_or_init(dir.join(FILE_NAME)).unwrap();
        let lim = st.trash_limit();
        let mut hw = Item::new("hw4", ItemKind::Assignment, Utc::now(), "d");
        st.save_from_ui(vec![hw.clone()], &BTreeMap::new());

        hw.priority = 2; // a plain edit
        st.save_from_ui(vec![hw.clone()], &BTreeMap::new());
        assert!(st.trash.info(lim).entries.is_empty());

        hw.priority = 0; // its undo: the "!!" version is trashed
        st.save_from_ui(
            vec![hw.clone()],
            &BTreeMap::from([(hw.id, "Undone priority".into())]),
        );
        let info = st.trash.info(lim);
        assert_eq!(info.entries.len(), 1);
        assert_eq!(
            (info.entries[0].why.as_str(), info.entries[0].gone),
            ("Undone priority", false)
        );

        hw.deleted = true;
        st.save_from_ui(vec![hw.clone()], &BTreeMap::new());
        let info = st.trash.info(lim);
        assert_eq!(
            (info.entries[0].why.as_str(), info.entries[0].gone),
            ("Deleted", true)
        );
        let back = st.trash.take(&[info.entries[0].id.clone()]).unwrap();
        assert!(!back[0].1.deleted, "the version before the delete");
        st.trash
            .put(vec![(back[0].1.clone(), "Deleted".into(), true)], lim)
            .unwrap();

        hw.deleted = false; // undo the delete: no need to keep it in the trash
        st.save_from_ui(
            vec![hw.clone()],
            &BTreeMap::from([(hw.id, "Undone delete".into())]),
        );
        let left: Vec<String> = st
            .trash
            .info(lim)
            .entries
            .into_iter()
            .map(|m| m.why)
            .collect();
        assert_eq!(left, vec!["Undone priority"]);
        let _ = fs::remove_dir_all(&dir);
    }

    /// A fresh store stamps nothing; a class pick, a feed link or a look change made here is
    /// stamped on save; and another device's values land in the right fields.
    #[test]
    fn synced_settings_stamp_on_save_and_take_other_devices_values() {
        let dir = std::env::temp_dir().join(format!("ca-store-{}", Uuid::new_v4().simple()));
        let mut st = AppState::load_or_init(dir.join(FILE_NAME)).unwrap();
        assert!(st.data.synced.is_empty(), "defaults stay unstamped");
        st.data.settings.look = Some(BTreeMap::from([("pal".into(), Value::Null)]));
        st.save().unwrap();
        assert!(st.data.synced.is_empty(), "a look at its defaults too");

        st.data.settings.gcal_hidden = vec!["uid-1".into()];
        st.data.settings.gcal_feed_url = Some("https://calendar.google.com/x/basic.ics".into());
        st.data.settings.look = Some(BTreeMap::from([("pal".into(), "P13".into())]));
        st.data.settings.trash_limit_mb = 7; // stays on this device
        st.data.settings.gradescope = true; // a sign-in: stays on this device
        st.save().unwrap();
        let keys: Vec<&str> = st.data.synced.keys().map(String::as_str).collect();
        assert_eq!(keys, ["gcal_feed_url", "gcal_hidden", "look.pal"]);
        assert_eq!(st.data.synced["look.pal"].by, st.data.device_id);

        let mut s = Settings::default();
        s.set_synced("gcal_courses", &serde_json::json!({ "uid-2": "cs130a" }));
        s.set_synced("tray_focus_level", &"soft".into());
        s.set_synced("look.night", &"auto".into());
        s.set_synced("canvas_feed_url", &"https://canvas.example/feed.ics".into());
        s.set_synced("gcal_series", &42.into()); // unreadable: skipped
        s.set_synced("trash_limit_mb", &1.into()); // not synced: skipped
        assert_eq!(s.gcal_courses["uid-2"], "cs130a");
        assert_eq!(s.tray_focus_level, FocusLevel::Soft);
        assert_eq!(s.look.as_ref().unwrap()["night"], "auto");
        assert_eq!(
            s.canvas_feed_url.as_deref(),
            Some("https://canvas.example/feed.ics")
        );
        assert_eq!(s.gcal_series, None);
        assert_eq!(s.trash_limit_mb, Settings::default().trash_limit_mb);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn visible_items_skip_excluded_courses_and_tombstones() {
        let mut s = Snapshot::fresh();
        let now = Utc::now();
        let mut a = Item::new("a", ItemKind::Class, now, "d");
        a.course_id = Some("x16".into());
        let mut b = Item::new("b", ItemKind::Class, now, "d");
        b.deleted = true;
        let mut old = Course::new("x16", "CMPSC 16");
        old.included = false;
        s.courses.push(old);
        s.items.extend([a, b]);
        let titles: Vec<String> = s.visible_items().into_iter().map(|i| i.title).collect();
        assert_eq!(titles.len(), 1, "only the welcome item: {titles:?}");
    }
}
