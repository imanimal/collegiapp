//! Minimal iCalendar (RFC 5545) VEVENT reader + adapters for Canvas and Google Calendar feeds.
//!
//! Supported: line unfolding, text unescaping, nested components (VALARM) skipped,
//! DTSTART/DTEND as UTC (`...Z`), floating or `TZID=` local times (resolved in the caller's
//! time zone `tz` — pass a `FixedOffset` for a fixed default offset, or `chrono::Local` on
//! desktop to get DST right), `VALUE=DATE` all-day events, SUMMARY/UID/LOCATION/URL/
//! DESCRIPTION/STATUS, EXDATE, RECURRENCE-ID overrides, and RRULE `FREQ=WEEKLY` with
//! BYDAY/INTERVAL/UNTIL/COUNT expanded within a window. Other FREQs yield only DTSTART.

use std::collections::BTreeMap;

use chrono::{
    DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc, Weekday,
};
use serde::{Deserialize, Serialize};

use crate::model::{
    canvas_kind, course_in_text, normalize_token, stable_id, Course, InterruptLevel, Item,
    ItemKind, Link, Source, Status,
};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum IcsError {
    #[error("not an iCalendar file (no BEGIN:VCALENDAR)")]
    NotCalendar,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RRule {
    /// Upper-case FREQ value ("WEEKLY").
    pub freq: String,
    pub interval: u32,
    pub by_day: Vec<Weekday>,
    pub until: Option<DateTime<Utc>>,
    pub count: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IcsEvent {
    pub uid: String,
    pub summary: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub url: Option<String>,
    /// STATUS (e.g. "CANCELLED"), upper-case.
    pub status: Option<String>,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub all_day: bool,
    pub rrule: Option<RRule>,
    pub exdates: Vec<DateTime<Utc>>,
    /// Set on an override of one instance of a recurring series (same UID).
    pub recurrence_id: Option<DateTime<Utc>>,
}

fn local_to_utc<Tz: TimeZone>(tz: &Tz, naive: NaiveDateTime) -> DateTime<Utc> {
    tz.from_local_datetime(&naive)
        .earliest()
        // inside a spring-forward gap: shift forward an hour
        .or_else(|| {
            tz.from_local_datetime(&(naive + Duration::hours(1)))
                .earliest()
        })
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|| naive.and_utc())
}

fn utc_to_local<Tz: TimeZone>(tz: &Tz, t: DateTime<Utc>) -> NaiveDateTime {
    t.with_timezone(tz).naive_local()
}

fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        if (raw.starts_with(' ') || raw.starts_with('\t')) && !lines.is_empty() {
            lines.last_mut().expect("non-empty").push_str(&raw[1..]);
        } else {
            lines.push(raw.to_string());
        }
    }
    lines
}

type Params = Vec<(String, String)>;

fn split_line(line: &str) -> Option<(String, Params, String)> {
    let mut in_quote = false;
    let mut colon = None;
    for (i, c) in line.char_indices() {
        if c == '"' {
            in_quote = !in_quote;
        } else if c == ':' && !in_quote {
            colon = Some(i);
            break;
        }
    }
    let colon = colon?;
    let (head, value) = (&line[..colon], &line[colon + 1..]);
    let mut parts = head.split(';');
    let name = parts.next()?.trim().to_ascii_uppercase();
    let params = parts
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| {
            (
                k.trim().to_ascii_uppercase(),
                v.trim_matches('"').to_string(),
            )
        })
        .collect();
    Some((name, params, value.to_string()))
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') | Some('N') => out.push('\n'),
            Some(',') => out.push(','),
            Some(';') => out.push(';'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

fn param<'a>(params: &'a Params, key: &str) -> Option<&'a str> {
    params
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

/// Parse a DATE or DATE-TIME value. Returns (instant, is_all_day).
fn parse_dt<Tz: TimeZone>(value: &str, params: &Params, tz: &Tz) -> Option<(DateTime<Utc>, bool)> {
    let v = value.trim();
    let is_date = param(params, "VALUE").is_some_and(|x| x.eq_ignore_ascii_case("DATE"))
        || (v.len() == 8 && v.bytes().all(|b| b.is_ascii_digit()));
    if is_date {
        let d = NaiveDate::parse_from_str(v.get(..8)?, "%Y%m%d").ok()?;
        return Some((local_to_utc(tz, d.and_time(NaiveTime::MIN)), true));
    }
    if let Some(z) = v.strip_suffix('Z').or_else(|| v.strip_suffix('z')) {
        let n = NaiveDateTime::parse_from_str(z, "%Y%m%dT%H%M%S").ok()?;
        return Some((n.and_utc(), false));
    }
    let n = NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S").ok()?;
    Some((local_to_utc(tz, n), false))
}

fn parse_weekday(s: &str) -> Option<Weekday> {
    // BYDAY entries may carry an ordinal prefix ("1MO", "-1FR"); weekly rules ignore it.
    let code = s
        .trim()
        .trim_start_matches(|c: char| c == '+' || c == '-' || c.is_ascii_digit());
    Some(match code.to_ascii_uppercase().as_str() {
        "MO" => Weekday::Mon,
        "TU" => Weekday::Tue,
        "WE" => Weekday::Wed,
        "TH" => Weekday::Thu,
        "FR" => Weekday::Fri,
        "SA" => Weekday::Sat,
        "SU" => Weekday::Sun,
        _ => return None,
    })
}

fn parse_rrule<Tz: TimeZone>(value: &str, tz: &Tz) -> Option<RRule> {
    let mut rr = RRule {
        freq: String::new(),
        interval: 1,
        by_day: Vec::new(),
        until: None,
        count: None,
    };
    for part in value.split(';') {
        let Some((k, v)) = part.split_once('=') else {
            continue;
        };
        match k.trim().to_ascii_uppercase().as_str() {
            "FREQ" => rr.freq = v.trim().to_ascii_uppercase(),
            "INTERVAL" => rr.interval = v.trim().parse().unwrap_or(1).max(1),
            "COUNT" => rr.count = v.trim().parse().ok(),
            "BYDAY" => rr.by_day = v.split(',').filter_map(parse_weekday).collect(),
            "UNTIL" => {
                let (t, all_day) = parse_dt(v, &Vec::new(), tz)?;
                // a date-only UNTIL is inclusive of that whole (local) day
                rr.until = Some(if all_day {
                    let d = utc_to_local(tz, t).date();
                    local_to_utc(tz, (d + Duration::days(1)).and_time(NaiveTime::MIN))
                        - Duration::seconds(1)
                } else {
                    t
                });
            }
            _ => {}
        }
    }
    (!rr.freq.is_empty()).then_some(rr)
}

#[derive(Default)]
struct Partial {
    uid: Option<String>,
    summary: Option<String>,
    description: Option<String>,
    location: Option<String>,
    url: Option<String>,
    status: Option<String>,
    dtstart: Option<(Params, String)>,
    dtend: Option<(Params, String)>,
    rrule: Option<String>,
    exdates: Vec<(Params, String)>,
    recurrence_id: Option<(Params, String)>,
}

impl Partial {
    fn finish<Tz: TimeZone>(self, tz: &Tz) -> Option<IcsEvent> {
        let (sp, sv) = self.dtstart?;
        let (start, all_day) = parse_dt(&sv, &sp, tz)?;
        let end = match self.dtend.and_then(|(p, v)| parse_dt(&v, &p, tz)) {
            Some((e, _)) if e >= start => e,
            _ if all_day => start + Duration::days(1),
            _ => start,
        };
        let mut exdates = Vec::new();
        for (p, v) in &self.exdates {
            for one in v.split(',') {
                if let Some((t, _)) = parse_dt(one, p, tz) {
                    exdates.push(t);
                }
            }
        }
        let summary = self.summary.unwrap_or_default();
        Some(IcsEvent {
            uid: self
                .uid
                .unwrap_or_else(|| format!("{}@{}", summary, start.timestamp())),
            summary,
            description: self.description.filter(|s| !s.is_empty()),
            location: self.location.filter(|s| !s.is_empty()),
            url: self.url.filter(|s| !s.is_empty()),
            status: self.status.map(|s| s.to_ascii_uppercase()),
            start,
            end,
            all_day,
            rrule: self.rrule.and_then(|r| parse_rrule(&r, tz)),
            exdates,
            recurrence_id: self
                .recurrence_id
                .and_then(|(p, v)| parse_dt(&v, &p, tz))
                .map(|x| x.0),
        })
    }
}

/// Parse all VEVENTs. Events without a parseable DTSTART are skipped.
pub fn parse_ics<Tz: TimeZone>(text: &str, tz: &Tz) -> Result<Vec<IcsEvent>, IcsError> {
    let mut saw_calendar = false;
    let mut events = Vec::new();
    let mut cur: Option<Partial> = None;
    let mut nested = 0usize;
    for line in unfold(text) {
        if line.trim().is_empty() {
            continue;
        }
        let Some((name, params, value)) = split_line(&line) else {
            continue;
        };
        let value_uc = value.trim().to_ascii_uppercase();
        match name.as_str() {
            "BEGIN" if value_uc == "VCALENDAR" => saw_calendar = true,
            "BEGIN" if value_uc == "VEVENT" && cur.is_none() => {
                cur = Some(Partial::default());
                nested = 0;
            }
            "BEGIN" if cur.is_some() => nested += 1,
            "END" if cur.is_some() && nested > 0 => nested -= 1,
            "END" if value_uc == "VEVENT" => {
                if let Some(ev) = cur.take().and_then(|p| p.finish(tz)) {
                    events.push(ev);
                }
            }
            _ => {
                let Some(p) = cur.as_mut().filter(|_| nested == 0) else {
                    continue;
                };
                match name.as_str() {
                    "UID" => p.uid = Some(value.trim().to_string()),
                    "SUMMARY" => p.summary = Some(unescape(&value).trim().to_string()),
                    "DESCRIPTION" => p.description = Some(unescape(&value)),
                    "LOCATION" => p.location = Some(unescape(&value).trim().to_string()),
                    "URL" => p.url = Some(value.trim().to_string()),
                    "STATUS" => p.status = Some(value.trim().to_string()),
                    "DTSTART" => p.dtstart = Some((params, value)),
                    "DTEND" => p.dtend = Some((params, value)),
                    "RRULE" => p.rrule = Some(value),
                    "EXDATE" => p.exdates.push((params, value)),
                    "RECURRENCE-ID" => p.recurrence_id = Some((params, value)),
                    _ => {}
                }
            }
        }
    }
    if saw_calendar {
        Ok(events)
    } else {
        Err(IcsError::NotCalendar)
    }
}

impl IcsEvent {
    pub fn is_cancelled(&self) -> bool {
        self.status.as_deref() == Some("CANCELLED")
    }

    /// Occurrences `(start, end)` overlapping `[from, to)`. Weekly rules are expanded in the
    /// local time of `tz` (so "MO 14:00" stays 14:00 local across DST with a DST-aware tz).
    pub fn occurrences<Tz: TimeZone>(
        &self,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
        tz: &Tz,
    ) -> Vec<(DateTime<Utc>, DateTime<Utc>)> {
        let dur = self.end - self.start;
        let overlaps = |s: DateTime<Utc>| {
            if dur > Duration::zero() {
                s < to && s + dur > from
            } else {
                s >= from && s < to
            }
        };
        let single = || {
            if overlaps(self.start) {
                vec![(self.start, self.end)]
            } else {
                Vec::new()
            }
        };
        let Some(rr) = self.rrule.as_ref().filter(|r| r.freq == "WEEKLY") else {
            return single();
        };
        let local_start = utc_to_local(tz, self.start);
        let start_date = local_start.date();
        let time = local_start.time();
        let mut days = rr.by_day.clone();
        if days.is_empty() {
            days.push(start_date.weekday());
        }
        days.sort_by_key(|d| d.num_days_from_monday());
        days.dedup();
        let week0 = start_date - Duration::days(start_date.weekday().num_days_from_monday() as i64);
        let step = 7 * rr.interval.max(1) as i64;
        let mut count = 0u32;
        let mut out = Vec::new();
        for w in 0..5000i64 {
            let monday = week0 + Duration::days(step * w);
            for wd in &days {
                let date = monday + Duration::days(wd.num_days_from_monday() as i64);
                if date < start_date {
                    continue;
                }
                let s = local_to_utc(tz, date.and_time(time));
                if rr.until.is_some_and(|u| s > u) || rr.count.is_some_and(|c| count >= c) {
                    return out;
                }
                count += 1;
                if s >= to {
                    return out;
                }
                if !self.exdates.contains(&s) && overlaps(s) {
                    out.push((s, s + dur));
                }
            }
        }
        out
    }
}

/// Base events of recurring series (for a "pick your classes" list).
pub fn recurring_series(events: &[IcsEvent]) -> Vec<&IcsEvent> {
    events
        .iter()
        .filter(|e| e.rrule.is_some() && e.recurrence_id.is_none())
        .collect()
}

/// Split a Canvas SUMMARY "HW 4 [CMPSC 130A F26]" into ("HW 4", Some("CMPSC 130A")).
/// The course code is the bracket's words up to and including the first word (after the
/// first) that starts with a digit; without such a word the whole bracket text is used.
pub fn split_canvas_summary(summary: &str) -> (String, Option<String>) {
    let s = summary.trim();
    if let (true, Some(lb)) = (s.ends_with(']'), s.rfind('[')) {
        let inner = s[lb + 1..s.len() - 1].trim();
        let title = s[..lb].trim().to_string();
        let words: Vec<&str> = inner.split_whitespace().collect();
        let code = match words
            .iter()
            .enumerate()
            .skip(1)
            .find(|(_, w)| w.chars().next().is_some_and(|c| c.is_ascii_digit()))
        {
            Some((i, _)) => words[..=i].join(" ").to_uppercase(),
            None => inner.to_string(),
        };
        let title = if title.is_empty() {
            s.to_string()
        } else {
            title
        };
        return (title, (!code.is_empty()).then_some(code));
    }
    (s.to_string(), None)
}

fn course_id_for(code: &str, courses: &[Course]) -> String {
    course_in_text(code, courses)
        .map(|c| c.id.clone())
        .unwrap_or_else(|| normalize_token(code))
}

/// Canvas calendar feed -> items. UIDs containing "assignment" are Canvas assignments, which
/// the feed can't tell from grade columns and notices, so they come in as Info
/// ([`canvas_kind`]: in the Inbox for you to sort unless the title reads as a grade or a
/// notice); PocketCanvas, which can tell, sets the kind of real work. Everything else becomes
/// an `event` with start/end. Course comes from the
/// trailing "[CODE ...]" in SUMMARY (matched against `courses`, else the normalized code is
/// used as `course_id`). All-day assignments are due 23:59 local. Ids are stable per UID.
pub fn canvas_feed_to_items<Tz: TimeZone>(
    events: &[IcsEvent],
    courses: &[Course],
    tz: &Tz,
    now: DateTime<Utc>,
    device: &str,
) -> Vec<Item> {
    let mut out = Vec::new();
    for ev in events.iter().filter(|e| !e.is_cancelled()) {
        let is_assignment = ev.uid.to_ascii_lowercase().contains("assignment");
        let (title, code) = split_canvas_summary(&ev.summary);
        let (kind, status) = if is_assignment {
            canvas_kind(&title, ItemKind::Assignment, false)
        } else {
            (ItemKind::Event, Status::Todo)
        };
        let mut it = Item::new(title, kind, now, device);
        it.id = stable_id("canvas", &ev.uid);
        it.status = status;
        it.course_id = code.as_deref().map(|c| course_id_for(c, courses));
        if is_assignment {
            it.due = Some(if ev.all_day {
                let d = utc_to_local(tz, ev.start).date();
                local_to_utc(
                    tz,
                    d.and_time(NaiveTime::from_hms_opt(23, 59, 0).expect("valid")),
                )
            } else {
                ev.start
            });
        } else {
            it.due = Some(ev.start);
            it.end = Some(ev.end);
        }
        it.location = ev.location.clone();
        it.notes = ev.description.clone().unwrap_or_default();
        it.source = Source {
            adapter: "canvas".into(),
            external_id: Some(ev.uid.clone()),
            url: ev.url.clone(),
            kind: None,
        };
        if let Some(u) = &ev.url {
            it.links.push(Link {
                label: "Canvas".into(),
                url: u.clone(),
            });
        }
        out.push(it);
    }
    out
}

fn occurrence_key(uid: &str, start: DateTime<Utc>) -> String {
    format!("{uid}@{}", start.format("%Y%m%dT%H%M%SZ"))
}

/// Expand events into one item per occurrence in `[from, to)`, honoring RECURRENCE-ID
/// overrides and CANCELLED instances. `external_id` = "UID@YYYYMMDDTHHMMSSZ" of the
/// (original) occurrence start; ids are stable.
#[allow(clippy::too_many_arguments)]
pub fn events_to_items<Tz: TimeZone>(
    events: &[IcsEvent],
    adapter: &str,
    kind: ItemKind,
    courses: &[Course],
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    tz: &Tz,
    now: DateTime<Utc>,
    device: &str,
    keep: impl Fn(&IcsEvent) -> bool,
) -> Vec<Item> {
    let mk = |ev: &IcsEvent, key_start: DateTime<Utc>, s: DateTime<Utc>, e: DateTime<Utc>| {
        let mut it = Item::new(ev.summary.clone(), kind, now, device);
        let ext = occurrence_key(&ev.uid, key_start);
        it.id = stable_id(adapter, &ext);
        it.status = Status::Todo;
        it.course_id = course_in_text(&ev.summary, courses).map(|c| c.id.clone());
        it.due = Some(s);
        it.end = Some(e);
        it.location = ev.location.clone();
        it.notes = ev.description.clone().unwrap_or_default();
        it.source = Source {
            adapter: adapter.into(),
            external_id: Some(ext),
            url: ev.url.clone(),
            kind: None,
        };
        if let Some(u) = &ev.url {
            it.links.push(Link::from_url(u));
        }
        it
    };
    let mut out = Vec::new();
    for base in events
        .iter()
        .filter(|e| e.recurrence_id.is_none() && keep(e))
    {
        if base.is_cancelled() {
            continue;
        }
        let overrides: Vec<&IcsEvent> = events
            .iter()
            .filter(|o| o.uid == base.uid && o.recurrence_id.is_some())
            .collect();
        for (s, e) in base.occurrences(from, to, tz) {
            if overrides.iter().any(|o| o.recurrence_id == Some(s)) {
                continue;
            }
            out.push(mk(base, s, s, e));
        }
        for o in overrides {
            let rid = o.recurrence_id.expect("filtered");
            if o.is_cancelled() || !(o.start < to && o.end.max(o.start) >= from) {
                continue;
            }
            out.push(mk(o, rid, o.start, o.end));
        }
    }
    out
}

/// What you picked in "which of these are classes?": the series that are classes, which of
/// them are sections (discussion, lab, ...), and the course of series whose title doesn't name it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ClassPicks {
    /// Series UIDs imported as classes, lectures and sections alike.
    pub series: Vec<String>,
    /// The picked series that are sections. Their meetings are still `class` items of the
    /// course, tagged [`SECTION_TAG`].
    pub sections: Vec<String>,
    /// Series UID -> course id, overriding the course the title names.
    pub courses: BTreeMap<String, String>,
}

/// The tag on the meetings of a series picked as a section (`#section` in filters).
pub const SECTION_TAG: &str = "section";

/// Google Calendar export -> `class` items for the series the user picked (by UID), each with
/// the `alert` interrupt. Sections are tagged [`SECTION_TAG`]; `picks.courses` sets the course.
#[allow(clippy::too_many_arguments)]
pub fn gcal_to_class_items<Tz: TimeZone>(
    events: &[IcsEvent],
    picks: &ClassPicks,
    courses: &[Course],
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    tz: &Tz,
    now: DateTime<Utc>,
    device: &str,
) -> Vec<Item> {
    events_to_items(
        events,
        "gcal",
        ItemKind::Class,
        courses,
        from,
        to,
        tz,
        now,
        device,
        |e| picks.series.iter().any(|u| u == &e.uid),
    )
    .into_iter()
    .map(|mut it| {
        // a class you picked is one you mean to attend: it gets the "starting soon" alert
        it.interrupt = InterruptLevel::Alert;
        let uid = it
            .source
            .external_id
            .as_deref()
            .map(series_uid)
            .unwrap_or("");
        if let Some(c) = picks
            .courses
            .get(uid)
            .filter(|c| courses.iter().any(|x| &x.id == *c))
        {
            it.course_id = Some(c.clone());
        }
        if picks.sections.iter().any(|u| u == uid) {
            it.tags.push(SECTION_TAG.into());
        }
        it
    })
    .collect()
}

/// The adapter of Google events that are not classes (an appointment, a dinner, a one-off
/// meeting). Their own adapter keeps [`prune_series`] and [`mark_sections`] on the classes
/// (`"gcal"`) from touching them.
pub const GCAL_EVENT: &str = "gcalev";

/// UIDs of the Google events that become [`GCAL_EVENT`] items: every live event or series
/// except those in `skip` (picked classes, hidden series, copies).
pub fn gcal_event_series(events: &[IcsEvent], skip: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for e in events
        .iter()
        .filter(|e| e.recurrence_id.is_none() && !e.is_cancelled() && !skip.contains(&e.uid))
    {
        if !out.contains(&e.uid) {
            out.push(e.uid.clone());
        }
    }
    out
}

/// Google export -> `event` items for everything [`gcal_event_series`] keeps, so a meeting you
/// put on your calendar shows up even when it is not one of your classes.
#[allow(clippy::too_many_arguments)]
pub fn gcal_to_event_items<Tz: TimeZone>(
    events: &[IcsEvent],
    skip: &[String],
    courses: &[Course],
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    tz: &Tz,
    now: DateTime<Utc>,
    device: &str,
) -> Vec<Item> {
    events_to_items(
        events,
        GCAL_EVENT,
        ItemKind::Event,
        courses,
        from,
        to,
        tz,
        now,
        device,
        |e| !skip.contains(&e.uid),
    )
}

/// Words that make a series title read as a section rather than a lecture ("CS 16 Lab",
/// "Discussion 0102", "PSTAT 120A Sec"). Trailing digits are ignored ("dis01").
pub fn looks_like_section(summary: &str) -> bool {
    summary
        .split(|c: char| !c.is_alphanumeric())
        .map(|w| w.to_lowercase())
        .any(|w| {
            matches!(
                w.trim_end_matches(|c: char| c.is_ascii_digit()),
                "section"
                    | "sect"
                    | "sec"
                    | "discussion"
                    | "disc"
                    | "dis"
                    | "lab"
                    | "recitation"
                    | "tutorial"
                    | "studio"
            )
        })
}

/// Keep the [`SECTION_TAG`] of the live `adapter` items in step with `sections` (tags are the
/// user's, so a re-import alone would not move it when a series changes role). Returns how
/// many items changed.
pub fn mark_sections(
    items: &mut [Item],
    adapter: &str,
    sections: &[String],
    now: DateTime<Utc>,
    device: &str,
) -> usize {
    let mut n = 0;
    for it in items
        .iter_mut()
        .filter(|i| !i.deleted && i.source.adapter == adapter)
    {
        let Some(uid) = it.source.external_id.as_deref().map(series_uid) else {
            continue;
        };
        let want = sections.iter().any(|u| u == uid);
        let has = it.tags.iter().any(|t| t.eq_ignore_ascii_case(SECTION_TAG));
        if want == has {
            continue;
        }
        if want {
            it.tags.push(SECTION_TAG.into());
        } else {
            it.tags.retain(|t| !t.eq_ignore_ascii_case(SECTION_TAG));
        }
        it.touch(now, device);
        n += 1;
    }
    n
}

/// One recurring series in a calendar export, for the "which of these are classes?" step.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SeriesInfo {
    pub uid: String,
    pub summary: String,
    pub location: Option<String>,
    pub first_start: DateTime<Utc>,
    /// Length of one meeting.
    pub minutes: i64,
    /// "Mon", "Wed", ...
    pub by_day: Vec<String>,
    /// The course the summary names ([`course_in_text`]). Such series are picked by default.
    pub course_id: Option<String>,
    /// The title reads as a section ([`looks_like_section`]): the default role when picked.
    #[serde(default)]
    pub section: bool,
}

/// UIDs of series that repeat another one: the same title, place and length, with at least
/// 4 in 5 of its meetings in `[from, to)` at the other's times, so one moved or cancelled
/// meeting doesn't hide a copy (a schedule added to Google twice). The
/// earlier-starting copy stays. A series split by an edit ("this and following") covers
/// different weeks, so both halves stay.
pub fn duplicate_series<Tz: TimeZone>(
    events: &[IcsEvent],
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    tz: &Tz,
) -> Vec<String> {
    let norm = |s: &str| {
        s.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };
    let mut series: Vec<&IcsEvent> = recurring_series(events)
        .into_iter()
        .filter(|e| !e.is_cancelled())
        .collect();
    series.sort_by_key(|e| e.start);
    let mut kept: Vec<(&IcsEvent, Vec<DateTime<Utc>>)> = Vec::new();
    let mut dups = Vec::new();
    for e in series {
        let times: Vec<DateTime<Utc>> = e
            .occurrences(from, to, tz)
            .into_iter()
            .map(|(s, _)| s)
            .collect();
        if times.is_empty() {
            continue;
        }
        let same = |k: &IcsEvent| {
            k.uid != e.uid
                && norm(&k.summary) == norm(&e.summary)
                && norm(k.location.as_deref().unwrap_or(""))
                    == norm(e.location.as_deref().unwrap_or(""))
                && k.end - k.start == e.end - e.start
        };
        if kept.iter().any(|(k, kt)| {
            same(k) && times.iter().filter(|t| kt.contains(t)).count() * 5 >= times.len() * 4
        }) {
            if !dups.contains(&e.uid) {
                dups.push(e.uid.clone());
            }
        } else {
            kept.push((e, times));
        }
    }
    dups
}

/// Weekly series with at least one meeting in `[from, to)` (a Google export holds every
/// series you ever had; only this term's are worth asking about), in start order. Copies of
/// another series ([`duplicate_series`]) are left out.
pub fn series_info<Tz: TimeZone>(
    events: &[IcsEvent],
    courses: &[Course],
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    tz: &Tz,
) -> Vec<SeriesInfo> {
    let dups = duplicate_series(events, from, to, tz);
    let mut out: Vec<SeriesInfo> = recurring_series(events)
        .into_iter()
        .filter(|e| !e.is_cancelled() && !dups.contains(&e.uid))
        .filter(|e| !e.occurrences(from, to, tz).is_empty())
        .map(|e| SeriesInfo {
            uid: e.uid.clone(),
            summary: e.summary.clone(),
            location: e.location.clone(),
            first_start: e.start,
            minutes: (e.end - e.start).num_minutes(),
            by_day: e
                .rrule
                .as_ref()
                .map(|r| r.by_day.iter().map(|d| d.to_string()).collect())
                .unwrap_or_default(),
            course_id: course_in_text(&e.summary, courses).map(|c| c.id.clone()),
            section: looks_like_section(&e.summary),
        })
        .collect();
    out.sort_by_key(|s| s.first_start);
    out
}

/// The default pick: series whose summary names one of your courses.
pub fn default_class_series(series: &[SeriesInfo]) -> Vec<String> {
    series
        .iter()
        .filter(|s| s.course_id.is_some())
        .map(|s| s.uid.clone())
        .collect()
}

/// The default sections: series whose title reads as one.
pub fn default_sections(series: &[SeriesInfo]) -> Vec<String> {
    series
        .iter()
        .filter(|s| s.section)
        .map(|s| s.uid.clone())
        .collect()
}

/// The series UID of an occurrence's `external_id` ("UID@20261001T163000Z" -> "UID"; UIDs may
/// contain '@' themselves, the occurrence stamp never does).
pub fn series_uid(external_id: &str) -> &str {
    external_id
        .rsplit_once('@')
        .map_or(external_id, |(uid, _)| uid)
}

/// Tombstone the live `adapter` items whose series is not in `keep` (the user un-picked or hid
/// it, or this export reads it as a copy) and note those series in `pruned`, so
/// [`restore_series`] can bring them back. Returns how many were removed.
pub fn prune_series(
    items: &mut [Item],
    adapter: &str,
    keep: &[String],
    pruned: &mut Vec<String>,
    now: DateTime<Utc>,
    device: &str,
) -> usize {
    let mut n = 0;
    for it in items
        .iter_mut()
        .filter(|i| !i.deleted && i.source.adapter == adapter)
    {
        let Some(uid) = it.source.external_id.as_deref().map(series_uid) else {
            continue;
        };
        if !keep.iter().any(|k| k == uid) {
            if !pruned.iter().any(|p| p == uid) {
                pruned.push(uid.to_string());
            }
            it.deleted = true;
            it.touch(now, device);
            n += 1;
        }
    }
    n
}

/// Undo [`prune_series`] for the series in `pruned` that are in `keep` again: their meetings
/// come back (a newer write than the tombstone, so it syncs) and the series leave `pruned`.
/// Meetings you deleted yourself in a series that was never pruned stay deleted.
/// Returns how many came back.
pub fn restore_series(
    items: &mut [Item],
    adapter: &str,
    keep: &[String],
    pruned: &mut Vec<String>,
    now: DateTime<Utc>,
    device: &str,
) -> usize {
    let back: Vec<String> = pruned
        .iter()
        .filter(|p| keep.contains(p))
        .cloned()
        .collect();
    pruned.retain(|p| !back.contains(p));
    let mut n = 0;
    for it in items
        .iter_mut()
        .filter(|i| i.deleted && i.source.adapter == adapter)
    {
        let uid = it.source.external_id.as_deref().map(series_uid);
        if uid.is_some_and(|u| back.iter().any(|b| b == u)) {
            it.deleted = false;
            it.touch(now, device);
            n += 1;
        }
    }
    n
}

/// Series of `adapter` whose every item is deleted: what [`prune_series`] left behind before
/// it noted the series it pruned (a whole series is only ever removed that way).
pub fn fully_deleted_series(items: &[Item], adapter: &str) -> Vec<String> {
    let mut live: Vec<&str> = Vec::new();
    let mut gone: Vec<&str> = Vec::new();
    for it in items.iter().filter(|i| i.source.adapter == adapter) {
        let Some(uid) = it.source.external_id.as_deref().map(series_uid) else {
            continue;
        };
        let list = if it.deleted { &mut gone } else { &mut live };
        if !list.contains(&uid) {
            list.push(uid);
        }
    }
    gone.into_iter()
        .filter(|u| !live.contains(u))
        .map(String::from)
        .collect()
}

/// "https://canvas.ucsb.edu/courses/123/assignments/9" -> ("123", "https://canvas.ucsb.edu/courses/123").
fn canvas_course_url(url: &str) -> Option<(String, String)> {
    let at = url.find("/courses/")?;
    let rest = &url[at + "/courses/".len()..];
    let id: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    (!id.is_empty()).then(|| (id.clone(), format!("{}/courses/{id}", &url[..at])))
}

/// Courses a Canvas feed names that `courses` does not have yet. The id is the normalized code,
/// the same id [`canvas_feed_to_items`] falls back to, so imported items land in them. The
/// bracket's next word becomes the quarter ("[CMPSC 130A F26]" -> "F26"), event URLs give the
/// Canvas course id and home link, and colors 1–6 are handed out in turn.
pub fn canvas_courses(events: &[IcsEvent], courses: &[Course]) -> Vec<Course> {
    let mut found: Vec<Course> = Vec::new();
    for ev in events.iter().filter(|e| !e.is_cancelled()) {
        let (_, Some(code)) = split_canvas_summary(&ev.summary) else {
            continue;
        };
        let link = ev.url.as_deref().and_then(canvas_course_url);
        if let Some(c) = found.iter_mut().find(|c| c.code == code) {
            if c.canvas_id.is_none() {
                if let Some((id, home)) = link {
                    c.canvas_id = Some(id);
                    c.links.push(Link {
                        label: "Canvas".into(),
                        url: home,
                    });
                }
            }
            continue;
        }
        if course_in_text(&code, courses).is_some() {
            continue;
        }
        let mut c = Course::new(&normalize_token(&code), &code);
        let bracket = ev.summary.rsplit_once('[').map_or("", |(_, b)| b);
        c.quarter = bracket
            .trim_end_matches(']')
            .split_whitespace()
            .nth(code.split_whitespace().count())
            .filter(|w| w.len() <= 4)
            .unwrap_or_default()
            .to_string();
        c.color = ((courses.len() + found.len()) % 6 + 1) as u8;
        if let Some((id, home)) = link {
            c.canvas_id = Some(id);
            c.links.push(Link {
                label: "Canvas".into(),
                url: home,
            });
        }
        found.push(c);
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;

    fn pdt() -> FixedOffset {
        FixedOffset::west_opt(7 * 3600).unwrap()
    }

    fn u(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    const CANVAS: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Instructure//Canvas\r\n\
BEGIN:VEVENT\r\nUID:event-assignment-123\r\n\
SUMMARY:HW 4: Graph Algorithms [CMPSC 130A F26]\r\n\
DTSTART:20261031T065900Z\r\nDTEND:20261031T065900Z\r\n\
URL;VALUE=URI:https://canvas.ucsb.edu/courses/1/assignments/123\r\n\
DESCRIPTION:Line one\\nLine two\\, with a comma and a long line that is fol\r\n ded here\r\n\
BEGIN:VALARM\r\nTRIGGER:-PT15M\r\nDESCRIPTION:alarm text\r\nEND:VALARM\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:event-assignment-124\r\nSUMMARY:Quiz 3 [PSTAT 120A F26]\r\n\
DTSTART;VALUE=DATE:20261105\r\nDTEND;VALUE=DATE:20261106\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:event-calendar-event-55\r\nSUMMARY:Review session [CMPSC 130A F26]\r\n\
DTSTART:20261103T010000Z\r\nDTEND:20261103T023000Z\r\nLOCATION:Phelps 1260\r\nEND:VEVENT\r\n\
END:VCALENDAR\r\n";

    #[test]
    fn parses_canvas_basics() {
        let evs = parse_ics(CANVAS, &pdt()).unwrap();
        assert_eq!(evs.len(), 3);
        let hw = &evs[0];
        assert_eq!(hw.uid, "event-assignment-123");
        assert_eq!(hw.start, u("2026-10-31T06:59:00Z"));
        assert_eq!(
            hw.description.as_deref(),
            Some("Line one\nLine two, with a comma and a long line that is folded here")
        );
        assert_eq!(
            hw.url.as_deref(),
            Some("https://canvas.ucsb.edu/courses/1/assignments/123")
        );
        assert!(evs[1].all_day);
        assert_eq!(evs[1].start, u("2026-11-05T00:00:00-07:00"));
    }

    #[test]
    fn canvas_items() {
        let evs = parse_ics(CANVAS, &pdt()).unwrap();
        let mut algo = Course::new("cmpsc130a-f26", "CMPSC 130A");
        algo.aliases = vec!["algo".into()];
        let now = u("2026-10-28T17:00:00Z");
        let items = canvas_feed_to_items(&evs, &[algo], &pdt(), now, "dev");
        assert_eq!(items.len(), 3);
        let hw = &items[0];
        assert_eq!(hw.title, "HW 4: Graph Algorithms");
        assert_eq!(
            (hw.kind, hw.status),
            (ItemKind::Info, Status::Inbox),
            "the feed can't tell work from a grade column, so you sort it"
        );
        assert_eq!(hw.course_id.as_deref(), Some("cmpsc130a-f26"));
        assert_eq!(hw.source.adapter, "canvas");
        assert_eq!(
            hw.source.external_id.as_deref(),
            Some("event-assignment-123")
        );
        assert_eq!(hw.id, stable_id("canvas", "event-assignment-123"));
        assert_eq!(hw.links[0].label, "Canvas");
        let quiz = &items[1];
        assert_eq!(quiz.kind, ItemKind::Info);
        assert_eq!(
            quiz.course_id.as_deref(),
            Some("pstat120a"),
            "unknown course -> normalized code"
        );
        assert_eq!(quiz.due, Some(u("2026-11-05T23:59:00-07:00")));
        let ev = &items[2];
        assert_eq!(ev.kind, ItemKind::Event);
        assert_eq!(ev.end, Some(u("2026-11-03T02:30:00Z")));
        assert_eq!(ev.location.as_deref(), Some("Phelps 1260"));
        // re-import is idempotent by id
        let again = canvas_feed_to_items(&evs, &[], &pdt(), now, "other-device");
        assert_eq!(again[0].id, hw.id);
    }

    #[test]
    fn canvas_summary_split() {
        assert_eq!(
            split_canvas_summary("Project 1 [CH E 10 - Fall 2026]"),
            ("Project 1".to_string(), Some("CH E 10".to_string()))
        );
        assert_eq!(
            split_canvas_summary("No brackets"),
            ("No brackets".to_string(), None)
        );
        assert_eq!(
            split_canvas_summary("Orientation [Welcome]"),
            ("Orientation".to_string(), Some("Welcome".to_string()))
        );
    }

    const GCAL: &str = "BEGIN:VCALENDAR\nVERSION:2.0\n\
BEGIN:VTIMEZONE\nTZID:America/Los_Angeles\nBEGIN:DAYLIGHT\nDTSTART:19700308T020000\nEND:DAYLIGHT\nEND:VTIMEZONE\n\
BEGIN:VEVENT\nUID:algo-lecture@google.com\nSUMMARY:CMPSC 130A Lecture\nLOCATION:Phelps 3526\n\
DTSTART;TZID=America/Los_Angeles:20260928T140000\nDTEND;TZID=America/Los_Angeles:20260928T151500\n\
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261204T235959Z\n\
EXDATE;TZID=America/Los_Angeles:20261012T140000\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:algo-lecture@google.com\nRECURRENCE-ID;TZID=America/Los_Angeles:20261028T140000\n\
SUMMARY:CMPSC 130A Lecture (moved)\nLOCATION:Online\n\
DTSTART;TZID=America/Los_Angeles:20261028T160000\nDTEND;TZID=America/Los_Angeles:20261028T171500\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:section@google.com\nSUMMARY:Section\n\
DTSTART:20260929T170000Z\nDTEND:20260929T175000Z\nRRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=3\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:biweekly@google.com\nSUMMARY:Club\n\
DTSTART:20261001T030000Z\nDTEND:20261001T040000Z\nRRULE:FREQ=WEEKLY;INTERVAL=2\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:party@google.com\nSUMMARY:Party\nDTSTART:20261031T040000Z\nEND:VEVENT\n\
END:VCALENDAR\n";

    #[test]
    fn tzid_uses_provided_zone() {
        let evs = parse_ics(GCAL, &pdt()).unwrap();
        assert_eq!(evs.len(), 5, "VTIMEZONE DTSTART is not an event");
        assert_eq!(evs[0].start, u("2026-09-28T21:00:00Z"));
        let rr = evs[0].rrule.as_ref().unwrap();
        assert_eq!(rr.by_day, vec![Weekday::Mon, Weekday::Wed]);
        assert_eq!(evs[0].exdates, vec![u("2026-10-12T21:00:00Z")]);
        assert_eq!(evs[1].recurrence_id, Some(u("2026-10-28T21:00:00Z")));
    }

    #[test]
    fn weekly_until_and_exdate() {
        let evs = parse_ics(GCAL, &pdt()).unwrap();
        let lec = &evs[0];
        let all = lec.occurrences(u("2026-01-01T00:00:00Z"), u("2027-01-01T00:00:00Z"), &pdt());
        // Sep 28 .. Dec 2: 10 weeks * 2 = 20, minus 1 EXDATE
        assert_eq!(all.len(), 19);
        assert_eq!(all[0].0, u("2026-09-28T21:00:00Z"));
        assert_eq!(all.last().unwrap().0, u("2026-12-02T21:00:00Z"));
        assert!(!all.iter().any(|(s, _)| *s == u("2026-10-12T21:00:00Z")));
        let week = lec.occurrences(u("2026-10-26T07:00:00Z"), u("2026-11-02T07:00:00Z"), &pdt());
        assert_eq!(week.len(), 2);
        assert_eq!(week[0].1 - week[0].0, Duration::minutes(75));
    }

    #[test]
    fn weekly_count_interval_and_single() {
        let evs = parse_ics(GCAL, &pdt()).unwrap();
        let far = (u("2020-01-01T00:00:00Z"), u("2030-01-01T00:00:00Z"));
        let sec = evs[2].occurrences(far.0, far.1, &pdt());
        let starts: Vec<_> = sec.iter().map(|o| o.0).collect();
        assert_eq!(
            starts,
            vec![
                u("2026-09-29T17:00:00Z"),
                u("2026-10-01T17:00:00Z"),
                u("2026-10-06T17:00:00Z")
            ]
        );
        // Club: Wed 20:00 PDT (Thu 03:00Z) every other week, no end -> bounded by window
        let club = evs[3].occurrences(u("2026-10-01T00:00:00Z"), u("2026-11-01T00:00:00Z"), &pdt());
        let starts: Vec<_> = club.iter().map(|o| o.0).collect();
        assert_eq!(
            starts,
            vec![
                u("2026-10-01T03:00:00Z"),
                u("2026-10-15T03:00:00Z"),
                u("2026-10-29T03:00:00Z")
            ]
        );
        let party = evs[4].occurrences(far.0, far.1, &pdt());
        assert_eq!(
            party,
            vec![(u("2026-10-31T04:00:00Z"), u("2026-10-31T04:00:00Z"))]
        );
    }

    #[test]
    fn gcal_events_are_everything_that_is_not_a_class() {
        let evs = parse_ics(GCAL, &pdt()).unwrap();
        let skip = vec!["algo-lecture@google.com".to_string()];
        let keep = gcal_event_series(&evs, &skip);
        assert_eq!(
            keep,
            vec!["section@google.com", "biweekly@google.com", "party@google.com"]
        );
        let items = gcal_to_event_items(
            &evs,
            &skip,
            &[],
            u("2026-10-01T00:00:00Z"),
            u("2026-11-02T00:00:00Z"),
            &pdt(),
            u("2026-10-26T00:00:00Z"),
            "dev",
        );
        assert!(items
            .iter()
            .all(|i| i.kind == ItemKind::Event && i.source.adapter == GCAL_EVENT));
        assert!(items.iter().any(|i| i.title == "Party"), "the one-off shows");
        assert!(!items.iter().any(|i| i.title.starts_with("CMPSC")));
        // a pruned series comes back through the same helpers the classes use
        let mut live = items;
        let mut pruned = Vec::new();
        let now = u("2026-10-27T00:00:00Z");
        let only = vec!["party@google.com".to_string()];
        assert!(prune_series(&mut live, GCAL_EVENT, &only, &mut pruned, now, "dev") > 0);
        assert_eq!(live.iter().filter(|i| !i.deleted).count(), 1);
        assert!(restore_series(&mut live, GCAL_EVENT, &keep, &mut pruned, now, "dev") > 0);
        assert!(live.iter().all(|i| !i.deleted));
    }

    #[test]
    fn gcal_class_items_with_override() {
        let evs = parse_ics(GCAL, &pdt()).unwrap();
        let courses = vec![Course::new("cmpsc130a", "CMPSC 130A")];
        let series: Vec<String> = recurring_series(&evs)
            .iter()
            .map(|e| e.uid.clone())
            .collect();
        assert_eq!(series.len(), 3);
        let now = u("2026-10-26T00:00:00Z");
        let items = gcal_to_class_items(
            &evs,
            &ClassPicks {
                series: vec!["algo-lecture@google.com".to_string()],
                ..Default::default()
            },
            &courses,
            u("2026-10-26T07:00:00Z"),
            u("2026-11-02T07:00:00Z"),
            &pdt(),
            now,
            "dev",
        );
        assert_eq!(items.len(), 2);
        assert!(items
            .iter()
            .all(|i| i.kind == ItemKind::Class && i.source.adapter == "gcal"));
        assert!(items
            .iter()
            .all(|i| i.course_id.as_deref() == Some("cmpsc130a")));
        let moved = items
            .iter()
            .find(|i| i.location.as_deref() == Some("Online"))
            .unwrap();
        assert_eq!(moved.due, Some(u("2026-10-28T23:00:00Z")));
        assert_eq!(
            moved.source.external_id.as_deref(),
            Some("algo-lecture@google.com@20261028T210000Z"),
            "override keeps the original occurrence key"
        );
        let mon = items
            .iter()
            .find(|i| i.location.as_deref() == Some("Phelps 3526"))
            .unwrap();
        assert_eq!(mon.due, Some(u("2026-10-26T21:00:00Z")));
        assert_eq!(mon.end, Some(u("2026-10-26T22:15:00Z")));
    }

    #[test]
    fn canvas_courses_discovered() {
        let evs = parse_ics(CANVAS, &pdt()).unwrap();
        let found = canvas_courses(&evs, &[]);
        assert_eq!(found.len(), 2);
        let algo = &found[0];
        assert_eq!(
            (algo.id.as_str(), algo.code.as_str()),
            ("cmpsc130a", "CMPSC 130A")
        );
        assert_eq!(algo.quarter, "F26");
        assert_eq!(algo.canvas_id.as_deref(), Some("1"));
        assert_eq!(algo.links[0].url, "https://canvas.ucsb.edu/courses/1");
        assert_eq!(found[1].id, "pstat120a");
        assert_ne!(algo.color, found[1].color);
        // imported items land in the discovered courses
        let items = canvas_feed_to_items(&evs, &found, &pdt(), u("2026-10-28T17:00:00Z"), "dev");
        assert_eq!(items[0].course_id.as_deref(), Some("cmpsc130a"));
        // a course you already have is not proposed again
        let known = vec![Course::new("cmpsc130a-f26", "CMPSC 130A")];
        let found = canvas_courses(&evs, &known);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].code, "PSTAT 120A");
    }

    #[test]
    fn series_picker_and_pruning() {
        let evs = parse_ics(GCAL, &pdt()).unwrap();
        let courses = vec![Course::new("cmpsc130a", "CMPSC 130A")];
        let (from, to) = (u("2026-10-26T07:00:00Z"), u("2026-11-30T07:00:00Z"));
        let series = series_info(&evs, &courses, from, to, &pdt());
        // "Section" (COUNT=3, over by October) is not this window's; the party is not a series
        let uids: Vec<&str> = series.iter().map(|s| s.uid.as_str()).collect();
        assert_eq!(uids, vec!["algo-lecture@google.com", "biweekly@google.com"]);
        assert_eq!(series[0].by_day, vec!["Mon", "Wed"]);
        assert_eq!(series[0].minutes, 75);
        assert_eq!(series[0].course_id.as_deref(), Some("cmpsc130a"));
        let picked = default_class_series(&series);
        assert_eq!(picked, vec!["algo-lecture@google.com".to_string()]);

        let now = u("2026-10-26T00:00:00Z");
        let all: Vec<String> = series.iter().map(|s| s.uid.clone()).collect();
        let all = ClassPicks {
            series: all,
            ..Default::default()
        };
        let mut items = gcal_to_class_items(&evs, &all, &courses, from, to, &pdt(), now, "dev");
        assert!(items.iter().all(|i| i.interrupt == InterruptLevel::Alert));
        let clubs = items
            .iter()
            .filter(|i| {
                i.source.external_id.as_deref().map(series_uid) == Some("biweekly@google.com")
            })
            .count();
        assert!(clubs > 0);
        let mut pruned = Vec::new();
        assert_eq!(
            prune_series(&mut items, "gcal", &picked, &mut pruned, now, "dev"),
            clubs
        );
        assert_eq!(pruned, vec!["biweekly@google.com".to_string()]);
        assert!(items
            .iter()
            .filter(|i| !i.deleted)
            .all(|i| i.title.starts_with("CMPSC 130A")));
        assert_eq!(fully_deleted_series(&items, "gcal"), pruned);

        // a meeting you deleted yourself stays deleted; the pruned series comes back when picked again
        let lecture = items.iter().position(|i| !i.deleted).unwrap();
        items[lecture].deleted = true;
        let both = vec![
            "algo-lecture@google.com".to_string(),
            "biweekly@google.com".to_string(),
        ];
        assert_eq!(
            restore_series(&mut items, "gcal", &both, &mut pruned, now, "dev"),
            clubs
        );
        assert!(pruned.is_empty());
        assert!(items[lecture].deleted);
        assert_eq!(items.iter().filter(|i| i.deleted).count(), 1);
        assert_eq!(series_uid("a@google.com@20261001T163000Z"), "a@google.com");
    }

    #[test]
    fn a_schedule_added_twice_is_listed_once() {
        let copy = GCAL.replace(
            "BEGIN:VEVENT
UID:section@google.com",
            "BEGIN:VEVENT
UID:copy@google.com
SUMMARY:CMPSC  130A lecture
LOCATION:Phelps 3526
DTSTART;TZID=America/Los_Angeles:20261005T140000
DTEND;TZID=America/Los_Angeles:20261005T151500
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261204T235959Z
END:VEVENT
BEGIN:VEVENT
UID:later-half@google.com
SUMMARY:CMPSC 130A Lecture
LOCATION:Phelps 3526
DTSTART;TZID=America/Los_Angeles:20261207T140000
DTEND;TZID=America/Los_Angeles:20261207T151500
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4
END:VEVENT
BEGIN:VEVENT
UID:section@google.com",
        );
        let evs = parse_ics(&copy, &pdt()).unwrap();
        let (from, to) = (u("2026-10-26T07:00:00Z"), u("2026-12-31T08:00:00Z"));
        // the copy meets at the original's times; the half after an edit meets later, so it stays
        assert_eq!(
            duplicate_series(&evs, from, to, &pdt()),
            vec!["copy@google.com".to_string()]
        );
        let uids: Vec<String> = series_info(&evs, &[], from, to, &pdt())
            .into_iter()
            .map(|s| s.uid)
            .collect();
        assert!(uids.contains(&"algo-lecture@google.com".to_string()));
        assert!(uids.contains(&"later-half@google.com".to_string()));
        assert!(!uids.contains(&"copy@google.com".to_string()));
    }

    #[test]
    fn sections_are_classes_of_their_course() {
        assert!(looks_like_section("CMPSC 16 Lab"));
        assert!(looks_like_section("Discussion 0102"));
        assert!(looks_like_section("pstat 120a dis01"));
        assert!(looks_like_section("Section"));
        assert!(!looks_like_section("CMPSC 130A Lecture"));
        assert!(!looks_like_section("Labor history"));

        let evs = parse_ics(GCAL, &pdt()).unwrap();
        let courses = vec![Course::new("cmpsc130a", "CMPSC 130A")];
        let (from, to) = (u("2026-09-28T07:00:00Z"), u("2026-10-10T07:00:00Z"));
        let series = series_info(&evs, &courses, from, to, &pdt());
        let sec = series
            .iter()
            .find(|s| s.uid == "section@google.com")
            .unwrap();
        // "Section" names no course, so it is not picked by default, but it reads as a section
        assert!(sec.section && sec.course_id.is_none());
        assert_eq!(
            default_sections(&series),
            vec!["section@google.com".to_string()]
        );

        let picks = ClassPicks {
            series: vec![
                "algo-lecture@google.com".into(),
                "section@google.com".into(),
            ],
            sections: vec!["section@google.com".into()],
            courses: BTreeMap::from([
                ("section@google.com".into(), "cmpsc130a".into()),
                // a course that no longer exists is ignored
                ("algo-lecture@google.com".into(), "gone".into()),
            ]),
        };
        let now = u("2026-09-27T00:00:00Z");
        let mut items = gcal_to_class_items(&evs, &picks, &courses, from, to, &pdt(), now, "dev");
        let (secs, lecs): (Vec<&Item>, Vec<&Item>) = items
            .iter()
            .partition(|i| i.tags.iter().any(|t| t == SECTION_TAG));
        assert_eq!(secs.len(), 3, "COUNT=3");
        assert!(secs.iter().all(|i| i.kind == ItemKind::Class
            && i.course_id.as_deref() == Some("cmpsc130a")
            && i.interrupt == InterruptLevel::Alert));
        assert!(!lecs.is_empty());
        assert!(lecs
            .iter()
            .all(|i| i.course_id.as_deref() == Some("cmpsc130a")));

        // un-marking the section drops the tag from items already imported, and only from those
        assert_eq!(mark_sections(&mut items, "gcal", &[], now, "dev"), 3);
        assert!(items.iter().all(|i| i.tags.is_empty()));
        let again = vec!["section@google.com".to_string()];
        assert_eq!(mark_sections(&mut items, "gcal", &again, now, "dev"), 3);
        assert_eq!(mark_sections(&mut items, "gcal", &again, now, "dev"), 0);
    }

    #[test]
    fn not_a_calendar() {
        assert_eq!(parse_ics("hello", &pdt()), Err(IcsError::NotCalendar));
    }
}
