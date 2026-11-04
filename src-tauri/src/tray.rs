//! System tray / menu-bar icon and its menu.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, Wry};

use crate::focus::FocusManager;
use crate::store::{lock, SharedState};

pub const TRAY_ID: &str = "collegiapp";

static ISLAND_PLACED: AtomicBool = AtomicBool::new(false);
/// The "Pocket Start replaces Windows' Start" check, moved by `check_win_key` when Start's Power
/// menu or the app flips the setting.
static WIN_KEY: OnceLock<CheckMenuItem<Wry>> = OnceLock::new();

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Collegiapp", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quickadd", "Quick Add", true, None::<&str>)?;
    let island = MenuItem::with_id(app, "island", "Toggle Island", true, None::<&str>)?;
    let focus = MenuItem::with_id(app, "focus25", "Focus 25 min", true, None::<&str>)?;
    let start = MenuItem::with_id(app, "start", "Pocket Start", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "Refresh sources now", true, None::<&str>)?;
    // only Windows has the Win-key and Start-key hooks (start.rs)
    let win_key_on = lock(&app.state::<SharedState>())
        .data
        .settings
        .start_win_key;
    let win_key = CheckMenuItem::with_id(
        app,
        "startwinkey",
        "Pocket Start replaces Windows' Start",
        cfg!(windows),
        win_key_on && cfg!(windows),
        None::<&str>,
    )?;
    let _ = WIN_KEY.set(win_key.clone());
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let update = MenuItem::with_id(app, "update", "Check for updates", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show, &quick, &island, &focus, &sync, &sep, &start, &win_key, &sep2, &update, &quit,
        ],
    )?;
    crate::updater::set_menu_item(app, update);

    // every menu's clicks land here: the tray's and the island's right-click menu (`island_menu`)
    app.on_menu_event(|app, event| on_menu(app, event.id().as_ref()));
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tauri::include_image!("icons/tray.png"))
        .tooltip("Collegiapp")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// A menu command, by id. The island's own commands are `island-…` (see [`island_menu`]); the
/// rest are the tray's, which the island's menu shares (show, quickadd, focus25, sync).
fn on_menu(app: &AppHandle, id: &str) {
    if let Some(rest) = id.strip_prefix("island-") {
        return island_command(app, rest);
    }
    match id {
        "show" => show_main(app),
        "quickadd" => open_quick_add(app),
        "island" => {
            let _ = toggle_island(app);
        }
        "start" => crate::start::show(app),
        // the check mark has already flipped; store it and switch the hook
        "startwinkey" => {
            let on = !lock(&app.state::<SharedState>())
                .data
                .settings
                .start_win_key;
            crate::start::set_win_key(app, on);
        }
        "focus25" => {
            let level = lock(&app.state::<SharedState>())
                .data
                .settings
                .tray_focus_level;
            let blocklist = lock(&app.state::<SharedState>())
                .data
                .settings
                .focus_blocklist
                .clone();
            match app.state::<FocusManager>().start(app, 25, level, blocklist) {
                Ok(_) => notify(app, "Focus: 25 minutes", &format!("{level:?} mode is on.")),
                Err(e) => notify(app, "Focus", &e),
            }
        }
        // the window runs the check and shows the update dialog (app.js `checkUpdate`)
        // the UI runs it, so the result shows as a toast
        "sync" => {
            show_main(app);
            let _ = app.emit_to("main", "sync-now", ());
        }
        "update" => {
            show_main(app);
            let _ = app.emit_to("main", "update-check", ());
        }
        "quit" => {
            if app.state::<FocusManager>().is_lockdown() {
                notify(
                    app,
                    "Lockdown focus",
                    "Quit is disabled until the session ends.",
                );
                let _ = app.emit("focus-blocked", "quit");
            } else {
                crate::power::off(app, true);
            }
        }
        _ => {}
    }
}

/// The island's right-click menu, at the pointer: what it's showing (open it in the app, its
/// link, notes for it), focus (start one, or add time to and end the running one), quick add,
/// a refresh, then the island itself (back to the top centre, hide). Clicks go to [`on_menu`].
pub fn island_menu(app: &AppHandle) -> tauri::Result<()> {
    let Some(win) = app.get_webview_window("island") else {
        return Ok(());
    };
    let p = crate::presence::compute(app);
    let item = p.as_ref().and_then(|p| {
        lock(&app.state::<SharedState>())
            .data
            .items
            .iter()
            .find(|it| it.id == p.item_id)
            .cloned()
    });
    let focus = app.state::<FocusManager>().state();
    let menu = Menu::new(app)?;
    let item_of = |id: String, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let off = |text: String| MenuItem::new(app, text, false, None::<&str>);
    let sep = || PredefinedMenuItem::separator(app);

    if let Some(p) = &p {
        let what = if p.detail.is_empty() {
            p.label.clone()
        } else {
            format!("{} · {}", p.label, p.detail)
        };
        menu.append(&off(clip(&what, 60))?)?;
        menu.append(&item_of(
            format!("island-open:{}", p.item_id),
            "Open in Collegiapp",
        )?)?;
        if let Some(l) = item.as_ref().and_then(|it| it.links.first()) {
            let label = if l.label.trim().is_empty() {
                "link"
            } else {
                l.label.trim()
            };
            menu.append(&item_of(
                format!("island-link:{}", p.item_id),
                &format!("Open {}", clip(label, 40)),
            )?)?;
        }
        menu.append(&item_of(
            format!("island-note:{}", p.item_id),
            "Take notes",
        )?)?;
        menu.append(&sep()?)?;
    }
    if focus.active {
        let left = (focus.remaining_secs.max(0) + 59) / 60;
        menu.append(&off(format!("Focus · {left} min left"))?)?;
        menu.append(&item_of("island-focus-more".into(), "Add 5 minutes")?)?;
        if focus.can_end_freely {
            menu.append(&item_of("island-focus-end".into(), "End focus")?)?;
        } else {
            menu.append(&item_of("show".into(), "Show the focus screen")?)?;
        }
    } else {
        menu.append(&item_of("focus25".into(), "Focus 25 min")?)?;
    }
    menu.append(&item_of("quickadd".into(), "Quick add…")?)?;
    menu.append(&item_of("sync".into(), "Refresh sources now")?)?;
    menu.append(&sep()?)?;
    menu.append(&item_of("show".into(), "Show Collegiapp")?)?;
    menu.append(&item_of("island-center".into(), "Move to the top centre")?)?;
    menu.append(&item_of("island-hide".into(), "Hide the island")?)?;
    win.popup_menu(&menu)
}

/// The island menu's own commands (`island-` taken off).
fn island_command(app: &AppHandle, cmd: &str) {
    let (what, id) = cmd.split_once(':').unwrap_or((cmd, ""));
    let id = uuid::Uuid::parse_str(id).ok();
    match (what, id) {
        ("open", Some(id)) => {
            show_main(app);
            let _ = app.emit_to("main", "open-item", id);
        }
        ("link", Some(id)) => {
            let url = lock(&app.state::<SharedState>())
                .data
                .items
                .iter()
                .find(|it| it.id == id)
                .and_then(|it| it.links.first().map(|l| l.url.clone()));
            if let Some(url) = url {
                if let Err(e) = crate::commands::open_url(app, url) {
                    notify(app, "Couldn't open the link", &e);
                }
            }
        }
        // the window makes the note (app.js `noteFor`): titled with the class and the day, filed
        // under its class, opened in the editor
        ("note", Some(id)) => {
            show_main(app);
            let _ = app.emit_to("main", "note-for", id);
        }
        ("focus-more", _) => {
            if let Err(e) = app.state::<FocusManager>().extend(app, 5) {
                notify(app, "Focus", &e);
            }
        }
        ("focus-end", _) => {
            if let Err(e) = app.state::<FocusManager>().end(app, None) {
                notify(app, "Focus", &e);
            }
        }
        ("center", _) => {
            if let Some(win) = app.get_webview_window("island") {
                place_island(&win);
            }
        }
        ("hide", _) => {
            if let Some(win) = app.get_webview_window("island") {
                let _ = win.hide();
            }
        }
        _ => {}
    }
}

/// At most `n` characters, with an ellipsis when cut.
fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        return s.to_string();
    }
    let mut out: String = s.chars().take(n.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Set the tray's "Pocket Start replaces Windows' Start" check (start.rs `set_win_key`).
pub fn check_win_key(on: bool) {
    if let Some(item) = WIN_KEY.get() {
        let _ = item.set_checked(on && cfg!(windows));
    }
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Show + focus the main window and tell it to open quick add ("quickadd" event).
pub fn open_quick_add(app: &AppHandle) {
    show_main(app);
    let _ = app.emit_to("main", "quickadd", ());
}

/// Show/hide the floating island. First show places it top-center of the primary monitor.
/// Returns whether it is now visible.
pub fn toggle_island(app: &AppHandle) -> tauri::Result<bool> {
    let Some(win) = app.get_webview_window("island") else {
        return Ok(false);
    };
    if win.is_visible()? {
        win.hide()?;
        return Ok(false);
    }
    if !ISLAND_PLACED.swap(true, Ordering::SeqCst) {
        place_island(&win);
    }
    win.show()?;
    let _ = win.set_always_on_top(true);
    crate::presence::refresh(app);
    Ok(true)
}

/// Put the island at the top centre of the primary monitor.
fn place_island(win: &WebviewWindow) {
    if let Ok(Some(m)) = win.primary_monitor() {
        let scale = m.scale_factor();
        let w = (380.0 * scale) as i32;
        let x = m.position().x + (m.size().width as i32 - w) / 2;
        let y = m.position().y + (10.0 * scale) as i32;
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }
}

pub fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}
