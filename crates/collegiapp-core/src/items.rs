//! Everything on the list that isn't a note, for an assistant connected over the bridge
//! (`/v1/items`, src-tauri/src/bridge.rs; the client is `integrations/claude-desktop`): search
//! tasks, assignments, exams, classes and events, read one, add an event or a task with real
//! times, change it, mark it done or delete it. Notes have their own door ([`crate::notes`]).
//!
//! Times travel as text: an RFC 3339 time (`2026-11-04T14:00:00-08:00`) or a local one without an
//! offset (`2026-11-04T14:00`), read in the computer's time zone. An empty string clears a time.

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::filter::{run_query, Ctx};
use crate::model::{Course, Item, ItemKind, Sort, Status};
use crate::notes::class_id;

/// How long the notes of a row are, in characters, in a list.
const PREVIEW: usize = 200;

/// An item as a list shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Row {
    pub id: Uuid,
    pub title: String,
    pub kind: &'static str,
    pub status: Status,
    /// The class's code ("CMPSC 130A").
    pub class: Option<String>,
    /// When it is due; for a class or event, when it starts.
    pub due: Option<DateTime<Utc>>,
    pub end: Option<DateTime<Utc>>,
    pub location: Option<String>,
    pub tags: Vec<String>,
    pub priority: u8,
    pub est_minutes: Option<u32>,
    /// Where it came from: "manual", "canvas", "gcal", "gcalev", "gradescope" ...
    pub source: String,
    pub notes: String,
    pub links: Vec<String>,
}

/// An item to add. `due` is the start for a class or event.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct NewItem {
    pub title: String,
    /// A kind name; "event" when it has a start and nothing says otherwise, else "task".
    pub kind: Option<String>,
    pub class: Option<String>,
    pub due: Option<String>,
    pub end: Option<String>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub tags: Vec<String>,
    pub priority: Option<u8>,
    pub est_minutes: Option<u32>,
}

/// A change to an item: only what is set changes. A time or `class` or `location` set to an
/// empty string is cleared.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Change {
    pub title: Option<String>,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub class: Option<String>,
    pub due: Option<String>,
    pub end: Option<String>,
    pub location: Option<String>,
    /// Replaces the item's notes.
    pub notes: Option<String>,
    /// Added to the end of its notes.
    pub append_notes: Option<String>,
    pub add_tags: Vec<String>,
    pub remove_tags: Vec<String>,
    pub priority: Option<u8>,
    /// 0 clears it.
    pub est_minutes: Option<u32>,
    /// Delete it (it goes to the trash).
    pub delete: bool,
}

/// Read a time: RFC 3339, or `YYYY-MM-DDTHH:MM[:SS]` / `YYYY-MM-DD HH:MM` in `tz`, or a bare date
/// (the end of that day, 23:59, as the app dates work). Empty is `None`.
pub fn parse_time<Tz: TimeZone>(s: &str, tz: &Tz) -> Result<Option<DateTime<Utc>>, String> {
    let s = s.trim();
    if s.is_empty() {
        return Ok(None);
    }
    if let Ok(t) = DateTime::parse_from_rfc3339(s) {
        return Ok(Some(t.with_timezone(&Utc)));
    }
    let naive = ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"]
        .iter()
        .find_map(|f| NaiveDateTime::parse_from_str(s, f).ok())
        .or_else(|| {
            NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .ok()
                .map(|d| d.and_time(NaiveTime::from_hms_opt(23, 59, 0).expect("valid")))
        })
        .ok_or_else(|| {
            format!("can't read the time \"{s}\"; write it like 2026-11-04T14:00 or 2026-11-04T14:00:00-08:00")
        })?;
    tz.from_local_datetime(&naive)
        .earliest()
        .map(|t| Some(t.with_timezone(&Utc)))
        .ok_or_else(|| format!("\"{s}\" doesn't exist in this time zone (a clock change skips it)"))
}

fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn kind_of(name: &str) -> Result<ItemKind, String> {
    ItemKind::from_name(name).ok_or_else(|| {
        let all: Vec<&str> = ItemKind::ALL.iter().map(|k| k.as_str()).collect();
        format!("no kind called \"{name}\" ({})", all.join(", "))
    })
}

fn tag(t: &str) -> String {
    t.trim()
        .trim_start_matches('#')
        .trim()
        .replace(char::is_whitespace, "-")
}

fn add_tags(tags: &mut Vec<String>, more: &[String]) {
    for t in more.iter().map(|t| tag(t)).filter(|t| !t.is_empty()) {
        if !tags.iter().any(|x| x.eq_ignore_ascii_case(&t)) {
            tags.push(t);
        }
    }
}

pub fn is_item(it: &Item) -> bool {
    !it.deleted && it.kind != ItemKind::Note
}

/// Items matching `query` (the filter grammar: words, `kind:event`, `due:today`, `course:130a`,
/// `status:todo` ...), notes left out. Open ones only unless `all`; the soonest first.
pub fn list(
    items: &[Item],
    courses: &[Course],
    query: &str,
    all: bool,
    limit: usize,
    now: DateTime<FixedOffset>,
) -> Vec<Row> {
    let q = format!(
        "-kind:note{} {}",
        if all { "" } else { " is:open" },
        query.trim()
    );
    let ctx = Ctx { now, courses };
    let mut rows: Vec<Item> = run_query(items, &q, Sort::Due, &ctx)
        .into_iter()
        .map(|r| r.item)
        .collect();
    // undated last; the rest in time order
    rows.sort_by_key(|it| (it.due.is_none(), it.due));
    rows.iter().take(limit).map(|it| row(it, courses)).collect()
}

pub fn row(it: &Item, courses: &[Course]) -> Row {
    Row {
        id: it.id,
        title: it.title.clone(),
        kind: it.kind.as_str(),
        status: it.status,
        class: it
            .course_id
            .as_deref()
            .and_then(|id| courses.iter().find(|c| c.id == id))
            .map(|c| c.code.clone()),
        due: it.due,
        end: it.end,
        location: it.location.clone(),
        tags: it.tags.clone(),
        priority: it.priority,
        est_minutes: it.est_minutes,
        source: it.source.adapter.clone(),
        notes: it.notes.clone(),
        links: it.links.iter().map(|l| l.url.clone()).collect(),
    }
}

/// A row with its notes cut for a list.
pub fn brief(mut r: Row) -> Row {
    r.notes = clip(&r.notes, PREVIEW);
    r
}

pub fn create<Tz: TimeZone>(
    n: &NewItem,
    courses: &[Course],
    tz: &Tz,
    now: DateTime<Utc>,
    device: &str,
) -> Result<Item, String> {
    let title = n.title.trim();
    if title.is_empty() {
        return Err("it needs a title".into());
    }
    let due = n.due.as_deref().map(|t| parse_time(t, tz)).transpose()?.flatten();
    let end = n.end.as_deref().map(|t| parse_time(t, tz)).transpose()?.flatten();
    let kind = match n.kind.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        Some(k) => kind_of(k)?,
        None if due.is_some() && end.is_some() => ItemKind::Event,
        None => ItemKind::Task,
    };
    if kind == ItemKind::Note {
        return Err("make notes with create_note".into());
    }
    if let (Some(d), Some(e)) = (due, end) {
        if e < d {
            return Err("it ends before it starts".into());
        }
    }
    let mut it = Item::new(title, kind, now, device);
    it.due = due;
    it.end = end.or_else(|| {
        // an event with a start and no end runs an hour
        (kind.is_scheduled() && due.is_some()).then(|| due.expect("some") + chrono::Duration::hours(1))
    });
    it.location = n.location.as_deref().map(str::trim).filter(|l| !l.is_empty()).map(String::from);
    it.notes = n.notes.clone().unwrap_or_default();
    it.priority = n.priority.unwrap_or(0).min(3);
    it.est_minutes = n.est_minutes.filter(|m| *m > 0);
    if let Some(c) = n.class.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        it.course_id = Some(class_id(c, courses)?);
    }
    add_tags(&mut it.tags, &n.tags);
    Ok(it)
}

/// Apply `c` to `it`. Returns whether anything changed; a delete is the caller's (it tombstones
/// and keeps the old version in the trash).
pub fn edit<Tz: TimeZone>(
    it: &mut Item,
    c: &Change,
    courses: &[Course],
    tz: &Tz,
) -> Result<bool, String> {
    let before = it.clone();
    if let Some(t) = c.title.as_deref().map(str::trim) {
        if t.is_empty() {
            return Err("the title can't be empty".into());
        }
        it.title = t.to_string();
    }
    if let Some(k) = c.kind.as_deref() {
        let k = kind_of(k)?;
        if k == ItemKind::Note || it.kind == ItemKind::Note {
            return Err("notes are changed with update_note".into());
        }
        it.kind = k;
    }
    if let Some(s) = c.status.as_deref() {
        it.status = Status::from_name(s)
            .ok_or_else(|| format!("no status called \"{s}\" (inbox, todo, doing, done, dropped)"))?;
    }
    if let Some(cl) = c.class.as_deref() {
        it.course_id = if cl.trim().is_empty() { None } else { Some(class_id(cl, courses)?) };
    }
    if let Some(t) = c.due.as_deref() {
        it.due = parse_time(t, tz)?;
    }
    if let Some(t) = c.end.as_deref() {
        it.end = parse_time(t, tz)?;
    }
    if let (Some(d), Some(e)) = (it.due, it.end) {
        if e < d {
            return Err("it would end before it starts".into());
        }
    }
    if let Some(l) = c.location.as_deref() {
        it.location = Some(l.trim().to_string()).filter(|l| !l.is_empty());
    }
    if let Some(n) = &c.notes {
        it.notes = n.clone();
    }
    if let Some(a) = c.append_notes.as_deref().filter(|a| !a.trim().is_empty()) {
        if !it.notes.is_empty() {
            it.notes.push_str("\n\n");
        }
        it.notes.push_str(a.trim_end());
    }
    add_tags(&mut it.tags, &c.add_tags);
    for t in c.remove_tags.iter().map(|t| tag(t)) {
        it.tags.retain(|x| !x.eq_ignore_ascii_case(&t));
    }
    if let Some(p) = c.priority {
        it.priority = p.min(3);
    }
    if let Some(m) = c.est_minutes {
        it.est_minutes = Some(m).filter(|m| *m > 0);
    }
    Ok(*it != before)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pst() -> FixedOffset {
        FixedOffset::west_opt(8 * 3600).unwrap()
    }
    fn now() -> DateTime<Utc> {
        "2026-11-04T00:00:00Z".parse().unwrap()
    }

    #[test]
    fn times_read_in_the_local_zone() {
        let t = parse_time("2026-11-04T14:00", &pst()).unwrap().unwrap();
        assert_eq!(t, "2026-11-04T22:00:00Z".parse::<DateTime<Utc>>().unwrap());
        let t = parse_time("2026-11-04T14:00:00-05:00", &pst()).unwrap().unwrap();
        assert_eq!(t, "2026-11-04T19:00:00Z".parse::<DateTime<Utc>>().unwrap());
        assert_eq!(parse_time("", &pst()).unwrap(), None);
        assert!(parse_time("2pm", &pst()).is_err());
    }

    #[test]
    fn an_event_with_a_start_and_end_is_an_event() {
        let n = NewItem {
            title: "Meeting with OBSD".into(),
            due: Some("2026-11-04T14:00".into()),
            end: Some("2026-11-04T14:30".into()),
            tags: vec!["#advising".into()],
            ..Default::default()
        };
        let it = create(&n, &[], &pst(), now(), "dev").unwrap();
        assert_eq!(it.kind, ItemKind::Event);
        assert_eq!(it.tags, vec!["advising"]);
        assert_eq!(it.end.unwrap() - it.due.unwrap(), chrono::Duration::minutes(30));
        assert!(create(&NewItem::default(), &[], &pst(), now(), "dev").is_err());
    }

    #[test]
    fn edits_change_only_what_is_set() {
        let mut it = Item::new("Problem set", ItemKind::Assignment, now(), "dev");
        let c = Change {
            status: Some("done".into()),
            append_notes: Some("turned in".into()),
            due: Some("2026-11-05T23:59".into()),
            ..Default::default()
        };
        assert!(edit(&mut it, &c, &[], &pst()).unwrap());
        assert_eq!(it.status, Status::Done);
        assert_eq!(it.notes, "turned in");
        assert_eq!(it.title, "Problem set");
        assert!(!edit(&mut it, &Change::default(), &[], &pst()).unwrap());
        let bad = Change { due: Some("soon".into()), ..Default::default() };
        assert!(edit(&mut it, &bad, &[], &pst()).is_err());
    }

    #[test]
    fn lists_leave_out_notes_and_show_the_soonest_first() {
        let mut later = Item::new("Dinner", ItemKind::Event, now(), "dev");
        later.due = Some(now() + chrono::Duration::days(2));
        let mut sooner = Item::new("Brunch", ItemKind::Event, now(), "dev");
        sooner.due = Some(now() + chrono::Duration::hours(30));
        let note = Item::new("Brunch ideas", ItemKind::Note, now(), "dev");
        let items = vec![later, note, sooner];
        let rows = list(&items, &[], "", false, 10, now().with_timezone(&pst()));
        let titles: Vec<&str> = rows.iter().map(|r| r.title.as_str()).collect();
        assert_eq!(titles, vec!["Brunch", "Dinner"]);
        let found = list(&items, &[], "dinner", false, 10, now().with_timezone(&pst()));
        assert_eq!(found.len(), 1);
    }
}
