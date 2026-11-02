//! Live presence ("what's now / next") pushed to every OS surface:
//! taskbar/dock progress, Windows taskbar overlay dot, macOS dock badge + menu-bar title,
//! tray tooltip, and the "presence" event (island + main window). On iOS/Android only the
//! event is sent; the UI shows it in-app.
//!
//! A 15s ticker recomputes `collegiapp_core::next_up`. `set_presence(Some(p))` from the UI
//! overrides the ticker for [`MANUAL_HOLD_SECS`]; `set_presence(None)` drops the override and
//! recomputes immediately.
//!
//! The same ticker fires interrupts: a class or event with an interrupt level that starts
//! within [`ALERT_LEAD_MINS`] sends "alert" to the main window once (the UI shows the toast,
//! dialog or takeover), plus a system notification when the window is not in front; a
//! takeover also brings the window forward.
//!
//! Every refresh also rewrites [`EXPORT_FILE`] beside the store, for pages outside the app
//! (the Wallpaper Engine wallpaper in `integrations/wallpaper-engine`); see [`export_js`].

use std::collections::HashSet;
use std::fs;
use std::sync::Mutex;
use std::thread;
use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, FixedOffset, Local, Utc};
use collegiapp_core::filter::{run_query, Ctx};
use collegiapp_core::{alerts_due, next_up, Course, InterruptLevel, ItemKind, Presence, Sort};
use serde::Serialize;
#[cfg(desktop)]
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::focus::FocusManager;
use crate::store::{lock, SharedState, Snapshot};
#[cfg(desktop)]
use crate::tray::TRAY_ID;

pub const TICK: StdDuration = StdDuration::from_secs(15);
pub const MANUAL_HOLD_SECS: i64 = 120;
pub const ALERT_LEAD_MINS: i64 = 10;

/// Interrupts already fired, by item and start time (a moved class alerts again).
#[derive(Default)]
pub struct AlertLog(Mutex<HashSet<(Uuid, i64)>>);

/// Payload of the "alert" event.
#[derive(Debug, Clone, Serialize)]
pub struct AlertEvent {
    pub item_id: Uuid,
    pub level: InterruptLevel,
}

#[derive(Default)]
pub struct PresenceHold {
    manual_until: Mutex<Option<DateTime<Utc>>>,
}

impl PresenceHold {
    fn active(&self, now: DateTime<Utc>) -> bool {
        self.manual_until
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some_and(|t| t > now)
    }
    fn set(&self, until: Option<DateTime<Utc>>) {
        *self.manual_until.lock().unwrap_or_else(|e| e.into_inner()) = until;
    }
}

pub fn compute(app: &AppHandle) -> Option<Presence> {
    let state = app.state::<SharedState>();
    let items = lock(&state).data.visible_items();
    next_up(&items, Utc::now())
}

/// Recompute from items, write the export, and apply (unless the UI holds a manual presence).
pub fn refresh(app: &AppHandle) {
    let p = compute(app);
    export(app, p.as_ref());
    if app.state::<PresenceHold>().active(Utc::now()) {
        return;
    }
    apply(app, p.as_ref());
}

/// File name of the presence export, beside the store (`collegiapp.json`).
pub const EXPORT_FILE: &str = "presence.js";

/// The export's fields: the planned presence endpoint's (docs/PLATFORM_PRESENCE.md: the next
/// class or event flattened in, `short`, focus, due today, the Do first title), plus the whole
/// Do first item, how many are ranked, and when it was written so a reader can tell the app
/// has stopped.
#[derive(Serialize)]
struct Export<'a> {
    #[serde(flatten)]
    next: Option<&'a Presence>,
    short: Option<String>,
    focus: FocusBrief,
    due_today: usize,
    do_first: Option<&'a str>,
    do_first_item: Option<DoFirstItem<'a>>,
    do_first_count: usize,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct FocusBrief {
    active: bool,
}

#[derive(Serialize)]
struct DoFirstItem<'a> {
    title: &'a str,
    kind: ItemKind,
    /// The course code ("CMPSC 154") and its palette index (1–6, the UI's `--k1`…`--k6`).
    course: Option<&'a str>,
    color: Option<u8>,
    due: Option<DateTime<Utc>>,
    est_minutes: Option<u32>,
}

/// A course's palette index: its own (1–6), else a hash of its id, like `hue` in ui/js/store.js.
fn course_color(c: &Course) -> u8 {
    if (1..=6).contains(&c.color) {
        return c.color;
    }
    let h =
        c.id.encode_utf16()
            .fold(0u32, |h, u| h.wrapping_mul(31).wrapping_add(u32::from(u)));
    1 + (h % 6) as u8
}

/// The export as a script: `window.collegiappPresence({…})`. A file:// page can load a script
/// from another folder but can't fetch a file, so the JSON is wrapped in a call. Do first is the
/// `do_first` command's ranking (open, actionable, scored, not in an excluded course).
fn export_js(
    data: &Snapshot,
    next: Option<&Presence>,
    focus: bool,
    now: DateTime<FixedOffset>,
) -> String {
    let ctx = Ctx {
        now,
        courses: &data.courses,
    };
    let ranked: Vec<_> = run_query(&data.items, "is:open is:actionable", Sort::Score, &ctx)
        .into_iter()
        .filter(|r| r.score.is_some())
        .collect();
    let due_today = run_query(
        &data.items,
        "is:open is:actionable due<=today",
        Sort::Score,
        &ctx,
    )
    .len();
    let top = ranked.first().map(|r| &r.item);
    let course = top
        .and_then(|it| it.course_id.as_ref())
        .and_then(|id| data.courses.iter().find(|c| &c.id == id));
    let export = Export {
        next,
        short: next.map(Presence::short_text),
        focus: FocusBrief { active: focus },
        due_today,
        do_first: top.map(|it| it.title.as_str()),
        do_first_item: top.map(|it| DoFirstItem {
            title: &it.title,
            kind: it.kind,
            course: course.map(|c| c.code.as_str()),
            color: course.map(course_color),
            due: it.due,
            est_minutes: it.est_minutes,
        }),
        do_first_count: ranked.len(),
        updated_at: now.with_timezone(&Utc),
    };
    let json = serde_json::to_string(&export).unwrap_or_else(|_| "null".into());
    format!("// Collegiapp presence, rewritten every {} s (src-tauri/src/presence.rs)\nwindow.collegiappPresence && window.collegiappPresence({json});\n", TICK.as_secs())
}

/// Write [`EXPORT_FILE`] (temp file + rename, so a reader never sees half of it).
fn export(app: &AppHandle, next: Option<&Presence>) {
    let focus = app.state::<FocusManager>().state().active;
    let state = app.state::<SharedState>();
    let (js, path) = {
        let g = lock(&state);
        let js = export_js(&g.data, next, focus, Local::now().fixed_offset());
        (js, g.path.with_file_name(EXPORT_FILE))
    };
    let tmp = path.with_extension("js.tmp");
    if fs::write(&tmp, js).is_ok() {
        let _ = fs::rename(&tmp, &path);
    }
}

/// Command path for `set_presence`.
pub fn set_manual(app: &AppHandle, p: Option<Presence>) {
    let hold = app.state::<PresenceHold>();
    match p {
        Some(p) => {
            hold.set(Some(Utc::now() + Duration::seconds(MANUAL_HOLD_SECS)));
            apply(app, Some(&p));
        }
        None => {
            hold.set(None);
            refresh(app);
        }
    }
}

pub fn spawn_ticker(app: AppHandle) {
    thread::spawn(move || {
        let mut first = true;
        loop {
            refresh(&app);
            // skip the launch tick: the UI is still loading and would miss the event
            if !first {
                check_alerts(&app);
            }
            first = false;
            thread::sleep(TICK);
        }
    });
}

fn check_alerts(app: &AppHandle) {
    let now = Utc::now();
    let due: Vec<_> = {
        let state = app.state::<SharedState>();
        let items = lock(&state).data.visible_items();
        alerts_due(&items, now, Duration::minutes(ALERT_LEAD_MINS))
            .into_iter()
            .cloned()
            .collect()
    };
    if due.is_empty() {
        return;
    }
    let log = app.state::<AlertLog>();
    for it in due {
        let Some(start) = it.due else { continue };
        if !log
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert((it.id, start.timestamp()))
        {
            continue;
        }
        let in_front = app
            .get_webview_window("main")
            .and_then(|w| Some(w.is_visible().ok()? && w.is_focused().ok()?))
            .unwrap_or(false);
        #[cfg(desktop)]
        if it.interrupt == InterruptLevel::Takeover {
            crate::tray::show_main(app);
        }
        if !in_front {
            use tauri_plugin_notification::NotificationExt;
            let mins = ((start - now).num_seconds() + 59) / 60;
            let body = match it.location.as_deref().filter(|l| !l.is_empty()) {
                Some(loc) => format!("Starts in {mins} min · {loc}"),
                None => format!("Starts in {mins} min"),
            };
            let _ = app
                .notification()
                .builder()
                .title(&it.title)
                .body(body)
                .show();
        }
        let _ = app.emit_to(
            "main",
            "alert",
            AlertEvent {
                item_id: it.id,
                level: it.interrupt,
            },
        );
    }
}

/// Push a presence (or its absence) to every surface.
pub fn apply(app: &AppHandle, p: Option<&Presence>) {
    #[cfg(desktop)]
    desktop_surfaces(app, p);
    let _ = app.emit("presence", p);
}

#[cfg(desktop)]
fn desktop_surfaces(app: &AppHandle, p: Option<&Presence>) {
    if let Some(win) = app.get_webview_window("main") {
        let bar = match p.and_then(|p| p.progress) {
            Some(f) => ProgressBarState {
                status: Some(ProgressBarStatus::Normal),
                progress: Some((f * 100.0).round().clamp(0.0, 100.0) as u64),
            },
            None => ProgressBarState {
                status: Some(ProgressBarStatus::None),
                progress: None,
            },
        };
        let _ = win.set_progress_bar(bar);

        #[cfg(target_os = "windows")]
        {
            // green dot while something is on or starts within 15 minutes
            let soon = p.is_some_and(|p| p.progress.is_some() || p.starts_in_secs <= 15 * 60);
            let _ = win.set_overlay_icon(if soon { Some(overlay_dot()) } else { None });
        }
        #[cfg(target_os = "macos")]
        {
            let _ = win.set_badge_label(p.map(|p| p.short_text()));
        }
    }

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        #[cfg(target_os = "macos")]
        {
            let _ = tray.set_title(p.map(|p| p.short_text()));
        }
        let tip = match p {
            Some(p) => format!("Collegiapp: {} ({})", p.label, p.detail),
            None => "Collegiapp".to_string(),
        };
        let _ = tray.set_tooltip(Some(tip));
    }
}

/// 16x16 RGBA green dot for the Windows taskbar overlay.
#[cfg(target_os = "windows")]
fn overlay_dot() -> tauri::image::Image<'static> {
    const N: u32 = 16;
    let mut rgba = Vec::with_capacity((N * N * 4) as usize);
    let c = (N as f32 - 1.0) / 2.0;
    for y in 0..N {
        for x in 0..N {
            let d = ((x as f32 - c).powi(2) + (y as f32 - c).powi(2)).sqrt();
            let a = (7.5 - d).clamp(0.0, 1.0);
            let ring = d > 5.5;
            let (r, g, b) = if ring { (8, 10, 8) } else { (51, 255, 102) };
            rgba.extend_from_slice(&[r, g, b, (a * 255.0) as u8]);
        }
    }
    tauri::image::Image::new_owned(rgba, N, N)
}

#[cfg(test)]
mod tests {
    use super::*;
    use collegiapp_core::Item;

    fn payload(js: &str) -> serde_json::Value {
        let json = js.split_once("collegiappPresence(").unwrap().1;
        serde_json::from_str(json.trim_end().trim_end_matches(");")).unwrap()
    }

    #[test]
    fn export_names_the_do_first_item_and_its_course() {
        let now = Local::now().fixed_offset();
        let mut s = Snapshot::fresh();
        s.items.clear();
        let mut c = Course::new("cmpsc154-f26", "CMPSC 154");
        c.color = 2;
        let mut lab = Item::new(
            "Lab 3: PyRTL ALU",
            ItemKind::Assignment,
            now.with_timezone(&Utc),
            "d",
        );
        lab.course_id = Some(c.id.clone());
        lab.due = Some(now.with_timezone(&Utc) + Duration::hours(30));
        let reading = Item::new(
            "Sipser ch. 2",
            ItemKind::Reading,
            now.with_timezone(&Utc),
            "d",
        );
        s.courses.push(c);
        s.items.extend([lab, reading]);

        let v = payload(&export_js(&s, None, false, now));
        assert_eq!(v["do_first"], "Lab 3: PyRTL ALU");
        assert_eq!(v["do_first_item"]["kind"], "assignment");
        assert_eq!(v["do_first_item"]["course"], "CMPSC 154");
        assert_eq!(v["do_first_item"]["color"], 2);
        assert_eq!(v["do_first_count"], 2);
        assert_eq!(v["focus"]["active"], false);
        assert!(
            v.get("label").is_none(),
            "no class or event, so no presence fields: {v}"
        );
    }

    #[test]
    fn export_is_empty_without_open_work() {
        let mut s = Snapshot::fresh();
        s.items.clear();
        let v = payload(&export_js(&s, None, true, Local::now().fixed_offset()));
        assert!(v["do_first"].is_null() && v["do_first_item"].is_null());
        assert_eq!(v["do_first_count"], 0);
        assert_eq!(v["focus"]["active"], true);
    }

    #[test]
    fn course_colors_match_the_ui() {
        // ui/js/store.js: hue("cmpsc130a-f26") === 3, hue("pstat120a-f26") === 6
        assert_eq!(course_color(&Course::new("cmpsc130a-f26", "CMPSC 130A")), 3);
        assert_eq!(course_color(&Course::new("pstat120a-f26", "PSTAT 120A")), 6);
        let mut c = Course::new("x", "X");
        c.color = 5;
        assert_eq!(course_color(&c), 5);
    }
}
