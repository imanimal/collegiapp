//! Gradescope: you sign in once in a Gradescope window inside the app (a real browser, so
//! UCSB's single sign-on works there), then the app reads your courses and assignments with
//! that session when you connect, when the UI refreshes and every 30 minutes with the
//! calendar feeds (feeds.rs). Parsing and mapping to items live in
//! `collegiapp_core::gradescope`; this file is the window, the session and the fetching.
//!
//! The session is the webview's own gradescope.com cookies (every window of the app shares
//! one browser profile). A copy is kept in `gradescope.session` beside the store, never synced
//! and never sent to the UI, because Gradescope's cookie may only last as long as the browser
//! and the app restarts for updates. Pages are fetched with the system curl, the cookie on its
//! stdin. Disconnecting deletes both, which signs the app out of Gradescope.

use std::path::PathBuf;

use chrono::Utc;
use collegiapp_core::gradescope::{self as gs, GsAssignment, GsCourse};
use collegiapp_core::{merge_imported, ImportCounts};
use tauri::{AppHandle, Manager};

use crate::store::{lock, AppState, SharedState};

pub const LABEL: &str = "gradescope";
const SESSION_FILE: &str = "gradescope.session";

fn session_file(app: &AppHandle) -> Option<PathBuf> {
    let state = app.state::<SharedState>();
    let g = lock(&state);
    g.path.parent().map(|d| d.join(SESSION_FILE))
}

/// The gradescope.com cookies of window `label` as a `Cookie:` header value. Blocks on the
/// main thread on Windows: call it from another thread, and only on a window that stays open.
#[cfg(desktop)]
fn webview_session(app: &AppHandle, label: &str) -> Option<String> {
    let url = gs::BASE.parse().ok()?;
    let w = app.get_webview_window(label)?;
    let cookies = w.cookies_for_url(url).ok()?;
    let header = cookies
        .iter()
        .map(|c| format!("{}={}", c.name(), c.value()))
        .collect::<Vec<_>>()
        .join("; ");
    (!header.is_empty()).then_some(header)
}

/// Open the sign-in window (or bring it back). When it reaches your Gradescope account page,
/// the app takes the session, closes the window and imports.
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
    let url = format!("{}/login", gs::BASE)
        .parse()
        .map_err(|e| format!("{e}"))?;
    let handle = app.clone();
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title("Sign in to Gradescope")
        .inner_size(520.0, 760.0)
        .center()
        .on_page_load(move |_, payload| {
            let u = payload.url();
            let signed_in = u.host_str() == Some("www.gradescope.com")
                && (u.path().starts_with("/account") || u.path().starts_with("/courses"));
            if payload.event() == PageLoadEvent::Finished && signed_in {
                let app = handle.clone();
                // cookies_for_url waits on the main thread, which is running this handler
                std::thread::spawn(move || finish_sign_in(&app));
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(desktop)]
fn finish_sign_in(app: &AppHandle) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::Emitter;
    static BUSY: AtomicBool = AtomicBool::new(false);

    if BUSY.swap(true, Ordering::SeqCst) {
        return;
    }
    // take the session while the sign-in window is still open, then close it
    if let (Some(cookie), Some(f)) = (webview_session(app, LABEL), session_file(app)) {
        let _ = std::fs::write(f, cookie);
    }
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
    let state = app.state::<SharedState>();
    lock(&state).data.settings.gradescope = true;
    let r = sync(app);
    crate::feeds::record(&mut lock(&state).data.feeds.gradescope, &r);
    if let Ok(feeds) = crate::feeds::finish(app) {
        let _ = app.emit("gradescope", feeds.gradescope);
    }
    BUSY.store(false, Ordering::SeqCst);
}

/// Forget the session: delete the webview's gradescope.com cookies and the saved copy. Items
/// already imported stay.
pub fn disconnect(app: &AppHandle) {
    #[cfg(desktop)]
    if let (Some(w), Ok(url)) = (app.get_webview_window("main"), gs::BASE.parse()) {
        for c in w.cookies_for_url(url).unwrap_or_default() {
            let _ = w.delete_cookie(c);
        }
    }
    if let Some(f) = session_file(app) {
        let _ = std::fs::remove_file(f);
    }
    let state = app.state::<SharedState>();
    let mut g = lock(&state);
    g.data.settings.gradescope = false;
    g.data.feeds.gradescope = Default::default();
    g.data.feeds.gradescope_courses.clear();
}

/// Fetch this term's courses and their assignments and import them. Blocking.
#[cfg(desktop)]
pub fn sync(app: &AppHandle) -> Result<ImportCounts, String> {
    let file = session_file(app);
    let saved = file.as_ref().and_then(|f| std::fs::read_to_string(f).ok());
    let mut tried: Vec<String> = Vec::new();
    let mut account = None;
    // the sign-in window may be closing; the main window shares its cookies and stays
    for cookie in [webview_session(app, "main"), saved].into_iter().flatten() {
        let cookie = cookie.trim().to_string();
        if cookie.is_empty() || tried.contains(&cookie) {
            continue;
        }
        tried.push(cookie.clone());
        let html = crate::feeds::get(&format!("{}/account", gs::BASE), Some(&cookie))
            .map_err(|e| format!("Gradescope didn't load: {e}"))?;
        if !gs::is_login_page(&html) {
            account = Some((cookie, html));
            break;
        }
    }
    let Some((cookie, html)) = account else {
        return Err("Signed out of Gradescope. Sign in again.".into());
    };
    if let Some(f) = &file {
        let _ = std::fs::write(f, &cookie);
    }
    let courses = gs::current_courses(&gs::parse_courses(&html));
    let mut pages = Vec::new();
    for c in &courses {
        // one course failing (dropped, archived) doesn't stop the others
        if let Ok(html) = crate::feeds::get(&c.url(), Some(&cookie)) {
            pages.push((c.clone(), gs::parse_assignments(&html)));
        }
    }
    let state = app.state::<SharedState>();
    let mut g = lock(&state);
    g.data.feeds.gradescope_courses = courses;
    Ok(import(&mut g, &pages))
}

#[cfg(mobile)]
pub fn sync(_app: &AppHandle) -> Result<ImportCounts, String> {
    Err("Gradescope needs the desktop app for now.".into())
}

/// Import read pages: each Gradescope course lands in the course you have for it (gaining a
/// Gradescope link) or a new one; assignments you submitted since the last check are marked
/// done.
pub fn import(g: &mut AppState, pages: &[(GsCourse, Vec<GsAssignment>)]) -> ImportCounts {
    let (now, device) = (Utc::now(), g.device_id());
    let mut incoming = Vec::new();
    let mut submitted = Vec::new();
    for (course, list) in pages {
        let id = match gs::course_for(course, &g.data.courses).map(|c| c.id.clone()) {
            Some(id) => {
                let c = g
                    .data
                    .courses
                    .iter_mut()
                    .find(|c| c.id == id)
                    .expect("found");
                if !c.links.iter().any(|l| l.url == course.url()) {
                    c.links.push(gs::gradescope_link(course));
                }
                id
            }
            None => {
                let c = gs::new_course(course, &g.data.courses);
                let id = c.id.clone();
                g.data.courses.push(c);
                id
            }
        };
        incoming.extend(gs::to_items(course, Some(&id), list, now, &device));
        submitted.extend(
            list.iter()
                .filter(|a| a.submitted())
                .map(|a| gs::external_id(&course.id, a)),
        );
    }
    let mut n = merge_imported(&mut g.data.items, incoming, now, &device);
    let seen = &mut g.data.feeds.gradescope_submitted;
    let newly: Vec<String> = submitted
        .into_iter()
        .filter(|e| !seen.contains(e))
        .collect();
    seen.extend(newly.iter().cloned());
    n.updated += gs::mark_submitted(&mut g.data.items, &newly, now, &device);
    n
}

#[cfg(test)]
mod tests {
    use super::*;
    use collegiapp_core::{Course, Status};

    fn gs_course() -> GsCourse {
        GsCourse {
            id: "77".into(),
            short_name: "CMPSC 16".into(),
            name: "Problem Solving with Computers I".into(),
            term: "Fall 2026".into(),
        }
    }

    fn lab(status: &str) -> GsAssignment {
        GsAssignment {
            id: Some("5".into()),
            name: "lab05".into(),
            release: None,
            due: Some(Utc::now()),
            late_due: None,
            status: status.into(),
            score: None,
        }
    }

    #[test]
    fn lands_in_your_course_and_marks_new_submissions_done() {
        let mut g = AppState {
            data: crate::store::Snapshot::fresh(),
            path: PathBuf::from("unused.json"),
            trash: crate::trash::Trash::new(PathBuf::from("unused-trash")),
        };
        g.data.courses.push(Course::new("cs16", "CS 16"));
        let n = import(&mut g, &[(gs_course(), vec![lab("No Submission")])]);
        assert_eq!(n.added, 1);
        assert_eq!(g.data.courses.len(), 1, "matched CS 16, no new course");
        assert_eq!(
            g.data.courses[0].links[0].url,
            "https://www.gradescope.com/courses/77"
        );
        let it = g
            .data
            .items
            .iter()
            .find(|i| i.source.adapter == "gradescope")
            .unwrap();
        assert_eq!(
            (it.course_id.as_deref(), it.status),
            (Some("cs16"), Status::Todo)
        );

        // you submit: done once; reopen it and it stays open
        import(&mut g, &[(gs_course(), vec![lab("Submitted")])]);
        let pos = g
            .data
            .items
            .iter()
            .position(|i| i.source.adapter == "gradescope")
            .unwrap();
        assert_eq!(g.data.items[pos].status, Status::Done);
        g.data.items[pos].status = Status::Todo;
        import(&mut g, &[(gs_course(), vec![lab("Submitted")])]);
        assert_eq!(g.data.items[pos].status, Status::Todo);
        assert_eq!(g.data.courses[0].links.len(), 1);
    }
}
