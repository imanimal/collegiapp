//! The main window turns off like a CRT before it goes. Closing it (or Quit in the tray) emits
//! "power-off" `{ seq, quit }` to the page, which plays the tube collapsing (fx.js) and calls
//! `power_done(seq)`; then the window hides, or the app exits for Quit. If the page doesn't
//! answer in time the window goes anyway. A hidden window just goes.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Longer than the slowest power-off (M3 motion), short enough that a stuck page never keeps a window up.
const FALLBACK: Duration = Duration::from_millis(2600);

#[derive(Default)]
pub struct Power {
    seq: AtomicU64,
    /// the turn-off waiting for the page: (seq, quit)
    pending: Mutex<Option<(u64, bool)>>,
}

#[derive(Serialize, Clone)]
struct Off {
    seq: u64,
    quit: bool,
}

fn finish(app: &AppHandle, quit: bool) {
    if quit {
        app.exit(0);
    } else if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

/// Turn the main window off: animate when it's on screen, else straight away.
pub fn off(app: &AppHandle, quit: bool) {
    let shown = app
        .get_webview_window("main")
        .is_some_and(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false));
    if !shown {
        return finish(app, quit);
    }
    let p = app.state::<Power>();
    let seq = p.seq.fetch_add(1, Ordering::Relaxed) + 1;
    let quit = {
        let mut pend = p.pending.lock().unwrap();
        // a Quit during a close keeps the Quit
        let quit = quit || pend.is_some_and(|(_, q)| q);
        *pend = Some((seq, quit));
        quit
    };
    if app.emit_to("main", "power-off", Off { seq, quit }).is_err() {
        return done(app, seq);
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FALLBACK);
        done(&app, seq);
    });
}

/// The turn-off `seq` finished (or ran out of time): hide or quit, once.
fn done(app: &AppHandle, seq: u64) {
    let p = app.state::<Power>();
    let take = {
        let mut pend = p.pending.lock().unwrap();
        match *pend {
            Some((s, q)) if s == seq => {
                *pend = None;
                Some(q)
            }
            _ => None,
        }
    };
    if let Some(quit) = take {
        finish(app, quit);
    }
}

#[tauri::command]
pub fn power_done(app: AppHandle, seq: u64) {
    done(&app, seq);
}
