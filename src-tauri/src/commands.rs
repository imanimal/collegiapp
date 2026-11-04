//! Tauri commands. JS calls them with `window.__TAURI__.core.invoke(name, args)`; argument
//! keys are camelCase in JS (Tauri converts), e.g. `invoke('list_items', { query, sort })`.
//! Errors reject the promise with a string.

use std::collections::BTreeMap;

use chrono::{DateTime, Duration, FixedOffset, Local, Utc};
use collegiapp_core::filter::{run_query, Ctx, Filter, FilterTerm};
use collegiapp_core::ics::{self, SeriesInfo};
use collegiapp_core::quickadd::{self, Draft};
use collegiapp_core::{Course, ImportCounts, Item, Presence, RankedItem, Sort, View};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, Window};
use uuid::Uuid;

use crate::feeds::{self, Feeds};
use crate::focus::{effective_blocklist, FocusLevel, FocusManager, FocusState};
use crate::start::{StartApp, StartApps};
use crate::store::{lock, same_content, Settings, SharedState};
use crate::trash::TrashInfo;

type CmdResult<T> = Result<T, String>;

fn local_now() -> DateTime<FixedOffset> {
    Local::now().fixed_offset()
}

/// Persist, tell every window the item list changed, refresh presence. The event payload
/// names who changed it: a window label for `save_items`, else "app" (or "import", feeds.rs),
/// so a window can skip the echo of its own save.
fn changed(app: &AppHandle, state: &SharedState) -> CmdResult<()> {
    changed_by(app, state, "app")
}

pub(crate) fn changed_by(app: &AppHandle, state: &SharedState, origin: &str) -> CmdResult<()> {
    lock(state).save()?;
    let _ = app.emit("items-changed", origin);
    crate::presence::refresh(app);
    Ok(())
}

/// Everything the UI needs at launch and after "items-changed".
#[derive(Debug, Clone, Serialize)]
pub struct Everything {
    /// Live items (tombstones stay in the store for sync but are not sent).
    pub items: Vec<Item>,
    pub courses: Vec<Course>,
    pub settings: Settings,
    pub feeds: Feeds,
    pub device_id: String,
}

#[tauri::command]
pub fn load_all(state: State<'_, SharedState>) -> Everything {
    let g = lock(&state);
    Everything {
        items: g
            .data
            .items
            .iter()
            .filter(|i| !i.deleted)
            .cloned()
            .collect(),
        courses: g.data.courses.clone(),
        settings: g.data.settings.clone(),
        feeds: g.data.feeds.clone(),
        device_id: g.device_id(),
    }
}

/// Upsert items edited in the UI, in one write (the UI parses quick add and edits locally,
/// see engine.js). Deleting is `deleted: true`, so undo is another save. `why` tags the saves
/// of an undo, whose replaced versions go to the trash ([`AppState::save_from_ui`]).
#[tauri::command]
pub fn save_items(
    items: Vec<Item>,
    why: Option<BTreeMap<Uuid, String>>,
    window: Window,
    app: AppHandle,
    state: State<'_, SharedState>,
) -> CmdResult<()> {
    lock(&state).save_from_ui(items, &why.unwrap_or_default());
    changed_by(&app, &state, window.label())
}

#[tauri::command]
pub fn trash_list(state: State<'_, SharedState>) -> TrashInfo {
    let mut g = lock(&state);
    let limit = g.trash_limit();
    g.trash.info(limit)
}

/// Restored items, what each replaced (None: never stored), and the trash after.
#[derive(Debug, Clone, Serialize)]
pub struct Restored {
    pub items: Vec<Item>,
    pub before: Vec<Option<Item>>,
    pub trash: TrashInfo,
}

/// Put trashed versions back on the list, live. A version that would overwrite a different
/// live one trashes that one first ("Replaced by a restore"); of several versions of one item
/// the newest is restored and the others stay. A course deleted since leaves it personal.
#[tauri::command]
pub fn trash_restore(
    ids: Vec<String>,
    app: AppHandle,
    state: State<'_, SharedState>,
) -> CmdResult<Restored> {
    let out = {
        let mut g = lock(&state);
        let (now, device) = (Utc::now(), g.device_id());
        let taken = g
            .trash
            .take(&ids)
            .map_err(|e| format!("trash not read: {e}"))?;
        let (mut keep, mut again) = (Vec::<Item>::new(), Vec::new());
        for (m, it) in taken {
            // taken oldest first: a later version of the same item wins
            match keep.iter().position(|k| k.id == it.id) {
                Some(at) => again.push((std::mem::replace(&mut keep[at], it), m.why, m.gone)),
                None => keep.push(it),
            }
        }
        let (mut items, mut before, mut replaced) = (Vec::new(), Vec::new(), Vec::new());
        for mut it in keep {
            let known = |c: &String| g.data.courses.iter().any(|x| &x.id == c);
            if it.course_id.as_ref().is_some_and(|c| !known(c)) {
                it.course_id = None;
            }
            it.deleted = false;
            let old = g.data.items.iter().find(|i| i.id == it.id).cloned();
            if let Some(o) = &old {
                it.created_at = o.created_at;
                if !o.deleted && !same_content(o, &it) {
                    replaced.push((o.clone(), "Replaced by a restore".to_string(), false));
                }
            }
            it.touch(now, &device);
            g.upsert(it.clone());
            items.push(it);
            before.push(old);
        }
        again.append(&mut replaced);
        g.trash_put(again);
        let limit = g.trash_limit();
        Restored {
            items,
            before,
            trash: g.trash.info(limit),
        }
    };
    changed(&app, &state)?;
    Ok(out)
}

/// Delete trashed versions for good: `ids`, or everything.
#[tauri::command]
pub fn trash_purge(
    ids: Option<Vec<String>>,
    state: State<'_, SharedState>,
) -> CmdResult<TrashInfo> {
    let mut g = lock(&state);
    g.trash
        .purge(ids.as_deref())
        .map_err(|e| format!("trash not emptied: {e}"))?;
    let limit = g.trash_limit();
    Ok(g.trash.info(limit))
}

/// Most the trash keeps, in MB (1 MB to 10 GB); past it the oldest go at once.
#[tauri::command]
pub fn trash_set_limit(mb: u32, state: State<'_, SharedState>) -> CmdResult<TrashInfo> {
    let mut g = lock(&state);
    g.data.settings.trash_limit_mb = mb.clamp(1, 10 * 1024);
    g.save()?;
    let limit = g.trash_limit();
    g.trash
        .enforce(limit)
        .map_err(|e| format!("trash not trimmed: {e}"))?;
    Ok(g.trash.info(limit))
}

#[tauri::command]
pub fn quick_add_preview(text: String, state: State<'_, SharedState>) -> Draft {
    let g = lock(&state);
    let mut d = quickadd::parse(&text, local_now(), &g.data.courses);
    d.fit_free(&g.data.items, local_now());
    d
}

#[tauri::command]
pub fn quick_add(text: String, app: AppHandle, state: State<'_, SharedState>) -> CmdResult<Item> {
    if text.trim().is_empty() {
        return Err("nothing to add".into());
    }
    let item = {
        let mut g = lock(&state);
        let mut draft = quickadd::parse(&text, local_now(), &g.data.courses);
        draft.fit_free(&g.data.items, local_now());
        let item = draft.into_item(Utc::now(), &g.device_id());
        g.data.items.push(item.clone());
        item
    };
    changed(&app, &state)?;
    Ok(item)
}

/// Filter + score + sort. `sort` defaults to "score".
#[tauri::command]
pub fn list_items(
    query: String,
    sort: Option<Sort>,
    state: State<'_, SharedState>,
) -> Vec<RankedItem> {
    let g = lock(&state);
    let ctx = Ctx {
        now: local_now(),
        courses: &g.data.courses,
    };
    run_query(&g.data.items, &query, sort.unwrap_or_default(), &ctx)
}

/// The single top "do first" item (open, actionable, not snoozed, not in an excluded course).
#[tauri::command]
pub fn do_first(state: State<'_, SharedState>) -> Option<RankedItem> {
    let g = lock(&state);
    let ctx = Ctx {
        now: local_now(),
        courses: &g.data.courses,
    };
    run_query(&g.data.items, "is:open is:actionable", Sort::Score, &ctx)
        .into_iter()
        .find(|r| r.score.is_some())
}

/// Upsert an item edited by the UI (stamps `updated_at`/`updated_by`). Returns the stored item.
#[tauri::command]
pub fn update_item(item: Item, app: AppHandle, state: State<'_, SharedState>) -> CmdResult<Item> {
    let mut item = item;
    {
        let mut g = lock(&state);
        let device = g.device_id();
        if let Some(existing) = g.data.items.iter().find(|i| i.id == item.id) {
            item.created_at = existing.created_at;
        }
        item.priority = item.priority.min(3);
        item.touch(Utc::now(), &device);
        g.upsert(item.clone());
    }
    changed(&app, &state)?;
    Ok(item)
}

/// Tombstone an item (kept for sync).
#[tauri::command]
pub fn delete_item(id: Uuid, app: AppHandle, state: State<'_, SharedState>) -> CmdResult<()> {
    {
        let mut g = lock(&state);
        let device = g.device_id();
        let it = g
            .data
            .items
            .iter_mut()
            .find(|i| i.id == id)
            .ok_or("no such item")?;
        let was = (!it.deleted).then(|| it.clone());
        it.deleted = true;
        it.touch(Utc::now(), &device);
        if let Some(was) = was {
            g.trash_put(vec![(was, "Deleted".into(), true)]);
        }
    }
    changed(&app, &state)
}

#[tauri::command]
pub fn list_courses(state: State<'_, SharedState>) -> Vec<Course> {
    lock(&state).data.courses.clone()
}

/// Insert or replace a course by id.
#[tauri::command]
pub fn upsert_course(
    course: Course,
    app: AppHandle,
    state: State<'_, SharedState>,
) -> CmdResult<Course> {
    {
        let mut g = lock(&state);
        match g.data.courses.iter_mut().find(|c| c.id == course.id) {
            Some(slot) => *slot = course.clone(),
            None => g.data.courses.push(course.clone()),
        }
    }
    changed(&app, &state)?;
    Ok(course)
}

/// Remove a course: merged `into` another (a duplicate), or on its own, its items kept as
/// personal or, with `drop_items`, tombstoned. Google series picked for it follow the merge or
/// go back to "pick its course". Returns the removed course (the UI's undo upserts it).
#[tauri::command]
pub fn delete_course(
    id: String,
    into: Option<String>,
    drop_items: Option<bool>,
    app: AppHandle,
    state: State<'_, SharedState>,
) -> CmdResult<Course> {
    let gone = {
        let mut g = lock(&state);
        let device = g.device_id();
        // deleted with the course: their last versions go to the trash
        let dropped: Vec<Item> = if drop_items.unwrap_or(false) && into.is_none() {
            let of = |i: &&Item| !i.deleted && i.course_id.as_deref() == Some(id.as_str());
            g.data.items.iter().filter(of).cloned().collect()
        } else {
            Vec::new()
        };
        let d = &mut g.data;
        let gone = collegiapp_core::remove_course(
            &mut d.courses,
            &mut d.items,
            &id,
            into.as_deref(),
            drop_items.unwrap_or(false),
            Utc::now(),
            &device,
        )
        .ok_or("no such course")?;
        let picks = &mut d.settings.gcal_courses;
        match &into {
            Some(k) => picks
                .values_mut()
                .filter(|v| **v == id)
                .for_each(|v| *v = k.clone()),
            None => picks.retain(|_, v| *v != id),
        }
        let why = format!("Deleted with {}", gone.code);
        g.trash_put(
            dropped
                .into_iter()
                .map(|i| (i, why.clone(), true))
                .collect(),
        );
        gone
    };
    changed(&app, &state)?;
    Ok(gone)
}

#[tauri::command]
pub fn list_views(state: State<'_, SharedState>) -> Vec<View> {
    lock(&state).data.views.clone()
}

/// Parsed filter terms for chips (key/negated/valid per term).
#[tauri::command]
pub fn filter_terms(query: String) -> Vec<FilterTerm> {
    Filter::parse(&query).terms()
}

#[tauri::command]
pub fn get_settings(state: State<'_, SharedState>) -> Settings {
    lock(&state).data.settings.clone()
}

/// Connect (or with `url: None`, disconnect) a calendar feed: `adapter` "canvas" or "gcal".
/// Imported items stay when a feed is disconnected. Call `refresh_feeds` next.
#[tauri::command]
pub fn set_feed(
    adapter: String,
    url: Option<String>,
    state: State<'_, SharedState>,
) -> CmdResult<Settings> {
    let url = url
        .filter(|u| !u.trim().is_empty())
        .map(|u| feeds::normalize_url(&u))
        .transpose()?;
    let mut g = lock(&state);
    match adapter.as_str() {
        "canvas" => {
            g.data.settings.canvas_feed_url = url;
            g.data.feeds.canvas = Default::default();
        }
        "gcal" => {
            g.data.settings.gcal_feed_url = url;
            g.data.feeds.gcal = Default::default();
        }
        other => return Err(format!("unknown feed {other:?}")),
    }
    g.save()?;
    Ok(g.data.settings.clone())
}

/// Fetch and import every connected feed now. Runs off the main thread.
#[tauri::command]
pub async fn refresh_feeds(app: AppHandle) -> CmdResult<Feeds> {
    tauri::async_runtime::spawn_blocking(move || feeds::refresh(&app))
        .await
        .map_err(|e| e.to_string())?
}

/// Set which Google series are classes (UIDs from `Feeds.series`), which of those are
/// sections, the course of series whose title doesn't name one, and the series hidden from
/// the list; then re-import them.
/// `sections`, `courses` and `hidden` left out keep what was set.
#[tauri::command]
pub async fn set_class_series(
    uids: Vec<String>,
    sections: Option<Vec<String>>,
    courses: Option<BTreeMap<String, String>>,
    hidden: Option<Vec<String>>,
    app: AppHandle,
) -> CmdResult<Feeds> {
    tauri::async_runtime::spawn_blocking(move || {
        {
            let state = app.state::<SharedState>();
            let mut g = lock(&state);
            let s = &mut g.data.settings;
            s.gcal_series = Some(uids);
            if sections.is_some() {
                s.gcal_sections = sections;
            }
            if let Some(c) = courses {
                s.gcal_courses = c;
            }
            if let Some(h) = hidden {
                s.gcal_hidden = h;
            }
        }
        feeds::reimport_gcal(&app)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open the Gradescope sign-in window; signing in there connects Gradescope and imports
/// (gradescope.rs). Async: building a window from a sync command deadlocks on Windows.
#[tauri::command]
pub async fn gradescope_connect(app: AppHandle) -> CmdResult<()> {
    #[cfg(desktop)]
    return crate::gradescope::open_sign_in(&app);
    #[cfg(mobile)]
    {
        let _ = app;
        Err("Gradescope needs the desktop app for now.".into())
    }
}

/// Sign the app out of Gradescope and stop importing; imported items stay. Async, because
/// reading the webview's cookies waits on the main thread.
#[tauri::command]
pub async fn gradescope_disconnect(app: AppHandle) -> CmdResult<Feeds> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::gradescope::disconnect(&app);
        feeds::finish(&app)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open the WeBWorK sign-in window; signing in to a course there connects it and imports
/// (webwork.rs). Async, like gradescope_connect.
#[tauri::command]
pub async fn webwork_connect(app: AppHandle) -> CmdResult<()> {
    #[cfg(desktop)]
    return crate::webwork::open_sign_in(&app);
    #[cfg(mobile)]
    {
        let _ = app;
        Err("WeBWorK needs the desktop app for now.".into())
    }
}

/// Sign the app out of every WeBWorK course and stop importing; imported items stay.
#[tauri::command]
pub async fn webwork_disconnect(app: AppHandle) -> CmdResult<Feeds> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::webwork::disconnect(&app);
        feeds::finish(&app)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The Appearance drawer's choices that sync (lab.js `look()`, null for a default), from a
/// change made here. Keys this version of the UI doesn't send are kept.
#[tauri::command]
pub fn save_look(
    look: BTreeMap<String, serde_json::Value>,
    state: State<'_, SharedState>,
) -> CmdResult<()> {
    let mut g = lock(&state);
    g.data.settings.look.get_or_insert_default().extend(look);
    g.save()
}

#[tauri::command]
pub fn set_settings(settings: Settings, state: State<'_, SharedState>) -> CmdResult<Settings> {
    let mut g = lock(&state);
    g.data.settings = settings.clone();
    g.save()?;
    Ok(settings)
}

/// Open a URL in the preferred browser (settings.browser, e.g. "firefox"), falling back to
/// the system default.
#[tauri::command]
pub fn open_link(url: String, app: AppHandle) -> CmdResult<()> {
    open_url(&app, url)
}

/// [`open_link`] for Rust callers (the island's menu).
pub fn open_url(app: &AppHandle, url: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    if !(url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:")) {
        return Err("only http(s) and mailto links can be opened".into());
    }
    let browser = lock(&app.state::<SharedState>())
        .data
        .settings
        .browser
        .clone();
    if let Some(b) = browser.filter(|b| !b.trim().is_empty()) {
        if app.opener().open_url(url.clone(), Some(b)).is_ok() {
            return Ok(());
        }
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

// ---- presence / island ---------------------------------------------------------------

/// Push a presence to the taskbar/dock/tray/island. `Some` holds for 2 minutes over the
/// automatic 15s ticker; `None` returns to automatic.
#[tauri::command]
pub fn set_presence(p: Option<Presence>, app: AppHandle) {
    crate::presence::set_manual(&app, p);
}

/// Current automatic presence (what the ticker would show).
#[tauri::command]
pub fn get_presence(app: AppHandle) -> Option<Presence> {
    crate::presence::compute(&app)
}

/// The main window's backdrop ("desktop" or "solid") and the wallpaper's dot grid; None off
/// Windows (backdrop.rs).
#[tauri::command]
pub fn backdrop() -> Option<crate::backdrop::Backdrop> {
    crate::backdrop::current()
}

/// Returns whether the island is now visible.
#[tauri::command]
pub fn toggle_island(app: AppHandle) -> CmdResult<bool> {
    #[cfg(desktop)]
    return crate::tray::toggle_island(&app).map_err(|e| e.to_string());
    #[cfg(mobile)]
    {
        let _ = app; // phones have no floating window; the UI shows presence in-app
        Ok(false)
    }
}

/// The island's right-click menu, at the pointer (tray.rs `island_menu`). Runs on the main
/// thread, where a native menu has to open.
#[tauri::command]
pub fn island_menu(app: AppHandle) -> CmdResult<()> {
    #[cfg(desktop)]
    return crate::tray::island_menu(&app).map_err(|e| e.to_string());
    #[cfg(mobile)]
    {
        let _ = app;
        Ok(())
    }
}

// ---- Pocket Start (start.rs) -----------------------------------------------------------

/// Pinned apps, every Start app and the Settings pages search offers.
#[tauri::command]
pub fn start_apps(app: AppHandle) -> StartApps {
    crate::start::apps(&app)
}

/// Save your own pins (`null` = use Windows' pins again).
#[tauri::command]
pub fn set_start_pins(pins: Option<Vec<StartApp>>, app: AppHandle) -> CmdResult<StartApps> {
    crate::start::set_pins(&app, pins)
}

/// Open an app from Start's catalog by id, then hide Start.
#[tauri::command]
pub fn launch_app(id: String, app: AppHandle) -> CmdResult<()> {
    crate::start::launch(&app, &id)
}

/// What Start's right-click menu can offer for an app (start/menu.rs). Runs off the main thread:
/// it asks the shell and looks through the running processes.
#[tauri::command(async)]
pub fn start_app_info(id: String, app: AppHandle) -> CmdResult<crate::start::menu::AppInfo> {
    crate::start::menu::info(&app, &id)
}

/// One of the right-click menu's commands for an app: a Windows verb ("runas",
/// "openfilelocation", "opennewwindow", "taskbarunpin", "uninstall") or Pocket Start's own
/// ("folder", "terminal", "properties", "appsettings", "endtask", "restart", "block", "signin",
/// "desktop", "hide", "unhide").
#[tauri::command(async)]
pub fn start_app_do(
    id: String,
    what: String,
    app: AppHandle,
) -> CmdResult<crate::start::menu::Done> {
    crate::start::menu::run(&app, &id, &what)
}

/// The work deck and search: "settings", "files", "account", "lock", "sleep", "restart",
/// "shutdown", "signout", "search" (with `text`, handed to Windows search).
#[tauri::command]
pub fn start_action(action: String, text: Option<String>, app: AppHandle) -> CmdResult<()> {
    crate::start::action(&app, &action, text)
}

/// Windows: whether the Win key and the taskbar's Start key open Pocket Start (`true`) or
/// Windows' own Start (`false`). Start's Power menu and the app's search flip it; so does the tray.
#[tauri::command]
pub fn set_start_win_key(on: bool, app: AppHandle) {
    #[cfg(desktop)]
    crate::start::set_win_key(&app, on);
    #[cfg(mobile)]
    let _ = (on, app);
}

#[tauri::command]
pub fn hide_start(app: AppHandle) {
    #[cfg(desktop)]
    crate::start::hide(&app);
    #[cfg(mobile)]
    let _ = app;
}

/// Show the main window (from Start), on one item when `id` is given ("open-item" to main).
#[tauri::command]
pub fn open_item(id: Option<Uuid>, app: AppHandle) {
    #[cfg(desktop)]
    {
        crate::start::hide(&app);
        crate::tray::show_main(&app);
    }
    if let Some(id) = id {
        let _ = app.emit_to("main", "open-item", id);
    }
}

// ---- focus -----------------------------------------------------------------------------

/// `level`: "soft" | "hard" | "lockdown". Empty/missing blocklist = settings list, else the
/// built-in default list.
#[tauri::command]
pub fn start_focus(
    minutes: u32,
    level: FocusLevel,
    blocklist: Option<Vec<String>>,
    app: AppHandle,
    focus: State<'_, FocusManager>,
    state: State<'_, SharedState>,
) -> CmdResult<FocusState> {
    let list = match blocklist {
        Some(b) if !b.is_empty() => b,
        _ => lock(&state).data.settings.focus_blocklist.clone(),
    };
    focus.start(&app, minutes, level, list)
}

/// Hard/Lockdown can only end early with phrase "i choose distraction".
#[tauri::command]
pub fn end_focus(
    phrase: Option<String>,
    app: AppHandle,
    focus: State<'_, FocusManager>,
) -> CmdResult<FocusState> {
    focus.end(&app, phrase)
}

#[tauri::command]
pub fn focus_state(focus: State<'_, FocusManager>) -> FocusState {
    focus.state()
}

/// Add minutes to the running session.
#[tauri::command]
pub fn extend_focus(
    minutes: u32,
    app: AppHandle,
    focus: State<'_, FocusManager>,
) -> CmdResult<FocusState> {
    focus.extend(&app, minutes)
}

/// The executables a Hard or Lockdown session would close (settings list or the default).
#[tauri::command]
pub fn focus_blocklist(state: State<'_, SharedState>) -> Vec<String> {
    effective_blocklist(lock(&state).data.settings.focus_blocklist.clone())
}

/// A break (a UI timer between focus sessions) ran out: a system notification naming what's
/// next, unless the main window is already in front showing it.
#[tauri::command]
pub fn break_over(next: Option<String>, app: AppHandle) {
    let in_front = app
        .get_webview_window("main")
        .and_then(|w| Some(w.is_visible().ok()? && w.is_focused().ok()?))
        .unwrap_or(false);
    if in_front {
        return;
    }
    use tauri_plugin_notification::NotificationExt;
    let body = match next.as_deref().filter(|n| !n.trim().is_empty()) {
        Some(n) => format!("Next: {n}"),
        None => "Time to get back to it.".into(),
    };
    let _ = app
        .notification()
        .builder()
        .title("Break over")
        .body(body)
        .show();
}

// ---- ICS import ---------------------------------------------------------------------------

/// This term's recurring series in an ICS export, for the "pick your classes" step.
#[tauri::command]
pub fn ics_series(text: String, state: State<'_, SharedState>) -> CmdResult<Vec<SeriesInfo>> {
    let events = ics::parse_ics(&text, &Local).map_err(|e| e.to_string())?;
    let now = Utc::now();
    let g = lock(&state);
    Ok(ics::series_info(
        &events,
        &g.data.courses,
        now - Duration::days(7),
        now + Duration::days(feeds::AHEAD_DAYS),
        &Local,
    ))
}

/// Import ICS text (a downloaded file). `adapter`: "canvas" (Canvas calendar feed; adds the
/// courses it names) or "gcal" (Google Calendar export; imports the series picked as classes,
/// `series` replacing the picks when given). Re-importing updates source-owned fields and keeps
/// your edits.
#[tauri::command]
pub fn import_ics(
    text: String,
    adapter: String,
    series: Option<Vec<String>>,
    app: AppHandle,
    state: State<'_, SharedState>,
) -> CmdResult<ImportCounts> {
    let r = match adapter.as_str() {
        "canvas" => {
            let mut g = lock(&state);
            let r = feeds::import_canvas(&mut g, &text);
            feeds::record(&mut g.data.feeds.canvas, &r);
            r
        }
        "gcal" => {
            if series.is_some() {
                lock(&state).data.settings.gcal_series = series;
            }
            let r = feeds::take_gcal(&app, text);
            feeds::record(&mut lock(&state).data.feeds.gcal, &r);
            r
        }
        other => {
            return Err(format!(
                "unknown adapter {other:?} (use \"canvas\" or \"gcal\")"
            ))
        }
    };
    let counts = r?;
    feeds::finish(&app)?;
    Ok(counts)
}

// ---- updates (updater.rs) --------------------------------------------------------------

/// Ask GitHub Releases for a newer version. `null` = up to date. Phones update through their
/// app stores, so there it is always `null`.
#[cfg(desktop)]
#[tauri::command]
pub async fn check_update(app: AppHandle) -> CmdResult<Option<crate::updater::UpdateInfo>> {
    crate::updater::check(&app).await
}

#[cfg(mobile)]
#[tauri::command]
pub fn check_update() -> CmdResult<Option<()>> {
    Ok(None)
}

/// Download, verify and install the update from the last check, then restart. Refused during
/// a focus session. Progress arrives as "update-progress" `{ done, total }`.
#[cfg(desktop)]
#[tauri::command]
pub async fn install_update(app: AppHandle) -> CmdResult<()> {
    crate::updater::install(&app).await
}

#[cfg(mobile)]
#[tauri::command]
pub fn install_update() -> CmdResult<()> {
    Err("On a phone, updates come from the app store.".into())
}
