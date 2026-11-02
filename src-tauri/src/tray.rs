//! System tray / menu-bar icon and its menu.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Wry};

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

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tauri::include_image!("icons/tray.png"))
        .tooltip("Collegiapp")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
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
        })
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
        if let Ok(Some(m)) = win.primary_monitor() {
            let scale = m.scale_factor();
            let w = (380.0 * scale) as i32;
            let x = m.position().x + (m.size().width as i32 - w) / 2;
            let y = m.position().y + (10.0 * scale) as i32;
            let _ = win.set_position(PhysicalPosition::new(x, y));
        }
    }
    win.show()?;
    let _ = win.set_always_on_top(true);
    crate::presence::refresh(app);
    Ok(true)
}

pub fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}
