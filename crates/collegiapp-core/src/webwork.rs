//! WeBWorK adapter: WeBWorK (2.18 at UCSB, webwork.math.ucsb.edu) has no student API and no
//! calendar feed, so the app reads the page a signed-in student sees. A course's home,
//! `<base>/<course>/`, is its homework list: `table.problem_set_table`, one row per set, whose
//! first cell is the set's name (a link to `<base>/<course>/<set>/`, or plain text before it
//! opens; `_` in the set id shows as a space) and whose second is its status sentence, with
//! dates in WeBWorK's default format "11/05/2026 at 11:59pm PST":
//!
//! - "Will open on D."
//! - "Open, closes D." (or, with reduced scoring, "Open, due D. Afterward reduced credit can be
//!   earned until D2." and later "Due date D has passed. Reduced credit can still be earned
//!   until D2.")
//! - "Closed, answers on D." / "Closed, answers recently available." / "Closed, answers available."
//!
//! A signed-out request gets the sign-in form (`#login_form`) at the same address. Sessions
//! end after 30 minutes without a request (WeBWorK's default).
//!
//! This module only parses that page and maps it to items and courses; the app shell fetches
//! it with your session (src-tauri/src/webwork.rs). Ids are stable per course/set, so
//! re-imports keep your edits ([`crate::merge_imported`]).

use chrono::{
    DateTime, Datelike, Duration, FixedOffset, NaiveDate, NaiveDateTime, TimeZone, Utc, Weekday,
};
use serde::{Deserialize, Serialize};

use crate::gradescope::{attr, has_class, inner, tags, text};
use crate::model::{
    course_in_text, normalize_token, stable_id, Course, Item, ItemKind, Link, Source, Status,
};
use crate::quickadd::kind_hint;

/// UCSB's WeBWorK: where the sign-in window starts (its list of courses).
pub const UCSB: &str = "https://webwork.math.ucsb.edu/webwork2";
pub const ADAPTER: &str = "webwork";

/// One WeBWorK course you signed in to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WwCourse {
    /// "https://webwork.math.ucsb.edu/webwork2"
    pub base: String,
    /// WeBWorK's course id: "math34A-01-f26-blee".
    pub id: String,
    /// "MATH 34A"
    pub code: String,
}

impl WwCourse {
    /// The course of a WeBWorK page address (`https://<host>/webwork2/<course>/...`), if it is one.
    pub fn from_url(url: &str) -> Option<WwCourse> {
        let rest = url.strip_prefix("https://")?;
        let (host, path) = rest.split_once('/')?;
        let path = path.split(['?', '#']).next().unwrap_or("");
        let mut segs = path.split('/');
        if host.is_empty() || segs.next() != Some("webwork2") {
            return None;
        }
        let id = segs.next().filter(|s| !s.is_empty())?;
        let ok = id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
        if !ok || id == "admin" || id.starts_with('.') {
            return None;
        }
        Some(WwCourse {
            base: format!("https://{host}/webwork2"),
            id: id.to_string(),
            code: course_code(id),
        })
    }

    /// The course home: its homework list.
    pub fn url(&self) -> String {
        format!("{}/{}/", self.base, self.id)
    }

    pub fn set_url(&self, set: &str) -> String {
        format!("{}{set}/", self.url())
    }
}

/// One homework set row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WwSet {
    /// WeBWorK's set id: "Homework_5".
    pub id: String,
    /// "Homework 5"
    pub name: String,
    pub opens: Option<DateTime<Utc>>,
    /// Full credit until then ("closes", or "due" when reduced credit follows).
    pub due: Option<DateTime<Utc>>,
    /// The end of reduced credit, when the course allows it.
    pub late_due: Option<DateTime<Utc>>,
    pub closed: bool,
}

impl WwSet {
    /// Open now (or past its due date but still taking reduced credit).
    pub fn open(&self) -> bool {
        !self.closed && self.due.is_some()
    }
}

/// The sign-in form came back instead of the homework list: the session is missing or ended.
pub fn is_login_page(html: &str) -> bool {
    !html.contains("problem_set_table")
        && (html.contains("id=\"login_form\"") || html.contains("external authentication system"))
}

/// The course only opens from Canvas (LTI): its homework list is replaced by a notice.
pub fn lms_only(html: &str) -> bool {
    !html.contains("problem_set_table")
        && html.contains("You must access assignments from your Course Management System")
}

/// The set rows of a course home, in page order.
pub fn parse_sets(html: &str) -> Vec<WwSet> {
    let Some(table) = tags(html, 0)
        .find(|t| !t.closing && t.name == "table" && has_class(t.raw, "problem_set_table"))
    else {
        return Vec::new();
    };
    let table = inner(html, &table);
    let mut out = Vec::new();
    for tr in tags(table, 0).filter(|t| !t.closing && t.name == "tr") {
        let row = inner(table, &tr);
        let cells: Vec<&str> = tags(row, 0)
            .filter(|t| !t.closing && t.name == "td")
            .map(|t| inner(row, &t))
            .collect();
        // the header row has <th>s only
        let (Some(name_cell), Some(status_cell)) = (cells.first(), cells.get(1)) else {
            continue;
        };
        let name = text(name_cell);
        if name.is_empty() {
            continue;
        }
        let from_link = tags(name_cell, 0)
            .filter(|t| !t.closing && t.name == "a")
            .find_map(|t| attr(t.raw, "href"))
            .and_then(|h| set_in_href(&h));
        let id = from_link.unwrap_or_else(|| name.replace(' ', "_"));
        out.push(read_status(id, name, &text(status_cell)));
    }
    out
}

/// "/webwork2/math34A-01-f26-blee/Homework_5/?user=x" -> "Homework_5".
fn set_in_href(href: &str) -> Option<String> {
    let path = href.split(['?', '#']).next()?;
    let path = path.split_once("/webwork2/").map_or(path, |(_, p)| p);
    let set = path.split('/').filter(|s| !s.is_empty()).nth(1)?;
    Some(set.to_string())
}

/// A set from its status sentence (see the module header).
fn read_status(id: String, name: String, status: &str) -> WwSet {
    let mut set = WwSet {
        id,
        name,
        opens: None,
        due: None,
        late_due: None,
        closed: false,
    };
    for sentence in status.split(". ").map(|s| s.trim().trim_end_matches('.')) {
        let lower = sentence.to_lowercase();
        let rest = |at: usize| &sentence[at..];
        if lower.starts_with("will open on ") {
            set.opens = parse_date(rest("will open on ".len()));
        } else if lower.starts_with("open, closes ") {
            set.due = parse_date(rest("open, closes ".len()));
        } else if lower.starts_with("open, due ") {
            set.due = parse_date(rest("open, due ".len()));
        } else if lower.starts_with("due date ") {
            let d = rest("due date ".len());
            set.due = parse_date(d.strip_suffix(" has passed").unwrap_or(d));
        } else if lower.contains("reduced credit") {
            if let Some(at) = lower.rfind(" until ") {
                set.late_due = parse_date(rest(at + " until ".len()));
            }
        } else if lower.starts_with("closed") {
            set.closed = true;
        }
    }
    set
}

/// A date as WeBWorK prints it: "11/05/2026 at 11:59pm PST" (the default), a few locale formats
/// ("November 5, 2026 at 11:59:00 PM PST"), with a US zone abbreviation or a numeric offset.
/// Without a zone it is read as Pacific time.
pub fn parse_date(s: &str) -> Option<DateTime<Utc>> {
    const FORMATS: &[&str] = &[
        "%m/%d/%Y at %I:%M%p",
        "%m/%d/%Y at %I:%M %p",
        "%m/%d/%Y %I:%M%p",
        "%m/%d/%Y %I:%M %p",
        "%B %d, %Y at %I:%M:%S %p",
        "%B %d, %Y at %I:%M %p",
        "%b %d, %Y, %I:%M:%S %p",
        "%b %d, %Y, %I:%M %p",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ];
    let s = s.trim().trim_end_matches('.').trim();
    let naive = |s: &str| {
        let s = s.trim().trim_end_matches(',');
        FORMATS
            .iter()
            .find_map(|f| NaiveDateTime::parse_from_str(s, f).ok())
    };
    let (local, offset) = match s
        .rsplit_once(' ')
        .and_then(|(d, z)| Some((naive(d)?, zone(z)?)))
    {
        Some(found) => found,
        None => {
            let local = naive(s)?;
            (local, pacific_offset(local))
        }
    };
    FixedOffset::east_opt(offset)?
        .from_local_datetime(&local)
        .single()
        .map(|d| d.with_timezone(&Utc))
}

/// Seconds east of UTC for "PST", "PDT", ... or "-0800" / "-08:00".
fn zone(z: &str) -> Option<i32> {
    let h = match z.to_ascii_uppercase().as_str() {
        "UTC" | "GMT" | "Z" => 0,
        "PST" | "AKDT" => -8,
        "PDT" | "MST" => -7,
        "MDT" | "CST" => -6,
        "CDT" | "EST" => -5,
        "EDT" => -4,
        "AKST" => -9,
        "HST" => -10,
        _ => {
            let (sign, rest) = match z.as_bytes().first()? {
                b'+' => (1, &z[1..]),
                b'-' => (-1, &z[1..]),
                _ => return None,
            };
            let digits: String = rest.chars().filter(|c| *c != ':').collect();
            if digits.len() != 4 || !digits.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            let (hh, mm): (i32, i32) = (digits[..2].parse().ok()?, digits[2..].parse().ok()?);
            return Some(sign * (hh * 3600 + mm * 60));
        }
    };
    Some(h * 3600)
}

/// California's offset at a local time: daylight time from the second Sunday of March to the
/// first Sunday of November, 2 a.m.
fn pacific_offset(local: NaiveDateTime) -> i32 {
    let nth_sunday = |month: u32, n: i64| {
        let first = NaiveDate::from_ymd_opt(local.year(), month, 1).expect("valid month");
        let to_sunday = (7 - first.weekday().num_days_from_sunday() as i64) % 7;
        let day = first + Duration::days(to_sunday + 7 * (n - 1));
        debug_assert_eq!(day.weekday(), Weekday::Sun);
        day.and_hms_opt(2, 0, 0).expect("valid time")
    };
    if local >= nth_sunday(3, 2) && local < nth_sunday(11, 1) {
        -7 * 3600
    } else {
        -8 * 3600
    }
}

/// "math34A-01-f26-blee" -> "MATH 34A", "math2a_34a-01-sims24-x" -> "MATH 2A": the subject and
/// number at the start of the course id.
pub fn course_code(id: &str) -> String {
    let first = id.split(['-', '_']).next().unwrap_or(id);
    match first.find(|c: char| c.is_ascii_digit()) {
        Some(d) if d > 0 && first[..d].chars().all(|c| c.is_ascii_alphabetic()) => {
            format!("{} {}", &first[..d], &first[d..]).to_uppercase()
        }
        _ => first.to_uppercase(),
    }
}

/// "math34A-01-f26-blee" -> "F26": the course id's quarter part, if it has one.
fn quarter_of(id: &str) -> String {
    id.split(['-', '_'])
        .find(|p| {
            let b = p.as_bytes();
            b.len() == 3
                && matches!(b[0].to_ascii_lowercase(), b'f' | b'w' | b's' | b'm')
                && b[1..].iter().all(u8::is_ascii_digit)
        })
        .map(str::to_uppercase)
        .unwrap_or_default()
}

/// The app course for a WeBWorK course: one already linked to it, else the one its code names.
pub fn course_for<'a>(ww: &WwCourse, courses: &'a [Course]) -> Option<&'a Course> {
    let url = ww.url();
    courses
        .iter()
        .find(|c| c.links.iter().any(|l| l.url == url))
        .or_else(|| course_in_text(&ww.code, courses))
}

/// A new course for a WeBWorK course you have nowhere else, linked to its WeBWorK page.
pub fn new_course(ww: &WwCourse, courses: &[Course]) -> Course {
    let mut id = normalize_token(&ww.code);
    if courses.iter().any(|c| c.id == id) {
        id = format!("{id}-ww");
    }
    let mut c = Course::new(&id, &ww.code);
    c.quarter = quarter_of(&ww.id);
    c.color = (courses.len() % 6 + 1) as u8;
    c.links.push(webwork_link(ww));
    c
}

/// The "WeBWorK" link to a course's homework list.
pub fn webwork_link(ww: &WwCourse) -> Link {
    Link {
        label: "WeBWorK".into(),
        url: ww.url(),
    }
}

/// The item key of a set: "<course>/<set>".
pub fn external_id(ww: &WwCourse, set: &WwSet) -> String {
    format!("{}/{}", ww.id, set.id)
}

/// Open sets -> items: kind `assignment` (or quiz/exam when the name says so), due at the
/// full-credit date, linked to the set. Sets that haven't opened (no due date shown yet) and
/// closed ones are left out.
pub fn to_items(
    ww: &WwCourse,
    course_id: Option<&str>,
    sets: &[WwSet],
    now: DateTime<Utc>,
    device: &str,
) -> Vec<Item> {
    sets.iter()
        .filter(|s| s.open())
        .map(|s| {
            let kind = match s.name.split_whitespace().find_map(kind_hint) {
                Some(k @ (ItemKind::Exam | ItemKind::Quiz)) => k,
                _ => ItemKind::Assignment,
            };
            let ext = external_id(ww, s);
            let url = ww.set_url(&s.id);
            let mut it = Item::new(s.name.clone(), kind, now, device);
            it.id = stable_id(ADAPTER, &ext);
            it.status = Status::Todo;
            it.course_id = course_id.map(str::to_string);
            it.due = s.due;
            it.links.push(Link {
                label: "WeBWorK".into(),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    /// The set list as WeBWorK 2.18 renders it for a student (ProblemSets.pm's setListRow).
    const HOME: &str = r#"<!DOCTYPE html><html><head><title>WeBWorK : math34A-01-f26-blee</title></head><body>
<div id="page-title"><h1>Homework Sets</h1></div>
<div class="table-responsive">
<table class="problem_set_table table table-sm caption-top font-sm">
<caption>Homework Sets</caption>
<thead class="table-group-divider"><tr><th scope="col"><a href="/webwork2/math34A-01-f26-blee/?sort=name">Name</a></th>
<th scope="col"><span>Status</span></th><th scope="col" class="hardcopy"><i class="icon far fa-arrow-alt-circle-down fa-lg"></i></th></tr></thead>
<tbody class="table-group-divider">
<tr><td dir="ltr"><a href="/webwork2/math34A-01-f26-blee/Homework_5/?user=dobson" class="set-id-tooltip" data-bs-toggle="tooltip" data-bs-placement="right" data-bs-title="Sections 3.1 &amp; 3.2">Homework 5</a></td><td>Open, closes 11/05/2026 at 11:59pm PST.</td><td class="hardcopy"><a class="hardcopy-link" href="/webwork2/math34A-01-f26-blee/hardcopy/Homework_5/?selected_sets=Homework_5"><i class="hardcopy-tooltip icon far fa-arrow-alt-circle-down fa-lg" aria-hidden="true"></i></a></td></tr>
<tr><td dir="ltr"><a href="/webwork2/math34A-01-f26-blee/Homework_4/" class="set-id-tooltip">Homework 4</a></td><td>Open, due 10/30/2026 at 11:59pm PDT.<br>Afterward reduced credit can be earned until 11/02/2026 at 11:59pm PST.</td><td class="hardcopy"></td></tr>
<tr><td dir="ltr"><a href="/webwork2/math34A-01-f26-blee/Quiz_2/" class="set-id-tooltip"><i class="icon far fa-clock" title="Test/quiz with time limit."></i> <span>Quiz 2</span></a></td><td>Due date 10/29/2026 at 11:59pm PDT has passed.<br>Reduced credit can still be earned until 11/03/2026 at 11:59pm PST.</td><td class="hardcopy"></td></tr>
<tr><td dir="ltr">Homework 6</td><td>Will open on 11/06/2026 at 12:00am PST.</td><td class="hardcopy"></td></tr>
<tr><td dir="ltr"><a href="/webwork2/math34A-01-f26-blee/Homework_3/" class="set-id-tooltip">Homework 3</a></td><td>Closed, answers on 11/04/2026 at 12:00am PST.</td><td class="hardcopy"></td></tr>
<tr><td dir="ltr"><a href="/webwork2/math34A-01-f26-blee/Homework_1/" class="set-id-tooltip">Homework 1</a></td><td>Closed, answers available.</td><td class="hardcopy"></td></tr>
</tbody></table></div></body></html>"#;

    const LOGIN: &str = r#"<p>Please enter your username and password for <b>math34A-01-f26-blee</b> below:</p>
<form action="/webwork2/math34A-01-f26-blee/" method="POST" id="login_form"><input name="user" id="uname"><input type="password" name="passwd" id="pswd"></form>"#;

    #[test]
    fn sets_from_the_course_home() {
        let s = parse_sets(HOME);
        let ids: Vec<&str> = s.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "Homework_5",
                "Homework_4",
                "Quiz_2",
                "Homework_6",
                "Homework_3",
                "Homework_1"
            ]
        );
        assert_eq!(s[0].name, "Homework 5");
        assert_eq!(s[0].due, Some(u("2026-11-06T07:59:00Z")));
        assert!(s[0].open() && s[0].late_due.is_none());
        assert_eq!(s[1].due, Some(u("2026-10-31T06:59:00Z")));
        assert_eq!(s[1].late_due, Some(u("2026-11-03T07:59:00Z")));
        assert_eq!(s[2].name, "Quiz 2");
        assert_eq!(s[2].due, Some(u("2026-10-30T06:59:00Z")));
        assert_eq!(s[2].late_due, Some(u("2026-11-04T07:59:00Z")));
        assert!(s[2].open(), "past due but still taking reduced credit");
        assert_eq!(s[3].opens, Some(u("2026-11-06T08:00:00Z")));
        assert!(!s[3].open(), "not open yet: no due date shown");
        assert!(s[4].closed && s[5].closed && !s[4].open());
    }

    #[test]
    fn signed_out_and_lms_only() {
        assert!(is_login_page(LOGIN));
        assert!(!is_login_page(HOME));
        assert!(parse_sets(LOGIN).is_empty());
        let lti = r#"<div class="alert alert-danger"><b>You must access assignments from your Course Management System (<a href="https://canvas.ucsb.edu">Canvas</a>).</b></div>"#;
        assert!(lms_only(lti) && !lms_only(HOME));
    }

    #[test]
    fn dates() {
        assert_eq!(
            parse_date("11/05/2026 at 11:59pm PST"),
            Some(u("2026-11-06T07:59:00Z"))
        );
        assert_eq!(
            parse_date("10/05/2026 at 09:00AM PDT."),
            Some(u("2026-10-05T16:00:00Z"))
        );
        assert_eq!(
            parse_date("November 5, 2026 at 11:59:00 PM PST"),
            Some(u("2026-11-06T07:59:00Z"))
        );
        assert_eq!(
            parse_date("11/05/2026 at 11:59pm -0500"),
            Some(u("2026-11-06T04:59:00Z"))
        );
        // no zone: Pacific, daylight time until the first Sunday of November
        assert_eq!(
            parse_date("10/31/2026 at 11:59pm"),
            Some(u("2026-11-01T06:59:00Z"))
        );
        assert_eq!(
            parse_date("11/02/2026 at 11:59pm"),
            Some(u("2026-11-03T07:59:00Z"))
        );
        assert_eq!(parse_date("soon"), None);
    }

    #[test]
    fn courses_and_items() {
        let ww = WwCourse::from_url(
            "https://webwork.math.ucsb.edu/webwork2/math34A-01-f26-blee/Homework_5/?user=x",
        )
        .unwrap();
        assert_eq!(ww.id, "math34A-01-f26-blee");
        assert_eq!(ww.code, "MATH 34A");
        assert_eq!(
            ww.url(),
            "https://webwork.math.ucsb.edu/webwork2/math34A-01-f26-blee/"
        );
        assert!(WwCourse::from_url("https://webwork.math.ucsb.edu/webwork2/").is_none());
        assert!(WwCourse::from_url("https://webwork.math.ucsb.edu/webwork2/admin/").is_none());
        assert!(WwCourse::from_url("http://webwork.math.ucsb.edu/webwork2/math4a/").is_none());
        assert!(WwCourse::from_url("https://canvas.ucsb.edu/courses/1").is_none());
        assert_eq!(course_code("math2a_34a-01-sims24-barei"), "MATH 2A");
        assert_eq!(course_code("pstat120a-01-f26-x"), "PSTAT 120A");

        // a course you have (from Canvas, or made yourself) is reused, matched by its code
        let mine = vec![Course::new("math34a", "MATH 34A")];
        assert_eq!(
            course_for(&ww, &mine).map(|c| c.id.as_str()),
            Some("math34a")
        );
        let c = new_course(&ww, &[]);
        assert_eq!(
            (c.id.as_str(), c.code.as_str(), c.quarter.as_str()),
            ("math34a", "MATH 34A", "F26")
        );
        assert_eq!(
            course_for(&ww, std::slice::from_ref(&c)).map(|x| x.id.as_str()),
            Some("math34a")
        );

        let now = u("2026-11-01T20:00:00Z");
        let items = to_items(&ww, Some("math34a"), &parse_sets(HOME), now, "dev");
        let titles: Vec<&str> = items.iter().map(|i| i.title.as_str()).collect();
        assert_eq!(titles, vec!["Homework 5", "Homework 4", "Quiz 2"]);
        assert_eq!(items[0].kind, ItemKind::Assignment);
        assert_eq!(items[2].kind, ItemKind::Quiz);
        assert_eq!(items[0].due, Some(u("2026-11-06T07:59:00Z")));
        assert_eq!(items[0].course_id.as_deref(), Some("math34a"));
        assert_eq!(
            items[0].links[0].url,
            "https://webwork.math.ucsb.edu/webwork2/math34A-01-f26-blee/Homework_5/"
        );
        assert_eq!(
            items[0].source.external_id.as_deref(),
            Some("math34A-01-f26-blee/Homework_5")
        );
        let again = to_items(&ww, Some("math34a"), &parse_sets(HOME), now, "dev");
        assert_eq!(items[0].id, again[0].id, "ids are stable across imports");
    }
}
