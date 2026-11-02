//! WeBWorK: you sign in to a course once in a WeBWorK window inside the app, then the app reads
//! that course's homework list with your session when you connect, when the UI refreshes and
//! with the calendar feeds (feeds.rs), every [`KEEP_ALIVE`] so the session doesn't lapse while
//! the app runs. Parsing and mapping to items live in `collegiapp_core::webwork`; this file is
//! the window, the sessions and the fetching.
//!
//! WeBWorK ends a session after 30 minutes without a request, so a session outlives an app
//! restart or a sleeping laptop only briefly; after that the course shows "signed out" and its
//! items stay until you sign in again. Like Gradescope (gradescope.rs), each session is the
//! webview's own cookies for the course, with a copy in `webwork.session` beside the store
//! (course address -> `Cookie:` value), never synced and never sent to the UI.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use chrono::Utc;
use collegiapp_core::webwork::{self as ww, WwCourse, WwSet};
use collegiapp_core::{merge_imported, ImportCounts};
use tauri::{AppHandle, Manager};

use crate::store::{lock, AppState, SharedState};

pub const LABEL: &str = "webwork";
const SESSION_FILE: &str = "webwork.session";
/// Read the courses this often, inside WeBWorK's 30-minute session timeout.
pub const KEEP_ALIVE: Duration = Duration::from_secs(20 * 60);

fn session_file(app: &AppHandle) -> Option<PathBuf> {
    let state = app.state::<SharedState>();
    let g = lock(&state);
    g.path.parent().map(|d| d.join(SESSION_FILE))
}

fn saved_sessions(app: &AppHandle) -> BTreeMap<String, String> {
    session_file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_sessions(app: &AppHandle, sessions: &BTreeMap<String, String>) {
    if let (Some(f), Ok(json)) = (session_file(app), serde_json::to_string(sessions)) {
        let _ = std::fs::write(f, json);
    }
}

/// Window `label`'s cookies for `url` as a `Cookie:` header value. Blocks on the main thread
/// on Windows: call it from another thread, and only on a window that stays open.
#[cfg(desktop)]
fn webview_session(app: &AppHandle, label: &str, url: &str) -> Option<String> {
    let w = app.get_webview_window(label)?;
    let cookies = w.cookies_for_url(url.parse().ok()?).ok()?;
    let header = cookies
        .iter()
        .map(|c| format!("{}={}", c.name(), c.value()))
        .collect::<Vec<_>>()
        .join("; ");
    (!header.is_empty()).then_some(header)
}

/// Open the sign-in window (or bring it back) on UCSB's list of WeBWorK courses. Once a
/// course's homework list loads in it, the app takes the session, closes the window and imports.
#[cfg(desktop)]
pub fn open_sign_in(app: &AppHandle) -> Result<(), String> {
    use tauri::webview::PageLoadEvent;
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let url = format!("{}/", ww::UCSB)
        .parse()
        .map_err(|e| format!("{e}"))?;
    let handle = app.clone();
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title("Sign in to WeBWorK")
        .inner_size(720.0, 780.0)
        .center()
        .on_page_load(move |_, payload| {
            // every page of a course, the sign-in form included: finish_sign_in checks
            // whether the homework list is readable yet
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            if let Some(course) = WwCourse::from_url(payload.url().as_str()) {
                let app = handle.clone();
                // cookies_for_url waits on the main thread, which is running this handler
                std::thread::spawn(move || finish_sign_in(&app, course));
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(desktop)]
fn finish_sign_in(app: &AppHandle, course: WwCourse) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::Emitter;
    static BUSY: AtomicBool = AtomicBool::new(false);

    if BUSY.swap(true, Ordering::SeqCst) {
        return;
    }
    let url = course.url();
    let cookie = webview_session(app, LABEL, &url);
    let html = cookie
        .as_deref()
        .and_then(|c| crate::feeds::get(&url, Some(c)).ok());
    let state = app.state::<SharedState>();
    match (cookie, html) {
        (Some(cookie), Some(html)) if !ww::is_login_page(&html) => {
            let mut sessions = saved_sessions(app);
            sessions.insert(url, cookie);
            save_sessions(app, &sessions);
            if let Some(w) = app.get_webview_window(LABEL) {
                let _ = w.close();
            }
            {
                let mut g = lock(&state);
                let list = &mut g.data.settings.webwork_courses;
                if !list.iter().any(|c| c.url() == course.url()) {
                    list.push(course);
                }
            }
            let r = sync(app);
            crate::feeds::record(&mut lock(&state).data.feeds.webwork, &r);
            if let Ok(feeds) = crate::feeds::finish(app) {
                let _ = app.emit("webwork", feeds.webwork);
            }
        }
        // not signed in yet: the window stays for the sign-in form
        _ => {}
    }
    BUSY.store(false, Ordering::SeqCst);
}

/// Forget every course: delete the webview's cookies for them and the saved copies. Items
/// already imported stay.
pub fn disconnect(app: &AppHandle) {
    let state = app.state::<SharedState>();
    let courses = std::mem::take(&mut lock(&state).data.settings.webwork_courses);
    #[cfg(desktop)]
    if let Some(w) = app.get_webview_window("main") {
        for c in &courses {
            let Ok(url) = c.url().parse() else { continue };
            for cookie in w.cookies_for_url(url).unwrap_or_default() {
                let _ = w.delete_cookie(cookie);
            }
        }
    }
    #[cfg(mobile)]
    let _ = courses;
    if let Some(f) = session_file(app) {
        let _ = std::fs::remove_file(f);
    }
    lock(&state).data.feeds.webwork = Default::default();
}

/// Read every signed-in course's homework list and import it. Blocking. A course that is
/// signed out or fails keeps its items; the error names it, after the others import.
#[cfg(desktop)]
pub fn sync(app: &AppHandle) -> Result<ImportCounts, String> {
    let state = app.state::<SharedState>();
    let courses = lock(&state).data.settings.webwork_courses.clone();
    if courses.is_empty() {
        return Err("Sign in to a WeBWorK course first.".into());
    }
    let mut sessions = saved_sessions(app);
    let (mut pages, mut problems, mut signed_out) = (Vec::new(), Vec::new(), Vec::new());
    for c in &courses {
        let url = c.url();
        let mut tried: Vec<String> = Vec::new();
        let (mut page, mut failed) = (None, false);
        // the main window shares the sign-in window's cookies and stays open
        for cookie in [
            webview_session(app, "main", &url),
            sessions.get(&url).cloned(),
        ]
        .into_iter()
        .flatten()
        {
            let cookie = cookie.trim().to_string();
            if cookie.is_empty() || tried.contains(&cookie) {
                continue;
            }
            tried.push(cookie.clone());
            match crate::feeds::get(&url, Some(&cookie)) {
                Ok(html) if ww::is_login_page(&html) => continue,
                Ok(html) if ww::lms_only(&html) => {
                    problems.push(format!("{} opens only from Canvas", c.code));
                    failed = true;
                }
                Ok(html) => page = Some((cookie, ww::parse_sets(&html))),
                Err(e) => {
                    problems.push(format!("{} didn't load: {e}", c.code));
                    failed = true;
                }
            }
            break;
        }
        match page {
            Some((cookie, sets)) => {
                sessions.insert(url, cookie);
                pages.push((c.clone(), sets));
            }
            None if !failed => signed_out.push(c.code.clone()),
            None => {}
        }
    }
    save_sessions(app, &sessions);
    let n = import(&mut lock(&state), &pages);
    if !signed_out.is_empty() {
        problems.push(format!(
            "Signed out of WeBWorK ({}). It signs you out after 30 idle minutes; sign in again",
            signed_out.join(", ")
        ));
    }
    if problems.is_empty() {
        Ok(n)
    } else {
        Err(problems.join(" · ") + ".")
    }
}

#[cfg(mobile)]
pub fn sync(_app: &AppHandle) -> Result<ImportCounts, String> {
    Err("WeBWorK needs the desktop app for now.".into())
}

/// Import read homework lists: each WeBWorK course lands in the course you have for it
/// (gaining a WeBWorK link) or a new one; its open sets become items.
pub fn import(g: &mut AppState, pages: &[(WwCourse, Vec<WwSet>)]) -> ImportCounts {
    let (now, device) = (Utc::now(), g.device_id());
    let mut incoming = Vec::new();
    for (course, sets) in pages {
        let id = match ww::course_for(course, &g.data.courses).map(|c| c.id.clone()) {
            Some(id) => {
                let c = g
                    .data
                    .courses
                    .iter_mut()
                    .find(|c| c.id == id)
                    .expect("found");
                if !c.links.iter().any(|l| l.url == course.url()) {
                    c.links.push(ww::webwork_link(course));
                }
                id
            }
            None => {
                let c = ww::new_course(course, &g.data.courses);
                let id = c.id.clone();
                g.data.courses.push(c);
                id
            }
        };
        incoming.extend(ww::to_items(course, Some(&id), sets, now, &device));
    }
    merge_imported(&mut g.data.items, incoming, now, &device)
}

#[cfg(test)]
mod tests {
    use super::*;
    use collegiapp_core::Course;

    #[test]
    fn lands_in_your_course() {
        let mut g = AppState {
            data: crate::store::Snapshot::fresh(),
            path: PathBuf::from("unused.json"),
            trash: crate::trash::Trash::new(PathBuf::from("unused-trash")),
        };
        g.data.courses.push(Course::new("math4a", "MATH 4A"));
        let course =
            WwCourse::from_url("https://webwork.math.ucsb.edu/webwork2/math4a-01-f26-x/").unwrap();
        let set = WwSet {
            id: "HW_1".into(),
            name: "HW 1".into(),
            opens: None,
            due: Some(Utc::now()),
            late_due: None,
            closed: false,
        };
        let n = import(&mut g, &[(course.clone(), vec![set.clone()])]);
        assert_eq!(n.added, 1);
        assert_eq!(g.data.courses.len(), 1, "matched MATH 4A, no new course");
        assert_eq!(g.data.courses[0].links[0].url, course.url());
        let it = g
            .data
            .items
            .iter()
            .find(|i| i.source.adapter == "webwork")
            .unwrap();
        assert_eq!(it.course_id.as_deref(), Some("math4a"));
        // a re-import changes nothing and adds no second link
        let n = import(&mut g, &[(course, vec![set])]);
        assert_eq!((n.added, n.unchanged), (0, 1));
        assert_eq!(g.data.courses[0].links.len(), 1);
    }
}
