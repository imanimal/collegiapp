//! Gradescope adapter: Gradescope has no API and no calendar feed, so the app reads the pages a
//! signed-in student sees. `/account` lists your courses (`a.courseBox` links under
//! `.courseList--term` headings, student and instructor courses under `.pageHeading`s) and
//! `/courses/<id>` lists a course's assignments, one table row each: the name cell (a link to
//! your submission, a `button.js-submitAssignment[data-assignment-id]`, or plain text once
//! closed), the status cell ("No Submission", "Submitted", or a score "8.0 / 10.0") and
//! `time.submissionTimeChart--releaseDate` / `--dueDate` (the second `--dueDate` is the late
//! due date) whose `datetime` reads "2026-10-28 23:59:00 -0700".
//!
//! This module only parses those pages and maps them to items and courses; the app shell
//! fetches them with your session (src-tauri/src/gradescope.rs). Ids are stable per
//! course/assignment, so re-imports keep your edits ([`crate::merge_imported`]).

use chrono::{DateTime, FixedOffset, Utc};
use serde::{Deserialize, Serialize};

use crate::model::{
    course_in_text, normalize_token, stable_id, Course, Item, ItemKind, Link, Source, Status,
};
use crate::quickadd::kind_hint;

pub const BASE: &str = "https://www.gradescope.com";
pub const ADAPTER: &str = "gradescope";

/// One course from the account page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GsCourse {
    /// Gradescope's course id ("123456").
    pub id: String,
    /// "CMPSC 16"
    pub short_name: String,
    /// "Problem Solving with Computers I"
    pub name: String,
    /// "Fall 2026"
    pub term: String,
}

impl GsCourse {
    pub fn url(&self) -> String {
        format!("{BASE}/courses/{}", self.id)
    }
}

/// One assignment row of a course page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GsAssignment {
    /// None for a closed assignment you never submitted (its name is plain text).
    pub id: Option<String>,
    pub name: String,
    pub release: Option<DateTime<Utc>>,
    pub due: Option<DateTime<Utc>>,
    pub late_due: Option<DateTime<Utc>>,
    /// The status cell as shown: "No Submission", "Submitted", "8.0 / 10.0".
    pub status: String,
    /// (points, out of) once graded.
    pub score: Option<(f32, f32)>,
}

impl GsAssignment {
    /// Something was turned in (graded or not).
    pub fn submitted(&self) -> bool {
        let s = self.status.to_lowercase();
        self.score.is_some() || (s.contains("submitted") && !s.contains("no submission"))
    }
}

// ─── a small HTML scanner: enough for Gradescope's server-rendered pages (and WeBWorK's) ───

pub(crate) struct Tag<'a> {
    /// Lower-case element name.
    pub(crate) name: String,
    /// The text between `<` and `>`.
    pub(crate) raw: &'a str,
    /// Byte offset just past `>`.
    pub(crate) end: usize,
    pub(crate) closing: bool,
}

/// Tags from `from` on, skipping comments and the insides of `<script>` and `<style>`.
pub(crate) fn tags(html: &str, from: usize) -> impl Iterator<Item = Tag<'_>> {
    let b = html.as_bytes();
    let mut i = from;
    std::iter::from_fn(move || loop {
        let lt = i + html.get(i..)?.find('<')?;
        if html[lt..].starts_with("<!--") {
            i = html[lt..].find("-->").map_or(html.len(), |e| lt + e + 3);
            continue;
        }
        let closing = b.get(lt + 1) == Some(&b'/');
        let ns = lt + 1 + closing as usize;
        let ne = ns
            + html[ns..]
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
                .unwrap_or(html.len() - ns);
        if ne == ns {
            i = lt + 1;
            continue;
        }
        // find the closing '>' outside quotes
        let (mut j, mut quote) = (ne, None::<u8>);
        while j < b.len() {
            match (quote, b[j]) {
                (None, b'"' | b'\'') => quote = Some(b[j]),
                (Some(q), c) if c == q => quote = None,
                (None, b'>') => break,
                _ => {}
            }
            j += 1;
        }
        let name = html[ns..ne].to_ascii_lowercase();
        let end = (j + 1).min(html.len());
        i = end;
        if !closing && (name == "script" || name == "style") {
            let close = format!("</{name}");
            i = html[end..]
                .to_ascii_lowercase()
                .find(&close)
                .map_or(html.len(), |e| end + e);
        }
        return Some(Tag {
            name,
            raw: &html[lt + 1..j.min(html.len())],
            end,
            closing,
        });
    })
}

/// An attribute's decoded value.
pub(crate) fn attr(raw: &str, key: &str) -> Option<String> {
    let b = raw.as_bytes();
    let mut i = raw.find(|c: char| c.is_whitespace())?;
    while i < b.len() {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') {
            i += 1;
        }
        let ks = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' {
            i += 1;
        }
        let k = &raw[ks..i];
        let mut v = "";
        if b.get(i) == Some(&b'=') {
            i += 1;
            match b.get(i) {
                Some(&q @ (b'"' | b'\'')) => {
                    let vs = i + 1;
                    let ve = raw[vs..].find(q as char).map_or(raw.len(), |e| vs + e);
                    v = &raw[vs..ve];
                    i = ve + 1;
                }
                _ => {
                    let vs = i;
                    while i < b.len() && !b[i].is_ascii_whitespace() {
                        i += 1;
                    }
                    v = &raw[vs..i];
                }
            }
        }
        if !k.is_empty() && k.eq_ignore_ascii_case(key) {
            return Some(decode(v));
        }
    }
    None
}

pub(crate) fn has_class(raw: &str, class: &str) -> bool {
    attr(raw, "class").is_some_and(|c| c.split_whitespace().any(|x| x == class))
}

/// Decode the entities Gradescope's pages use (named basics and numeric).
pub(crate) fn decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        // an entity is short: look for its ';' in the next few bytes (by byte, so a multi-byte
        // character there can't split the slice)
        let Some(semi) = rest.bytes().take(12).position(|b| b == b';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..semi];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            "mdash" => Some('\u{2014}'),
            "ndash" => Some('\u{2013}'),
            "hellip" => Some('\u{2026}'),
            "middot" => Some('\u{b7}'),
            "lsquo" => Some('\u{2018}'),
            "rsquo" => Some('\u{2019}'),
            "ldquo" => Some('\u{201c}'),
            "rdquo" => Some('\u{201d}'),
            _ => ent
                .strip_prefix("#x")
                .or_else(|| ent.strip_prefix("#X"))
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| ent.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The inner HTML of the element whose start tag ends at `tag.end`: up to its matching close
/// tag (same-name nesting counted), or the end of the document.
pub(crate) fn inner<'a>(html: &'a str, tag: &Tag) -> &'a str {
    let mut depth = 0;
    for t in tags(html, tag.end) {
        if t.name != tag.name {
            continue;
        }
        if !t.closing {
            depth += 1;
        } else if depth == 0 {
            // the close tag starts at `<`, which is raw's start minus one, minus the '/'
            let close = t.raw.as_ptr() as usize - html.as_ptr() as usize - 1;
            return &html[tag.end..close];
        } else {
            depth -= 1;
        }
    }
    &html[tag.end..]
}

/// Visible text: tags dropped, entities decoded, whitespace collapsed.
pub(crate) fn text(fragment: &str) -> String {
    let mut out = String::new();
    let mut last = 0;
    for t in tags(fragment, 0) {
        let start = t.raw.as_ptr() as usize - fragment.as_ptr() as usize - 1;
        out.push_str(&fragment[last..start]);
        out.push(' ');
        last = t.end;
    }
    out.push_str(&fragment[last.min(fragment.len())..]);
    decode(&out)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// The text of the first element in `html` with `class`.
fn class_text(html: &str, class: &str) -> Option<String> {
    tags(html, 0)
        .find(|t| !t.closing && has_class(t.raw, class))
        .map(|t| text(inner(html, &t)))
}

/// "2026-10-28 23:59:00 -0700" (what Gradescope writes), or RFC 3339.
pub fn parse_time(s: &str) -> Option<DateTime<Utc>> {
    let s = s.trim();
    [
        "%Y-%m-%d %H:%M:%S %z",
        "%Y-%m-%d %H:%M:%S%z",
        "%Y-%m-%d %H:%M %z",
    ]
    .iter()
    .find_map(|f| DateTime::<FixedOffset>::parse_from_str(s, f).ok())
    .or_else(|| DateTime::parse_from_rfc3339(s).ok())
    .map(|d| d.with_timezone(&Utc))
}

/// The digits after `key` in `href` ("/courses/12/assignments/34/submissions/5", "assignments/") -> "34".
fn id_after(href: &str, key: &str) -> Option<String> {
    let at = href.find(key)? + key.len();
    let id: String = href[at..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    (!id.is_empty()).then_some(id)
}

/// The sign-in form came back instead of the page: the session is missing or expired.
pub fn is_login_page(html: &str) -> bool {
    tags(html, 0).any(|t| {
        !t.closing
            && t.name == "form"
            && attr(t.raw, "action").is_some_and(|a| a.trim_end_matches('/').ends_with("/login"))
    }) && !html.contains("courseBox")
        && !html.contains("submissionTimeChart")
}

/// Your student courses on the account page, in page order (newest term first).
pub fn parse_courses(html: &str) -> Vec<GsCourse> {
    // a staff account's page starts with its instructor courses
    let mut student = !html.contains("js-createNewCourse");
    let mut term = String::new();
    let mut out: Vec<GsCourse> = Vec::new();
    for t in tags(html, 0).filter(|t| !t.closing) {
        if has_class(t.raw, "pageHeading") {
            let h = text(inner(html, &t)).to_lowercase();
            if h.contains("student") {
                student = true;
            } else if h.contains("instructor") {
                student = false;
            }
        } else if has_class(t.raw, "courseList--term") {
            term = text(inner(html, &t));
        } else if t.name == "a" && has_class(t.raw, "courseBox") && student {
            let Some(id) = attr(t.raw, "href").and_then(|h| id_after(&h, "/courses/")) else {
                continue;
            };
            let body = inner(html, &t);
            let short_name = class_text(body, "courseBox--shortname").unwrap_or_default();
            if short_name.is_empty() || out.iter().any(|c| c.id == id) {
                continue;
            }
            out.push(GsCourse {
                id,
                short_name,
                name: class_text(body, "courseBox--name").unwrap_or_default(),
                term: term.clone(),
            });
        }
    }
    out
}

/// The courses of the newest term (the first on the page): the ones worth importing.
pub fn current_courses(courses: &[GsCourse]) -> Vec<GsCourse> {
    let Some(first) = courses.first() else {
        return Vec::new();
    };
    courses
        .iter()
        .filter(|c| c.term == first.term)
        .cloned()
        .collect()
}

/// The assignment rows of a student's course page.
pub fn parse_assignments(html: &str) -> Vec<GsAssignment> {
    let mut out = Vec::new();
    for tr in tags(html, 0).filter(|t| !t.closing && t.name == "tr") {
        if attr(tr.raw, "class").is_some_and(|c| c.contains("dropzonePreview")) {
            continue;
        }
        let row = inner(html, &tr);
        let cells: Vec<&str> = tags(row, 0)
            .filter(|t| !t.closing && (t.name == "th" || t.name == "td"))
            .map(|t| inner(row, &t))
            .collect();
        let Some(name_cell) = cells.first() else {
            continue;
        };
        let times: Vec<Tag> = tags(row, 0)
            .filter(|t| !t.closing && attr(t.raw, "datetime").is_some())
            .collect();
        let time_of = |class: &str| {
            times
                .iter()
                .filter(|t| has_class(t.raw, class))
                .filter_map(|t| attr(t.raw, "datetime").and_then(|d| parse_time(&d)))
                .collect::<Vec<_>>()
        };
        let dues = time_of("submissionTimeChart--dueDate");
        let id = tags(name_cell, 0).filter(|t| !t.closing).find_map(|t| {
            attr(t.raw, "data-assignment-id")
                .filter(|v| v.chars().all(|c| c.is_ascii_digit()) && !v.is_empty())
                .or_else(|| attr(t.raw, "href").and_then(|h| id_after(&h, "/assignments/")))
        });
        let name = text(name_cell);
        // the header row has neither an id nor dates
        if name.is_empty() || (id.is_none() && dues.is_empty()) {
            continue;
        }
        let status = cells.get(1).map(|c| text(c)).unwrap_or_default();
        let score = status.split_once('/').and_then(|(a, b)| {
            let first = |s: &str| s.split_whitespace().next()?.parse::<f32>().ok();
            Some((first(a.split_whitespace().last()?)?, first(b)?))
        });
        out.push(GsAssignment {
            id,
            name,
            release: time_of("submissionTimeChart--releaseDate").first().copied(),
            due: dues.first().copied(),
            late_due: dues.get(1).copied(),
            status,
            score,
        });
    }
    out
}

/// "CMPSC 16 - F26" -> "CMPSC 16", "CS16" -> "CS 16": words up to the first that has a digit,
/// with a glued number split off.
pub fn course_code(short_name: &str) -> String {
    let mut words: Vec<String> = Vec::new();
    for w in short_name.split_whitespace() {
        let w = w.trim_matches(|c: char| !c.is_alphanumeric());
        if w.is_empty() {
            continue;
        }
        if let Some(d) = w.find(|c: char| c.is_ascii_digit()) {
            if d > 0 && w[..d].chars().all(|c| c.is_alphabetic()) {
                words.push(w[..d].to_string());
                words.push(w[d..].to_string());
            } else {
                words.push(w.to_string());
            }
            break;
        }
        words.push(w.to_string());
    }
    let code = words.join(" ").to_uppercase();
    if code.is_empty() {
        short_name.trim().to_string()
    } else {
        code
    }
}

/// "Fall 2026" -> "F26", "Spring 2027" -> "S27", "Summer 2026" -> "M26" (UCSB's quarter letters).
fn quarter_of(term: &str) -> String {
    let mut w = term.split_whitespace();
    let (Some(season), Some(year)) = (w.next(), w.next()) else {
        return String::new();
    };
    let letter = match season.to_lowercase().as_str() {
        "fall" => "F",
        "winter" => "W",
        "spring" => "S",
        "summer" => "M",
        _ => return String::new(),
    };
    format!(
        "{letter}{}",
        year.get(year.len().saturating_sub(2)..).unwrap_or("")
    )
}

/// The app course for a Gradescope course: one already linked to it, else the one its short
/// name (or full name) names.
pub fn course_for<'a>(gs: &GsCourse, courses: &'a [Course]) -> Option<&'a Course> {
    let url = gs.url();
    courses
        .iter()
        .find(|c| c.links.iter().any(|l| l.url == url))
        .or_else(|| course_in_text(&course_code(&gs.short_name), courses))
        .or_else(|| course_in_text(&gs.short_name, courses))
}

/// A new course for a Gradescope course you have nowhere else, linked to its Gradescope page.
pub fn new_course(gs: &GsCourse, courses: &[Course]) -> Course {
    let code = course_code(&gs.short_name);
    let mut id = normalize_token(&code);
    if courses.iter().any(|c| c.id == id) {
        id = format!("{id}-gs{}", gs.id);
    }
    let mut c = Course::new(&id, &code);
    c.title = gs.name.clone();
    c.quarter = quarter_of(&gs.term);
    c.color = (courses.len() % 6 + 1) as u8;
    c.links.push(gradescope_link(gs));
    c
}

/// The "Gradescope" link to a course page.
pub fn gradescope_link(gs: &GsCourse) -> Link {
    Link {
        label: "Gradescope".into(),
        url: gs.url(),
    }
}

/// The item key of an assignment: "<course>/<assignment>", or "<course>/name:<name>" for a
/// closed assignment without an id.
pub fn external_id(course: &str, a: &GsAssignment) -> String {
    match &a.id {
        Some(id) => format!("{course}/{id}"),
        None => format!("{course}/name:{}", normalize_token(&a.name)),
    }
}

/// Assignments -> items: kind `assignment` (or exam/quiz/lab/project/reading when the name's
/// first kind keyword says so), due at the regular due date, `done` when already submitted,
/// linked to the assignment on Gradescope.
pub fn to_items(
    gs: &GsCourse,
    course_id: Option<&str>,
    assignments: &[GsAssignment],
    now: DateTime<Utc>,
    device: &str,
) -> Vec<Item> {
    assignments
        .iter()
        .map(|a| {
            let kind = match a.name.split_whitespace().find_map(kind_hint) {
                Some(
                    k @ (ItemKind::Exam
                    | ItemKind::Quiz
                    | ItemKind::Lab
                    | ItemKind::Project
                    | ItemKind::Reading),
                ) => k,
                _ => ItemKind::Assignment,
            };
            let ext = external_id(&gs.id, a);
            let url = match &a.id {
                Some(id) => format!("{}/assignments/{id}", gs.url()),
                None => gs.url(),
            };
            let mut it = Item::new(a.name.clone(), kind, now, device);
            it.id = stable_id(ADAPTER, &ext);
            it.status = if a.submitted() {
                Status::Done
            } else {
                Status::Todo
            };
            it.course_id = course_id.map(str::to_string);
            it.due = a.due;
            it.links.push(Link {
                label: "Gradescope".into(),
                url: url.clone(),
            });
            it.source = Source {
                adapter: ADAPTER.into(),
                external_id: Some(ext),
                url: Some(url),
                kind: None,
                said: None,
            };
            it
        })
        .collect()
}

/// Mark done the open items of assignments you submitted since the last check (`newly`:
/// external ids). Only new submissions count, so an item you reopen stays open. Returns how
/// many changed.
pub fn mark_submitted(
    items: &mut [Item],
    newly: &[String],
    now: DateTime<Utc>,
    device: &str,
) -> usize {
    let mut n = 0;
    for it in items.iter_mut().filter(|i| {
        !i.deleted
            && i.source.adapter == ADAPTER
            && matches!(i.status, Status::Inbox | Status::Todo | Status::Doing)
            && i.source
                .external_id
                .as_ref()
                .is_some_and(|e| newly.contains(e))
    }) {
        it.status = Status::Done;
        it.touch(now, device);
        n += 1;
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    const ACCOUNT: &str = r#"<!DOCTYPE html><html><head><script>var x = "<a class='courseBox' href='/courses/1'>";</script></head>
<body><div id="account-show">
<h1 class="pageHeading">Student Courses</h1>
<div class="courseList">
  <div class="courseList--term pageSubheading" role="heading">Fall 2026</div>
  <div class="courseList--coursesForTerm">
    <a class="courseBox" href="/courses/1092837"><h3 class="courseBox--shortname">CMPSC 16 - F26</h3>
      <div class="courseBox--name">Problem Solving with Computers I</div>
      <div class="courseBox--assignments">4 assignments</div></a>
    <a class="courseBox" href="/courses/1092999"><h3 class="courseBox--shortname">MATH 4A</h3>
      <div class="courseBox--name">Linear Algebra &amp; Differential Equations</div></a>
  </div>
  <div class="courseList--term pageSubheading" role="heading">Summer 2026</div>
  <div class="courseList--coursesForTerm">
    <a class="courseBox" href="/courses/990001"><h3 class="courseBox--shortname">CS8</h3>
      <div class="courseBox--name">Intro to CS</div></a>
  </div>
</div></div></body></html>"#;

    const COURSE: &str = r#"<table class="table" id="assignments-student-table" role="table">
<thead><tr role="row"><th class="table--primaryLink" role="columnheader" scope="col">Name</th>
<th role="columnheader">Status</th><th role="columnheader">Released</th><th role="columnheader">Due (PDT)</th></tr></thead>
<tbody>
<tr role="row"><th class="table--primaryLink" role="rowheader" scope="row">
  <a aria-label="View hw01" href="/courses/1092837/assignments/6650001/submissions/310001">hw01</a></th>
  <td class="submissionStatus"><div class="submissionStatus--score">10.0 / 10.0</div></td>
  <td class="submissionTimeChart"><div class="progressBar--caption">
  <time class="submissionTimeChart--releaseDate" datetime="2026-09-30 09:00:00 -0700">Sep 30</time>
  <time class="submissionTimeChart--dueDate" datetime="2026-10-07 23:59:00 -0700">Due Date: Oct 07 at 11:59PM</time>
  <time class="submissionTimeChart--dueDate" datetime="2026-10-09 23:59:00 -0700">Late Due Date: Oct 09</time></div></td></tr>
<tr role="row"><th class="table--primaryLink" role="rowheader" scope="row">
  <button class="js-submitAssignment" data-assignment-id="6650005" data-post-url="/courses/1092837/assignments/6650005/submissions" type="button">lab05 &mdash; Pointers</button></th>
  <td class="submissionStatus submissionStatus-warning"><div class="submissionStatus--text">No Submission</div></td>
  <td class="submissionTimeChart"><time class="submissionTimeChart--releaseDate" datetime="2026-10-29 09:00:00 -0700">Oct 29</time>
  <time class="submissionTimeChart--dueDate" datetime="2026-11-05 23:59:00 -0800">Due Date: Nov 05</time></td></tr>
<tr role="row"><th class="table--primaryLink" role="rowheader" scope="row">
  <a href="/courses/1092837/assignments/6650004/submissions/320000">Midterm 1</a></th>
  <td class="submissionStatus"><div class="submissionStatus--text">Submitted</div></td>
  <td class="submissionTimeChart"><time class="submissionTimeChart--dueDate" datetime="2026-10-22 13:00:00 -0700">Oct 22</time></td></tr>
<tr role="row"><th class="table--primaryLink" role="rowheader" scope="row">hw00</th>
  <td class="submissionStatus"><div class="submissionStatus--text">No Submission</div></td>
  <td class="submissionTimeChart"><time class="submissionTimeChart--dueDate" datetime="2026-09-30 23:59:00 -0700">Sep 30</time></td></tr>
<tr role="row" class="dropzonePreview--fileNameHeader"><td>Uploaded files</td></tr>
</tbody></table>"#;

    #[test]
    fn courses_from_the_account_page() {
        let all = parse_courses(ACCOUNT);
        let ids: Vec<&str> = all.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["1092837", "1092999", "990001"],
            "the script's fake box is skipped"
        );
        assert_eq!(all[0].short_name, "CMPSC 16 - F26");
        assert_eq!(all[0].term, "Fall 2026");
        assert_eq!(all[1].name, "Linear Algebra & Differential Equations");
        let now: Vec<String> = current_courses(&all).into_iter().map(|c| c.id).collect();
        assert_eq!(now, vec!["1092837", "1092999"]);
    }

    #[test]
    fn instructor_courses_are_skipped() {
        let html = r#"<button class="js-createNewCourse">Create</button>
<h1 class="pageHeading">Instructor Courses</h1><div class="courseList"><div class="courseList--term">Fall 2026</div>
<a class="courseBox" href="/courses/5"><h3 class="courseBox--shortname">CS 1L</h3></a></div>
<h2 class="pageHeading">Student Courses</h2><div class="courseList"><div class="courseList--term">Fall 2026</div>
<a class="courseBox" href="/courses/6"><h3 class="courseBox--shortname">CS 24</h3></a></div>"#;
        let ids: Vec<String> = parse_courses(html).into_iter().map(|c| c.id).collect();
        assert_eq!(ids, vec!["6"]);
    }

    #[test]
    fn assignments_from_a_course_page() {
        let a = parse_assignments(COURSE);
        assert_eq!(a.len(), 4, "header and dropzone rows are skipped");
        assert_eq!(a[0].id.as_deref(), Some("6650001"));
        assert_eq!(a[0].name, "hw01");
        assert_eq!(a[0].score, Some((10.0, 10.0)));
        assert_eq!(a[0].release, Some(u("2026-09-30T16:00:00Z")));
        assert_eq!(a[0].due, Some(u("2026-10-08T06:59:00Z")));
        assert_eq!(a[0].late_due, Some(u("2026-10-10T06:59:00Z")));
        assert!(a[0].submitted());
        assert_eq!(a[1].id.as_deref(), Some("6650005"));
        assert_eq!(a[1].name, "lab05 \u{2014} Pointers");
        assert_eq!(a[1].due, Some(u("2026-11-06T07:59:00Z")));
        assert!(!a[1].submitted() && a[1].score.is_none());
        assert!(a[2].submitted() && a[2].score.is_none());
        assert_eq!(a[3].id, None);
        assert_eq!(a[3].status, "No Submission");
    }

    #[test]
    fn items_and_courses() {
        let gs = &parse_courses(ACCOUNT)[0];
        assert_eq!(course_code(&gs.short_name), "CMPSC 16");
        assert_eq!(course_code("CS16"), "CS 16");
        assert_eq!(course_code("PSTAT 120A F26"), "PSTAT 120A");

        // a course you have (from Canvas, or made yourself) is reused, matched by number
        let mine = vec![Course::new("cs16", "CS 16")];
        assert_eq!(course_for(gs, &mine).map(|c| c.id.as_str()), Some("cs16"));
        let c = new_course(gs, &[]);
        assert_eq!(
            (c.id.as_str(), c.code.as_str(), c.quarter.as_str()),
            ("cmpsc16", "CMPSC 16", "F26")
        );
        assert_eq!(c.links[0].url, "https://www.gradescope.com/courses/1092837");
        assert_eq!(
            course_for(gs, std::slice::from_ref(&c)).map(|x| x.id.as_str()),
            Some("cmpsc16")
        );

        let now = u("2026-11-01T20:00:00Z");
        let items = to_items(gs, Some("cmpsc16"), &parse_assignments(COURSE), now, "dev");
        assert_eq!(items[0].status, Status::Done);
        assert_eq!(items[1].status, Status::Todo);
        assert_eq!(items[1].kind, ItemKind::Lab);
        assert_eq!(items[2].kind, ItemKind::Exam);
        assert_eq!(items[0].kind, ItemKind::Assignment);
        assert_eq!(items[1].course_id.as_deref(), Some("cmpsc16"));
        assert_eq!(
            items[1].links[0].url,
            "https://www.gradescope.com/courses/1092837/assignments/6650005"
        );
        assert_eq!(
            items[3].source.external_id.as_deref(),
            Some("1092837/name:hw00")
        );
        // ids are stable across imports
        let again = to_items(gs, Some("cmpsc16"), &parse_assignments(COURSE), now, "dev");
        assert_eq!(items[1].id, again[1].id);

        let mut items = items;
        let ext = items[1].source.external_id.clone().unwrap();
        assert_eq!(
            mark_submitted(&mut items, std::slice::from_ref(&ext), now, "dev"),
            1
        );
        assert_eq!(items[1].status, Status::Done);
        assert_eq!(mark_submitted(&mut items, &[ext], now, "dev"), 0);
    }

    #[test]
    fn text_with_non_ascii_near_an_ampersand() {
        // a byte-indexed cut 12 bytes after '&' landed inside a check mark and crashed the app
        assert_eq!(decode("a & b ✓✓✓✓✓✓"), "a & b ✓✓✓✓✓✓");
        assert_eq!(decode("&#10003;&amp;✓&"), "✓&✓&");
        assert_eq!(text("<b>R&amp;D ✓</b> &mdash;✓✓✓✓"), "R&D ✓ \u{2014}✓✓✓✓");
    }

    #[test]
    fn signed_out() {
        let login = r#"<form action="/login" method="post"><input name="authenticity_token" value="x"></form>"#;
        assert!(is_login_page(login));
        assert!(!is_login_page(ACCOUNT));
        assert!(!is_login_page(COURSE));
    }
}
