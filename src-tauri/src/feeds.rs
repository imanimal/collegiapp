//! Calendar feeds: the Canvas calendar feed and a Google Calendar secret iCal address (and
//! Gradescope and WeBWorK, which refresh with them: gradescope.rs, webwork.rs). They are fetched when you connect them, when the UI asks, and every [`REFRESH_EVERY`] in the
//! background, then imported through `collegiapp_core::ics` (re-imports keep your edits).
//!
//! Fetching runs the system `curl` (Windows 10 1803+ and macOS ship it), so the app carries no
//! HTTP stack of its own. The URL reaches curl on stdin (`--config -`), not the command line,
//! because these addresses are secrets (anyone holding one can read the calendar) and command
//! lines are visible to other processes. Feed URLs stay in the local store and are never synced.
//! iOS/Android have no curl: there, import a downloaded .ics file until the mobile build (M6).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, Local, Utc};
use collegiapp_core::gradescope::GsCourse;
use collegiapp_core::ics::{self, ClassPicks, SeriesInfo};
use collegiapp_core::{merge_imported, ImportCounts};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::store::{lock, AppState, SharedState};

pub const REFRESH_EVERY: StdDuration = StdDuration::from_secs(30 * 60);
/// Google classes are expanded from a week ago to this many days ahead.
pub const AHEAD_DAYS: i64 = 120;
#[cfg(desktop)]
const MAX_BYTES: &str = "20000000";

/// The outcome of the last fetch of one feed.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct FeedLog {
    pub checked_at: Option<DateTime<Utc>>,
    pub ok: bool,
    /// The error, when `ok` is false.
    pub error: String,
    pub counts: ImportCounts,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Feeds {
    pub canvas: FeedLog,
    pub gcal: FeedLog,
    /// This term's recurring Google series, for "which of these are classes?".
    pub series: Vec<SeriesInfo>,
    pub gradescope: FeedLog,
    /// The Gradescope courses of this term, as last read.
    pub gradescope_courses: Vec<GsCourse>,
    /// Assignments (item external ids) seen submitted, so only new submissions mark items done.
    pub gradescope_submitted: Vec<String>,
    pub webwork: FeedLog,
    /// Google series whose meetings were pruned (un-picked, hidden or read as a copy), so they
    /// come back when the series is a class again. None = from before this was kept.
    pub gcal_pruned: Option<Vec<String>>,
}

/// The last Google export, kept in memory so changing the class picks re-imports without a
/// second download, and a guard against two refreshes at once.
#[derive(Default)]
pub struct FeedCache {
    gcal: Mutex<Option<String>>,
    busy: AtomicBool,
}

/// Accept `https://` and `webcal://` (rewritten to https) addresses only.
pub fn normalize_url(raw: &str) -> Result<String, String> {
    let u = raw.trim();
    let u = match u.strip_prefix("webcal://") {
        Some(rest) => format!("https://{rest}"),
        None => u.to_string(),
    };
    if !u.starts_with("https://") || u.len() <= "https://".len() {
        return Err("Paste the full https:// or webcal:// address of the feed.".into());
    }
    if u.chars()
        .any(|c| c.is_whitespace() || c.is_control() || c == '"' || c == '\\')
    {
        return Err("That address has spaces or quotes in it. Copy it again.".into());
    }
    Ok(u)
}

#[cfg(desktop)]
pub(crate) fn curl_program() -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    if let Some(root) = std::env::var_os("SystemRoot") {
        // the copy Windows ships, not whatever "curl" comes first on PATH
        let p = std::path::Path::new(&root)
            .join("System32")
            .join("curl.exe");
        if p.exists() {
            return p;
        }
    }
    "curl".into()
}

/// Download a feed as text.
#[cfg(desktop)]
pub fn fetch(url: &str) -> Result<String, String> {
    let url = normalize_url(url)?;
    let text = get(&url, None).map_err(|err| download_error(&url, &err))?;
    if !text.contains("BEGIN:VCALENDAR") {
        return Err("That address did not return a calendar. Copy the feed link again.".into());
    }
    Ok(text)
}

/// GET an https address with curl, optionally sending `cookie` (a `Cookie:` header value; it
/// goes on stdin with the URL, never on the command line). Errors are curl's message.
#[cfg(desktop)]
pub fn get(url: &str, cookie: Option<&str>) -> Result<String, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let mut cmd = Command::new(curl_program());
    cmd.args([
        "--silent",
        "--show-error",
        "--fail",
        "--location",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--max-time",
        "30",
        "--max-filesize",
        MAX_BYTES,
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
    let mut child = cmd.spawn().map_err(|e| {
        format!("Could not start curl ({e}). Import a downloaded .ics file instead.")
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        // callers pass URLs without quotes or backslashes (normalize_url), so this is well formed
        let mut config = format!("url = \"{url}\"\n");
        if let Some(c) = cookie {
            // a quoted config value: drop line breaks, escape backslashes and quotes
            let c: String = c.chars().filter(|ch| !ch.is_control()).collect();
            let c = c.replace('\\', "\\\\").replace('"', "\\\"");
            config.push_str(&format!("header = \"Cookie: {c}\"\n"));
        }
        let _ = stdin.write_all(config.as_bytes());
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let err = err.trim().trim_start_matches("curl: ");
        // "(22) The requested URL returned error: 404" -> the message
        let err = err
            .split_once(") ")
            .filter(|(code, _)| code.starts_with('('))
            .map_or(err, |(_, msg)| msg);
        return Err(err.to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// A Google public address 404s unless the calendar is shared publicly, so point at the secret one.
#[cfg(desktop)]
fn download_error(url: &str, err: &str) -> String {
    if url.contains("calendar.google.com") && url.contains("/public/") && err.contains("404") {
        return "That's the public address, which only works for public calendars. Use Settings › your calendar › Integrate calendar › Secret address in iCal format.".into();
    }
    format!("Download failed: {err}")
}

#[cfg(mobile)]
pub fn fetch(_url: &str) -> Result<String, String> {
    Err("This device can't download feeds yet. Import a .ics file instead.".into())
}

/// Import Canvas feed text: adds the courses it names, then upserts its items.
pub fn import_canvas(g: &mut AppState, text: &str) -> Result<ImportCounts, String> {
    let events = ics::parse_ics(text, &Local).map_err(|e| e.to_string())?;
    let (now, device) = (Utc::now(), g.device_id());
    let found = ics::canvas_courses(&events, &g.data.courses);
    g.data.courses.extend(found);
    let incoming = ics::canvas_feed_to_items(&events, &g.data.courses, &Local, now, &device);
    Ok(merge_imported(&mut g.data.items, incoming, now, &device))
}

/// Import a Google Calendar export: refreshes the series list, imports the picked series as
/// classes (sections tagged as such) and removes the classes of series you un-picked.
pub fn import_gcal(g: &mut AppState, text: &str) -> Result<ImportCounts, String> {
    let events = ics::parse_ics(text, &Local).map_err(|e| e.to_string())?;
    let (now, device) = (Utc::now(), g.device_id());
    let (from, to) = (now - Duration::days(7), now + Duration::days(AHEAD_DAYS));
    let series = ics::series_info(&events, &g.data.courses, from, to, &Local);
    let s = &g.data.settings;
    // copies of a series and series you hid are never classes, so their meetings are pruned
    let dups = ics::duplicate_series(&events, from, to, &Local);
    let mut picks = ClassPicks {
        series: s
            .gcal_series
            .clone()
            .unwrap_or_else(|| ics::default_class_series(&series)),
        sections: s
            .gcal_sections
            .clone()
            .unwrap_or_else(|| ics::default_sections(&series)),
        courses: s.gcal_courses.clone(),
    };
    picks
        .series
        .retain(|u| !dups.contains(u) && !s.gcal_hidden.contains(u));
    g.data.feeds.series = series;
    let incoming = ics::gcal_to_class_items(
        &events,
        &picks,
        &g.data.courses,
        from,
        to,
        &Local,
        now,
        &device,
    );
    // pruned meetings of series that are classes again come back before the merge refreshes them
    let mut pruned = g
        .data
        .feeds
        .gcal_pruned
        .take()
        .unwrap_or_else(|| ics::fully_deleted_series(&g.data.items, "gcal"));
    let back = ics::restore_series(
        &mut g.data.items,
        "gcal",
        &picks.series,
        &mut pruned,
        now,
        &device,
    );
    let mut n = merge_imported(&mut g.data.items, incoming, now, &device);
    n.updated += back;
    n.updated += ics::mark_sections(&mut g.data.items, "gcal", &picks.sections, now, &device);
    n.removed = ics::prune_series(
        &mut g.data.items,
        "gcal",
        &picks.series,
        &mut pruned,
        now,
        &device,
    );
    g.data.feeds.gcal_pruned = Some(pruned);
    Ok(n)
}

pub fn record(log: &mut FeedLog, r: &Result<ImportCounts, String>) {
    log.checked_at = Some(Utc::now());
    match r {
        Ok(counts) => {
            log.ok = true;
            log.error.clear();
            log.counts = *counts;
        }
        Err(e) => {
            log.ok = false;
            log.error = e.clone();
        }
    }
}

/// Save, tell the windows (payload "import") and refresh presence.
pub fn finish(app: &AppHandle) -> Result<Feeds, String> {
    let state = app.state::<SharedState>();
    let feeds = {
        let mut g = lock(&state);
        g.save()?;
        g.data.feeds.clone()
    };
    let _ = app.emit("items-changed", "import");
    crate::presence::refresh(app);
    Ok(feeds)
}

/// Import Google text (from a download or a file) and remember it for re-picks.
pub fn take_gcal(app: &AppHandle, text: String) -> Result<ImportCounts, String> {
    let r = import_gcal(&mut lock(&app.state::<SharedState>()), &text);
    if r.is_ok() {
        *app.state::<FeedCache>()
            .gcal
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(text);
    }
    r
}

/// Fetch and import every configured feed (Canvas first, so Google classes find its courses),
/// then Gradescope and WeBWorK.
/// Blocking: call it off the main thread. While one refresh runs, another returns an error.
pub fn refresh(app: &AppHandle) -> Result<Feeds, String> {
    let cache = app.state::<FeedCache>();
    if cache.busy.swap(true, Ordering::SeqCst) {
        return Err("Already refreshing.".into());
    }
    let state = app.state::<SharedState>();
    let (canvas, gcal, gradescope, webwork) = {
        let g = lock(&state);
        let s = &g.data.settings;
        (
            s.canvas_feed_url.clone(),
            s.gcal_feed_url.clone(),
            s.gradescope,
            !s.webwork_courses.is_empty(),
        )
    };
    if let Some(url) = canvas {
        let r = fetch(&url).and_then(|text| import_canvas(&mut lock(&state), &text));
        record(&mut lock(&state).data.feeds.canvas, &r);
    }
    if let Some(url) = gcal {
        let r = fetch(&url).and_then(|text| take_gcal(app, text));
        record(&mut lock(&state).data.feeds.gcal, &r);
    }
    if gradescope {
        let r = crate::gradescope::sync(app);
        record(&mut lock(&state).data.feeds.gradescope, &r);
    }
    if webwork {
        let r = crate::webwork::sync(app);
        record(&mut lock(&state).data.feeds.webwork, &r);
    }
    cache.busy.store(false, Ordering::SeqCst);
    finish(app)
}

/// Re-import Google after the class picks changed: from the cached export, else a download.
pub fn reimport_gcal(app: &AppHandle) -> Result<Feeds, String> {
    let cached = app
        .state::<FeedCache>()
        .gcal
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let state = app.state::<SharedState>();
    let r = match cached {
        Some(text) => import_gcal(&mut lock(&state), &text),
        None => {
            let url = lock(&state).data.settings.gcal_feed_url.clone();
            match url {
                Some(url) => fetch(&url).and_then(|text| take_gcal(app, text)),
                None => Err("Connect Google Calendar first.".into()),
            }
        }
    };
    record(&mut lock(&state).data.feeds.gcal, &r);
    finish(app)
}

/// Read WeBWorK alone (its sessions need a request every [`crate::webwork::KEEP_ALIVE`]).
fn refresh_webwork(app: &AppHandle) -> Result<Feeds, String> {
    let cache = app.state::<FeedCache>();
    if cache.busy.swap(true, Ordering::SeqCst) {
        return Err("Already refreshing.".into());
    }
    let r = crate::webwork::sync(app);
    record(
        &mut lock(&app.state::<SharedState>()).data.feeds.webwork,
        &r,
    );
    cache.busy.store(false, Ordering::SeqCst);
    finish(app)
}

fn stale(log: &FeedLog, now: DateTime<Utc>) -> bool {
    stale_after(log, now, REFRESH_EVERY)
}

fn stale_after(log: &FeedLog, now: DateTime<Utc>, every: StdDuration) -> bool {
    let every = Duration::from_std(every).unwrap_or(Duration::minutes(30));
    log.checked_at.is_none_or(|t| now - t >= every)
}

/// Background refresh: shortly after launch, then whenever a configured feed is
/// [`REFRESH_EVERY`] old, or WeBWorK alone when it is [`crate::webwork::KEEP_ALIVE`] old
/// (checked every 5 minutes).
pub fn spawn_refresher(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(StdDuration::from_secs(20));
        loop {
            let (due, webwork_due) = {
                let state = app.state::<SharedState>();
                let g = lock(&state);
                let (s, f, now) = (&g.data.settings, &g.data.feeds, Utc::now());
                (
                    (s.canvas_feed_url.is_some() && stale(&f.canvas, now))
                        || (s.gcal_feed_url.is_some() && stale(&f.gcal, now))
                        || (s.gradescope && stale(&f.gradescope, now)),
                    !s.webwork_courses.is_empty()
                        && stale_after(&f.webwork, now, crate::webwork::KEEP_ALIVE),
                )
            };
            if due {
                let _ = refresh(&app);
            } else if webwork_due {
                let _ = refresh_webwork(&app);
            }
            thread::sleep(StdDuration::from_secs(5 * 60));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        assert_eq!(
            normalize_url(" webcal://canvas.ucsb.edu/feeds/calendars/user_x.ics ").unwrap(),
            "https://canvas.ucsb.edu/feeds/calendars/user_x.ics"
        );
        assert!(normalize_url("http://example.com/a.ics").is_err());
        assert!(normalize_url("file:///etc/passwd").is_err());
        assert!(normalize_url("https://a.com/x\" -o out").is_err());
        assert!(normalize_url("https://").is_err());
    }

    #[cfg(desktop)]
    #[test]
    fn google_public_404_points_at_the_secret_address() {
        let public = "https://calendar.google.com/calendar/ical/a%40gmail.com/public/basic.ics";
        let err = download_error(public, "The requested URL returned error: 404");
        assert!(err.contains("Secret address"), "{err}");
        let secret = "https://calendar.google.com/calendar/ical/a%40gmail.com/private-x/basic.ics";
        let err = download_error(secret, "The requested URL returned error: 404");
        assert!(err.starts_with("Download failed: "), "{err}");
    }

    /// curl gets the URL on stdin and its error comes back readable. Local only: nothing listens
    /// on port 9, so the connection is refused at once.
    #[cfg(desktop)]
    #[test]
    fn curl_reads_the_url_from_stdin() {
        let err = fetch("https://127.0.0.1:9/feed.ics").unwrap_err();
        assert!(err.starts_with("Download failed: "), "{err}");
        assert!(err.contains("127.0.0.1"), "curl saw the URL: {err}");
    }
}
