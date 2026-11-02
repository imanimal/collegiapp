//! Pocket Start's right-click menu for an app: what it can offer (`info`) and doing it (`run`).
//!
//! Windows' own commands come from the app's Apps-folder item, the context menu Windows' Start
//! uses, and run by canonical verb so they behave exactly as there: Open new window, Run as
//! administrator, Open file location, Unpin from taskbar and Uninstall. The rest are Pocket
//! Start's: the program's folder, a terminal there, the program's properties, ending or
//! restarting it, blocking it in focus sessions, starting it at sign-in (a shortcut in the Startup
//! folder), a desktop shortcut, App settings for Store apps, and hiding it from All apps
//! (`settings.start_hidden`). Copying the path and moving pins happen in start.js.

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::{apps, is_path, shell_target, StartApp, StartApps};
use crate::focus::{effective_blocklist, is_protected, normalize_exe};
use crate::store::{lock, SharedState};

/// Windows' commands the menu offers, by canonical verb (lowercase).
pub const VERBS: &[&str] = &[
    "opennewwindow",
    "runas",
    "openfilelocation",
    "taskbarunpin",
    "uninstall",
];

/// What the menu can offer for one app (`start_app_info`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct AppInfo {
    /// Windows' commands it has, from [`VERBS`].
    pub verbs: Vec<String>,
    /// The program it runs, when that's a file.
    pub program: Option<String>,
    /// A Store app's package family name: it has an App settings page.
    pub package: Option<String>,
    /// The program is running (never for Collegiapp itself).
    pub running: bool,
    /// On the focus blocklist; None when it can't be (no program, or a protected one).
    pub blocked: Option<bool>,
    /// Starts at sign-in: "off", "ours" (a shortcut in the Startup folder) or "windows" (a Run
    /// entry, which Startup apps settings manages); None where there's no such thing.
    pub signin: Option<&'static str>,
}

/// The reply to `start_app_do`: a line for the hint, and the app lists when they changed.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Done {
    pub note: String,
    pub apps: Option<StartApps>,
}

fn find(app: &AppHandle, id: &str) -> Result<StartApp, String> {
    let a = apps(app);
    a.pinned
        .into_iter()
        .chain(a.all)
        .chain(a.settings)
        .find(|x| x.id == id)
        .ok_or_else(|| "That app isn't in Start.".to_string())
}

fn is_settings_page(id: &str) -> bool {
    id.starts_with("ms-settings:")
}

pub fn info(app: &AppHandle, id: &str) -> Result<AppInfo, String> {
    let a = find(app, id)?;
    if is_settings_page(id) {
        return Ok(AppInfo::default());
    }
    let (mut verbs, program) = os::describe(&shell_target(id));
    // a pinned shortcut Start doesn't list is a file of its own: shown in its folder
    if is_path(id) && !verbs.iter().any(|v| v == "openfilelocation") {
        verbs.push("openfilelocation".into());
    }
    let program = program.or_else(|| is_program(id).then(|| id.to_string()));
    Ok(AppInfo {
        verbs,
        running: program.as_deref().is_some_and(|p| scan(p, false) > 0),
        package: package_family(id),
        blocked: program.as_deref().and_then(|p| blocked(app, p)),
        signin: cfg!(windows).then(|| os::signin(&link_name(&a.name), program.as_deref())),
        program,
    })
}

pub fn run(app: &AppHandle, id: &str, what: &str) -> Result<Done, String> {
    let a = find(app, id)?;
    let say = |note: String| Ok(Done { note, apps: None });
    let target = shell_target(id);
    let program = || {
        os::describe(&target)
            .1
            .or_else(|| is_program(id).then(|| id.to_string()))
            .ok_or_else(|| format!("{} has no program file Pocket Start can see.", a.name))
    };
    match what {
        "hide" | "unhide" => {
            let hide = what == "hide";
            set_hidden(app, id, hide)?;
            Ok(Done {
                note: if hide {
                    format!("{} is hidden from All apps", a.name)
                } else {
                    format!("{} is back in All apps", a.name)
                },
                apps: Some(apps(app)),
            })
        }
        "openfilelocation" if is_path(id) => {
            hide_start(app);
            os::show_in_folder(id).and(say(String::new()))
        }
        v if VERBS.contains(&v) => {
            if v != "taskbarunpin" {
                hide_start(app);
            }
            os::invoke(&target, v)?;
            say(if v == "taskbarunpin" {
                format!("Unpinned {} from the taskbar", a.name)
            } else {
                String::new()
            })
        }
        "folder" => {
            let p = program()?;
            hide_start(app);
            os::show_in_folder(&p).and(say(String::new()))
        }
        "terminal" => {
            let p = program()?;
            let dir = p.rsplit_once('\\').map_or(p.as_str(), |(d, _)| d);
            let dir = if dir.ends_with(':') {
                format!("{dir}\\")
            } else {
                dir.to_string()
            };
            hide_start(app);
            os::terminal(&dir).and(say(String::new()))
        }
        "properties" => {
            let p = program().or_else(|e| {
                if is_path(id) {
                    Ok(id.to_string())
                } else {
                    Err(e)
                }
            })?;
            hide_start(app);
            os::properties(&p).and(say(String::new()))
        }
        "appsettings" => {
            let family = package_family(id)
                .ok_or_else(|| format!("{} has no App settings page.", a.name))?;
            hide_start(app);
            super::os::open(&format!("ms-settings:appsfeatures-app?{family}"))
                .and(say(String::new()))
        }
        "endtask" => {
            let ended = scan(&program()?, true);
            say(if ended > 0 {
                format!("Ended {}", a.name)
            } else {
                format!("{} isn't running", a.name)
            })
        }
        "restart" => {
            let p = program()?;
            scan(&p, true);
            // wait for it to go, so a single-instance app doesn't hand the launch to the old one
            for _ in 0..30 {
                if scan(&p, false) == 0 {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            super::launch(app, id).and(say(String::new()))
        }
        "block" => {
            let p = program()?;
            let exe = exe_name(&p)
                .filter(|e| !is_protected(e))
                .ok_or_else(|| format!("Focus sessions never close {}.", a.name))?;
            let now = {
                let state = app.state::<SharedState>();
                let mut g = lock(&state);
                let (list, now) = toggle_blocked(&g.data.settings.focus_blocklist, &exe);
                g.data.settings.focus_blocklist = list;
                g.save()?;
                now
            };
            say(if now {
                format!("Focus sessions close {} from the next one on", a.name)
            } else {
                format!("Focus sessions leave {} open from the next one on", a.name)
            })
        }
        "signin" => {
            let file = link_name(&a.name);
            let p = os::describe(&target).1;
            match os::signin(&file, p.as_deref()) {
                "ours" => {
                    let path = os::startup_dir()?.join(&file);
                    std::fs::remove_file(&path)
                        .map_err(|e| format!("Couldn't remove {}: {e}", path.display()))?;
                    say(format!("{} won't start at sign-in", a.name))
                }
                "windows" => {
                    hide_start(app);
                    super::os::open("ms-settings:startupapps").and(say(String::new()))
                }
                _ => {
                    os::shortcut(link_file(id), &target, &os::startup_dir()?.join(&file))?;
                    say(format!("{} will start when you sign in", a.name))
                }
            }
        }
        "desktop" => {
            let path = os::desktop_dir()?.join(link_name(&a.name));
            if path.exists() {
                return say(format!("{} is already on the desktop", a.name));
            }
            os::shortcut(link_file(id), &target, &path)?;
            say(format!("Added {} to the desktop", a.name))
        }
        other => Err(format!("unknown app command {other:?}")),
    }
}

fn hide_start(app: &AppHandle) {
    #[cfg(desktop)]
    super::hide(app);
    #[cfg(mobile)]
    let _ = app;
}

/// An id that is itself a program file (`C:\Tools\app.exe`).
fn is_program(id: &str) -> bool {
    is_path(id) && id.to_lowercase().ends_with(".exe")
}

/// A pinned shortcut file (`…\util.lnk`), copied as it is for a new shortcut.
fn link_file(id: &str) -> Option<&str> {
    (is_path(id) && id.to_lowercase().ends_with(".lnk")).then_some(id)
}

/// `C:\a\Steam.exe` → `Steam.exe`, for programs only.
fn exe_name(program: &str) -> Option<String> {
    let name = program.rsplit(['\\', '/']).next()?;
    name.to_lowercase()
        .ends_with(".exe")
        .then(|| name.to_string())
}

fn blocked(app: &AppHandle, program: &str) -> Option<bool> {
    let exe = exe_name(program).filter(|e| !is_protected(e))?;
    let saved = lock(&app.state::<SharedState>())
        .data
        .settings
        .focus_blocklist
        .clone();
    Some(
        effective_blocklist(saved)
            .iter()
            .any(|b| normalize_exe(b) == normalize_exe(&exe)),
    )
}

/// Add `exe` to the focus blocklist or take it off. The saved list is empty while it's the
/// built-in one, so that one is written out first. Returns the list and whether it's now blocked.
fn toggle_blocked(saved: &[String], exe: &str) -> (Vec<String>, bool) {
    let mut list = effective_blocklist(saved.to_vec());
    let n = normalize_exe(exe);
    let before = list.len();
    list.retain(|b| normalize_exe(b) != n);
    if list.len() < before {
        (list, false)
    } else {
        list.push(format!("{n}.exe"));
        (list, true)
    }
}

fn set_hidden(app: &AppHandle, id: &str, hide: bool) -> Result<(), String> {
    let state = app.state::<SharedState>();
    let mut g = lock(&state);
    let list = &mut g.data.settings.start_hidden;
    list.retain(|x| x != id);
    if hide {
        list.push(id.to_string());
    }
    g.save()
}

/// A Store app's package family name: the part of its AppUserModelID before the `!`.
fn package_family(id: &str) -> Option<String> {
    if is_path(id) || id.contains(':') {
        return None;
    }
    let (family, app) = id.split_once('!')?;
    (family.contains('_') && !app.is_empty()).then(|| family.to_string())
}

/// The shortcut file Pocket Start makes for an app: its name with the characters Windows doesn't
/// allow in file names swapped out.
fn link_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let clean = clean.trim().trim_end_matches('.');
    format!("{}.lnk", if clean.is_empty() { "App" } else { clean })
}

/// Lowercased `program` split into its folder (with the trailing separator) and file name.
fn split_program(program: &str) -> Option<(String, String)> {
    let p = program.to_lowercase();
    let (dir, file) = p.rsplit_once('\\')?;
    Some((format!("{dir}\\"), file.to_string()))
}

/// A running executable is `program`: the same file, or one of that name in a folder under the
/// program's (Squirrel apps like Discord start `…\Discord\Discord.exe`, which runs
/// `…\Discord\app-1.0.9\Discord.exe`).
fn same_program(exe: &str, program: &str) -> bool {
    if exe.eq_ignore_ascii_case(program) {
        return true;
    }
    let (Some((dir, file)), Some((exe_dir, exe_file))) =
        (split_program(program), split_program(exe))
    else {
        return false;
    };
    file == exe_file && exe_dir.starts_with(&dir)
}

/// A sign-in command (a Run entry, variables expanded) starts `program`: it names the program
/// file, or a launcher in the program's folder plus the program's file name (Discord's is
/// `…\Discord\Update.exe --processStart Discord.exe`).
#[cfg_attr(not(windows), allow(dead_code))]
fn starts_program(command: &str, program: &str) -> bool {
    let cmd = command.to_lowercase();
    let Some((dir, file)) = split_program(program) else {
        return false;
    };
    cmd.contains(&program.to_lowercase())
        || (cmd.contains(&dir)
            && cmd
                .split(|c: char| c.is_whitespace() || c == '"' || c == '\\')
                .any(|w| w == file))
}

/// How many processes run `program` (never Collegiapp itself); with `kill`, end them.
#[cfg(desktop)]
fn scan(program: &str, kill: bool) -> usize {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let Ok(mut sys) = System::new() else {
        return 0;
    };
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    let own = sysinfo::get_current_pid().ok();
    sys.processes()
        .iter()
        .filter(|(pid, p)| {
            Some(**pid) != own
                && p.exe()
                    .is_some_and(|e| same_program(&e.to_string_lossy(), program))
        })
        .filter(|(_, p)| !kill || p.kill())
        .count()
}

#[cfg(mobile)]
fn scan(_program: &str, _kill: bool) -> usize {
    0
}

// ---- OS calls -------------------------------------------------------------------------------

#[cfg(windows)]
mod os {
    use std::path::{Path, PathBuf};
    use std::sync::mpsc::channel;
    use std::time::{Duration, Instant};

    use windows::core::{Interface, GUID, HSTRING, PCSTR, PCWSTR, PSTR};
    use windows::Win32::Storage::EnhancedStorage::PKEY_Link_TargetParsingPath;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile,
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::UI::Shell::{
        BHID_SFUIObject, FOLDERID_Desktop, FOLDERID_Startup, IContextMenu, ILCreateFromPathW,
        ILFree, IShellItem, IShellItem2, IShellLinkW, SHCreateItemFromParsingName,
        SHGetIDListFromObject, SHGetKnownFolderPath, SHObjectProperties,
        SHOpenFolderAndSelectItems, ShellExecuteExW, ShellLink, CMF_NORMAL, CMINVOKECOMMANDINFO,
        CMINVOKECOMMANDINFOEX, GCS_VERBW, KF_FLAG_DEFAULT, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC,
        SHELLEXECUTEINFOW, SHOP_FILEPATH,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreatePopupMenu, DestroyMenu, GetMenuItemCount, GetMenuItemID, HMENU, SW_SHOWNORMAL,
    };
    use windows_sys::core::BOOL;
    use windows_sys::Win32::Foundation::{ERROR_NO_MORE_ITEMS, ERROR_SUCCESS, HWND, LPARAM};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumValueW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER,
        HKEY_LOCAL_MACHINE, KEY_READ, REG_EXPAND_SZ, REG_SZ, RRF_RT_REG_BINARY,
    };
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, EnumThreadWindows, IsWindowVisible, MsgWaitForMultipleObjects,
        PeekMessageW, TranslateMessage, MSG, PM_REMOVE, QS_ALLINPUT,
    };

    /// Command ids handed to a context menu.
    const FIRST: u32 = 1;
    const LAST: u32 = 0x7fff;
    /// CMINVOKECOMMANDINFOEX carries wide strings (shobjidl.h; the windows crate leaves it out).
    const CMIC_MASK_UNICODE: u32 = 0x4000;
    /// HRESULT_FROM_WIN32(ERROR_CANCELLED): the UAC prompt was declined.
    const CANCELLED: i32 = 0x8007_04C7_u32 as i32;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    /// Run `f` on a new single-threaded COM thread (the shell's objects want one). With `pump`,
    /// that thread then dispatches its messages for a moment and for as long as it has a window
    /// up, which a Properties sheet or a dialog a command opened may need.
    fn sta<T: Send + 'static>(
        pump: bool,
        f: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, String> {
        let (tx, rx) = channel();
        std::thread::spawn(move || unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
            let _ = tx.send(f());
            if pump {
                pump_messages();
            }
            CoUninitialize();
        });
        rx.recv().map_err(|_| "the shell call failed".to_string())
    }

    unsafe fn pump_messages() {
        let start = Instant::now();
        loop {
            let mut msg: MSG = std::mem::zeroed();
            while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if start.elapsed() > Duration::from_secs(2) && !has_window() {
                return;
            }
            MsgWaitForMultipleObjects(0, std::ptr::null(), 0, 250, QS_ALLINPUT);
        }
    }

    unsafe fn has_window() -> bool {
        unsafe extern "system" fn visible(w: HWND, found: LPARAM) -> BOOL {
            if IsWindowVisible(w) != 0 {
                *(found as *mut bool) = true;
                0
            } else {
                1
            }
        }
        let mut found = false;
        EnumThreadWindows(
            GetCurrentThreadId(),
            Some(visible),
            &mut found as *mut bool as LPARAM,
        );
        found
    }

    /// A context menu's commands: (offset, canonical verb in lowercase).
    unsafe fn verbs(cm: &IContextMenu, menu: HMENU) -> Vec<(u32, String)> {
        let _ = cm.QueryContextMenu(menu, 0, FIRST, LAST, CMF_NORMAL);
        let mut out = Vec::new();
        for i in 0..GetMenuItemCount(Some(menu)).max(0) {
            let id = GetMenuItemID(menu, i);
            if !(FIRST..=LAST).contains(&id) {
                continue;
            }
            let mut buf = [0u16; 64];
            let got = cm.GetCommandString(
                (id - FIRST) as usize,
                GCS_VERBW,
                None,
                PSTR(buf.as_mut_ptr().cast()),
                buf.len() as u32,
            );
            if got.is_ok() {
                let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                out.push((
                    id - FIRST,
                    String::from_utf16_lossy(&buf[..n]).to_lowercase(),
                ));
            }
        }
        out
    }

    fn is_file(p: &str) -> bool {
        super::is_path(p) && Path::new(p).is_file()
    }

    /// The menu's Windows commands for a shell item, and the program it runs.
    pub fn describe(target: &str) -> (Vec<String>, Option<String>) {
        let target = HSTRING::from(target);
        sta(false, move || unsafe {
            let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem2>(&target, None) else {
                return (Vec::new(), None);
            };
            let program = item
                .GetString(&PKEY_Link_TargetParsingPath)
                .ok()
                .map(|p| {
                    let s = p.to_string().unwrap_or_default();
                    CoTaskMemFree(Some(p.0 as _));
                    s
                })
                .filter(|p| is_file(p));
            let mut found = Vec::new();
            if let (Ok(cm), Ok(menu)) = (
                item.BindToHandler::<_, IContextMenu>(None, &BHID_SFUIObject),
                CreatePopupMenu(),
            ) {
                for (_, v) in verbs(&cm, menu) {
                    if super::VERBS.contains(&v.as_str()) && !found.contains(&v) {
                        found.push(v);
                    }
                }
                let _ = DestroyMenu(menu);
            }
            (found, program)
        })
        .unwrap_or_default()
    }

    /// Run one of the item's context-menu commands by canonical verb, as Windows' Start does.
    pub fn invoke(target: &str, verb: &str) -> Result<(), String> {
        let (target, verb) = (HSTRING::from(target), verb.to_string());
        sta(true, move || unsafe {
            let item: IShellItem =
                SHCreateItemFromParsingName(&target, None).map_err(|e| e.message())?;
            let cm: IContextMenu = item
                .BindToHandler(None, &BHID_SFUIObject)
                .map_err(|e| e.message())?;
            let menu = CreatePopupMenu().map_err(|e| e.message())?;
            let found = verbs(&cm, menu).into_iter().find(|(_, v)| *v == verb);
            let r = match found {
                None => Err("Windows doesn't offer that for this app.".to_string()),
                Some((offset, _)) => {
                    let info = CMINVOKECOMMANDINFOEX {
                        cbSize: std::mem::size_of::<CMINVOKECOMMANDINFOEX>() as u32,
                        fMask: CMIC_MASK_UNICODE,
                        // a command offset in place of a verb string (MAKEINTRESOURCE)
                        lpVerb: PCSTR(offset as usize as *const u8),
                        lpVerbW: PCWSTR(offset as usize as *const u16),
                        nShow: SW_SHOWNORMAL.0,
                        ..Default::default()
                    };
                    match cm.InvokeCommand(&info as *const _ as *const CMINVOKECOMMANDINFO) {
                        Err(e) if e.code().0 != CANCELLED => Err(e.message()),
                        _ => Ok(()),
                    }
                }
            };
            let _ = DestroyMenu(menu);
            r
        })?
    }

    /// A File Explorer window on the file's folder with the file selected.
    pub fn show_in_folder(path: &str) -> Result<(), String> {
        let path = HSTRING::from(path);
        sta(true, move || unsafe {
            let pidl = ILCreateFromPathW(&path);
            if pidl.is_null() {
                return Err(format!("{path} isn't there any more."));
            }
            let r = SHOpenFolderAndSelectItems(pidl, None, 0);
            ILFree(Some(pidl));
            r.map_err(|e| e.message())
        })?
    }

    /// The file's Properties sheet.
    pub fn properties(path: &str) -> Result<(), String> {
        let path = HSTRING::from(path);
        sta(true, move || unsafe {
            SHObjectProperties(None, SHOP_FILEPATH, &path, PCWSTR::null())
                .ok()
                .map_err(|e| e.message())
        })?
    }

    unsafe fn shell_exec(file: &str, params: &str, dir: Option<&str>) -> windows::core::Result<()> {
        let (file, params) = (HSTRING::from(file), HSTRING::from(params));
        let dir = dir.map(HSTRING::from);
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
            lpFile: PCWSTR(file.as_ptr()),
            lpParameters: PCWSTR(params.as_ptr()),
            lpDirectory: dir.as_ref().map_or(PCWSTR::null(), |d| PCWSTR(d.as_ptr())),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        ShellExecuteExW(&mut info)
    }

    /// Windows Terminal in `dir`, or PowerShell where there's no Terminal.
    pub fn terminal(dir: &str) -> Result<(), String> {
        let dir = dir.to_string();
        sta(false, move || unsafe {
            // a trailing backslash would escape the closing quote
            let arg = if dir.ends_with('\\') {
                format!("{dir}.")
            } else {
                dir.clone()
            };
            shell_exec("wt.exe", &format!("-d \"{arg}\""), None)
                .or_else(|_| shell_exec("powershell.exe", "-NoExit", Some(&dir)))
                .map_err(|e| e.message())
        })?
    }

    fn known_folder(id: &GUID) -> Result<PathBuf, String> {
        unsafe {
            let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).map_err(|e| e.message())?;
            let s = p.to_string().unwrap_or_default();
            CoTaskMemFree(Some(p.0 as _));
            Ok(PathBuf::from(s))
        }
    }

    pub fn startup_dir() -> Result<PathBuf, String> {
        known_folder(&FOLDERID_Startup)
    }

    pub fn desktop_dir() -> Result<PathBuf, String> {
        known_folder(&FOLDERID_Desktop)
    }

    /// A shortcut at `path`: a copy of `link` (a pinned shortcut file), or one that opens the
    /// shell item `target` the way Start does.
    pub fn shortcut(link: Option<&str>, target: &str, path: &Path) -> Result<(), String> {
        if let Some(link) = link {
            return std::fs::copy(link, path)
                .map(|_| ())
                .map_err(|e| format!("Couldn't make {}: {e}", path.display()));
        }
        let (target, file) = (HSTRING::from(target), HSTRING::from(path.as_os_str()));
        sta(false, move || unsafe {
            let make = || -> windows::core::Result<()> {
                let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                let item: IShellItem = SHCreateItemFromParsingName(&target, None)?;
                let pidl = SHGetIDListFromObject(&item)?;
                let set = link.SetIDList(pidl);
                CoTaskMemFree(Some(pidl as _));
                set?;
                link.cast::<IPersistFile>()?.Save(&file, true)
            };
            make().map_err(|e| e.message())
        })?
    }

    /// "ours" when the Startup folder has Pocket Start's shortcut `file`, "windows" when a Run
    /// entry starts `program` (and Startup apps hasn't turned it off), else "off".
    pub fn signin(file: &str, program: Option<&str>) -> &'static str {
        if startup_dir().is_ok_and(|d| d.join(file).exists()) {
            "ours"
        } else if program.is_some_and(run_entry) {
            "windows"
        } else {
            "off"
        }
    }

    fn run_entry(program: &str) -> bool {
        const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
        const RUN32: &str = r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run";
        const APPROVED: &str =
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\";
        [
            (HKEY_CURRENT_USER, RUN, "Run"),
            (HKEY_LOCAL_MACHINE, RUN, "Run"),
            (HKEY_LOCAL_MACHINE, RUN32, "Run32"),
        ]
        .into_iter()
        .any(|(root, key, approved)| {
            string_values(root, key).into_iter().any(|(name, cmd)| {
                super::starts_program(&super::super::expand_env(&cmd), program)
                    && approved_on(root, &format!("{APPROVED}{approved}"), &name)
            })
        })
    }

    /// A key's string values, by name.
    fn string_values(root: HKEY, key: &str) -> Vec<(String, String)> {
        let mut out = Vec::new();
        unsafe {
            let mut h: HKEY = std::ptr::null_mut();
            if RegOpenKeyExW(root, wide(key).as_ptr(), 0, KEY_READ, &mut h) != ERROR_SUCCESS {
                return out;
            }
            for i in 0..512 {
                let mut name = [0u16; 260];
                let mut name_len = name.len() as u32;
                let mut data = vec![0u8; 8192];
                let mut data_len = data.len() as u32;
                let mut kind = 0u32;
                let r = RegEnumValueW(
                    h,
                    i,
                    name.as_mut_ptr(),
                    &mut name_len,
                    std::ptr::null(),
                    &mut kind,
                    data.as_mut_ptr(),
                    &mut data_len,
                );
                if r == ERROR_NO_MORE_ITEMS {
                    break;
                }
                if r != ERROR_SUCCESS || !(kind == REG_SZ || kind == REG_EXPAND_SZ) {
                    continue;
                }
                let units: Vec<u16> = data[..data_len as usize]
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|b| u16::from_le_bytes(*b))
                    .take_while(|&u| u != 0)
                    .collect();
                out.push((
                    String::from_utf16_lossy(&name[..name_len as usize]),
                    String::from_utf16_lossy(&units),
                ));
            }
            RegCloseKey(h);
        }
        out
    }

    /// Startup apps keeps each Run entry's switch under StartupApproved: an odd first byte is off.
    fn approved_on(root: HKEY, key: &str, name: &str) -> bool {
        let mut data = [0u8; 16];
        let mut len = data.len() as u32;
        let r = unsafe {
            RegGetValueW(
                root,
                wide(key).as_ptr(),
                wide(name).as_ptr(),
                RRF_RT_REG_BINARY,
                std::ptr::null_mut(),
                data.as_mut_ptr().cast(),
                &mut len,
            )
        };
        r != ERROR_SUCCESS || len == 0 || data[0] & 1 == 0
    }
}

#[cfg(not(windows))]
mod os {
    use std::path::{Path, PathBuf};

    const ONLY: &str = "This works on Windows only for now.";

    pub fn describe(_target: &str) -> (Vec<String>, Option<String>) {
        (Vec::new(), None)
    }
    pub fn invoke(_target: &str, _verb: &str) -> Result<(), String> {
        Err(ONLY.into())
    }
    pub fn show_in_folder(_path: &str) -> Result<(), String> {
        Err(ONLY.into())
    }
    pub fn properties(_path: &str) -> Result<(), String> {
        Err(ONLY.into())
    }
    pub fn terminal(_dir: &str) -> Result<(), String> {
        Err(ONLY.into())
    }
    pub fn startup_dir() -> Result<PathBuf, String> {
        Err(ONLY.into())
    }
    pub fn desktop_dir() -> Result<PathBuf, String> {
        Err(ONLY.into())
    }
    pub fn shortcut(_link: Option<&str>, _target: &str, _path: &Path) -> Result<(), String> {
        Err(ONLY.into())
    }
    pub fn signin(_file: &str, _program: Option<&str>) -> &'static str {
        "off"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_apps_have_a_package_family() {
        assert_eq!(
            package_family("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App").as_deref(),
            Some("Microsoft.WindowsCalculator_8wekyb3d8bbwe")
        );
        assert_eq!(package_family("com.squirrel.Discord.Discord"), None);
        assert_eq!(package_family(r"C:\Games\a!b_c.exe"), None);
        assert_eq!(package_family("steam://rungameid/1!x_y"), None);
    }

    #[test]
    fn shortcut_names_are_safe_file_names() {
        assert_eq!(link_name("util"), "util.lnk");
        assert_eq!(link_name("Foo: Bar/Baz?"), "Foo- Bar-Baz-.lnk");
        assert_eq!(link_name("Odd. "), "Odd.lnk");
        assert_eq!(link_name("  "), "App.lnk");
    }

    #[test]
    fn programs_and_shortcut_files() {
        assert!(is_program(r"C:\Games\Koikatsu Sunshine\InitSetting.exe"));
        assert!(!is_program("com.electron.notion"));
        assert_eq!(link_file(r"C:\x\util.lnk"), Some(r"C:\x\util.lnk"));
        assert_eq!(link_file(r"C:\x\util.exe"), None);
        assert_eq!(
            exe_name(r"C:\Program Files\Steam\Steam.exe").as_deref(),
            Some("Steam.exe")
        );
        assert_eq!(exe_name(r"C:\x\readme.txt"), None);
    }

    #[test]
    fn blocking_writes_out_the_built_in_list_first() {
        let (list, now) = toggle_blocked(&[], "Notion.exe");
        assert!(now);
        assert!(
            list.iter().any(|b| b == "discord.exe"),
            "built-in list kept"
        );
        assert_eq!(list.last().map(String::as_str), Some("notion.exe"));
        let (list, now) = toggle_blocked(&list, "NOTION.EXE");
        assert!(!now);
        assert!(!list.iter().any(|b| normalize_exe(b) == "notion"));
        let (list, now) = toggle_blocked(&["steam.exe".into(), "x.exe".into()], "steam.exe");
        assert!(!now);
        assert_eq!(list, ["x.exe"]);
    }

    #[test]
    fn programs_are_found_through_their_launchers() {
        let discord = r"C:\Users\me\AppData\Local\Discord\Discord.exe";
        assert!(same_program(
            r"c:\users\me\appdata\local\discord\DISCORD.EXE",
            discord
        ));
        assert!(same_program(
            r"C:\Users\me\AppData\Local\Discord\app-1.0.9\Discord.exe",
            discord
        ));
        assert!(!same_program(
            r"C:\Users\me\AppData\Local\Discord\app-1.0.9\Update.exe",
            discord
        ));
        assert!(!same_program(r"C:\Other\Discord.exe", discord));

        let run = r#""C:\Users\me\AppData\Local\Discord\Update.exe" --processStart Discord.exe"#;
        assert!(starts_program(run, discord));
        assert!(starts_program(
            r#""C:\Program Files (x86)\Steam\steam.exe" -silent"#,
            r"C:\Program Files (x86)\Steam\Steam.exe"
        ));
        assert!(!starts_program(
            run,
            r"C:\Users\me\AppData\Local\Discord\Squirrel.exe"
        ));
        assert!(!starts_program(
            r#""C:\Users\me\AppData\Local\Other\Update.exe" --processStart Discord.exe"#,
            discord
        ));
    }

    /// Asks Windows about Command Prompt, which every Windows has:
    /// `cargo test -p collegiapp -- --ignored describes_command_prompt`
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn describes_command_prompt() {
        let t0 = std::time::Instant::now();
        let (verbs, program) = os::describe(&shell_target(
            r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\cmd.exe",
        ));
        eprintln!("{verbs:?} {program:?} in {:?}", t0.elapsed());
        assert!(verbs.iter().any(|v| v == "runas"), "{verbs:?}");
        assert!(verbs.iter().any(|v| v == "openfilelocation"), "{verbs:?}");
        assert!(program.is_some_and(|p| p.to_lowercase().ends_with(r"\system32\cmd.exe")));
        let t0 = std::time::Instant::now();
        let n = scan(r"C:\Windows\explorer.exe", false);
        eprintln!("{n} explorer processes in {:?}", t0.elapsed());
        assert!(os::startup_dir().is_ok_and(|d| d.is_dir()));
        eprintln!(
            "cmd sign-in: {}",
            os::signin("Command Prompt.lnk", Some(r"C:\Windows\system32\cmd.exe"))
        );
    }
}
