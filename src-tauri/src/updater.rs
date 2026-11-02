//! Updates (desktop). The app reads a signed `latest.json` from GitHub Releases
//! (`plugins.updater.endpoints` in tauri.conf.json; `COLLEGIAPP_UPDATE_URL` overrides it for
//! testing). It checks 20 s after launch and every 6 hours. A new version is announced once:
//! "update-available" to every window, a notification, and the tray's "Check for updates"
//! item becomes "Update to x.y.z". Installing is always the user's call, from the update
//! dialog, and is refused during a focus session so it never cuts one short.
//!
//! Releases are signed with the private key in `~/.tauri/collegiapp.key` (CI reads it from the
//! TAURI_SIGNING_PRIVATE_KEY secret); the app only installs files that match the public key in
//! tauri.conf.json. On Windows the NSIS installer runs in passive mode, then reopens the app.

use std::sync::Mutex;
use std::thread;
use std::time::Duration as StdDuration;

use serde::Serialize;
use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::focus::FocusManager;

const CHECK_EVERY: StdDuration = StdDuration::from_secs(6 * 60 * 60);

/// What the UI shows in the update dialog.
#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Default)]
pub struct Updates {
    found: Mutex<Option<Update>>,
    announced: Mutex<Option<String>>,
    menu: Mutex<Option<MenuItem<Wry>>>,
}

/// tray.rs hands over its "Check for updates" item so a found update can rename it.
pub fn set_menu_item(app: &AppHandle, item: MenuItem<Wry>) {
    *app.state::<Updates>().menu.lock().unwrap() = Some(item);
}

fn info(u: &Update) -> UpdateInfo {
    UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone().filter(|b| !b.trim().is_empty()),
        date: u.date.map(|d| d.to_string()),
    }
}

/// Ask the release feed for a newer version. `Ok(None)` means up to date.
pub async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let mut builder = app.updater_builder();
    if let Some(url) = std::env::var_os("COLLEGIAPP_UPDATE_URL") {
        let url = url
            .to_string_lossy()
            .parse()
            .map_err(|e| format!("COLLEGIAPP_UPDATE_URL: {e}"))?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    let update = builder
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let found = update.as_ref().map(info);
    *app.state::<Updates>().found.lock().unwrap() = update;
    if let Some(i) = &found {
        announce(app, i);
    }
    Ok(found)
}

/// First sighting of a version: tell the windows, rename the tray item, notify once.
fn announce(app: &AppHandle, i: &UpdateInfo) {
    let st = app.state::<Updates>();
    let _ = app.emit("update-available", i);
    if let Some(item) = st.menu.lock().unwrap().as_ref() {
        let _ = item.set_text(format!("Update to {}…", i.version));
    }
    let mut seen = st.announced.lock().unwrap();
    if seen.as_deref() != Some(i.version.as_str()) {
        *seen = Some(i.version.clone());
        crate::tray::notify(
            app,
            &format!("Collegiapp {} is ready", i.version),
            "Open Collegiapp to install it. It restarts in a few seconds.",
        );
    }
}

/// Download, verify and install the update found by the last check, then restart.
/// Emits "update-progress" `{ done, total }` while downloading. On Windows the process exits
/// inside `install` and the installer reopens the app.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    if app.state::<FocusManager>().state().active {
        return Err("Finish your focus session first, then update.".into());
    }
    let update = app.state::<Updates>().found.lock().unwrap().clone();
    let Some(update) = update else {
        return Err("No update to install. Check for updates first.".into());
    };
    let mut done = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                done += chunk as u64;
                let _ = app.emit(
                    "update-progress",
                    serde_json::json!({ "done": done, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart()
}

/// Quiet background checks; a failed check (offline, no release yet) just waits for the next.
pub fn spawn_checker(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(StdDuration::from_secs(20));
        loop {
            if let Err(e) = tauri::async_runtime::block_on(check(&app)) {
                eprintln!("collegiapp: update check failed: {e}");
            }
            thread::sleep(CHECK_EVERY);
        }
    });
}
