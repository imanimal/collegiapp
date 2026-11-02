//! The main window's backdrop and top edge on Windows.
//!
//! The app's dot grid takes the Pocket wallpaper's cell size and phase
//! (`integrations/wallpaper-engine/wallpaper.js`: cells of `round(16 × monitor height / 1080)`
//! device pixels from the monitor's top-left corner, a dot in the middle of each), so over the
//! desktop its dots carry on the wallpaper's past the window's edge. That only holds while nothing
//! but the desktop is behind the window; over other windows the page keeps its own grid. The page
//! is opaque either way: desktop icons and other windows never show through.
//!
//! A thread looks at the window every 200 ms while it's shown, and at once when it moves, resizes
//! or changes focus (`poke`). Each change goes to the UI as the "backdrop" event (`Backdrop`),
//! which sets `html[data-backdrop]` and the grid's custom properties:
//! - "desktop": only the desktop is behind it. Windows that don't show don't count: hidden,
//!   minimized, cloaked (another virtual desktop), fully transparent, and Collegiapp's own.
//! - "solid": another window is behind it.
//!
//! The top edge: Tauri lays a resize strip (`TAURI_DRAG_RESIZE_BORDERS`) along the top of an
//! undecorated window, which here is the top bar's edge. The thread hides it, so the top bar moves
//! the window right up to its edge; the sides and the bottom still resize.
//!
//! Other platforms have no backdrop: `sync` returns None and the UI keeps its normal look.

use serde::Serialize;
#[cfg(windows)]
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
#[cfg(windows)]
use std::sync::{Mutex, OnceLock};
#[cfg(windows)]
use std::time::Duration;

#[cfg(windows)]
use tauri::{AppHandle, Emitter, Manager};

/// What the UI paints behind the app.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(not(windows), allow(dead_code))]
pub struct Backdrop {
    /// "desktop" or "solid"
    pub mode: &'static str,
    /// The wallpaper's grid in physical pixels: `[cell, x, y]`, where `x`, `y` is the top-left
    /// corner of the first whole cell, measured from the window's top-left corner.
    pub grid: [i32; 3],
}

#[cfg(windows)]
static CURRENT: Mutex<Option<Backdrop>> = Mutex::new(None);
#[cfg(windows)]
static POKE: OnceLock<Sender<()>> = OnceLock::new();

/// The wallpaper's cell for a monitor this many pixels tall: 16 at 1080p, 21 at 1440p, 32 at 4K,
/// whole device pixels, at least 8. Mirrors `layout()` in wallpaper.js; change both together.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn desk_cell(height: i32) -> i32 {
    ((16.0 * f64::from(height) / 1080.0).round() as i32).max(8)
}

/// The current backdrop.
pub fn current() -> Option<Backdrop> {
    #[cfg(windows)]
    {
        poke();
        CURRENT.lock().ok().and_then(|b| *b)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Look again now: the main window moved, resized or gained or lost focus.
pub fn poke() {
    #[cfg(windows)]
    {
        if let Some(tx) = POKE.get() {
            let _ = tx.send(());
        }
    }
}

/// Start watching the main window.
#[cfg(windows)]
pub fn spawn(app: AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let Ok(hwnd) = win.hwnd() else {
        return;
    };
    // HWND is a raw pointer, which isn't Send; the handle stays valid for the app's lifetime
    let hwnd = hwnd.0 as isize;
    let (tx, rx) = channel();
    if POKE.set(tx).is_err() {
        return;
    }
    std::thread::spawn(move || {
        let hwnd = hwnd as sys::HWND;
        let mut last: Option<Backdrop> = None;
        loop {
            let shown = sys::shown(hwnd);
            if shown {
                sys::free_top_edge(hwnd);
                let now = Backdrop {
                    mode: if sys::covers_a_window(hwnd) {
                        "solid"
                    } else {
                        "desktop"
                    },
                    grid: sys::grid(hwnd),
                };
                if last != Some(now) {
                    if let Ok(mut b) = CURRENT.lock() {
                        *b = Some(now);
                    }
                    let _ = app.emit_to("main", "backdrop", now);
                    last = Some(now);
                }
            }
            let wait = Duration::from_millis(if shown { 200 } else { 1000 });
            if let Err(RecvTimeoutError::Disconnected) = rx.recv_timeout(wait) {
                return;
            }
        }
    });
}

#[cfg(windows)]
mod sys {
    use core::ffi::c_void;

    pub use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::Graphics::Dwm::{
        DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
    };
    use windows_sys::Win32::Graphics::Gdi::{
        ClientToScreen, GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcessId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowExW, GetClassNameW, GetLayeredWindowAttributes, GetWindow, GetWindowLongW,
        GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible, ShowWindowAsync,
        GWL_EXSTYLE, GW_HWNDNEXT, LWA_ALPHA, SW_HIDE, WS_EX_LAYERED,
    };

    /// The desktop and the taskbars: behind every window, so they never count.
    const SHELL: [&str; 4] = [
        "Progman",
        "WorkerW",
        "Shell_TrayWnd",
        "Shell_SecondaryTrayWnd",
    ];

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    pub fn shown(w: HWND) -> bool {
        unsafe { IsWindowVisible(w) != 0 && IsIconic(w) == 0 }
    }

    /// The wallpaper's grid against the window's client area (`Backdrop::grid`).
    pub fn grid(w: HWND) -> [i32; 3] {
        let mut mi: MONITORINFO = unsafe { std::mem::zeroed() };
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        let mut p = POINT { x: 0, y: 0 };
        let ok = unsafe {
            GetMonitorInfoW(MonitorFromWindow(w, MONITOR_DEFAULTTONEAREST), &mut mi) != 0
                && ClientToScreen(w, &mut p) != 0
        };
        let m = mi.rcMonitor;
        if !ok || m.bottom <= m.top {
            return [16, 0, 0];
        }
        let cell = super::desk_cell(m.bottom - m.top);
        [
            cell,
            (m.left - p.x).rem_euclid(cell),
            (m.top - p.y).rem_euclid(cell),
        ]
    }

    /// Hide Tauri's resize strip along the top edge (see the module comment). Async, so a busy
    /// main thread never holds up this one.
    pub fn free_top_edge(w: HWND) {
        let class = wide("TAURI_DRAG_RESIZE_BORDERS");
        let strip =
            unsafe { FindWindowExW(w, std::ptr::null_mut(), class.as_ptr(), std::ptr::null()) };
        if !strip.is_null() && unsafe { IsWindowVisible(strip) } != 0 {
            unsafe { ShowWindowAsync(strip, SW_HIDE) };
        }
    }

    /// Whether any window that shows lies under `w`. Walks the windows below it in z-order, so
    /// the ones in front (and every always-on-top window) are never looked at.
    pub fn covers_a_window(w: HWND) -> bool {
        let Some(me) = bounds(w) else {
            return false;
        };
        let pid = unsafe { GetCurrentProcessId() };
        let mut h = w;
        // a cap in case windows close mid-walk and the chain loops
        for _ in 0..4096 {
            h = unsafe { GetWindow(h, GW_HWNDNEXT) };
            if h.is_null() {
                return false;
            }
            if !shown(h) || cloaked(h) || own(h, pid) || shell(h) || invisible(h) {
                continue;
            }
            if let Some(r) = bounds(h) {
                if r.left < me.right && me.left < r.right && r.top < me.bottom && me.top < r.bottom
                {
                    return true;
                }
            }
        }
        false
    }

    /// The visible frame, without the invisible resize borders `GetWindowRect` includes, so
    /// a window snapped beside ours doesn't count as under it.
    fn bounds(h: HWND) -> Option<RECT> {
        let mut r: RECT = unsafe { std::mem::zeroed() };
        let ok = unsafe {
            DwmGetWindowAttribute(
                h,
                DWMWA_EXTENDED_FRAME_BOUNDS as u32,
                &mut r as *mut RECT as *mut c_void,
                std::mem::size_of::<RECT>() as u32,
            )
        } == 0
            || unsafe { GetWindowRect(h, &mut r) } != 0;
        (ok && r.right > r.left && r.bottom > r.top).then_some(r)
    }

    fn cloaked(h: HWND) -> bool {
        let mut c = 0u32;
        let r = unsafe {
            DwmGetWindowAttribute(
                h,
                DWMWA_CLOAKED as u32,
                &mut c as *mut u32 as *mut c_void,
                4,
            )
        };
        r == 0 && c != 0
    }

    fn own(h: HWND, pid: u32) -> bool {
        let mut p = 0u32;
        unsafe { GetWindowThreadProcessId(h, &mut p) };
        p == pid
    }

    fn shell(h: HWND) -> bool {
        let mut buf = [0u16; 32];
        let n = unsafe { GetClassNameW(h, buf.as_mut_ptr(), buf.len() as i32) };
        n > 0 && SHELL.contains(&String::from_utf16_lossy(&buf[..n as usize]).as_str())
    }

    /// A layered window at zero opacity (an overlay waiting to appear).
    fn invisible(h: HWND) -> bool {
        if unsafe { GetWindowLongW(h, GWL_EXSTYLE) } as u32 & WS_EX_LAYERED == 0 {
            return false;
        }
        let (mut alpha, mut flags) = (255u8, 0u32);
        let ok = unsafe {
            GetLayeredWindowAttributes(h, std::ptr::null_mut(), &mut alpha, &mut flags) != 0
        };
        ok && flags & LWA_ALPHA != 0 && alpha == 0
    }
}

#[cfg(test)]
mod tests {
    use super::desk_cell;

    #[test]
    fn desk_cell_matches_the_wallpaper() {
        // wallpaper.js: Math.max(8, Math.round(16 * H / 1080))
        assert_eq!(desk_cell(1080), 16);
        assert_eq!(desk_cell(1440), 21);
        assert_eq!(desk_cell(1200), 18);
        assert_eq!(desk_cell(2160), 32);
        assert_eq!(desk_cell(1600), 24);
        assert_eq!(desk_cell(300), 8);
    }
}
