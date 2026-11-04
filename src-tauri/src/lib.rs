//! Collegiapp app shell (Tauri 2). All domain logic lives in `collegiapp-core`; this crate
//! wires it to windows, tray, global shortcut, notifications, autostart and focus mode.
//!
//! One codebase for Windows, macOS and Linux (desktop) and iOS and Android (Tauri mobile).
//! Desktop-only surfaces (tray, island window, taskbar/dock presence, global shortcut,
//! autostart, terminating processes during focus) are behind `#[cfg(desktop)]`; on a phone
//! the same UI runs full screen and focus sessions are timers with notifications.
//!
//! Events emitted to the frontend:
//! - "quickadd"      (to main)  global shortcut / tray "Quick Add": open the quick-add box
//! - "presence"      (all)      `Presence | null`, every 15s and on changes
//! - "items-changed" (all)      after any item/course mutation; the payload says who changed
//!   it (a window label for `save_items`, "app", or "import")
//! - "alert"         (to main)  `{ item_id, level }` when a class or event with an interrupt
//!   level is about to start (see presence.rs)
//! - "focus-started" / "focus-tick" (every 2s) / "focus-ended"  (all)  `FocusState`
//! - "focus-blocked" (all)      "quit" when Quit is refused during Lockdown
//! - "update-available" (all)   `UpdateInfo` when a check finds a newer release (updater.rs)
//! - "update-progress" (all)    `{ done, total }` bytes while an update downloads
//! - "update-check"  (to main)  tray "Check for updates": run the check and show the result
//! - "open-item"     (to main)  an item id picked in Pocket Start or the island's menu: select it
//! - "note-for"      (to main)  an item id, the island menu's "Take notes": a new note for it
//! - "start-open" / "start-apps" (to start)  Pocket Start shows / its app list changed (start.rs)
//! - "gradescope"    (all)      the Gradescope `FeedLog` after you sign in and it imports
//! - "webwork"       (all)      the WeBWorK `FeedLog` after you sign in to a course and it imports
//! - "backdrop"      (to main)  Windows: `{ mode, grid }`, what's behind the window ("desktop"
//!   or "solid") and the wallpaper's dot grid against it (backdrop.rs)
//! - "ai-chunk"      (to the asking window)  `{ id, delta }`, an AI reply as it streams (ai.rs)
//! - "power-off"     (to main)  `{ seq, quit }`: play the CRT turning off, then `power_done(seq)`
//!   hides the window or quits (power.rs)
//! - "cloud"         (all)      `CloudStatus` when sync signs in or out, starts or finishes a
//!   cycle (cloud.rs); a pull that changed items also sends "items-changed" with "sync"

mod ai;
mod backdrop;
mod bridge;
mod cloud;
mod commands;
mod export;
mod feeds;
mod focus;
mod gradescope;
mod mcp;
mod power;
mod presence;
mod start;
mod store;
mod trash;
#[cfg(desktop)]
mod tray;
#[cfg(desktop)]
mod updater;
mod webwork;

use tauri::Manager;
#[cfg(desktop)]
use tauri::WindowEvent;

use crate::feeds::FeedCache;
use crate::focus::FocusManager;
use crate::presence::{AlertLog, PresenceHold};
use crate::store::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // must be registered first
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                tray::show_main(app)
            }))
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--minimized"]),
            ))
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        // Pocket Start's app icons: appicon://localhost/<AppID> (http://appicon.localhost/… on
        // Windows), Windows' own icon for an app Start lists, as a PNG (start.rs)
        .register_asynchronous_uri_scheme_protocol("appicon", |ctx, request, responder| {
            let path = request.uri().path().trim_start_matches('/');
            let id = percent_encoding::percent_decode_str(path)
                .decode_utf8_lossy()
                .into_owned();
            start::icon(ctx.app_handle(), id, move |png| {
                responder.respond(start::icon_response(png))
            });
        })
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        // no setup-time inputs, so managed up front: a page can call these before setup runs
        .manage(ai::AiRuns::default())
        .manage(power::Power::default())
        .invoke_handler(tauri::generate_handler![
            commands::load_all,
            bridge::bridge_clients,
            bridge::bridge_answer,
            bridge::bridge_pending,
            bridge::bridge_forget,
            mcp::mcp_desktop,
            mcp::mcp_code,
            commands::save_items,
            commands::set_feed,
            commands::refresh_feeds,
            commands::set_class_series,
            commands::gradescope_connect,
            commands::gradescope_disconnect,
            commands::webwork_connect,
            commands::webwork_disconnect,
            commands::quick_add_preview,
            commands::quick_add,
            commands::list_items,
            commands::do_first,
            commands::update_item,
            commands::delete_item,
            commands::list_courses,
            commands::upsert_course,
            commands::delete_course,
            commands::trash_list,
            commands::trash_restore,
            commands::trash_purge,
            commands::trash_set_limit,
            commands::list_views,
            commands::filter_terms,
            commands::get_settings,
            commands::set_settings,
            commands::save_look,
            commands::open_link,
            commands::set_presence,
            commands::get_presence,
            commands::toggle_island,
            commands::island_menu,
            commands::backdrop,
            commands::start_apps,
            commands::set_start_pins,
            commands::launch_app,
            commands::start_app_info,
            commands::start_app_do,
            commands::start_action,
            commands::set_start_win_key,
            commands::hide_start,
            commands::open_item,
            commands::start_focus,
            commands::end_focus,
            commands::focus_state,
            commands::extend_focus,
            commands::focus_blocklist,
            commands::break_over,
            commands::ics_series,
            commands::import_ics,
            commands::check_update,
            commands::install_update,
            ai::ai_tools,
            ai::ai_run,
            ai::ai_cancel,
            export::save_export,
            export::reveal_export,
            export::open_export,
            export::save_pdf,
            export::print_page,
            power::power_done,
            cloud::cloud_status,
            cloud::cloud_config,
            cloud::cloud_sign_in,
            cloud::cloud_sign_out,
            cloud::cloud_sync_now,
        ])
        .setup(|app| {
            // COLLEGIAPP_DATA points the store at another folder (tests, a second profile)
            let dir = match std::env::var_os("COLLEGIAPP_DATA") {
                Some(d) => std::path::PathBuf::from(d),
                None => app.path().app_data_dir()?,
            };
            log_panics(dir.join("crash.log"));
            let path = dir.join(store::FILE_NAME);
            app.manage(bridge::Bridge::load(&path));
            app.manage(cloud::Cloud::load(&path));
            let state = AppState::load_or_init(path)?;
            app.manage(std::sync::Mutex::new(state));
            app.manage(FocusManager::default());
            app.manage(PresenceHold::default());
            app.manage(AlertLog::default());
            app.manage(FeedCache::default());
            app.manage(start::StartCatalog::default());

            #[cfg(desktop)]
            {
                app.manage(updater::Updates::default());
                // island and start are `"create": false` and built here, after the state above:
                // Tauri builds config windows before setup, and building one pumps messages, so
                // an earlier window's page could invoke a command that reads unmanaged state.
                for cfg in app.config().app.windows.iter().filter(|w| !w.create) {
                    tauri::WebviewWindowBuilder::from_config(app.handle(), cfg)?.build()?;
                }
                tray::build(app.handle())?;
                register_shortcuts(app.handle());
                start::setup(app.handle());
                #[cfg(windows)]
                backdrop::spawn(app.handle().clone());
                if std::env::args().any(|a| a == "--minimized") {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
            }

            presence::spawn_ticker(app.handle().clone());
            feeds::spawn_refresher(app.handle().clone());
            #[cfg(desktop)]
            {
                updater::spawn_checker(app.handle().clone());
                bridge::spawn(app.handle().clone());
                cloud::start(app.handle().clone());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Desktop: closing the main window hides it to the tray; Quit lives in the tray menu.
            // Pocket Start hides when it loses focus, like Windows' Start. The main window's
            // backdrop is looked at again whenever it moves, resizes or changes focus.
            #[cfg(desktop)]
            match event {
                WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                    api.prevent_close();
                    power::off(window.app_handle(), false);
                }
                WindowEvent::CloseRequested { api, .. }
                    if matches!(window.label(), "island" | start::LABEL) =>
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
                WindowEvent::Focused(false) if window.label() == start::LABEL => {
                    start::on_blur(window.app_handle());
                }
                WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::Focused(_)
                    if window.label() == "main" =>
                {
                    backdrop::poke();
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Collegiapp");
}

/// Release builds abort on a panic and a windowed app has no console, so a crash would leave
/// no trace: append the panic (message, file:line, thread) to `crash.log` beside the store first.
fn log_panics(file: std::path::PathBuf) {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file)
        {
            let thread = std::thread::current();
            let _ = writeln!(
                f,
                "{} collegiapp {} panicked on thread {}: {info}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                env!("CARGO_PKG_VERSION"),
                thread.name().unwrap_or("?"),
            );
        }
        default(info);
    }));
}

/// Ctrl+Shift+Space (Cmd+Shift+Space on macOS): show + focus main and emit "quickadd".
/// Ctrl+Alt+Space (Ctrl+Option+Cmd+Space on macOS): toggle Pocket Start, alongside the Win key.
#[cfg(desktop)]
fn register_shortcuts(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };

    #[cfg(target_os = "macos")]
    let (mods, start_mods) = (
        Modifiers::SUPER | Modifiers::SHIFT,
        Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER,
    );
    #[cfg(not(target_os = "macos"))]
    let (mods, start_mods) = (
        Modifiers::CONTROL | Modifiers::SHIFT,
        Modifiers::CONTROL | Modifiers::ALT,
    );
    let quick_add = Shortcut::new(Some(mods), Code::Space);
    let start_key = Shortcut::new(Some(start_mods), Code::Space);

    let plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            if shortcut == &quick_add {
                tray::open_quick_add(app);
            } else if shortcut == &start_key {
                start::toggle(app);
            }
        })
        .build();
    if let Err(e) = app.plugin(plugin) {
        eprintln!("collegiapp: global-shortcut plugin failed: {e}");
        return;
    }
    // another app may own a combo; the tray still has Quick Add, and the Win key opens Start
    for (shortcut, what) in [(quick_add, "quick-add"), (start_key, "Start")] {
        if let Err(e) = app.global_shortcut().register(shortcut) {
            eprintln!("collegiapp: could not register the {what} shortcut: {e}");
        }
    }
}
