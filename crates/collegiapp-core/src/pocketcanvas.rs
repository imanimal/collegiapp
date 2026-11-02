//! PocketCanvas adapter: what the Firefox extension sends over the bridge (`POST /v1/canvas`,
//! src-tauri/src/bridge.rs). PocketCanvas reads Canvas with the browser's session, so it sees what
//! the calendar feed can't: work with no due date, your class choices (priority, ghost, hidden),
//! submissions, and due dates it found in WeBWorK and Gradescope for Canvas work that has none.
//!
//! Every work entry names its source the way Collegiapp's own readers do, so the same work is one
//! item whichever reader saw it first: Canvas assignments use the calendar feed's UID
//! (`canvas` / `event-assignment-<id>`), WeBWorK sets `webwork` / `<course>/<set>` and Gradescope
//! assignments `gradescope` / `<course>/<id>` (the ids [`crate::webwork`] and [`crate::gradescope`]
//! make), anything else `pocketcanvas` / `<kind>-<id>`. A Canvas entry whose date came from an app
//! carries `same_as`, and is skipped when Collegiapp already has that app's item.
//!
//! Classes: one with your Canvas id is updated, else the one its code names, else (unless it's
//! ghosted or hidden) a new course. Ghosted and hidden classes are excluded (`included: false`);
//! priority and normal ones included; a class left on automatic keeps whatever you set here.
//! Work Canvas says you submitted is checked off once, when it's still open here.
//!
//! Canvas lists grade columns and notices as assignments too, so work keeps its kind only when
//! it's sure to be work ([`canvas_kind`]): the extension says it's to do (`to_do`: turned in
//! online, a quiz, a discussion, or on your Canvas To Do list), or WeBWorK or Gradescope has it.
//! Anything else comes in as Info, in the Inbox for you to sort unless it reads as a grade.
//!
//! One piece of work can also be sent on purpose from its Canvas page (PocketCanvas's Send to
//! Collegiapp, `POST /v1/work`): [`send`] imports it the same way and adds the estimate, priority
//! and notes you gave, and [`find`] (`POST /v1/work/find`) says whether it's here already.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::model::{
    canvas_kind, course_in_text, merge_imported, normalize_token, stable_id, Course, ImportCounts,
    Item, ItemKind, Link, Source, Status,
};

pub const ADAPTER: &str = "pocketcanvas";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Push {
    /// "canvas.ucsb.edu"
    pub host: String,
    pub courses: Vec<PushCourse>,
    pub work: Vec<PushWork>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct PushCourse {
    pub canvas_id: String,
    /// "CMPSC 130A - Data Structures and Algorithms"
    pub name: String,
    /// "CMPSC 130A F26"
    pub code: String,
    pub term: String,
    /// "priority" | "normal" | "ghost" | "hidden", or None for automatic.
    pub mode: Option<String>,
    pub url: String,
    pub color: u8,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct SourceRef {
    pub adapter: String,
    pub external_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct PushWork {
    pub adapter: String,
    pub external_id: String,
    pub same_as: Option<SourceRef>,
    /// The Canvas course id, if the work belongs to a class.
    pub course: Option<String>,
    /// A course code for work no Canvas class claims ("MATH 4B").
    pub course_text: Option<String>,
    pub title: String,
    pub kind: String,
    pub due: Option<DateTime<Utc>>,
    /// "canvas" | "mine" | "webwork" | "gradescope", or None without a date.
    pub due_from: Option<String>,
    pub url: Option<String>,
    pub submitted: bool,
    pub points: Option<f32>,
    /// Canvas says it's something to do: an assignment turned in online (an upload, text, a
    /// link, an online quiz, a discussion post, an outside tool such as Gradescope), or an item
    /// on your Canvas To Do list. Without it the work may be a grade column or a notice.
    pub to_do: bool,
}

impl PushWork {
    /// Sure to be work: Canvas says it's to do, or WeBWorK or Gradescope has it.
    fn sure(&self) -> bool {
        let app = |a: &str| matches!(a, "webwork" | "gradescope");
        self.to_do
            || app(&self.adapter)
            || self.same_as.is_some()
            || self.due_from.as_deref().is_some_and(app)
    }
}

fn excluded(mode: Option<&str>) -> Option<bool> {
    match mode {
        Some("ghost" | "hidden") => Some(true),
        Some("priority" | "normal") => Some(false),
        _ => None,
    }
}

/// "CMPSC 130A F26" -> "CMPSC 130A": the subject and number, without a trailing term.
fn short_code(code: &str) -> String {
    let mut words: Vec<&str> = Vec::new();
    for w in code.split_whitespace() {
        let term = w.len() <= 4
            && matches!(
                w.as_bytes()[0].to_ascii_uppercase(),
                b'F' | b'W' | b'S' | b'M'
            )
            && w[1..].bytes().all(|b| b.is_ascii_digit())
            && w.len() > 1;
        if (term && !words.is_empty()) || w == "-" {
            break;
        }
        words.push(w);
        if w.bytes().any(|b| b.is_ascii_digit()) {
            break;
        }
    }
    let s = words.join(" ");
    if s.is_empty() {
        code.trim().to_string()
    } else {
        s
    }
}

/// Fold your classes into `courses` (see the module header) and return Canvas id -> course id.
fn courses_in(courses: &mut Vec<Course>, push: &Push) -> Vec<(String, String)> {
    let mut map = Vec::new();
    for pc in &push.courses {
        let code = short_code(if pc.code.is_empty() {
            &pc.name
        } else {
            &pc.code
        });
        let found = courses
            .iter()
            .position(|c| c.canvas_id.as_deref() == Some(pc.canvas_id.as_str()))
            .or_else(|| {
                let c =
                    course_in_text(&code, courses).or_else(|| course_in_text(&pc.name, courses))?;
                courses.iter().position(|x| x.id == c.id)
            });
        let ex = excluded(pc.mode.as_deref());
        let i = match found {
            Some(i) => i,
            None if ex == Some(true) => continue,
            None => {
                let mut id = normalize_token(&code);
                if courses.iter().any(|c| c.id == id) {
                    id = format!("{id}-{}", pc.canvas_id);
                }
                let mut c = Course::new(&id, &code);
                c.title = pc
                    .name
                    .split_once(" - ")
                    .map_or(String::new(), |(_, t)| t.trim().to_string());
                c.color = if (1..=6).contains(&pc.color) {
                    pc.color
                } else {
                    (courses.len() % 6 + 1) as u8
                };
                courses.push(c);
                courses.len() - 1
            }
        };
        let c = &mut courses[i];
        if c.canvas_id.is_none() {
            c.canvas_id = Some(pc.canvas_id.clone());
        }
        if !pc.url.is_empty() && !c.links.iter().any(|l| l.url == pc.url) {
            c.links.push(Link {
                label: "Canvas".into(),
                url: pc.url.clone(),
            });
        }
        if let Some(ex) = ex {
            c.included = !ex;
        }
        map.push((pc.canvas_id.clone(), c.id.clone()));
    }
    map
}

fn kind_of(k: &str) -> ItemKind {
    match ItemKind::from_name(k) {
        Some(k) if k.is_actionable() => k,
        _ => ItemKind::Assignment,
    }
}

fn label_for(adapter: &str) -> &'static str {
    match adapter {
        "webwork" => "WeBWorK",
        "gradescope" => "Gradescope",
        _ => "Canvas",
    }
}

/// Import a push into `courses` and `items`. Returns what changed (`removed` is always 0: work
/// that disappears from Canvas stays until you delete it, like the other readers).
pub fn import(
    courses: &mut Vec<Course>,
    items: &mut Vec<Item>,
    push: &Push,
    now: DateTime<Utc>,
    device: &str,
) -> ImportCounts {
    let map = courses_in(courses, push);
    let mut incoming = Vec::new();
    let mut done = Vec::new();
    for w in &push.work {
        if w.title.trim().is_empty() || w.adapter.is_empty() || w.external_id.is_empty() {
            continue;
        }
        let id = stable_id(&w.adapter, &w.external_id);
        let known = items.iter().any(|i| i.id == id);
        if let Some(s) = &w.same_as {
            // the app's own item is already here (Collegiapp's WeBWorK or Gradescope reader)
            if !known
                && items
                    .iter()
                    .any(|i| i.id == stable_id(&s.adapter, &s.external_id))
            {
                continue;
            }
        }
        let (kind, status) = canvas_kind(w.title.trim(), kind_of(&w.kind), w.sure());
        let mut it = Item::new(w.title.trim(), kind, now, device);
        it.id = id;
        it.status = status;
        it.course_id = w
            .course
            .as_ref()
            .and_then(|cid| map.iter().find(|(c, _)| c == cid).map(|(_, id)| id.clone()))
            .or_else(|| {
                w.course_text
                    .as_deref()
                    .and_then(|t| course_in_text(t, courses))
                    .map(|c| c.id.clone())
            });
        it.due = w.due;
        it.source = Source {
            adapter: w.adapter.clone(),
            external_id: Some(w.external_id.clone()),
            url: w.url.clone(),
            kind: None,
        };
        if let Some(u) = &w.url {
            it.links.push(Link {
                label: label_for(&w.adapter).into(),
                url: u.clone(),
            });
        }
        if w.submitted {
            done.push(id);
        }
        incoming.push(it);
    }
    let mut n = merge_imported(items, incoming, now, device);
    for it in items
        .iter_mut()
        .filter(|i| done.contains(&i.id) && !i.deleted)
    {
        if matches!(it.status, Status::Inbox | Status::Todo) {
            it.status = Status::Done;
            it.touch(now, device);
            n.updated += 1;
        }
    }
    n
}

/// One piece of work sent from its page: the work as a push carries it, its class, and what you
/// added in the form. `None` leaves a field as it is; an estimate of 0 clears it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Send {
    pub host: String,
    pub course: Option<PushCourse>,
    pub work: PushWork,
    pub est_minutes: Option<u32>,
    /// 0..=3 (`!` to `!!!`).
    pub priority: Option<u8>,
    pub notes: Option<String>,
}

/// An item as the Send form shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Sent {
    pub id: Uuid,
    pub title: String,
    pub due: Option<DateTime<Utc>>,
    pub done: bool,
    pub est_minutes: Option<u32>,
    pub priority: u8,
    pub notes: String,
    /// "MATH 4B", when it has a class.
    pub course: Option<String>,
    /// False when its class is left out here, so Collegiapp's lists hide it.
    pub shown: bool,
}

fn sent(it: &Item, courses: &[Course]) -> Sent {
    let c = it
        .course_id
        .as_deref()
        .and_then(|id| courses.iter().find(|c| c.id == id));
    Sent {
        id: it.id,
        title: it.title.clone(),
        due: it.due,
        done: matches!(it.status, Status::Done | Status::Dropped),
        est_minutes: it.est_minutes,
        priority: it.priority,
        notes: it.notes.clone(),
        course: c.map(|c| c.code.clone()),
        shown: c.is_none_or(|c| c.included),
    }
}

fn ids_of(refs: &[SourceRef]) -> Vec<Uuid> {
    refs.iter()
        .filter(|r| !r.adapter.is_empty() && !r.external_id.is_empty())
        .map(|r| stable_id(&r.adapter, &r.external_id))
        .collect()
}

/// The index of the first live item `ids` name, in their order.
fn live(items: &[Item], ids: &[Uuid]) -> Option<usize> {
    ids.iter()
        .find_map(|id| items.iter().position(|i| i.id == *id && !i.deleted))
}

/// The item one of `refs` names (the work itself, then the app item it's the same as), if it's here.
pub fn find(items: &[Item], courses: &[Course], refs: &[SourceRef]) -> Option<Sent> {
    live(items, &ids_of(refs)).map(|i| sent(&items[i], courses))
}

/// Send one piece of work. It's imported like a push (same id, same class matching, checked off
/// when Canvas says you submitted it), except that it's work (you sent it), it never changes
/// whether a class is included, and an item you deleted here comes back. When Collegiapp has the app item it's the same as,
/// that item gets your additions. Later pushes leave the estimate, priority and notes alone.
/// Returns the item and whether it's new here, or None when there's nothing to send.
pub fn send(
    courses: &mut Vec<Course>,
    items: &mut Vec<Item>,
    s: &Send,
    now: DateTime<Utc>,
    device: &str,
) -> Option<(Sent, bool)> {
    let w = &s.work;
    if w.title.trim().is_empty() || w.adapter.is_empty() || w.external_id.is_empty() {
        return None;
    }
    let mut refs = vec![SourceRef {
        adapter: w.adapter.clone(),
        external_id: w.external_id.clone(),
    }];
    refs.extend(w.same_as.clone());
    let ids = ids_of(&refs);
    let new = live(items, &ids).is_none();
    if new {
        if let Some(it) = ids
            .iter()
            .find_map(|id| items.iter().position(|i| i.id == *id))
        {
            items[it].deleted = false;
            items[it].touch(now, device);
        }
    }
    let push = Push {
        host: s.host.clone(),
        courses: s
            .course
            .iter()
            .map(|c| PushCourse {
                mode: None,
                ..c.clone()
            })
            .collect(),
        work: vec![PushWork {
            to_do: true,
            ..w.clone()
        }],
    };
    import(courses, items, &push, now, device);
    let i = live(items, &ids)?;
    let it = &mut items[i];
    let before = (it.est_minutes, it.priority, it.notes.clone());
    if let Some(m) = s.est_minutes {
        it.est_minutes = (m > 0).then_some(m.min(24 * 60));
    }
    if let Some(p) = s.priority {
        it.priority = p.min(3);
    }
    if let Some(n) = &s.notes {
        it.notes = n.trim().to_string();
    }
    if (it.est_minutes, it.priority, &it.notes) != (before.0, before.1, &before.2) {
        it.touch(now, device);
    }
    Some((sent(&items[i], courses), new))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-11-01T17:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn push() -> Push {
        serde_json::from_str(
            r#"{"host":"canvas.ucsb.edu",
            "courses":[
              {"canvas_id":"10","name":"MATH 4B - Linear Algebra","code":"MATH 4B F26","term":"Fall 2026","mode":null,"url":"https://canvas.ucsb.edu/courses/10","color":2},
              {"canvas_id":"11","name":"CMPSC 130A","code":"CMPSC 130A S25","term":"Spring 2025","mode":"ghost","url":"https://canvas.ucsb.edu/courses/11","color":1},
              {"canvas_id":"12","name":"CMPSC 154","code":"CMPSC 154 F26","term":"Fall 2026","mode":"priority","url":"https://canvas.ucsb.edu/courses/12","color":3}],
            "work":[
              {"adapter":"canvas","external_id":"event-assignment-100","same_as":{"adapter":"webwork","external_id":"math4B-01-f26-x/Homework_3"},"course":"10","title":"Homework 3","kind":"assignment","due":"2026-11-06T07:59:00Z","due_from":"webwork","url":"https://canvas.ucsb.edu/courses/10/assignments/100","submitted":false},
              {"adapter":"webwork","external_id":"math4B-01-f26-x/Homework_5","course":"10","title":"Homework 5","kind":"assignment","due":"2026-11-13T07:59:00Z","due_from":"webwork","url":"https://webwork.math.ucsb.edu/webwork2/math4B-01-f26-x/Homework_5/","submitted":false},
              {"adapter":"canvas","external_id":"event-assignment-200","course":"12","title":"Lab 4","kind":"lab","due":null,"url":"u","submitted":true,"to_do":true},
              {"adapter":"pocketcanvas","external_id":"discussion_topic-9","course":"12","title":"Intro post","kind":"discussion","due":null,"submitted":false,"to_do":true}
            ]}"#,
        )
        .unwrap()
    }

    #[test]
    fn classes_and_work_land_once() {
        let now = at();
        let mut courses = vec![Course::new("cmpsc154", "CMPSC 154")];
        let mut items = Vec::new();
        let n = import(&mut courses, &mut items, &push(), now, "d");
        assert_eq!(n.added, 4);
        // MATH 4B is new, 154 matched by code, the ghosted 130A wasn't created
        assert_eq!(courses.len(), 2);
        let math = courses.iter().find(|c| c.code == "MATH 4B").unwrap();
        assert_eq!(
            (
                math.id.as_str(),
                math.canvas_id.as_deref(),
                math.title.as_str()
            ),
            ("math4b", Some("10"), "Linear Algebra")
        );
        assert_eq!(courses[0].canvas_id.as_deref(), Some("12"));
        assert!(courses[0].included);
        let hw3 = items.iter().find(|i| i.title == "Homework 3").unwrap();
        assert_eq!(hw3.id, stable_id("canvas", "event-assignment-100"));
        assert_eq!(hw3.course_id.as_deref(), Some("math4b"));
        assert!(hw3.due.is_some());
        let hw5 = items.iter().find(|i| i.title == "Homework 5").unwrap();
        assert_eq!(hw5.id, stable_id("webwork", "math4B-01-f26-x/Homework_5"));
        assert_eq!(hw5.links[0].label, "WeBWorK");
        // submitted on Canvas: checked off; a discussion is an assignment here
        let lab = items.iter().find(|i| i.title == "Lab 4").unwrap();
        assert_eq!(
            (lab.status, lab.kind, lab.due),
            (Status::Done, ItemKind::Lab, None)
        );
        assert_eq!(
            items.iter().find(|i| i.title == "Intro post").unwrap().kind,
            ItemKind::Assignment
        );
        // again: nothing changes
        let n = import(&mut courses, &mut items, &push(), now, "d");
        assert_eq!((n.added, n.updated, n.unchanged), (0, 0, 4));
    }

    #[test]
    fn an_app_item_already_here_wins() {
        let now = at();
        let (mut courses, mut items) = (Vec::new(), Vec::new());
        let mut ww = Item::new("Homework 3", ItemKind::Assignment, now, "d");
        ww.id = stable_id("webwork", "math4B-01-f26-x/Homework_3");
        items.push(ww);
        import(&mut courses, &mut items, &push(), now, "d");
        assert_eq!(items.iter().filter(|i| i.title == "Homework 3").count(), 1);
    }

    #[test]
    fn modes_include_and_exclude_known_classes() {
        let now = at();
        let mut c = Course::new("cmpsc130a", "CMPSC 130A");
        c.canvas_id = Some("11".into());
        let mut courses = vec![c];
        import(&mut courses, &mut Vec::new(), &push(), now, "d");
        assert!(!courses[0].included, "ghosted in PocketCanvas");
        let mut p = push();
        p.courses[1].mode = None;
        import(&mut courses, &mut Vec::new(), &p, now, "d");
        assert!(!courses[0].included, "automatic keeps your choice here");
    }

    fn pa3() -> SourceRef {
        SourceRef {
            adapter: "canvas".into(),
            external_id: "event-assignment-300".into(),
        }
    }

    /// PA 3 in the ghosted CMPSC 130A, sent with a date, an estimate, a priority and a note.
    fn one(due: Option<&str>) -> Send {
        let mut p = push();
        Send {
            host: p.host.clone(),
            course: Some(p.courses.remove(1)),
            work: PushWork {
                adapter: "canvas".into(),
                external_id: "event-assignment-300".into(),
                course: Some("11".into()),
                title: "PA 3".into(),
                kind: "assignment".into(),
                due: due.map(|d| DateTime::parse_from_rfc3339(d).unwrap().with_timezone(&Utc)),
                due_from: due.map(|_| "mine".into()),
                url: Some("https://canvas.ucsb.edu/courses/11/assignments/300".into()),
                ..Default::default()
            },
            est_minutes: Some(120),
            priority: Some(2),
            notes: Some("  read the spec first \n".into()),
        }
    }

    #[test]
    fn sends_one_piece_of_work() {
        let now = at();
        let (mut courses, mut items) = (Vec::new(), Vec::new());
        assert!(find(&items, &courses, &[pa3()]).is_none());
        let (s, new) = send(
            &mut courses,
            &mut items,
            &one(Some("2026-11-07T07:59:00Z")),
            now,
            "d",
        )
        .unwrap();
        assert!(new);
        assert_eq!(s.id, stable_id("canvas", "event-assignment-300"));
        assert_eq!(
            (
                s.est_minutes,
                s.priority,
                s.notes.as_str(),
                s.course.as_deref(),
                s.shown,
                s.done
            ),
            (
                Some(120),
                2,
                "read the spec first",
                Some("CMPSC 130A"),
                true,
                false
            )
        );
        assert!(s.due.is_some());
        // its class is made for it, and sending doesn't leave it out
        assert_eq!(courses.len(), 1);
        assert!(courses[0].included);
        // a push (130A ghosted there) leaves out the class but keeps what you added
        let mut p = push();
        p.work.push(one(Some("2026-11-07T07:59:00Z")).work);
        import(&mut courses, &mut items, &p, now, "d");
        let f = find(&items, &courses, &[pa3()]).unwrap();
        assert_eq!((f.est_minutes, f.priority, f.shown), (Some(120), 2, false));
        // sent again: an estimate of 0 clears it, None leaves the rest, the class stays left out
        let mut again = one(None);
        (again.est_minutes, again.priority, again.notes) = (Some(0), None, None);
        let (s, new) = send(&mut courses, &mut items, &again, now, "d").unwrap();
        assert!(!new);
        assert_eq!(
            (s.est_minutes, s.priority, s.notes.as_str(), s.due),
            (None, 2, "read the spec first", None)
        );
        assert!(
            !courses
                .iter()
                .find(|c| c.code == "CMPSC 130A")
                .unwrap()
                .included
        );
        assert_eq!(items.iter().filter(|i| i.title == "PA 3").count(), 1);
    }

    #[test]
    fn sending_brings_back_a_deleted_item_and_fills_an_app_item() {
        let now = at();
        let (mut courses, mut items) = (Vec::new(), Vec::new());
        send(&mut courses, &mut items, &one(None), now, "d").unwrap();
        items[0].deleted = true;
        assert!(find(&items, &courses, &[pa3()]).is_none());
        let (_, new) = send(&mut courses, &mut items, &one(None), now, "d").unwrap();
        assert!(new);
        assert_eq!((items.len(), items[0].deleted), (1, false));
        // Homework 3's date came from WeBWorK, and Collegiapp has the WeBWorK item: that one gets it
        let mut ww = Item::new("Homework 3", ItemKind::Assignment, now, "d");
        ww.id = stable_id("webwork", "math4B-01-f26-x/Homework_3");
        let mut items = vec![ww];
        let s = Send {
            work: push().work.remove(0),
            ..one(None)
        };
        let (got, new) = send(&mut courses, &mut items, &s, now, "d").unwrap();
        assert!(!new);
        assert_eq!(
            (got.id, items.len(), items[0].priority),
            (items[0].id, 1, 2)
        );
        // nothing to send
        let empty = Send {
            work: PushWork::default(),
            ..one(None)
        };
        assert!(send(&mut courses, &mut items, &empty, now, "d").is_none());
    }

    /// Grade columns and notices as Canvas lists them (assignments with nothing to turn in and
    /// no date, sent as exams for their titles), and one homework Canvas says you turn in.
    fn columns() -> Push {
        let w = |id: &str, title: &str| PushWork {
            adapter: "canvas".into(),
            external_id: format!("event-assignment-{id}"),
            title: title.into(),
            kind: "exam".into(),
            ..Default::default()
        };
        Push {
            host: "canvas.ucsb.edu".into(),
            courses: Vec::new(),
            work: vec![
                w("1", "Final course grade (with bonus)"),
                w("2", "Max( Midterm1, Avg(Midterm2, Final) ) (15%)"),
                w("3", "Midterm 1 (FYI)"),
                w("4", "Midterm 2 (25%)"),
                PushWork {
                    kind: "assignment".into(),
                    to_do: true,
                    ..w("5", "Homework 6")
                },
            ],
        }
    }

    fn kind_and_status(items: &[Item], title: &str) -> (ItemKind, Status) {
        let it = items.iter().find(|i| i.title == title).unwrap();
        (it.kind, it.status)
    }

    #[test]
    fn only_sure_work_keeps_its_kind() {
        let now = at();
        let (mut courses, mut items) = (Vec::new(), Vec::new());
        import(&mut courses, &mut items, &columns(), now, "d");
        let got = |items: &[Item], t: &str| kind_and_status(items, t);
        assert_eq!(
            got(&items, "Final course grade (with bonus)"),
            (ItemKind::Info, Status::Todo)
        );
        assert_eq!(
            got(&items, "Max( Midterm1, Avg(Midterm2, Final) ) (15%)"),
            (ItemKind::Info, Status::Todo)
        );
        assert_eq!(
            got(&items, "Midterm 1 (FYI)"),
            (ItemKind::Info, Status::Todo)
        );
        assert_eq!(
            got(&items, "Midterm 2 (25%)"),
            (ItemKind::Info, Status::Inbox),
            "not sure: yours to sort"
        );
        assert_eq!(
            got(&items, "Homework 6"),
            (ItemKind::Assignment, Status::Todo)
        );
        // you say Midterm 2 is an exam, and the next push keeps it
        let mt2 = items
            .iter_mut()
            .find(|i| i.title == "Midterm 2 (25%)")
            .unwrap();
        (mt2.kind, mt2.status) = (ItemKind::Exam, Status::Todo);
        let n = import(&mut courses, &mut items, &columns(), now, "d");
        assert_eq!((n.updated, n.unchanged), (0, 5));
        assert_eq!(
            got(&items, "Midterm 2 (25%)"),
            (ItemKind::Exam, Status::Todo)
        );
    }

    #[test]
    fn exams_imported_before_are_sorted_again() {
        let now = at();
        let (mut courses, mut items) = (Vec::new(), Vec::new());
        import(&mut courses, &mut items, &columns(), now, "d");
        // as an older Collegiapp left them: exams, to do, with no kind recorded from the reader
        for it in &mut items {
            if it.kind == ItemKind::Info {
                (it.kind, it.status, it.source.kind) = (ItemKind::Exam, Status::Todo, None);
            }
        }
        items[2].status = Status::Done;
        import(&mut courses, &mut items, &columns(), now, "d");
        assert_eq!(
            kind_and_status(&items, "Midterm 2 (25%)"),
            (ItemKind::Info, Status::Inbox)
        );
        assert_eq!(
            kind_and_status(&items, "Final course grade (with bonus)"),
            (ItemKind::Info, Status::Todo)
        );
        assert_eq!(
            kind_and_status(&items, "Midterm 1 (FYI)"),
            (ItemKind::Info, Status::Done),
            "what you checked off stays checked off"
        );
    }

    #[test]
    fn short_codes() {
        assert_eq!(short_code("MATH 4B F26"), "MATH 4B");
        assert_eq!(short_code("CMPSC 130A - Data Structures"), "CMPSC 130A");
        assert_eq!(short_code("Writing 2"), "Writing 2");
        assert_eq!(short_code("Intro Seminar"), "Intro Seminar");
    }
}
