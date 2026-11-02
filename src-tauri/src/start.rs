//! Pocket Start: Collegiapp's own Start menu (ui/start.html), a frameless, always-on-top window
//! that opens above the taskbar's Start key with your pinned apps, a search prompt and the live
//! Do first list. Windows' Start comes back as soon as Collegiapp quits.
//!
//! Opening it:
//! - Windows: a low-level keyboard hook turns a lone Win press into "toggle Pocket Start". It
//!   holds each Win press back from Windows until it knows what it is: a tap toggles Pocket Start
//!   and Windows never sees it, so its Start and Search never open; Win+anything (Win+E, Win+L,
//!   Win+Shift+S …) is sent on to Windows just ahead of the other key. Windows doesn't pass keys
//!   to a normal app's hook while an app running as administrator is in front, so there Win still
//!   opens Windows' Start.
//! - Windows: a low-level mouse hook takes a left click on the taskbar's Start key (toggles) or
//!   search box (opens), found with UI Automation at click time (`startkey` below).
//! - "Pocket Start replaces Windows' Start" (`settings.start_win_key`) turns both hooks off, so
//!   the Win key and the Start key open Windows' Start again: a check in the tray, a switch in
//!   Pocket Start's Power menu and a command in the app's search (`set_win_key`).
//! - Every desktop: Ctrl+Alt+Space (Ctrl+Option+Cmd+Space on macOS), registered in lib.rs.
//!
//! Apps come from Windows: `Get-StartApps` lists every Start app and `Export-StartLayout` gives
//! the pins, read in the background at launch and again when Start opens after ten minutes.
//! Pinning or unpinning in Pocket Start saves your own list (`settings.start_pins`); "Use Windows
//! pins" goes back. `launch` only opens apps from that catalog or the Settings pages below, and
//! opens them through Explorer, so they start as if from Windows' Start (not as Collegiapp's
//! children, and without its environment). Icons and the right-click menu (start/menu.rs) come
//! from each app's Apps-folder item, the one Windows' Start shows, so a shortcut's own icon wins
//! over its program's.
//!
//! Events: "start-open" (to start) `StartInfo` each time it shows; "start-apps" (to start)
//! `StartApps` when the catalog has been read.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
#[cfg(desktop)]
use tauri::{Emitter, PhysicalPosition, PhysicalSize};

use crate::store::{lock, SharedState};

pub mod menu;

pub const LABEL: &str = "start";
/// Window size in logical px: the 720 px panel of the design plus an 18 px transparent margin
/// that holds its shadow (ui/css/start.css `--pad`).
pub const WIDTH: f64 = 756.0;
pub const HEIGHT: f64 = 742.0;
/// Re-read the Windows app list when Start opens and the last read is older than this.
const STALE: Duration = Duration::from_secs(600);

/// One app (or Settings page) Start can open. `id` is the Windows AppID from `Get-StartApps`
/// (an AppUserModelID, a known-folder path or a URL), a .lnk path, or an `ms-settings:` URI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StartApp {
    pub id: String,
    pub name: String,
}

/// What the Start window shows.
#[derive(Debug, Clone, Default, Serialize)]
pub struct StartApps {
    pub pinned: Vec<StartApp>,
    /// Every Start app, sorted by name.
    pub all: Vec<StartApp>,
    /// Settings pages for search.
    pub settings: Vec<StartApp>,
    /// The pins are your own list (`settings.start_pins`), not Windows'.
    pub custom: bool,
    /// Ids you hid from All apps and search (`settings.start_hidden`).
    pub hidden: Vec<String>,
    /// False until Windows has answered (the first read takes a second or two).
    pub loaded: bool,
}

/// Payload of "start-open".
#[derive(Debug, Clone, Serialize)]
pub struct StartInfo {
    pub user: String,
    /// Windows' own light/dark mode (the taskbar's), so Start matches the shell: Some(true) =
    /// dark (P11 Night). None where the OS doesn't say; the UI then follows prefers-color-scheme.
    pub night: Option<bool>,
    /// Windows: the Win key and the taskbar's Start key open Pocket Start (`settings.start_win_key`).
    /// None elsewhere, which has no hooks.
    pub win_key: Option<bool>,
}

#[derive(Default)]
struct Catalog {
    all: Vec<StartApp>,
    windows_pins: Vec<StartApp>,
    read_at: Option<Instant>,
    reading: bool,
}

/// The app list read from Windows, plus when the window last showed.
#[derive(Default)]
pub struct StartCatalog {
    catalog: Mutex<Catalog>,
    shown_at: Mutex<Option<Instant>>,
}

/// Settings pages offered by search ("Bluetooth" finds Bluetooth & devices).
const SETTINGS_PAGES: &[(&str, &str)] = &[
    ("ms-settings:", "Settings"),
    ("ms-settings:display", "Display"),
    ("ms-settings:sound", "Sound"),
    ("ms-settings:network-wifi", "Wi-Fi"),
    ("ms-settings:bluetooth", "Bluetooth & devices"),
    ("ms-settings:personalization", "Personalization"),
    ("ms-settings:taskbar", "Taskbar"),
    ("ms-settings:personalization-start", "Start settings"),
    ("ms-settings:notifications", "Notifications"),
    ("ms-settings:powersleep", "Power & battery"),
    ("ms-settings:storagesense", "Storage"),
    ("ms-settings:appsfeatures", "Installed apps"),
    ("ms-settings:startupapps", "Startup apps"),
    ("ms-settings:defaultapps", "Default apps"),
    ("ms-settings:dateandtime", "Date & time"),
    ("ms-settings:windowsupdate", "Windows Update"),
    ("ms-settings:privacy", "Privacy & security"),
    ("ms-settings:yourinfo", "Your info"),
];

fn settings_pages() -> Vec<StartApp> {
    if !cfg!(windows) {
        return Vec::new();
    }
    SETTINGS_PAGES
        .iter()
        .map(|(id, name)| StartApp {
            id: (*id).into(),
            name: (*name).into(),
        })
        .collect()
}

// ---- the catalog: pure parts (tested below) ---------------------------------------------

#[derive(Debug, Deserialize)]
struct RawCatalog {
    #[serde(default)]
    apps: Option<Vec<RawApp>>,
    #[serde(default)]
    pins: Option<Vec<RawPin>>,
}

#[derive(Debug, Deserialize)]
struct RawApp {
    #[serde(rename = "Name")]
    name: Option<String>,
    #[serde(rename = "AppID")]
    app_id: Option<String>,
}

/// One entry of `Export-StartLayout`'s `pinnedList`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPin {
    packaged_app_id: Option<String>,
    desktop_app_id: Option<String>,
    desktop_app_link: Option<String>,
}

/// Parse the JSON the PowerShell reader writes: `{ apps: [{Name, AppID}], pins: [pinnedList…] }`.
/// Returns every app (sorted by name, one per id) and the resolved pins.
fn parse_catalog(
    json: &str,
    expand: impl Fn(&str) -> String,
) -> Result<(Vec<StartApp>, Vec<StartApp>), String> {
    let raw: RawCatalog = serde_json::from_str(json.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("unreadable app list: {e}"))?;
    let mut all: Vec<StartApp> = raw
        .apps
        .unwrap_or_default()
        .into_iter()
        .filter_map(|a| {
            let (name, id) = (a.name?.trim().to_string(), a.app_id?.trim().to_string());
            (!name.is_empty() && !id.is_empty()).then_some(StartApp { id, name })
        })
        .collect();
    all.sort_by_key(|a| a.name.to_lowercase());
    let mut seen = std::collections::HashSet::new();
    all.retain(|a| seen.insert(a.id.to_lowercase()));
    let pins = resolve_pins(&raw.pins.unwrap_or_default(), &all, expand);
    Ok((all, pins))
}

/// Match Windows' pins to apps: packaged and desktop app ids by id, shortcuts by their file name
/// (File Explorer.lnk → "File Explorer"); a shortcut with no matching app opens the .lnk itself.
fn resolve_pins(
    pins: &[RawPin],
    all: &[StartApp],
    expand: impl Fn(&str) -> String,
) -> Vec<StartApp> {
    let by_id = |id: &str| all.iter().find(|a| a.id.eq_ignore_ascii_case(id)).cloned();
    let mut out: Vec<StartApp> = Vec::new();
    for p in pins {
        let app = if let Some(id) = p.packaged_app_id.as_deref().or(p.desktop_app_id.as_deref()) {
            by_id(id)
        } else if let Some(link) = p.desktop_app_link.as_deref() {
            let path = expand(link);
            let stem = std::path::Path::new(&path.replace('\\', "/"))
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            all.iter()
                .find(|a| a.name.eq_ignore_ascii_case(&stem))
                .cloned()
                .or_else(|| {
                    (!stem.is_empty()).then_some(StartApp {
                        id: path,
                        name: stem,
                    })
                })
        } else {
            None
        };
        if let Some(a) = app {
            if !out.iter().any(|o| o.id.eq_ignore_ascii_case(&a.id)) {
                out.push(a);
            }
        }
    }
    out
}

/// Pins when Windows gave none: the first app matching each slot.
fn fallback_pins(all: &[StartApp]) -> Vec<StartApp> {
    const SLOTS: &[&[&str]] = &[
        &["file explorer"],
        &[
            "firefox",
            "google chrome",
            "microsoft edge",
            "brave",
            "opera",
        ],
        &["terminal", "windows powershell", "command prompt"],
        &["visual studio code", "cursor", "intellij idea", "pycharm"],
        &["collegiapp"],
        &["spotify", "media player", "music"],
        &["discord", "slack", "microsoft teams"],
        &["outlook", "mail", "thunderbird"],
        &["calendar"],
        &["photos"],
        &["notion", "obsidian", "onenote", "notepad"],
        &["settings"],
    ];
    let mut out: Vec<StartApp> = Vec::new();
    for slot in SLOTS {
        let hit = slot
            .iter()
            .find_map(|want| all.iter().find(|a| a.name.to_lowercase() == *want))
            .or_else(|| {
                slot.iter()
                    .find_map(|want| all.iter().find(|a| a.name.to_lowercase().contains(want)))
            });
        if let Some(a) = hit {
            if !out.contains(a) {
                out.push(a.clone());
            }
        }
    }
    out
}

/// `%APPDATA%\x` → `C:\Users\me\AppData\Roaming\x`; unknown variables stay as written.
fn expand_env(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after.find('%') {
            Some(j) => {
                let name = &after[..j];
                match std::env::var(name) {
                    Ok(v) if !name.is_empty() => out.push_str(&v),
                    _ => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[j + 1..];
            }
            None => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// What Explorer is asked to open for an app id: URIs (`ms-settings:`, `steam://`) and full paths
/// (`C:\…\app.exe`, a .lnk) as they are; AppUserModelIDs and known-folder paths
/// (`{1AC14E77-…}\cmd.exe`) through the Apps folder, which is how Windows' Start opens them.
pub fn launch_target(id: &str) -> String {
    let scheme = id.split(':').next().unwrap_or("");
    let is_uri = id.contains(':')
        && scheme.len() > 1
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c));
    if is_uri || is_path(id) {
        id.to_string()
    } else {
        format!("shell:AppsFolder\\{id}")
    }
}

/// Top-left corner for a `w`×`h` window in a work area (physical px): bottom edge on the work
/// area's bottom (the taskbar's top), left edge on its left, or centered when the taskbar is.
pub fn anchor(area: (i32, i32, i32, i32), w: i32, h: i32, centered: bool) -> (i32, i32) {
    let (x, y, aw, ah) = area;
    let left = if centered { x + (aw - w) / 2 } else { x };
    (left, y + ah - h.min(ah))
}

// ---- state and window -------------------------------------------------------------------

/// The catalog plus the effective pins (your own list or Windows').
pub fn apps(app: &AppHandle) -> StartApps {
    let (custom, hidden) = {
        let state = app.state::<SharedState>();
        let g = lock(&state);
        let s = &g.data.settings;
        (s.start_pins.clone(), s.start_hidden.clone())
    };
    let cat = app.state::<StartCatalog>();
    let c = cat.catalog.lock().unwrap_or_else(|e| e.into_inner());
    let pinned = match &custom {
        Some(p) => p.clone(),
        None if !c.windows_pins.is_empty() => c.windows_pins.clone(),
        None => fallback_pins(&c.all),
    };
    StartApps {
        pinned,
        all: c.all.clone(),
        settings: settings_pages(),
        custom: custom.is_some(),
        hidden,
        loaded: c.read_at.is_some() || !cfg!(windows),
    }
}

/// Save your own pins, or with `None` go back to Windows' pins.
pub fn set_pins(app: &AppHandle, pins: Option<Vec<StartApp>>) -> Result<StartApps, String> {
    {
        let state = app.state::<SharedState>();
        let mut g = lock(&state);
        g.data.settings.start_pins = pins;
        g.save()?;
    }
    Ok(apps(app))
}

#[cfg(desktop)]
pub fn info(app: &AppHandle) -> StartInfo {
    let raw = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default();
    let mut c = raw.chars();
    let user = match c.next() {
        Some(f) => f.to_uppercase().chain(c).collect(),
        None => "You".into(),
    };
    StartInfo {
        user,
        night: os::night(),
        win_key: cfg!(windows).then(|| {
            lock(&app.state::<SharedState>())
                .data
                .settings
                .start_win_key
        }),
    }
}

/// Read the app list from Windows in the background when it was never read or is stale.
#[cfg(desktop)]
pub fn refresh(app: &AppHandle, force: bool) {
    if !cfg!(windows) {
        return;
    }
    let cat = app.state::<StartCatalog>();
    {
        let mut c = cat.catalog.lock().unwrap_or_else(|e| e.into_inner());
        let fresh = c.read_at.is_some_and(|t| t.elapsed() < STALE);
        if c.reading || (fresh && !force) {
            return;
        }
        c.reading = true;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let read = os::read_catalog().and_then(|json| parse_catalog(&json, expand_env));
        let cat = app.state::<StartCatalog>();
        {
            let mut c = cat.catalog.lock().unwrap_or_else(|e| e.into_inner());
            c.reading = false;
            match read {
                Ok((all, pins)) => {
                    c.all = all;
                    c.windows_pins = pins;
                    c.read_at = Some(Instant::now());
                }
                Err(e) => {
                    eprintln!("collegiapp: could not read the Start apps: {e}");
                    // try again next time Start opens, but show what we have
                    if c.read_at.is_none() && !c.all.is_empty() {
                        c.read_at = Some(Instant::now());
                    }
                }
            }
        }
        let _ = app.emit_to(LABEL, "start-apps", apps(&app));
    });
}

#[cfg(desktop)]
pub fn toggle(app: &AppHandle) {
    let Some(win) = app.get_webview_window(LABEL) else {
        return;
    };
    if win.is_visible().unwrap_or(false) {
        hide(app);
    } else {
        show(app);
    }
}

/// Place, show and focus Start. Not during Lockdown focus (the Win key then opens nothing).
#[cfg(desktop)]
pub fn show(app: &AppHandle) {
    if app.state::<crate::focus::FocusManager>().is_lockdown() {
        return;
    }
    let Some(win) = app.get_webview_window(LABEL) else {
        return;
    };
    place(&win);
    *app.state::<StartCatalog>()
        .shown_at
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
    let _ = app.emit_to(LABEL, "start-open", info(app));
    let _ = win.show();
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
    refresh(app, false);
}

#[cfg(desktop)]
pub fn hide(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.hide();
    }
}

/// Start lost focus: hide it, unless it only just opened (Windows can bounce focus while a
/// window comes to the front).
#[cfg(desktop)]
pub fn on_blur(app: &AppHandle) {
    let recent = app
        .state::<StartCatalog>()
        .shown_at
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some_and(|t| t.elapsed() < Duration::from_millis(350));
    if !recent {
        hide(app);
    }
}

/// On the monitor under the pointer, above the taskbar: left-aligned, or centered when the
/// Windows taskbar is centered (as Windows places its own Start).
#[cfg(desktop)]
fn place(win: &tauri::WebviewWindow) {
    let monitor = win
        .cursor_position()
        .ok()
        .and_then(|p| win.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten());
    let Some(m) = monitor else {
        return;
    };
    let s = m.scale_factor();
    let wa = m.work_area();
    let area = (
        wa.position.x,
        wa.position.y,
        wa.size.width as i32,
        wa.size.height as i32,
    );
    let w = (WIDTH * s).round() as i32;
    let h = ((HEIGHT * s).round() as i32).min(area.3);
    let (x, y) = anchor(area, w, h, os::taskbar_centered());
    // position first: moving to a monitor with another scale resizes the window
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let _ = win.set_size(PhysicalSize::new(w as u32, h as u32));
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

/// Open an app from the catalog (or a pin or Settings page), then hide Start.
pub fn launch(app: &AppHandle, id: &str) -> Result<(), String> {
    if !known(app, id) {
        return Err("That app isn't in Start.".into());
    }
    #[cfg(desktop)]
    hide(app);
    os::open(&launch_target(id))
}

/// `id` is an app or Settings page Start lists (the catalog, the pins, the Settings pages).
fn known(app: &AppHandle, id: &str) -> bool {
    let a = apps(app);
    a.all
        .iter()
        .chain(&a.pinned)
        .chain(&a.settings)
        .any(|x| x.id == id)
}

// ---- app icons ------------------------------------------------------------------------------

/// Icon size asked of Windows, in device pixels: Start shows icons at 30 px (20 in lists), so
/// they stay sharp up to 200% scale.
const ICON_PX: i32 = 64;

type IconJob = (String, Box<dyn FnOnce(Option<Vec<u8>>) + Send>);

/// Windows' icon for a Start app as a PNG, for the `appicon:` scheme (lib.rs). `done` gets it,
/// or None for an app Start doesn't list or Windows has no icon for. One thread reads them
/// (the shell wants COM) and keeps each, so an icon is read once per run.
pub fn icon(app: &AppHandle, id: String, done: impl FnOnce(Option<Vec<u8>>) + Send + 'static) {
    static JOBS: std::sync::OnceLock<std::sync::mpsc::Sender<IconJob>> = std::sync::OnceLock::new();
    if !known(app, &id) {
        return done(None);
    }
    let jobs = JOBS.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::channel::<IconJob>();
        std::thread::spawn(move || {
            let mut read = std::collections::HashMap::<String, Option<Vec<u8>>>::new();
            for (id, done) in rx {
                let png = read.entry(id).or_insert_with_key(|id| {
                    os::icon_png(&shell_target(id), ICON_PX)
                        .or_else(|e| match is_path(id) {
                            true => os::icon_png(id, ICON_PX),
                            false => Err(e),
                        })
                        .ok()
                });
                done(png.clone());
            }
        });
        tx
    });
    if let Err(std::sync::mpsc::SendError((_, done))) = jobs.send((id, Box::new(done))) {
        done(None);
    }
}

/// The `appicon:` reply: the PNG, or 404 (the UI then keeps the app's pixel icon).
pub fn icon_response(png: Option<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let r = tauri::http::Response::builder();
    match png {
        Some(png) => r
            .header("Content-Type", "image/png")
            .header("Cache-Control", "max-age=86400")
            .body(png),
        None => r.status(404).body(Vec::new()),
    }
    .unwrap_or_default()
}

/// A full path (`C:\…`, `\\server\…`), not an AppUserModelID or a URI.
fn is_path(id: &str) -> bool {
    id.starts_with("\\\\") || (id.len() > 2 && &id[1..3] == ":\\")
}

/// The shell item behind an app: its Apps-folder item, the one Windows' Start shows, which has
/// the shortcut's own icon (an app whose id is a program path included) and Start's commands; or
/// the shortcut file itself for a pinned shortcut Start doesn't list.
fn shell_target(id: &str) -> String {
    let lower = id.to_lowercase();
    if is_path(id) && (lower.ends_with(".lnk") || lower.ends_with(".url")) {
        id.to_string()
    } else {
        format!("shell:AppsFolder\\{id}")
    }
}

/// Windows' 32-bit icon pixels (BGRA, premultiplied for most icons) as straight RGBA. Old icons
/// with no alpha at all would come out invisible, so they're made opaque.
#[cfg_attr(not(windows), allow(dead_code))]
fn straight_rgba(mut px: Vec<u8>) -> Vec<u8> {
    let (pixels, _) = px.as_chunks::<4>();
    let no_alpha = pixels.iter().all(|p| p[3] == 0);
    // premultiplied pixels never have a colour above their alpha
    let premultiplied = pixels
        .iter()
        .all(|p| p[0] <= p[3] && p[1] <= p[3] && p[2] <= p[3]);
    for p in px.as_chunks_mut::<4>().0 {
        p.swap(0, 2);
        let a = p[3] as u32;
        if no_alpha {
            p[3] = 255;
        } else if premultiplied && a > 0 && a < 255 {
            for c in &mut p[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    px
}

/// The work deck and search: "settings", "files", "account", "lock", "sleep", "restart",
/// "shutdown", "signout", and "search" (hands `text` to Windows search).
pub fn action(app: &AppHandle, action: &str, text: Option<String>) -> Result<(), String> {
    #[cfg(desktop)]
    hide(app);
    #[cfg(mobile)]
    let _ = app;
    match action {
        "settings" => os::open("ms-settings:"),
        "account" => os::open("ms-settings:yourinfo"),
        "files" => os::open(""),
        "search" => os::search(text.unwrap_or_default()),
        "lock" | "sleep" | "restart" | "shutdown" | "signout" => os::power(action),
        other => Err(format!("unknown Start action {other:?}")),
    }
}

// ---- the Win key --------------------------------------------------------------------------

/// Install the Win-key hook (Windows) and set it from settings. Call once at setup.
#[cfg(desktop)]
pub fn setup(app: &AppHandle) {
    let on = lock(&app.state::<SharedState>())
        .data
        .settings
        .start_win_key;
    #[cfg(windows)]
    {
        let handle = app.clone();
        winkey::install(move || toggle(&handle));
        winkey::set_enabled(on);
        let handle = app.clone();
        startkey::install(move |target| match target {
            startkey::Target::Start => toggle(&handle),
            // the search box opens Start (or keeps it open) with its search prompt ready
            startkey::Target::Search => show(&handle),
        });
        startkey::set_enabled(on);
    }
    #[cfg(not(windows))]
    let _ = on;
    refresh(app, true);
}

/// Turn the Win-key takeover on or off and remember it. The tray's check mark follows, and every
/// window hears "start-win-key".
#[cfg(desktop)]
pub fn set_win_key(app: &AppHandle, on: bool) {
    {
        let state = app.state::<SharedState>();
        let mut g = lock(&state);
        g.data.settings.start_win_key = on;
        let _ = g.save();
    }
    #[cfg(windows)]
    {
        winkey::set_enabled(on);
        startkey::set_enabled(on);
    }
    crate::tray::check_win_key(on);
    let _ = app.emit("start-win-key", on);
}

#[cfg(windows)]
mod winkey {
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering::SeqCst};
    use std::sync::mpsc::{channel, Sender};
    use std::sync::OnceLock;

    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Shutdown::LockWorkStation;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
        KEYEVENTF_EXTENDEDKEY, VK_CONTROL, VK_L, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION,
        KBDLLHOOKSTRUCT, LLKHF_EXTENDED, LLKHF_INJECTED, MSG, WH_KEYBOARD_LL, WM_KEYUP,
        WM_SYSKEYUP,
    };

    static ENABLED: AtomicBool = AtomicBool::new(false);
    /// A Win key is physically down.
    static WIN_DOWN: AtomicBool = AtomicBool::new(false);
    /// Nothing else was pressed since it went down.
    static ALONE: AtomicBool = AtomicBool::new(false);
    /// The Win key (VK_LWIN/VK_RWIN) whose press is being held back from Windows; 0 = none.
    static HELD: AtomicU32 = AtomicU32::new(0);
    static PRESSED: OnceLock<Sender<()>> = OnceLock::new();

    /// What to do with one physical key event.
    #[derive(Debug, PartialEq, Eq)]
    enum Verdict {
        /// Windows gets it.
        Pass,
        /// Swallowed.
        Take,
        /// Swallowed, and Pocket Start toggles: a lone Win tap.
        Tap,
        /// Swallowed, and Win down plus this key are sent instead: the held Win press turned
        /// out to be a combo (Win+E …).
        Replay,
    }

    pub fn set_enabled(on: bool) {
        ENABLED.store(on, SeqCst);
    }

    /// Hook thread (with its own message loop, so the hook never waits on the UI) plus a worker
    /// that runs `on_press` for each lone Win press.
    pub fn install(on_press: impl Fn() + Send + 'static) {
        let (tx, rx) = channel::<()>();
        if PRESSED.set(tx).is_err() {
            return;
        }
        std::thread::spawn(move || {
            for () in rx {
                on_press();
            }
        });
        std::thread::spawn(|| unsafe {
            let hook = SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(hook_proc),
                GetModuleHandleW(std::ptr::null()),
                0,
            );
            if hook.is_null() {
                eprintln!("collegiapp: could not hook the Win key; use Ctrl+Alt+Space for Start");
                return;
            }
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {}
            UnhookWindowsHookEx(hook);
        });
    }

    unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && lparam != 0 {
            let k = &*(lparam as *const KBDLLHOOKSTRUCT);
            // re-sent keys, and other programs' input, pass through
            if k.flags & LLKHF_INJECTED == 0 {
                let up = matches!(wparam as u32, WM_KEYUP | WM_SYSKEYUP);
                let held = HELD.load(SeqCst);
                match on_key(k.vkCode, up) {
                    Verdict::Pass => {}
                    Verdict::Take => return 1,
                    Verdict::Tap => {
                        if let Some(tx) = PRESSED.get() {
                            let _ = tx.send(());
                        }
                        return 1;
                    }
                    Verdict::Replay => {
                        replay(held as u16, k);
                        return 1;
                    }
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    fn is_win(vk: u32) -> bool {
        vk == VK_LWIN as u32 || vk == VK_RWIN as u32
    }

    /// One physical key event.
    ///
    /// A Win press with no Ctrl, Shift or Alt held is held back from Windows. Released with
    /// nothing in between, it toggles Pocket Start, and since Windows never saw it, neither its
    /// Start nor its Search opens, however the taps come. When another key goes down first, the
    /// press is sent on just ahead of that key, so Win+E, Win+Shift+S, Win+1 … work as always.
    /// Ctrl/Shift/Alt+Win, and everything while the takeover is off, pass straight through.
    fn on_key(vk: u32, up: bool) -> Verdict {
        if !is_win(vk) {
            if WIN_DOWN.load(SeqCst) {
                ALONE.store(false, SeqCst);
                if !up && HELD.swap(0, SeqCst) != 0 {
                    return Verdict::Replay;
                }
            }
            return Verdict::Pass;
        }
        if !up {
            // auto-repeat keeps the first press's verdict
            if !WIN_DOWN.swap(true, SeqCst) {
                let hold = ENABLED.load(SeqCst) && !modifiers_down();
                ALONE.store(hold, SeqCst);
                HELD.store(if hold { vk } else { 0 }, SeqCst);
            }
            return if HELD.load(SeqCst) != 0 {
                Verdict::Take
            } else {
                Verdict::Pass
            };
        }
        WIN_DOWN.store(false, SeqCst);
        let alone = ALONE.swap(false, SeqCst);
        if HELD.swap(0, SeqCst) == 0 {
            return Verdict::Pass;
        }
        // a press Windows never saw: its release goes nowhere either
        if alone && ENABLED.load(SeqCst) {
            Verdict::Tap
        } else {
            Verdict::Take
        }
    }

    fn modifiers_down() -> bool {
        [VK_CONTROL, VK_SHIFT, VK_MENU]
            .iter()
            .any(|&vk| unsafe { GetAsyncKeyState(vk as i32) } as u16 & 0x8000 != 0)
    }

    fn key(vk: u16, scan: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: scan,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    /// The held Win press turned into a combo: send Win down, then this key. Windows ignores a
    /// sent Win+L, so that one locks directly.
    fn replay(win_vk: u16, k: &KBDLLHOOKSTRUCT) {
        if k.vkCode == VK_L as u32 {
            unsafe { LockWorkStation() };
            return;
        }
        let ext = if k.flags & LLKHF_EXTENDED != 0 {
            KEYEVENTF_EXTENDEDKEY
        } else {
            0
        };
        let inputs = [
            key(win_vk, 0, KEYEVENTF_EXTENDEDKEY),
            key(k.vkCode as u16, k.scanCode as u16, ext),
        ];
        unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            );
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        const WIN: u32 = VK_LWIN as u32;
        const E: u32 = 0x45;

        // one test: the hook's state is shared statics
        #[test]
        fn win_presses_are_held_back() {
            set_enabled(true);
            // a tap: Windows sees neither half, Pocket Start toggles
            assert_eq!(on_key(WIN, false), Verdict::Take);
            assert_eq!(on_key(WIN, false), Verdict::Take, "auto-repeat");
            assert_eq!(on_key(WIN, true), Verdict::Tap);
            assert_eq!(on_key(WIN, false), Verdict::Take, "a second tap the same");
            assert_eq!(on_key(WIN, true), Verdict::Tap);

            // Win+E: the held Win goes out just ahead of the E, the rest passes
            assert_eq!(on_key(WIN, false), Verdict::Take);
            assert_eq!(on_key(E, false), Verdict::Replay);
            assert_eq!(on_key(E, true), Verdict::Pass);
            assert_eq!(on_key(WIN, true), Verdict::Pass);

            // E held from before: its release doesn't make a combo, and the tap opens nothing
            assert_eq!(on_key(WIN, false), Verdict::Take);
            assert_eq!(on_key(E, true), Verdict::Pass);
            assert_eq!(on_key(WIN, true), Verdict::Take);

            // turned off between a held press and its release: the release goes nowhere too
            assert_eq!(on_key(WIN, false), Verdict::Take);
            set_enabled(false);
            assert_eq!(on_key(WIN, true), Verdict::Take);

            // off: nothing is taken, so Windows' Start opens
            assert_eq!(on_key(WIN, false), Verdict::Pass);
            assert_eq!(on_key(WIN, true), Verdict::Pass);
        }
    }
}

// ---- the taskbar's Start key and search box --------------------------------------------------

/// Left clicks on the taskbar's Start key or search box open Pocket Start instead of Windows'
/// Start or Search. A low-level mouse hook takes such a click (press and release); every other
/// click passes through untouched. What's under the pointer is asked of UI Automation at click
/// time (the taskbar's `StartButton` and `SearchButton`), so a centered taskbar that shifts as
/// apps open never leaves a stale position behind. UI Automation runs on its own thread and a
/// click waits at most `WAIT` for it; past that the click goes to Windows as usual, because
/// Windows drops a low-level hook that keeps input waiting too long.
#[cfg(windows)]
mod startkey {
    use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
    use std::sync::mpsc::{channel, sync_channel, Receiver, Sender, SyncSender};
    use std::sync::OnceLock;
    use std::time::Duration;

    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationCacheRequest, IUIAutomationCondition,
        IUIAutomationElement, TreeScope_Descendants, UIA_AutomationIdPropertyId,
        UIA_BoundingRectanglePropertyId,
    };
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, FindWindowExW, GetAncestor, GetClassNameW, GetMessageW, GetWindowRect,
        SetWindowsHookExW, UnhookWindowsHookEx, WindowFromPoint, GA_ROOT, HC_ACTION,
        LLMHF_INJECTED, MSG, MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP,
    };

    /// What a taskbar click landed on.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Target {
        Start,
        Search,
    }

    /// A click position for the UI Automation thread, with the channel for its answer.
    type Question = (POINT, SyncSender<Option<Target>>);

    static ENABLED: AtomicBool = AtomicBool::new(false);
    /// The last press went to Pocket Start, so its release is taken too.
    static TAKEN: AtomicBool = AtomicBool::new(false);
    static ASK: OnceLock<Sender<Question>> = OnceLock::new();
    static CLICKED: OnceLock<Sender<Target>> = OnceLock::new();
    /// The longest a taskbar click waits for UI Automation (a lookup takes a few ms).
    const WAIT: Duration = Duration::from_millis(120);
    /// The main taskbar and the ones on other monitors.
    const TASKBARS: [&str; 2] = ["Shell_TrayWnd", "Shell_SecondaryTrayWnd"];

    pub fn set_enabled(on: bool) {
        ENABLED.store(on, SeqCst);
    }

    /// Hook thread (its own message loop), UI Automation thread, and a worker that runs
    /// `on_click` for each click taken.
    pub fn install(on_click: impl Fn(Target) + Send + 'static) {
        let (tx, rx) = channel::<Target>();
        if CLICKED.set(tx).is_err() {
            return;
        }
        std::thread::spawn(move || {
            for t in rx {
                on_click(t);
            }
        });
        let (ask, questions) = channel::<Question>();
        let _ = ASK.set(ask);
        std::thread::spawn(move || answer(questions));
        std::thread::spawn(|| unsafe {
            let hook = SetWindowsHookExW(
                WH_MOUSE_LL,
                Some(hook_proc),
                GetModuleHandleW(std::ptr::null()),
                0,
            );
            if hook.is_null() {
                eprintln!(
                    "collegiapp: could not hook taskbar clicks; the Start key opens Windows' Start"
                );
                return;
            }
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {}
            UnhookWindowsHookEx(hook);
        });
    }

    unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && lparam != 0 {
            let m = &*(lparam as *const MSLLHOOKSTRUCT);
            let msg = wparam as u32;
            // the release of a press we took, even if the setting changed in between
            if msg == WM_LBUTTONUP && TAKEN.swap(false, SeqCst) {
                return 1;
            }
            // other programs' clicks pass through
            if msg == WM_LBUTTONDOWN && ENABLED.load(SeqCst) && m.flags & LLMHF_INJECTED == 0 {
                if let Some(t) = target_at(m.pt) {
                    TAKEN.store(true, SeqCst);
                    if let Some(tx) = CLICKED.get() {
                        let _ = tx.send(t);
                    }
                    return 1;
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    /// Start or Search when `pt` is on one of them. Clicks off the taskbars never wait.
    fn target_at(pt: POINT) -> Option<Target> {
        if !on_taskbar(pt) {
            return None;
        }
        let (tx, rx) = sync_channel(1);
        ASK.get()?.send((pt, tx)).ok()?;
        rx.recv_timeout(WAIT).ok().flatten()
    }

    /// `pt` is inside a taskbar window's rectangle. Nothing here sends a message, so a hung app
    /// can't stall the hook; whether the taskbar is really in front there is `Uia::find`'s job.
    fn on_taskbar(pt: POINT) -> bool {
        TASKBARS.iter().any(|class| {
            let class = wide(class);
            let mut w: HWND = std::ptr::null_mut();
            loop {
                w = unsafe {
                    FindWindowExW(std::ptr::null_mut(), w, class.as_ptr(), std::ptr::null())
                };
                if w.is_null() {
                    return false;
                }
                let mut r: RECT = unsafe { std::mem::zeroed() };
                if unsafe { GetWindowRect(w, &mut r) } != 0
                    && inside([r.left, r.top, r.right, r.bottom], pt)
                {
                    return true;
                }
            }
        })
    }

    fn is_taskbar(w: HWND) -> bool {
        let mut buf = [0u16; 32];
        let n = unsafe { GetClassNameW(w, buf.as_mut_ptr(), buf.len() as i32) };
        n > 0 && {
            let class = String::from_utf16_lossy(&buf[..n as usize]);
            TASKBARS.contains(&class.as_str())
        }
    }

    /// The taskbar's buttons, by UI Automation id.
    fn target_for(automation_id: &str) -> Option<Target> {
        match automation_id {
            "StartButton" => Some(Target::Start),
            "SearchButton" => Some(Target::Search),
            _ => None,
        }
    }

    /// `[left, top, right, bottom]` contains `pt` (right and bottom are outside, as in Windows).
    fn inside(r: [i32; 4], pt: POINT) -> bool {
        pt.x >= r[0] && pt.x < r[2] && pt.y >= r[1] && pt.y < r[3]
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    /// The UI Automation thread: answers each click with what it's on.
    fn answer(questions: Receiver<Question>) {
        let uia = unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            Uia::new().ok()
        };
        if let Some(u) = &uia {
            // the first lookup loads UI Automation's proxies; do it before the first click
            unsafe { u.warm() };
        }
        for (pt, reply) in questions {
            let t = uia.as_ref().and_then(|u| unsafe { u.find(pt) });
            // never blocks (room for one); the answer is dropped if the click stopped waiting
            let _ = reply.send(t);
        }
    }

    struct Uia {
        auto: IUIAutomation,
        all: IUIAutomationCondition,
        /// Fetches every element's id and rectangle in one round trip to Explorer.
        cache: IUIAutomationCacheRequest,
    }

    impl Uia {
        unsafe fn new() -> windows::core::Result<Uia> {
            let auto: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
            let cache = auto.CreateCacheRequest()?;
            cache.AddProperty(UIA_AutomationIdPropertyId)?;
            cache.AddProperty(UIA_BoundingRectanglePropertyId)?;
            Ok(Uia {
                all: auto.CreateTrueCondition()?,
                cache,
                auto,
            })
        }

        unsafe fn warm(&self) {
            let class = wide(TASKBARS[0]);
            let tray = FindWindowExW(
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                class.as_ptr(),
                std::ptr::null(),
            );
            if !tray.is_null() {
                let _ = self.buttons(tray);
            }
        }

        /// What's under `pt`, when the window in front there is a taskbar (a full-screen app
        /// can cover one).
        unsafe fn find(&self, pt: POINT) -> Option<Target> {
            let root = GetAncestor(WindowFromPoint(pt), GA_ROOT);
            if !is_taskbar(root) {
                return None;
            }
            self.buttons(root)?
                .into_iter()
                .find(|(_, r)| inside(*r, pt))
                .map(|(t, _)| t)
        }

        /// The Start key and search box of one taskbar, with their rectangles.
        unsafe fn buttons(&self, taskbar: HWND) -> Option<Vec<(Target, [i32; 4])>> {
            let el: IUIAutomationElement = self
                .auto
                .ElementFromHandle(windows::Win32::Foundation::HWND(taskbar))
                .ok()?;
            let found = el
                .FindAllBuildCache(TreeScope_Descendants, &self.all, &self.cache)
                .ok()?;
            let mut out = Vec::new();
            for i in 0..found.Length().ok()? {
                let Ok(e) = found.GetElement(i) else { continue };
                let (Ok(id), Ok(r)) = (e.CachedAutomationId(), e.CachedBoundingRectangle()) else {
                    continue;
                };
                if let Some(t) = target_for(&id.to_string()) {
                    out.push((t, [r.left, r.top, r.right, r.bottom]));
                }
            }
            Some(out)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn only_the_start_key_and_search_box_are_taken() {
            assert_eq!(target_for("StartButton"), Some(Target::Start));
            assert_eq!(target_for("SearchButton"), Some(Target::Search));
            assert_eq!(target_for("TaskViewButton"), None);
            assert_eq!(target_for(""), None);
            let r = [2, 1380, 117, 1440];
            assert!(inside(r, POINT { x: 2, y: 1380 }));
            assert!(inside(r, POINT { x: 116, y: 1439 }));
            assert!(
                !inside(r, POINT { x: 117, y: 1400 }),
                "right edge is outside"
            );
            assert!(
                !inside(r, POINT { x: 50, y: 1440 }),
                "bottom edge is outside"
            );
        }

        /// Finds this desktop's real Start key and search box through UI Automation, then asks
        /// what's at their centres, as a click would. Needs a signed-in desktop with a taskbar:
        /// `cargo test -p collegiapp -- --ignored taskbar_buttons`.
        #[test]
        #[ignore]
        fn taskbar_buttons_are_found_at_their_centres() {
            use windows::Win32::UI::HiDpi::{
                SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
            };
            unsafe {
                // the app is per-monitor aware (tao sets it); match it so positions agree
                let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let u = Uia::new().expect("UI Automation");
                let class = wide(TASKBARS[0]);
                let tray = FindWindowExW(
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    class.as_ptr(),
                    std::ptr::null(),
                );
                assert!(!tray.is_null(), "no taskbar");
                let buttons = u.buttons(tray).expect("taskbar buttons");
                assert!(
                    buttons.iter().any(|(t, _)| *t == Target::Start),
                    "{buttons:?}"
                );
                for (t, r) in buttons {
                    let centre = POINT {
                        x: (r[0] + r[2]) / 2,
                        y: (r[1] + r[3]) / 2,
                    };
                    assert!(on_taskbar(centre));
                    let t0 = std::time::Instant::now();
                    assert_eq!(u.find(centre), Some(t), "{t:?} at {r:?}");
                    eprintln!("{t:?} at {r:?}: found in {:?}", t0.elapsed());
                }
            }
        }
    }
}

// ---- OS calls -------------------------------------------------------------------------------

#[cfg(windows)]
mod os {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    use windows_sys::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HANDLE, LUID};
    use windows_sys::Win32::Security::{
        AdjustTokenPrivileges, LookupPrivilegeValueW, LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED,
        SE_SHUTDOWN_NAME, TOKEN_ADJUST_PRIVILEGES, TOKEN_PRIVILEGES, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Power::SetSuspendState;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD,
    };
    use windows_sys::Win32::System::Shutdown::{
        ExitWindowsEx, InitiateShutdownW, LockWorkStation, EWX_LOGOFF, SHTDN_REASON_FLAG_PLANNED,
        SHUTDOWN_HYBRID, SHUTDOWN_POWEROFF, SHUTDOWN_RESTART,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY,
        KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VK_LWIN,
    };

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    fn reg_dword(root: HKEY, key: &str, value: &str) -> Option<u32> {
        let (k, v) = (wide(key), wide(value));
        let mut data = 0u32;
        let mut size = 4u32;
        let r = unsafe {
            RegGetValueW(
                root,
                k.as_ptr(),
                v.as_ptr(),
                RRF_RT_REG_DWORD,
                std::ptr::null_mut(),
                &mut data as *mut u32 as *mut core::ffi::c_void,
                &mut size,
            )
        };
        (r == ERROR_SUCCESS).then_some(data)
    }

    /// Windows 11 centers the taskbar unless "Taskbar alignment" is Left (TaskbarAl = 0).
    pub fn taskbar_centered() -> bool {
        reg_dword(
            HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            "TaskbarAl",
        ) != Some(0)
    }

    /// "Choose your default Windows mode" (the taskbar's), not the apps' mode.
    pub fn night() -> Option<bool> {
        reg_dword(
            HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "SystemUsesLightTheme",
        )
        .map(|v| v == 0)
    }

    /// `Get-StartApps` and the pins from `Export-StartLayout`, as JSON (UTF-8 through a temp
    /// file, because a windowless PowerShell can't switch its output encoding).
    pub fn read_catalog() -> Result<String, String> {
        let out =
            std::env::temp_dir().join(format!("collegiapp-start-{}.json", std::process::id()));
        let path = out.to_string_lossy().replace('\'', "''");
        let script = format!(
            "$ErrorActionPreference = 'SilentlyContinue'; \
             $p = Join-Path $env:TEMP ('collegiapp-pins-' + $PID + '.json'); \
             Export-StartLayout -Path $p; $pins = @(); \
             if (Test-Path $p) {{ $pins = @((Get-Content $p -Raw | ConvertFrom-Json).pinnedList); Remove-Item $p }}; \
             $o = [pscustomobject]@{{ apps = @(Get-StartApps | Select-Object Name, AppID); pins = $pins }}; \
             [IO.File]::WriteAllText('{path}', ($o | ConvertTo-Json -Depth 4 -Compress), [Text.UTF8Encoding]::new($false))"
        );
        let status = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| format!("cannot run PowerShell: {e}"))?;
        let text = std::fs::read_to_string(&out);
        let _ = std::fs::remove_file(&out);
        match text {
            Ok(t) => Ok(t),
            Err(e) => Err(format!("PowerShell ({status}) wrote no app list: {e}")),
        }
    }

    /// Open through Explorer (empty = a File Explorer window), so the app starts as if from
    /// Windows' Start.
    /// The icon Explorer and Start draw for a shell item (`shell:AppsFolder\<AppID>` or a file
    /// path), `px` square, as a PNG.
    pub fn icon_png(target: &str, px: i32) -> Result<Vec<u8>, String> {
        use windows::core::HSTRING;
        use windows::Win32::Foundation::SIZE;
        use windows::Win32::Graphics::Gdi::{
            DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
            BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        };
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
        use windows::Win32::UI::Shell::{
            IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK,
            SIIGBF_ICONONLY,
        };

        let bgra = unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let item: IShellItemImageFactory =
                SHCreateItemFromParsingName(&HSTRING::from(target), None)
                    .map_err(|e| e.to_string())?;
            let bitmap = item
                .GetImage(
                    SIZE { cx: px, cy: px },
                    SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
                )
                .map_err(|e| e.to_string())?;
            let mut bm = BITMAP::default();
            let got = GetObjectW(
                bitmap.into(),
                std::mem::size_of::<BITMAP>() as i32,
                Some(&mut bm as *mut BITMAP as *mut core::ffi::c_void),
            );
            let (w, h) = (bm.bmWidth, bm.bmHeight.abs());
            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // top-down rows
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bgra = vec![0u8; (w.max(0) * h * 4) as usize];
            let dc = GetDC(None);
            let rows = GetDIBits(
                dc,
                bitmap,
                0,
                h as u32,
                Some(bgra.as_mut_ptr().cast()),
                &mut info,
                DIB_RGB_COLORS,
            );
            ReleaseDC(None, dc);
            let _ = DeleteObject(bitmap.into());
            if got == 0 || rows == 0 || w <= 0 {
                return Err(format!("no icon for {target}"));
            }
            (w as u32, h as u32, bgra)
        };
        let (w, h, bgra) = bgra;
        let mut out = Vec::new();
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer
            .write_image_data(&super::straight_rgba(bgra))
            .map_err(|e| e.to_string())?;
        writer.finish().map_err(|e| e.to_string())?;
        Ok(out)
    }

    pub fn open(target: &str) -> Result<(), String> {
        let mut cmd = Command::new("explorer.exe");
        if !target.is_empty() {
            cmd.arg(target);
        }
        cmd.spawn()
            .map(|_| ())
            .map_err(|e| format!("cannot open {target}: {e}"))
    }

    fn key(vk: u16, scan: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: scan,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn send(inputs: &[INPUT]) {
        unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            );
        }
    }

    /// Win+S, then type the text into Windows search.
    pub fn search(text: String) -> Result<(), String> {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(120));
            let s = 0x53;
            send(&[
                key(VK_LWIN, 0, KEYEVENTF_EXTENDEDKEY),
                key(s, 0, 0),
                key(s, 0, KEYEVENTF_KEYUP),
                key(VK_LWIN, 0, KEYEVENTF_KEYUP | KEYEVENTF_EXTENDEDKEY),
            ]);
            if text.is_empty() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(450));
            let chars: Vec<INPUT> = text
                .encode_utf16()
                .flat_map(|u| {
                    [
                        key(0, u, KEYEVENTF_UNICODE),
                        key(0, u, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
                    ]
                })
                .collect();
            send(&chars);
        });
        Ok(())
    }

    /// Sleep, restart and shut down need the shutdown privilege switched on in our token.
    fn shutdown_privilege() -> Result<(), String> {
        unsafe {
            let mut token: HANDLE = std::ptr::null_mut();
            if OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
                &mut token,
            ) == 0
            {
                return Err("cannot open the process token".into());
            }
            let mut luid = LUID {
                LowPart: 0,
                HighPart: 0,
            };
            let ok = LookupPrivilegeValueW(std::ptr::null(), SE_SHUTDOWN_NAME, &mut luid) != 0
                && AdjustTokenPrivileges(
                    token,
                    0,
                    &TOKEN_PRIVILEGES {
                        PrivilegeCount: 1,
                        Privileges: [LUID_AND_ATTRIBUTES {
                            Luid: luid,
                            Attributes: SE_PRIVILEGE_ENABLED,
                        }],
                    },
                    0,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                ) != 0;
            CloseHandle(token);
            if ok {
                Ok(())
            } else {
                Err("Windows refused the shutdown privilege".into())
            }
        }
    }

    pub fn power(action: &str) -> Result<(), String> {
        let reason = SHTDN_REASON_FLAG_PLANNED;
        match action {
            "lock" => (unsafe { LockWorkStation() } != 0)
                .then_some(())
                .ok_or_else(|| "Windows didn't lock".into()),
            "signout" => (unsafe { ExitWindowsEx(EWX_LOGOFF, reason) } != 0)
                .then_some(())
                .ok_or_else(|| "Windows didn't sign out".into()),
            "sleep" => {
                shutdown_privilege()?;
                // after Start has hidden; SetSuspendState returns on wake
                std::thread::spawn(|| {
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    unsafe { SetSuspendState(false, false, false) };
                });
                Ok(())
            }
            "restart" | "shutdown" => {
                shutdown_privilege()?;
                let mut flags = if action == "restart" {
                    SHUTDOWN_RESTART
                } else {
                    SHUTDOWN_POWEROFF
                };
                // shut down the way Start does when Fast startup is on
                let fast = reg_dword(
                    HKEY_LOCAL_MACHINE,
                    r"SYSTEM\CurrentControlSet\Control\Session Manager\Power",
                    "HiberbootEnabled",
                ) == Some(1);
                if action == "shutdown" && fast {
                    flags |= SHUTDOWN_HYBRID;
                }
                let r = unsafe {
                    InitiateShutdownW(std::ptr::null(), std::ptr::null(), 0, flags, reason)
                };
                if r == ERROR_SUCCESS {
                    Ok(())
                } else {
                    Err(format!("Windows didn't {action} (error {r})"))
                }
            }
            other => Err(format!("unknown power action {other:?}")),
        }
    }
}

#[cfg(not(windows))]
mod os {
    pub fn taskbar_centered() -> bool {
        false
    }
    pub fn night() -> Option<bool> {
        None
    }
    pub fn read_catalog() -> Result<String, String> {
        Err("only Windows has a Start app list".into())
    }
    pub fn open(_target: &str) -> Result<(), String> {
        Err("Start opens apps on Windows only for now.".into())
    }
    pub fn search(_text: String) -> Result<(), String> {
        Err("Windows search is Windows only.".into())
    }
    pub fn power(_action: &str) -> Result<(), String> {
        Err("Power keys work on Windows only for now.".into())
    }
    pub fn icon_png(_target: &str, _px: i32) -> Result<Vec<u8>, String> {
        Err("App icons come from Windows only for now.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{"apps":[{"Name":"Settings","AppID":"windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel"},
        {"Name":"File Explorer","AppID":"Microsoft.Windows.Explorer"},{"Name":"µTorrent","AppID":"C:\\Users\\me\\AppData\\Roaming\\utorrent\\uTorrent.exe"},
        {"Name":"Notion","AppID":"com.squirrel.Notion.Notion"},{"Name":"Assetto Corsa","AppID":"steam://rungameid/244210"},
        {"Name":"Notion","AppID":"com.squirrel.Notion.Notion"},{"Name":"","AppID":"x"}],
        "pins":[{"packagedAppId":"Windows.ImmersiveControlPanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel"},
        {"desktopAppLink":"%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\File Explorer.lnk"},
        {"desktopAppLink":"%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\util.lnk"},
        {"desktopAppLink":"%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Notion.lnk"},
        {"desktopAppId":"Microsoft.Windows.Explorer"},{"secondaryTile":{}}]}"#;

    fn fake_env(s: &str) -> String {
        s.replace("%APPDATA%", "C:\\Users\\me\\AppData\\Roaming")
    }

    #[test]
    fn reads_apps_and_resolves_windows_pins() {
        let (all, pins) = parse_catalog(SAMPLE, fake_env).unwrap();
        let names: Vec<&str> = all.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "Assetto Corsa",
                "File Explorer",
                "Notion",
                "Settings",
                "µTorrent"
            ],
            "sorted, one per id, blank names dropped"
        );
        let pinned: Vec<(&str, &str)> = pins
            .iter()
            .map(|a| (a.name.as_str(), a.id.as_str()))
            .collect();
        assert_eq!(
            pinned,
            [
                ("Settings", "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel"),
                ("File Explorer", "Microsoft.Windows.Explorer"),
                ("util", "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\util.lnk"),
                ("Notion", "com.squirrel.Notion.Notion"),
            ],
            "ids match case-insensitively, shortcuts by file name, an unmatched shortcut opens itself, no duplicates"
        );
    }

    #[test]
    fn empty_or_missing_lists_are_fine() {
        let (all, pins) = parse_catalog(r#"{"apps":[],"pins":null}"#, fake_env).unwrap();
        assert!(all.is_empty() && pins.is_empty());
        let (all, _) = parse_catalog(
            "\u{feff}{\"apps\":[{\"Name\":\"A\",\"AppID\":\"a\"}]}",
            fake_env,
        )
        .unwrap();
        assert_eq!(
            all.len(),
            1,
            "a byte-order mark and a missing pins key are accepted"
        );
        assert!(parse_catalog("nope", fake_env).is_err());
    }

    #[test]
    fn fallback_pins_pick_one_app_per_slot() {
        let app = |n: &str| StartApp {
            id: n.to_lowercase(),
            name: n.into(),
        };
        let all = vec![
            app("Settings"),
            app("Firefox"),
            app("Microsoft Edge"),
            app("Windows PowerShell"),
            app("File Explorer"),
            app("Visual Studio Code"),
        ];
        let names: Vec<String> = fallback_pins(&all).into_iter().map(|a| a.name).collect();
        assert_eq!(
            names,
            [
                "File Explorer",
                "Firefox",
                "Windows PowerShell",
                "Visual Studio Code",
                "Settings"
            ]
        );
    }

    #[test]
    fn launch_targets() {
        assert_eq!(
            launch_target("Microsoft.Windows.Explorer"),
            "shell:AppsFolder\\Microsoft.Windows.Explorer"
        );
        assert_eq!(
            launch_target("{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\cmd.exe"),
            "shell:AppsFolder\\{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\cmd.exe"
        );
        assert_eq!(
            launch_target("windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel"),
            "shell:AppsFolder\\windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel"
        );
        assert_eq!(
            launch_target("steam://rungameid/244210"),
            "steam://rungameid/244210"
        );
        assert_eq!(launch_target("ms-settings:display"), "ms-settings:display");
        assert_eq!(launch_target("C:\\Tools\\app.exe"), "C:\\Tools\\app.exe");
        assert_eq!(
            launch_target("\\\\server\\share\\a.lnk"),
            "\\\\server\\share\\a.lnk"
        );
    }

    #[test]
    fn expands_known_variables_only() {
        std::env::set_var("CAPP_TEST_DIR", "C:\\x");
        assert_eq!(expand_env("%CAPP_TEST_DIR%\\a.lnk"), "C:\\x\\a.lnk");
        assert_eq!(expand_env("%CAPP_NOPE_VAR%\\a"), "%CAPP_NOPE_VAR%\\a");
        assert_eq!(expand_env("100% done"), "100% done");
    }

    #[test]
    fn anchors_above_the_taskbar() {
        // 2560×1440 at 125%: work area above a 60 px taskbar, a 945×928 window
        let area = (0, 0, 2560, 1380);
        assert_eq!(anchor(area, 945, 928, false), (0, 452));
        assert_eq!(anchor(area, 945, 928, true), (807, 452));
        // a second monitor to the left, and a window taller than the work area
        assert_eq!(anchor((-1920, 0, 1920, 1040), 945, 1200, false), (-1920, 0));
    }

    #[test]
    fn apps_are_their_apps_folder_items() {
        let af = |id: &str| format!(r"shell:AppsFolder\{id}");
        for id in [
            "Microsoft.Windows.Explorer",
            "steam://rungameid/244210",
            // an app whose id is its program: the folder item has its shortcut's own icon
            r"C:\Games\Koikatsu Sunshine\InitSetting.exe",
        ] {
            assert_eq!(shell_target(id), af(id));
        }
        // a pinned shortcut Start doesn't list is the file itself
        let lnk = r"C:\Users\me\Start Menu\Programs\util.LNK";
        assert_eq!(shell_target(lnk), lnk);
    }

    #[test]
    fn icon_pixels_become_straight_rgba() {
        // premultiplied BGRA: half-transparent blue (0,0,255 at alpha 128) is stored as 128,0,0
        let px = straight_rgba(vec![128, 0, 0, 128, 0, 0, 0, 0, 10, 20, 30, 255]);
        assert_eq!(px, vec![0, 0, 255, 128, 0, 0, 0, 0, 30, 20, 10, 255]);
        // no alpha anywhere (an old icon): opaque
        assert_eq!(straight_rgba(vec![1, 2, 3, 0]), vec![3, 2, 1, 255]);
        // a colour above its alpha: already straight, kept
        assert_eq!(straight_rgba(vec![200, 0, 0, 100]), vec![0, 0, 200, 100]);
    }

    /// Reads File Explorer's real icon from Windows. `cargo test -p collegiapp -- --ignored icon`
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn reads_a_real_app_icon() {
        let t0 = std::time::Instant::now();
        let png = os::icon_png(&shell_target("Microsoft.Windows.Explorer"), ICON_PX).unwrap();
        assert_eq!(&png[1..4], b"PNG");
        let size = u32::from_be_bytes(png[16..20].try_into().unwrap());
        eprintln!("{size} px, {} bytes in {:?}", png.len(), t0.elapsed());
        assert!(size >= 32);
    }
}
