//! Natural-language quick add: `"hw4 130a fri 11:59p ~2h !!"`.
//!
//! The grammar is mirrored in JavaScript by the UI (for instant highlighting), so any change
//! here must be made there too. Rules, applied word by word (words = whitespace-separated):
//!
//! 0. a first word `note:` `idea:` or `jot:` (any case, colon required) makes a note
//!    ([`ItemKind::Note`]) and is dropped from the title. In a note only rules 1, 2, 4 and 7
//!    apply (links, priority, tags, course); every other word is title text, so "11:59p" or
//!    "fri" stay in what you wrote.
//! 1. a link anywhere                      -> link (named after its site, `Link::from_url`). A word
//!    holding `http://` or `https://` is a link from there to the word's end, so `(https://…)`,
//!    `<https://…>`, `zoom:https://…` and Markdown's `[x](https://…)` work. A word starting `www.`,
//!    or a `host/path` whose host ends in a common web ending ([`WEB_ENDINGS`]), gets `https://`
//!    in front, so `github.com/me/pa2` is a link and `main.rs`, `node.js/react` or `e.g.` stay text.
//!    Trailing `. , ; : ! ? " ' > ] }` are left off, and a `)` while the link has more `)` than
//!    `(` (a Wikipedia `…_(film)` keeps its own). The whole word leaves the title ([`link_in`]).
//! 2. `!` `!!` `!!!` (whole word)          -> priority 1..3
//!    `whenfree` (whole word, any case)    -> when free: [`Draft::fit_free`] moves the time to the
//!    nearest free slot (see [`free_slot`]). With a date and no time it aims at 9:00 that day,
//!    with neither at now.
//! 3. `~2h` `~30m` `~1.5h` `~1h30m`         -> estimate minutes
//! 4. `#tag`                               -> tag (as typed; de-duplicated case-insensitively)
//! 5. `@place`                             -> location (text after `@`)
//! 6. two/three-word dates/times: `next <weekday>`, `in 3d|2w`, `in 3 day(s)|week(s)`,
//!    `<month> <day>`, `<day> <month>`, `at <time>`
//! 7. course: word equals (case-insensitive, spaces removed) an alias, code without space
//!    (`cmpsc130a`), number (`130a`) or `cs`+number (`cs130a`). Checked before single-word
//!    dates/times so a course like MATH 4A wins over "4a" = 4 AM.
//! 8. single-word dates: `today|tod`, `tonight` (21:00 unless a time is given),
//!    `tomorrow|tmr|tmrw`, weekday names + 3-letter abbreviations (next occurrence, same
//!    weekday = today), `M/D` (this year; >7 days in the past -> next year), `eod` (today
//!    23:59), `eow` (coming Friday 23:59; Friday = today)
//! 9. single-word times: `5pm` `5:30pm` `11:59p` `9a` `17:00` `noon` `midnight` (=23:59)
//! 10. otherwise the word is title text. If it is a kind keyword it is ALSO a `KindHint`
//!     token (stays in the title) and the FIRST such keyword sets the kind:
//!     word lowercased, non-alphanumerics trimmed from both ends, trailing digits stripped,
//!     then: hw homework pset assignment essay paper writeup pa -> assignment;
//!     exam midterm final, and `mt`+digits -> exam; quiz -> quiz; lab -> lab;
//!     read reading ch chapter -> reading; project proj -> project; oh -> office_hours;
//!     buy pick return renew call email print -> errand;
//!     apply application internship -> application; else task.
//!
//! Later tokens of the same type override earlier ones (last date/time/course/priority/
//! estimate/location wins); tags and links accumulate. Date without time -> 23:59 that day.
//! Time without date -> today if still in the future, else tomorrow. Title = remaining words
//! in original order joined by single spaces; with none, the item is named after its first link
//! ([`Draft::into_item`]), so a pasted link alone makes "Canvas". Token spans are UTF-8 byte offsets into the
//! input (equal to JS string indices for ASCII input).
//!
//! When free: the item takes `~estimate` (60 min without one) and the slot can't overlap anything
//! that holds time: open classes, sections, events, tickets, office hours and exams (`due` to
//! `end`, else an hour or their estimate), and any open item with an `end` after its `due` (an
//! earlier when-free block). The target itself is kept when it's free. Otherwise the slot moves
//! later (past each clash, to the next 5-minute mark) and earlier (to end before each clash),
//! never into the past and, once moved, only within 8:00-23:00; the one nearer the target wins,
//! earlier on a tie. The item gets `due` = the slot's start and `end` = its end.

use chrono::{
    DateTime, Datelike, Duration, FixedOffset, NaiveDate, NaiveTime, TimeZone, Utc, Weekday,
};
use serde::{Deserialize, Serialize};

use crate::model::{course_for_token, Course, Item, ItemKind, Link, Status};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenKind {
    Course,
    Date,
    Time,
    Estimate,
    Priority,
    Tag,
    Location,
    Url,
    KindHint,
    /// The `note:` / `idea:` / `jot:` that makes a note (rule 0).
    Note,
    /// `whenfree` (rule 2).
    WhenFree,
    Text,
}

/// A highlighted span of the input (byte offsets, `end` exclusive).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Token {
    pub start: usize,
    pub end: usize,
    pub kind: TokenKind,
}

/// The parse result; turn it into an [`Item`] with [`Draft::into_item`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Draft {
    pub title: String,
    pub kind: ItemKind,
    pub course_id: Option<String>,
    pub due: Option<DateTime<FixedOffset>>,
    pub est_minutes: Option<u32>,
    pub priority: u8,
    pub tags: Vec<String>,
    pub location: Option<String>,
    pub links: Vec<Link>,
    pub tokens: Vec<Token>,
    /// `whenfree`: [`Draft::fit_free`] puts it in the nearest free slot.
    #[serde(default)]
    pub when_free: bool,
    /// The slot's end, once [`Draft::fit_free`] placed it.
    #[serde(default)]
    pub end: Option<DateTime<FixedOffset>>,
    /// Where [`Draft::fit_free`] moved the time: -1 earlier, 0 kept, 1 later.
    #[serde(default)]
    pub moved: i8,
}

impl Draft {
    /// Build a new manual item. Status is `todo` when the draft has a due date or course, or is
    /// a note (notes skip triage), otherwise `inbox` (to be triaged). With no title words it's
    /// named after its first link, else "(untitled)". A note's text starts as its links, one a line.
    pub fn into_item(self, now: DateTime<Utc>, device: &str) -> Item {
        let title = if !self.title.trim().is_empty() {
            self.title
        } else if let Some(l) = self.links.first() {
            l.label.clone()
        } else {
            "(untitled)".to_string()
        };
        let mut it = Item::new(title, self.kind, now, device);
        it.status = if self.due.is_some() || self.course_id.is_some() || self.kind == ItemKind::Note
        {
            Status::Todo
        } else {
            Status::Inbox
        };
        it.course_id = self.course_id;
        it.due = self.due.map(|d| d.with_timezone(&Utc));
        it.end = self.end.map(|d| d.with_timezone(&Utc));
        it.est_minutes = self.est_minutes;
        it.priority = self.priority;
        it.tags = self.tags;
        it.location = self.location;
        if it.kind == ItemKind::Note {
            // a link leaves a note's title, so its text keeps it
            let urls: Vec<&str> = self.links.iter().map(|l| l.url.as_str()).collect();
            it.notes = urls.join("\n");
        }
        it.links = self.links;
        it
    }
}

fn hm(h: u32, m: u32) -> NaiveTime {
    NaiveTime::from_hms_opt(h, m, 0).expect("valid time")
}

fn at(offset: &FixedOffset, date: NaiveDate, time: NaiveTime) -> DateTime<FixedOffset> {
    offset
        .from_local_datetime(&date.and_time(time))
        .single()
        .expect("fixed offsets are unambiguous")
}

fn split_words(input: &str) -> Vec<(usize, usize, &str)> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    for (i, c) in input.char_indices() {
        if c.is_whitespace() {
            if let Some(s) = start.take() {
                out.push((s, i, &input[s..i]));
            }
        } else if start.is_none() {
            start = Some(i);
        }
    }
    if let Some(s) = start {
        out.push((s, input.len(), &input[s..]));
    }
    out
}

/// Endings a `host/path` link without `https://` may have (rule 1); `www.` hosts may end in anything.
pub const WEB_ENDINGS: [&str; 26] = [
    "com", "org", "net", "edu", "gov", "io", "dev", "app", "ai", "co", "me", "us", "uk", "ca", "gle",
    "be", "so", "site", "ly", "gg", "xyz", "info", "tv", "sh", "page", "to",
];

/// Rule 1: the link a word holds, if any, with `https://` put in front of a bare one.
/// Mirrored in engine.js `linkIn`.
pub fn link_in(word: &str) -> Option<String> {
    // ASCII lowercase keeps byte offsets, so a match indexes `word`
    let lw = word.to_ascii_lowercase();
    if let Some(at) = ["https://", "http://"].iter().filter_map(|p| lw.find(p)).min() {
        let s = trim_link_end(&word[at..]);
        let after = s.split_once("://").map_or("", |(_, r)| r);
        return after
            .chars()
            .next()
            .is_some_and(char::is_alphanumeric)
            .then(|| s.to_string());
    }
    let s = trim_link_end(word.trim_start_matches(['(', '<', '[', '{', '"', '\'']));
    let end = s.find(['/', '?', '#']).unwrap_or(s.len());
    let host = &s[..end];
    let labels: Vec<&str> = host.split('.').collect();
    let tld = labels[labels.len() - 1].to_ascii_lowercase();
    let ok = labels.len() >= 2
        && labels
            .iter()
            .all(|l| !l.is_empty() && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
        && tld.len() >= 2
        && tld.chars().all(|c| c.is_ascii_alphabetic())
        && (host.to_ascii_lowercase().starts_with("www.")
            || (WEB_ENDINGS.contains(&tld.as_str()) && s[end..].starts_with('/')));
    ok.then(|| format!("https://{s}"))
}

/// A link without the punctuation after it: `. , ; : ! ? " ' > ] }`, and a `)` it doesn't open.
fn trim_link_end(mut s: &str) -> &str {
    while let Some(c) = s.chars().last() {
        let cut = matches!(c, '.' | ',' | ';' | ':' | '!' | '?' | '"' | '\'' | '>' | ']' | '}')
            || (c == ')' && s.matches(')').count() > s.matches('(').count());
        if !cut {
            break;
        }
        s = &s[..s.len() - c.len_utf8()];
    }
    s
}

pub(crate) fn weekday_from(w: &str) -> Option<Weekday> {
    Some(match w {
        "monday" | "mon" => Weekday::Mon,
        "tuesday" | "tue" => Weekday::Tue,
        "wednesday" | "wed" => Weekday::Wed,
        "thursday" | "thu" => Weekday::Thu,
        "friday" | "fri" => Weekday::Fri,
        "saturday" | "sat" => Weekday::Sat,
        "sunday" | "sun" => Weekday::Sun,
        _ => return None,
    })
}

/// Next occurrence of `wd` on or after `today`.
pub(crate) fn next_weekday(today: NaiveDate, wd: Weekday) -> NaiveDate {
    let diff = (wd.num_days_from_monday() + 7 - today.weekday().num_days_from_monday()) % 7;
    today + Duration::days(diff as i64)
}

fn month_from(w: &str) -> Option<u32> {
    Some(match w {
        "jan" | "january" => 1,
        "feb" | "february" => 2,
        "mar" | "march" => 3,
        "apr" | "april" => 4,
        "may" => 5,
        "jun" | "june" => 6,
        "jul" | "july" => 7,
        "aug" | "august" => 8,
        "sep" | "sept" | "september" => 9,
        "oct" | "october" => 10,
        "nov" | "november" => 11,
        "dec" | "december" => 12,
        _ => return None,
    })
}

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

fn day_num(w: &str) -> Option<u32> {
    if w.len() <= 2 && all_digits(w) {
        let d: u32 = w.parse().ok()?;
        (1..=31).contains(&d).then_some(d)
    } else {
        None
    }
}

/// Month/day in this year, or next year if that is more than 7 days in the past.
fn month_day(today: NaiveDate, month: u32, day: u32) -> Option<NaiveDate> {
    let this = NaiveDate::from_ymd_opt(today.year(), month, day)?;
    if (today - this).num_days() > 7 {
        NaiveDate::from_ymd_opt(today.year() + 1, month, day)
    } else {
        Some(this)
    }
}

fn slash_date(today: NaiveDate, w: &str) -> Option<NaiveDate> {
    let (m, d) = w.split_once('/')?;
    if m.len() > 2 || d.len() > 2 || !all_digits(m) || !all_digits(d) {
        return None;
    }
    month_day(today, m.parse().ok()?, d.parse().ok()?)
}

/// `5pm` `5:30pm` `11:59p` `9a` `17:00` `noon` `midnight`(=23:59). Input must be lowercase.
pub(crate) fn parse_time(w: &str) -> Option<NaiveTime> {
    match w {
        "noon" => return Some(hm(12, 0)),
        "midnight" => return Some(hm(23, 59)),
        _ => {}
    }
    let (body, pm) = if let Some(b) = w.strip_suffix("pm").or_else(|| w.strip_suffix('p')) {
        (b, Some(true))
    } else if let Some(b) = w.strip_suffix("am").or_else(|| w.strip_suffix('a')) {
        (b, Some(false))
    } else {
        (w, None)
    };
    let (h, m) = match body.split_once(':') {
        Some((h, m)) => {
            if m.len() != 2 || !all_digits(m) {
                return None;
            }
            (h, m.parse::<u32>().ok()?)
        }
        None => {
            pm?; // a bare number is never a time
            (body, 0)
        }
    };
    if h.is_empty() || h.len() > 2 || !all_digits(h) || m > 59 {
        return None;
    }
    let h: u32 = h.parse().ok()?;
    let h24 = match pm {
        Some(is_pm) => {
            if !(1..=12).contains(&h) {
                return None;
            }
            match (h, is_pm) {
                (12, false) => 0,
                (12, true) => 12,
                (h, true) => h + 12,
                (h, false) => h,
            }
        }
        None => {
            if h > 23 {
                return None;
            }
            h
        }
    };
    NaiveTime::from_hms_opt(h24, m, 0)
}

/// `2h` `30m` `1.5h` `1h30m` (text after `~`).
fn parse_est(rest: &str) -> Option<u32> {
    let r = rest.to_lowercase();
    if let Some(m) = r.strip_suffix('m') {
        if let Some((h, mm)) = m.split_once('h') {
            if all_digits(h) && all_digits(mm) {
                return Some(h.parse::<u32>().ok()? * 60 + mm.parse::<u32>().ok()?);
            }
            return None;
        }
        return if all_digits(m) { m.parse().ok() } else { None };
    }
    if let Some(h) = r.strip_suffix('h') {
        let dots = h.matches('.').count();
        let ok = !h.is_empty()
            && dots <= 1
            && h.bytes().all(|b| b.is_ascii_digit() || b == b'.')
            && h.bytes().any(|b| b.is_ascii_digit());
        if !ok {
            return None;
        }
        let f: f64 = h.parse().ok()?;
        return Some((f * 60.0).round() as u32);
    }
    None
}

/// `3d` / `2w` -> days.
fn rel_compact(w: &str) -> Option<i64> {
    let (num, mult) = match w.strip_suffix('d') {
        Some(n) => (n, 1),
        None => (w.strip_suffix('w')?, 7),
    };
    if !all_digits(num) || num.len() > 4 {
        return None;
    }
    Some(num.parse::<i64>().ok()? * mult)
}

fn rel_unit(w: &str) -> Option<i64> {
    match w {
        "day" | "days" => Some(1),
        "week" | "weeks" => Some(7),
        _ => None,
    }
}

/// Kind keyword rule (see module docs).
pub fn kind_hint(word: &str) -> Option<ItemKind> {
    let w = word
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase();
    let base = w.trim_end_matches(|c: char| c.is_ascii_digit());
    if base == "mt" {
        return (base.len() < w.len()).then_some(ItemKind::Exam);
    }
    Some(match base {
        "hw" | "homework" | "pset" | "assignment" | "essay" | "paper" | "writeup" | "pa" => {
            ItemKind::Assignment
        }
        "exam" | "midterm" | "final" => ItemKind::Exam,
        "quiz" => ItemKind::Quiz,
        "lab" => ItemKind::Lab,
        "read" | "reading" | "ch" | "chapter" => ItemKind::Reading,
        "project" | "proj" => ItemKind::Project,
        "oh" => ItemKind::OfficeHours,
        "buy" | "pick" | "return" | "renew" | "call" | "email" | "print" => ItemKind::Errand,
        "apply" | "application" | "internship" => ItemKind::Application,
        _ => return None,
    })
}

/// Parse a quick-add line. `now` carries the user's local UTC offset; dates are resolved in it.
pub fn parse(input: &str, now: DateTime<FixedOffset>, courses: &[Course]) -> Draft {
    let words = split_words(input);
    let n = words.len();
    let today = now.date_naive();
    let off = *now.offset();
    let eod = hm(23, 59);

    let mut tokens: Vec<Token> = Vec::new();
    let mut title_words: Vec<&str> = Vec::new();
    let mut kind: Option<ItemKind> = None;
    let mut course_id: Option<String> = None;
    let mut date: Option<(NaiveDate, NaiveTime)> = None; // (day, default time)
    let mut time: Option<NaiveTime> = None;
    let mut est: Option<u32> = None;
    let mut priority: u8 = 0;
    let mut tags: Vec<String> = Vec::new();
    let mut location: Option<String> = None;
    let mut links: Vec<Link> = Vec::new();
    let mut when_free = false;

    let lower: Vec<String> = words.iter().map(|w| w.2.to_lowercase()).collect();
    let mut i = 0;
    // 0. note prefix
    let note = lower
        .first()
        .is_some_and(|w| matches!(w.as_str(), "note:" | "idea:" | "jot:"));
    if note {
        kind = Some(ItemKind::Note);
        tokens.push(Token {
            start: words[0].0,
            end: words[0].1,
            kind: TokenKind::Note,
        });
        i = 1;
    }
    while i < n {
        let (s, _, raw) = words[i];
        let lw = lower[i].as_str();
        let nx = lower.get(i + 1).map(String::as_str);
        let nx2 = lower.get(i + 2).map(String::as_str);
        let mut push = |kind: TokenKind, last: usize| {
            tokens.push(Token {
                start: s,
                end: words[last].1,
                kind,
            });
        };

        // 1. link
        if let Some(url) = link_in(raw) {
            links.push(Link::from_url(&url));
            push(TokenKind::Url, i);
            i += 1;
            continue;
        }
        // 2. priority
        if matches!(raw, "!" | "!!" | "!!!") {
            priority = raw.len() as u8;
            push(TokenKind::Priority, i);
            i += 1;
            continue;
        }
        if !note && lw == "whenfree" {
            when_free = true;
            push(TokenKind::WhenFree, i);
            i += 1;
            continue;
        }
        // in a note, the rest is what you wrote: tags, links, priority and the course only
        if note {
            if let Some(c) = course_id
                .is_none()
                .then(|| course_for_token(raw, courses))
                .flatten()
            {
                course_id = Some(c.id.clone());
                push(TokenKind::Course, i);
            } else if let Some(tag) = raw.strip_prefix('#').filter(|t| !t.is_empty()) {
                if !tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
                    tags.push(tag.to_string());
                }
                push(TokenKind::Tag, i);
            } else {
                push(TokenKind::Text, i);
                title_words.push(raw);
            }
            i += 1;
            continue;
        }
        // 3. estimate
        if let Some(m) = raw.strip_prefix('~').and_then(parse_est) {
            est = Some(m);
            push(TokenKind::Estimate, i);
            i += 1;
            continue;
        }
        // 4. tag
        if let Some(tag) = raw.strip_prefix('#').filter(|t| !t.is_empty()) {
            if !tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
                tags.push(tag.to_string());
            }
            push(TokenKind::Tag, i);
            i += 1;
            continue;
        }
        // 5. location
        if let Some(place) = raw.strip_prefix('@').filter(|t| !t.is_empty()) {
            location = Some(place.to_string());
            push(TokenKind::Location, i);
            i += 1;
            continue;
        }
        // 6. multi-word dates / times
        if lw == "next" {
            if let Some(wd) = nx.and_then(weekday_from) {
                date = Some((next_weekday(today, wd) + Duration::days(7), eod));
                push(TokenKind::Date, i + 1);
                i += 2;
                continue;
            }
        }
        if lw == "in" {
            if let Some(days) = nx.and_then(rel_compact) {
                date = Some((today + Duration::days(days), eod));
                push(TokenKind::Date, i + 1);
                i += 2;
                continue;
            }
            if let (Some(num), Some(mult)) = (
                nx.filter(|x| all_digits(x) && x.len() <= 4),
                nx2.and_then(rel_unit),
            ) {
                let days = num.parse::<i64>().unwrap_or(0) * mult;
                date = Some((today + Duration::days(days), eod));
                push(TokenKind::Date, i + 2);
                i += 3;
                continue;
            }
        }
        if lw == "at" {
            if let Some(t) = nx.and_then(parse_time) {
                time = Some(t);
                push(TokenKind::Time, i + 1);
                i += 2;
                continue;
            }
        }
        if let (Some(m), Some(d)) = (month_from(lw), nx.and_then(day_num)) {
            if let Some(dt) = month_day(today, m, d) {
                date = Some((dt, eod));
                push(TokenKind::Date, i + 1);
                i += 2;
                continue;
            }
        }
        if let (Some(d), Some(m)) = (day_num(lw), nx.and_then(month_from)) {
            if let Some(dt) = month_day(today, m, d) {
                date = Some((dt, eod));
                push(TokenKind::Date, i + 1);
                i += 2;
                continue;
            }
        }
        // 7. course
        if let Some(c) = course_for_token(raw, courses) {
            course_id = Some(c.id.clone());
            push(TokenKind::Course, i);
            i += 1;
            continue;
        }
        // 8. single-word dates
        let single_date = match lw {
            "today" | "tod" => Some((today, eod)),
            "tonight" => Some((today, hm(21, 0))),
            "tomorrow" | "tmr" | "tmrw" => Some((today + Duration::days(1), eod)),
            "eod" => Some((today, eod)),
            "eow" => Some((next_weekday(today, Weekday::Fri), eod)),
            _ => weekday_from(lw)
                .map(|wd| (next_weekday(today, wd), eod))
                .or_else(|| slash_date(today, lw).map(|d| (d, eod))),
        };
        if let Some(dt) = single_date {
            date = Some(dt);
            push(TokenKind::Date, i);
            i += 1;
            continue;
        }
        // 9. time
        if let Some(t) = parse_time(lw) {
            time = Some(t);
            push(TokenKind::Time, i);
            i += 1;
            continue;
        }
        // 10. title text (+ kind hint)
        if let Some(k) = kind_hint(raw) {
            if kind.is_none() {
                kind = Some(k);
            }
            push(TokenKind::KindHint, i);
        } else {
            push(TokenKind::Text, i);
        }
        title_words.push(raw);
        i += 1;
    }

    let due = match (date, time) {
        // when free with a day and no time: from the start of that day
        (Some((d, _)), None) if when_free => Some(at(&off, d, hm(9, 0))),
        (Some((d, default_t)), t) => Some(at(&off, d, t.unwrap_or(default_t))),
        (None, Some(t)) => {
            let today_at = at(&off, today, t);
            Some(if today_at > now {
                today_at
            } else {
                at(&off, today + Duration::days(1), t)
            })
        }
        (None, None) => None,
    };

    Draft {
        title: title_words.join(" "),
        kind: kind.unwrap_or(ItemKind::Task),
        course_id,
        due,
        est_minutes: est,
        priority,
        tags,
        location,
        links,
        tokens,
        when_free,
        end: None,
        moved: 0,
    }
}

impl Draft {
    /// `whenfree`: move `due` to the nearest free slot among `items` and set `end` (module docs).
    pub fn fit_free(&mut self, items: &[Item], now: DateTime<FixedOffset>) {
        if !self.when_free {
            return;
        }
        let len = Duration::minutes(self.est_minutes.unwrap_or(60).clamp(5, 12 * 60) as i64);
        let target = self
            .due
            .filter(|d| *d > now)
            .unwrap_or_else(|| round5(now, true));
        let (start, moved) = free_slot(target, len, &busy_blocks(items), now);
        self.due = Some(start);
        self.end = Some(start + len);
        self.moved = moved;
    }
}

/// What holds time: open scheduled items and exams, and open items with an `end` after `due`.
pub fn busy_blocks(items: &[Item]) -> Vec<(DateTime<Utc>, DateTime<Utc>)> {
    items
        .iter()
        .filter(|it| !it.deleted && !matches!(it.status, Status::Done | Status::Dropped))
        .filter_map(|it| {
            let s = it.due?;
            match it.end {
                Some(e) if e > s => Some((s, e)),
                _ if it.kind.is_scheduled() || it.kind == ItemKind::Exam => Some((
                    s,
                    s + Duration::minutes(it.est_minutes.unwrap_or(60).max(5) as i64),
                )),
                _ => None,
            }
        })
        .collect()
}

/// To the next (`up`) or the last 5-minute mark.
fn round5(t: DateTime<FixedOffset>, up: bool) -> DateTime<FixedOffset> {
    let s = t.timestamp();
    let r = s.rem_euclid(300);
    let s = if r == 0 {
        s
    } else if up {
        s + 300 - r
    } else {
        s - r
    };
    DateTime::from_timestamp(s, 0)
        .expect("in range")
        .with_timezone(t.offset())
}

/// The waking window, 8:00 to 23:00, of the day `days` after `t`'s.
fn window(t: DateTime<FixedOffset>, days: i64) -> (DateTime<FixedOffset>, DateTime<FixedOffset>) {
    let d = t.date_naive() + Duration::days(days);
    (at(t.offset(), d, hm(8, 0)), at(t.offset(), d, hm(23, 0)))
}

/// The nearest slot of `len` clear of `busy`, from `target`: (start, -1 earlier, 0 kept, 1 later).
pub fn free_slot(
    target: DateTime<FixedOffset>,
    len: Duration,
    busy: &[(DateTime<Utc>, DateTime<Utc>)],
    now: DateTime<FixedOffset>,
) -> (DateTime<FixedOffset>, i8) {
    let clashes =
        |s: DateTime<FixedOffset>| busy.iter().filter(move |(a, b)| *a < s + len && *b > s);
    if clashes(target).next().is_none() {
        return (target, 0);
    }
    // later: past each clash, into the next morning when the evening runs out (two weeks at most)
    let mut later = None;
    let mut t = round5(target, true);
    for _ in 0..400 {
        if t - target > Duration::days(14) {
            break;
        }
        let (ws, we) = window(t, 0);
        if t < ws {
            t = ws;
        }
        if t + len > we {
            t = window(t, 1).0;
            continue;
        }
        match clashes(t).map(|(_, b)| *b).max() {
            Some(e) => t = round5(e.with_timezone(t.offset()), true),
            None => {
                later = Some(t);
                break;
            }
        }
    }
    // earlier: ending before each clash, back into the evening before when the morning runs out, never before now
    let mut earlier = None;
    let mut t = round5(target, false);
    for _ in 0..400 {
        let (ws, we) = window(t, 0);
        if t + len > we {
            t = round5(we - len, false);
        }
        if t < ws {
            t = round5(window(t, -1).1 - len, false);
            continue;
        }
        if t < now {
            break;
        }
        match clashes(t).map(|(a, _)| *a).min() {
            Some(s) => t = round5(s.with_timezone(t.offset()) - len, false),
            None => {
                earlier = Some(t);
                break;
            }
        }
    }
    match (earlier, later) {
        (Some(e), Some(l)) if target - e <= l - target => (e, -1),
        (_, Some(l)) => (l, 1),
        (Some(e), None) => (e, -1),
        (None, None) => (target, 0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Wednesday 2026-10-28 10:00 PDT.
    fn now() -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339("2026-10-28T10:00:00-07:00").unwrap()
    }

    fn dt(s: &str) -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339(s).unwrap()
    }

    fn courses() -> Vec<Course> {
        let mut algo = Course::new("cmpsc130a", "CMPSC 130A");
        algo.aliases = vec!["algo".into()];
        let mut pstat = Course::new("pstat120a", "PSTAT 120A");
        pstat.aliases = vec!["pstat".into()];
        vec![
            algo,
            Course::new("cmpsc154", "CMPSC 154"),
            Course::new("cmpsc138", "CMPSC 138"),
            pstat,
            Course::new("math4a", "MATH 4A"),
        ]
    }

    fn p(s: &str) -> Draft {
        parse(s, now(), &courses())
    }

    #[test]
    fn hw_full() {
        let d = p("hw4 130a fri 11:59p ~2h !!");
        assert_eq!(d.title, "hw4");
        assert_eq!(d.kind, ItemKind::Assignment);
        assert_eq!(d.course_id.as_deref(), Some("cmpsc130a"));
        assert_eq!(d.due, Some(dt("2026-10-30T23:59:00-07:00")));
        assert_eq!(d.est_minutes, Some(120));
        assert_eq!(d.priority, 2);
        let kinds: Vec<TokenKind> = d.tokens.iter().map(|t| t.kind).collect();
        assert_eq!(
            kinds,
            vec![
                TokenKind::KindHint,
                TokenKind::Course,
                TokenKind::Date,
                TokenKind::Time,
                TokenKind::Estimate,
                TokenKind::Priority
            ]
        );
        assert_eq!((d.tokens[1].start, d.tokens[1].end), (4, 8));
    }

    #[test]
    fn lab_tmr() {
        let d = p("lab 3 cs154 tmr");
        assert_eq!(d.title, "lab 3");
        assert_eq!(d.kind, ItemKind::Lab);
        assert_eq!(d.course_id.as_deref(), Some("cmpsc154"));
        assert_eq!(d.due, Some(dt("2026-10-29T23:59:00-07:00")));
    }

    #[test]
    fn email_tonight() {
        let d = p("email TA about regrade !!! tonight");
        assert_eq!(d.title, "email TA about regrade");
        assert_eq!(d.kind, ItemKind::Errand);
        assert_eq!(d.priority, 3);
        assert_eq!(d.due, Some(dt("2026-10-28T21:00:00-07:00")));
    }

    #[test]
    fn tonight_with_time() {
        let d = p("call mom tonight 11pm");
        assert_eq!(d.due, Some(dt("2026-10-28T23:00:00-07:00")));
    }

    #[test]
    fn reading_in_2d() {
        let d = p("read sipser ch 2 138 in 2d ~45m #exam");
        assert_eq!(d.title, "read sipser ch 2");
        assert_eq!(d.kind, ItemKind::Reading);
        assert_eq!(d.course_id.as_deref(), Some("cmpsc138"));
        assert_eq!(d.due, Some(dt("2026-10-30T23:59:00-07:00")));
        assert_eq!(d.est_minutes, Some(45));
        assert_eq!(d.tags, vec!["exam".to_string()]);
    }

    #[test]
    fn midterm_slash_date() {
        let d = p("midterm 2 pstat 11/12 2pm");
        assert_eq!(d.title, "midterm 2");
        assert_eq!(d.kind, ItemKind::Exam);
        assert_eq!(d.course_id.as_deref(), Some("pstat120a"));
        assert_eq!(d.due, Some(dt("2026-11-12T14:00:00-07:00")));
    }

    #[test]
    fn errand_location() {
        let d = p("buy blue books @bookstore");
        assert_eq!(d.title, "buy blue books");
        assert_eq!(d.kind, ItemKind::Errand);
        assert_eq!(d.location.as_deref(), Some("bookstore"));
        assert_eq!(d.due, None);
    }

    #[test]
    fn plain() {
        let d = p("plain thing   no  metadata");
        assert_eq!(d.title, "plain thing no metadata");
        assert_eq!(d.kind, ItemKind::Task);
        assert_eq!(d.course_id, None);
        assert_eq!(d.due, None);
        assert_eq!(d.priority, 0);
        assert!(d.tokens.iter().all(|t| t.kind == TokenKind::Text));
        let it = d.into_item(now().with_timezone(&Utc), "dev");
        assert_eq!(it.status, Status::Inbox);
    }

    #[test]
    fn next_weekday_and_same_day() {
        assert_eq!(
            p("x wed").due,
            Some(dt("2026-10-28T23:59:00-07:00")),
            "same weekday = today"
        );
        assert_eq!(p("x next fri").due, Some(dt("2026-11-06T23:59:00-07:00")));
        assert_eq!(
            p("x next wednesday").due,
            Some(dt("2026-11-04T23:59:00-07:00"))
        );
        assert_eq!(p("x monday").due, Some(dt("2026-11-02T23:59:00-07:00")));
        assert_eq!(p("next steps").title, "next steps");
    }

    #[test]
    fn relative_days_and_weeks() {
        assert_eq!(p("x in 3 days").due, Some(dt("2026-10-31T23:59:00-07:00")));
        assert_eq!(p("x in 2w").due, Some(dt("2026-11-11T23:59:00-07:00")));
        assert_eq!(p("x in 1 week").due, Some(dt("2026-11-04T23:59:00-07:00")));
        let d = p("turn in hw");
        assert_eq!(d.title, "turn in hw");
        assert_eq!(d.due, None);
    }

    #[test]
    fn month_names_and_year_rollover() {
        assert_eq!(p("x nov 5").due, Some(dt("2026-11-05T23:59:00-07:00")));
        assert_eq!(p("x 5 nov").due, Some(dt("2026-11-05T23:59:00-07:00")));
        assert_eq!(
            p("x 10/25").due,
            Some(dt("2026-10-25T23:59:00-07:00")),
            "3 days ago stays"
        );
        assert_eq!(
            p("x 10/20").due,
            Some(dt("2027-10-20T23:59:00-07:00")),
            "8 days ago rolls"
        );
        assert_eq!(p("x 2/30").title, "x 2/30", "invalid date is text");
    }

    #[test]
    fn times_without_dates() {
        assert_eq!(p("x 5pm").due, Some(dt("2026-10-28T17:00:00-07:00")));
        assert_eq!(
            p("x 9am").due,
            Some(dt("2026-10-29T09:00:00-07:00")),
            "past -> tomorrow"
        );
        assert_eq!(p("x at noon").due, Some(dt("2026-10-28T12:00:00-07:00")));
        assert_eq!(p("x midnight").due, Some(dt("2026-10-28T23:59:00-07:00")));
        assert_eq!(p("x 17:30").due, Some(dt("2026-10-28T17:30:00-07:00")));
        assert_eq!(p("x 5:30pm").due, Some(dt("2026-10-28T17:30:00-07:00")));
        assert_eq!(p("x 12am").due, Some(dt("2026-10-29T00:00:00-07:00")));
        let d = p("meet at 5pm");
        assert_eq!(d.title, "meet");
        assert_eq!(d.tokens[1].kind, TokenKind::Time);
        assert_eq!((d.tokens[1].start, d.tokens[1].end), (5, 11));
        assert_eq!(p("look at this").title, "look at this");
    }

    #[test]
    fn eod_eow_today() {
        assert_eq!(p("x eod").due, Some(dt("2026-10-28T23:59:00-07:00")));
        assert_eq!(p("x eow").due, Some(dt("2026-10-30T23:59:00-07:00")));
        assert_eq!(p("x tod 3pm").due, Some(dt("2026-10-28T15:00:00-07:00")));
        assert_eq!(p("x tmrw at 9a").due, Some(dt("2026-10-29T09:00:00-07:00")));
    }

    #[test]
    fn estimates() {
        assert_eq!(p("x ~1.5h").est_minutes, Some(90));
        assert_eq!(p("x ~1h30m").est_minutes, Some(90));
        assert_eq!(p("x ~30m").est_minutes, Some(30));
        let d = p("x ~soon");
        assert_eq!(d.est_minutes, None);
        assert_eq!(d.title, "x ~soon");
    }

    #[test]
    fn priority_must_be_standalone() {
        let d = p("wow! !");
        assert_eq!(d.priority, 1);
        assert_eq!(d.title, "wow!");
        assert_eq!(p("x !!!!").priority, 0);
    }

    #[test]
    fn course_alias_and_code() {
        assert_eq!(p("pset algo").course_id.as_deref(), Some("cmpsc130a"));
        assert_eq!(p("pset CMPSC130A").course_id.as_deref(), Some("cmpsc130a"));
        assert_eq!(p("pset 130A").title, "pset");
        let d = p("quiz 4a");
        assert_eq!(d.course_id.as_deref(), Some("math4a"), "course beats 4 AM");
        assert_eq!(d.due, None);
        assert_eq!(d.kind, ItemKind::Quiz);
    }

    #[test]
    fn kinds() {
        assert_eq!(p("mt2 review").kind, ItemKind::Exam);
        assert_eq!(p("mt review").kind, ItemKind::Task);
        assert_eq!(p("pa1 writeup").kind, ItemKind::Assignment);
        assert_eq!(
            p("final project demo").kind,
            ItemKind::Exam,
            "first keyword wins"
        );
        assert_eq!(p("oh 130a thu 3pm").kind, ItemKind::OfficeHours);
        assert_eq!(p("apply to internship").kind, ItemKind::Application);
        assert_eq!(p("proj milestone").kind, ItemKind::Project);
        assert_eq!(p("(hw5)").kind, ItemKind::Assignment);
    }

    #[test]
    fn urls_tags_links() {
        let d = p("submit report https://canvas.ucsb.edu/courses/1/assignments/2 #cs #CS #ucsb");
        assert_eq!(d.title, "submit report");
        assert_eq!(d.links.len(), 1);
        assert_eq!(d.links[0].label, "Canvas");
        assert_eq!(d.tags, vec!["cs".to_string(), "ucsb".to_string()]);
        assert_eq!(d.kind, ItemKind::Task);
    }

    #[test]
    fn links_anywhere() {
        let d = p("read (https://en.wikipedia.org/wiki/Heap_(data_structure)). fri");
        assert_eq!(
            d.links[0].url,
            "https://en.wikipedia.org/wiki/Heap_(data_structure)"
        );
        assert_eq!(d.title, "read");
        assert!(d.due.is_some());
        let d = p("pa2 <https://www.gradescope.com/courses/9>, zoom:https://ucsb.zoom.us/j/1 [doc](HTTPS://docs.google.com/document/d/x/edit)");
        let got: Vec<(&str, &str)> = d
            .links
            .iter()
            .map(|l| (l.label.as_str(), l.url.as_str()))
            .collect();
        assert_eq!(
            got,
            vec![
                ("Gradescope", "https://www.gradescope.com/courses/9"),
                ("Zoom", "https://ucsb.zoom.us/j/1"),
                ("Google Docs", "HTTPS://docs.google.com/document/d/x/edit"),
            ]
        );
        assert_eq!((d.title.as_str(), d.kind), ("pa2", ItemKind::Assignment));
        let d = p("fix main.rs and node.js/react, see github.com/me/pa2. www.piazza.com e.g.");
        let urls: Vec<&str> = d.links.iter().map(|l| l.url.as_str()).collect();
        assert_eq!(urls, vec!["https://github.com/me/pa2", "https://www.piazza.com"]);
        assert_eq!(d.title, "fix main.rs and node.js/react, see e.g.");
        assert!(p("https:// http:// www. x.com/").links.len() == 1);
        assert_eq!(link_in("x.com/"), Some("https://x.com/".into()));
        assert_eq!(link_in("https://"), None);
    }

    #[test]
    fn a_link_alone_names_the_item() {
        let d = p("https://canvas.ucsb.edu/courses/1/assignments/2 fri");
        assert_eq!(d.title, "");
        let it = d.into_item(now().with_timezone(&Utc), "dev");
        assert_eq!((it.title.as_str(), it.links.len()), ("Canvas", 1));
        let it = p("!!").into_item(now().with_timezone(&Utc), "dev");
        assert_eq!(it.title, "(untitled)");
    }

    #[test]
    fn into_item_sets_fields() {
        let d = p("hw4 130a fri ~2h !!");
        let it = d.into_item(now().with_timezone(&Utc), "dev-1");
        assert_eq!(it.status, Status::Todo);
        assert_eq!(it.due, Some(dt("2026-10-31T06:59:00Z").with_timezone(&Utc)));
        assert_eq!(it.updated_by, "dev-1");
        assert_eq!(it.source.adapter, "manual");
    }

    #[test]
    fn notes_keep_what_you_wrote() {
        let d = p("idea: island shows 11:59p deadlines fri 130a #collegiapp !");
        assert_eq!(d.kind, ItemKind::Note);
        assert_eq!(d.title, "island shows 11:59p deadlines fri");
        assert_eq!(d.course_id.as_deref(), Some("cmpsc130a"));
        assert_eq!(d.tags, vec!["collegiapp".to_string()]);
        assert_eq!((d.due, d.priority), (None, 1));
        assert_eq!(d.tokens[0].kind, TokenKind::Note);
        let it = d.into_item(now().with_timezone(&Utc), "dev");
        assert_eq!(it.status, Status::Todo, "notes skip the inbox");
        assert_eq!(p("NOTE: x").kind, ItemKind::Note);
        assert_eq!(
            p("note to self").kind,
            ItemKind::Task,
            "only the prefix with a colon"
        );
        assert_eq!(p("hw note: x").kind, ItemKind::Assignment);
        let links = p("jot: read https://x.dev/a later");
        assert_eq!(links.title, "read later");
        assert_eq!(links.links.len(), 1);
        let it = links.into_item(now().with_timezone(&Utc), "dev");
        assert_eq!(it.notes, "https://x.dev/a", "the note keeps the link it was given");
    }

    #[test]
    fn unicode_spans_are_bytes() {
        let d = p("café hw !");
        assert_eq!(d.tokens[1].start, 6);
        assert_eq!(d.title, "café hw");
    }

    fn block(kind: ItemKind, from: &str, to: &str) -> Item {
        let mut it = Item::new("busy", kind, now().with_timezone(&Utc), "test");
        it.status = Status::Todo;
        it.due = Some(dt(from).with_timezone(&Utc));
        it.end = Some(dt(to).with_timezone(&Utc));
        it
    }

    #[test]
    fn whenfree_keeps_a_free_target_and_blocks_the_estimate() {
        let mut d = p("study 130a fri 3pm ~2h whenfree");
        assert!(d.when_free);
        assert_eq!(d.title, "study");
        assert!(d.tokens.iter().any(|t| t.kind == TokenKind::WhenFree));
        d.fit_free(&[], now());
        assert_eq!(d.due, Some(dt("2026-10-30T15:00:00-07:00")));
        assert_eq!(d.end, Some(dt("2026-10-30T17:00:00-07:00")));
        assert_eq!(d.moved, 0);
        let it = d.into_item(now().with_timezone(&Utc), "test");
        assert_eq!(
            it.end,
            Some(dt("2026-10-30T17:00:00-07:00").with_timezone(&Utc))
        );
    }

    #[test]
    fn whenfree_moves_to_the_nearer_side_of_what_is_there() {
        // a lecture 2:00-3:15: an hour wanted at 2:05 fits nearer before it (1:00), one at 3:00 after it (3:15)
        let class = block(
            ItemKind::Class,
            "2026-10-30T14:00:00-07:00",
            "2026-10-30T15:15:00-07:00",
        );
        let mut d = p("read ch4 fri 2:05pm whenfree");
        d.fit_free(std::slice::from_ref(&class), now());
        assert_eq!(
            (d.due, d.moved),
            (Some(dt("2026-10-30T13:00:00-07:00")), -1)
        );
        let mut d = p("read ch4 fri 3pm whenfree");
        d.fit_free(std::slice::from_ref(&class), now());
        assert_eq!((d.due, d.moved), (Some(dt("2026-10-30T15:15:00-07:00")), 1));
        // done and deleted items hold no time
        let mut gone = class.clone();
        gone.status = Status::Done;
        let mut d = p("read ch4 fri 2:30pm whenfree");
        d.fit_free(&[gone], now());
        assert_eq!(d.moved, 0);
    }

    #[test]
    fn whenfree_steps_past_back_to_back_blocks_and_never_into_the_past() {
        // now is 10:00; 10:00-11:00 and 11:00-12:20 are taken: the next free hour starts at 12:20
        let busy = [
            block(
                ItemKind::Event,
                "2026-10-28T10:00:00-07:00",
                "2026-10-28T11:00:00-07:00",
            ),
            block(
                ItemKind::Class,
                "2026-10-28T11:00:00-07:00",
                "2026-10-28T12:20:00-07:00",
            ),
        ];
        let mut d = p("call mom ~20m whenfree");
        assert_eq!(d.due, None);
        d.fit_free(&busy, now());
        assert_eq!((d.due, d.moved), (Some(dt("2026-10-28T12:20:00-07:00")), 1));
        assert_eq!(d.end, Some(dt("2026-10-28T12:40:00-07:00")));
        // a day without a time aims at 9:00 that day
        let mut d = p("laundry sat whenfree");
        assert_eq!(d.due, Some(dt("2026-10-31T09:00:00-07:00")));
        d.fit_free(&busy, now());
        assert_eq!(d.moved, 0);
    }

    #[test]
    fn whenfree_wraps_to_the_next_morning_and_is_text_in_a_note() {
        let late = block(
            ItemKind::Event,
            "2026-10-28T21:30:00-07:00",
            "2026-10-28T23:30:00-07:00",
        );
        let mut d = p("pset 10pm ~2h whenfree");
        d.fit_free(std::slice::from_ref(&late), now());
        // before it (19:30) is nearer than the next morning (8:00)
        assert_eq!(
            (d.due, d.moved),
            (Some(dt("2026-10-28T19:30:00-07:00")), -1)
        );
        let n = p("note: whenfree is a keyword");
        assert!(!n.when_free);
        assert_eq!(n.title, "whenfree is a keyword");
    }
}
