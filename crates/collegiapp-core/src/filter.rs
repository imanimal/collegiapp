//! Filter DSL used by views and the filter bar. Mirrored in JS by the UI.
//!
//! * Whitespace-separated terms are ANDed. `"quoted strings"` are one term.
//! * `-term` negates. `key:a,b` is OR within the key.
//! * Keys:
//!   - `kind:` any kind name (`office_hours`, `note`), its plural (`exams`, `quizzes`), or alias
//!     `hw`/`homework` (assignment), `oh`/`officehours` (office_hours), `idea`/`jot` (note),
//!     `work` (assignment,
//!     lab, quiz, project, reading: [`ItemKind::WORK`]), `section` (a class tagged
//!     `section`) and `lecture` (a class that isn't)
//!   - `course:` code/alias/number per the quick-add course rule (`130a`, `cs130a`,
//!     `cmpsc130a`, alias); `course:none` = no course
//!   - `status:` inbox|todo|doing|done|dropped
//!   - `src:` (or `source:`) source adapter, e.g. `src:canvas`
//!   - `tag:x` or `#x`
//!   - `pri:2` (equal; `pri:2,3` OR), `pri>=2` `pri>2` `pri<2` `pri<=2`, `!2` = pri>=2,
//!     `!`/`!!`/`!!!` = pri>=1/2/3 (alias key `priority`)
//!   - `is:` open|done|actionable|scheduled|overdue|snoozed|excluded. `overdue` = open,
//!     actionable and past due: a class or event that has started is never overdue
//!   - `due` with `:` `<` `<=` `>` `>=` and values today|tomorrow|tmr|<weekday>|week|Nd|
//!     overdue|none. Each day value names a local calendar day (weekday = next occurrence,
//!     same weekday = today; `week` = the coming Sunday, today if Sunday; `Nd` = today+N):
//!     - `due:<day>`: due falls on that day (today/tomorrow/weekday), or for `week`/`Nd`
//!       anywhere from the start of today through the end of that day
//!     - `due<=X`: due <= end of day X; `due<X`: due < start of day X
//!     - `due>=X`: due >= start of day X; `due>X`: due > end of day X
//!     - `due:overdue`: the same as `is:overdue`; `due:none`: no due date (other ops act
//!       like `:`)
//!     - items with no due date never match day comparisons
//! * Bare words / quoted strings: case-insensitive substring of the title, notes, location,
//!   tags, course code or title, or the kind's words ([`kind_words`]: "assignment", "work",
//!   "section", plurals), so `assignments` or `section` finds them; a course token (`130a`,
//!   an alias) also matches the course's items.
//! * Unknown `key:value` tokens are treated as bare words. Known keys with bad values are
//!   flagged `valid: false` in [`Filter::terms`] and ignored (match everything).
//! * Deleted (tombstoned) items never match. Items whose course has `included == false` are
//!   hidden unless the query contains a non-negated `is:excluded` (which itself matches only
//!   items in excluded courses).

use chrono::{DateTime, Duration, FixedOffset, NaiveDate, NaiveTime, TimeZone, Utc, Weekday};
use serde::{Deserialize, Serialize};

use crate::ics::SECTION_TAG;
use crate::model::{normalize_token, Course, Item, ItemKind, Sort, Status};
use crate::quickadd::{next_weekday, weekday_from};
use crate::score::{score, sort_ranked, RankedItem};

/// Evaluation context: the local "now" (its offset defines day boundaries) and courses.
#[derive(Debug, Clone, Copy)]
pub struct Ctx<'a> {
    pub now: DateTime<FixedOffset>,
    pub courses: &'a [Course],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Eq,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DueVal {
    Day(i64),
    Weekday(Weekday),
    Week,
    Within(i64),
    Overdue,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KindVal {
    Kind(ItemKind),
    /// A class tagged [`SECTION_TAG`].
    Section,
    /// A class that isn't a section.
    Lecture,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IsFlag {
    Open,
    Done,
    Actionable,
    Scheduled,
    Overdue,
    Snoozed,
    Excluded,
}

#[derive(Debug, Clone, PartialEq)]
enum Term {
    Kind(Vec<KindVal>),
    Course(Vec<String>),
    Status(Vec<Status>),
    Src(Vec<String>),
    Tag(Vec<String>),
    Pri(Op, Vec<u8>),
    Is(Vec<IsFlag>),
    Due(Op, Vec<DueVal>),
    Text(String),
    Invalid,
}

#[derive(Debug, Clone, PartialEq)]
struct Clause {
    raw: String,
    key: &'static str,
    negated: bool,
    term: Term,
}

/// A parsed term, for rendering filter chips.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FilterTerm {
    /// The term as typed (including any leading `-`).
    pub raw: String,
    /// Canonical key: kind|course|status|src|tag|pri|is|due|text.
    pub key: String,
    pub negated: bool,
    /// False when a known key has an unparseable value (the term is ignored).
    pub valid: bool,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Filter {
    clauses: Vec<Clause>,
    show_excluded: bool,
}

fn tokenize(q: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quote = false;
    for c in q.chars() {
        if c == '"' {
            in_quote = !in_quote;
            cur.push(c);
        } else if c.is_whitespace() && !in_quote {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(c);
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn values(v: &str) -> Vec<String> {
    v.split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

fn all_or_invalid<T>(vals: &[String], f: impl Fn(&str) -> Option<T>) -> Option<Vec<T>> {
    if vals.is_empty() {
        return None;
    }
    vals.iter().map(|v| f(v)).collect()
}

fn parse_due_val(v: &str) -> Option<DueVal> {
    Some(match v {
        "today" => DueVal::Day(0),
        "tomorrow" | "tmr" => DueVal::Day(1),
        "week" => DueVal::Week,
        "overdue" => DueVal::Overdue,
        "none" => DueVal::None,
        _ => {
            if let Some(wd) = weekday_from(v) {
                DueVal::Weekday(wd)
            } else {
                let n = v.strip_suffix('d')?;
                if n.is_empty() || n.len() > 4 || !n.bytes().all(|b| b.is_ascii_digit()) {
                    return None;
                }
                DueVal::Within(n.parse().ok()?)
            }
        }
    })
}

/// A `kind:` value: a kind, its plural, an alias, or a group (`work`).
fn parse_kind(v: &str) -> Option<Vec<KindVal>> {
    let one = |v: &str| -> Option<Vec<KindVal>> {
        Some(match v {
            "work" => ItemKind::WORK.iter().map(|k| KindVal::Kind(*k)).collect(),
            "section" => vec![KindVal::Section],
            "lecture" => vec![KindVal::Lecture],
            "quizzes" => vec![KindVal::Kind(ItemKind::Quiz)],
            _ => vec![KindVal::Kind(ItemKind::from_name(v)?)],
        })
    };
    one(v)
        .or_else(|| one(v.strip_suffix('s')?))
        .or_else(|| one(v.strip_suffix("es")?))
}

fn is_section(item: &Item) -> bool {
    item.kind == ItemKind::Class
        && item
            .tags
            .iter()
            .any(|t| t.eq_ignore_ascii_case(SECTION_TAG))
}

/// The words a bare search term also looks in, so `assignments`, `work` or `section` find
/// those items whatever their titles say.
pub fn kind_words(item: &Item) -> &'static str {
    match item.kind {
        ItemKind::Task => "task tasks todo",
        ItemKind::Assignment => "assignment assignments homework hw work",
        ItemKind::Exam => "exam exams test tests",
        ItemKind::Quiz => "quiz quizzes work",
        ItemKind::Lab => "lab labs work",
        ItemKind::Reading => "reading readings work",
        ItemKind::Project => "project projects work",
        ItemKind::Class if is_section(item) => "class classes section sections",
        ItemKind::Class => "class classes lecture lectures",
        ItemKind::OfficeHours => "office hours oh",
        ItemKind::Event => "event events",
        ItemKind::Ticket => "ticket tickets",
        ItemKind::Errand => "errand errands",
        ItemKind::Application => "application applications apply",
        ItemKind::Note => "note notes idea ideas",
        ItemKind::Info => "info fyi",
    }
}

fn parse_is(v: &str) -> Option<IsFlag> {
    Some(match v {
        "open" => IsFlag::Open,
        "done" => IsFlag::Done,
        "actionable" => IsFlag::Actionable,
        "scheduled" => IsFlag::Scheduled,
        "overdue" => IsFlag::Overdue,
        "snoozed" => IsFlag::Snoozed,
        "excluded" => IsFlag::Excluded,
        _ => return None,
    })
}

fn parse_pri(v: &str) -> Option<u8> {
    let n: u8 = v.parse().ok()?;
    (n <= 3).then_some(n)
}

fn parse_clause(raw: &str) -> Clause {
    let (negated, body) = match raw.strip_prefix('-') {
        Some(rest) if !rest.is_empty() => (true, rest),
        _ => (false, raw),
    };
    let mk = |key: &'static str, term: Term| Clause {
        raw: raw.to_string(),
        key,
        negated,
        term,
    };

    if body.starts_with('"') {
        let t = body.trim_matches('"').to_lowercase();
        return mk(
            "text",
            if t.is_empty() {
                Term::Invalid
            } else {
                Term::Text(t)
            },
        );
    }
    if let Some(tag) = body.strip_prefix('#').filter(|t| !t.is_empty()) {
        return mk("tag", Term::Tag(vec![tag.to_lowercase()]));
    }
    if body.starts_with('!') {
        let rest = body.trim_start_matches('!');
        let bangs = body.len() - rest.len();
        if rest.is_empty() && bangs <= 3 {
            return mk("pri", Term::Pri(Op::Ge, vec![bangs as u8]));
        }
        if bangs == 1 {
            if let Some(n) = parse_pri(rest) {
                return mk("pri", Term::Pri(Op::Ge, vec![n]));
            }
        }
        return mk("text", Term::Text(body.to_lowercase()));
    }

    let key_end = body
        .find(|c: char| !c.is_ascii_alphabetic())
        .unwrap_or(body.len());
    let key = body[..key_end].to_ascii_lowercase();
    let rest = &body[key_end..];
    let (op, val) = if let Some(v) = rest.strip_prefix("<=") {
        (Some(Op::Le), v)
    } else if let Some(v) = rest.strip_prefix(">=") {
        (Some(Op::Ge), v)
    } else if let Some(v) = rest.strip_prefix('<') {
        (Some(Op::Lt), v)
    } else if let Some(v) = rest.strip_prefix('>') {
        (Some(Op::Gt), v)
    } else if let Some(v) = rest.strip_prefix(':').or_else(|| rest.strip_prefix('=')) {
        (Some(Op::Eq), v)
    } else {
        (None, rest)
    };
    let Some(op) = op else {
        return mk("text", Term::Text(body.to_lowercase()));
    };
    let vals = values(val);
    let eq_only = |t: Option<Term>| {
        if op == Op::Eq {
            t.unwrap_or(Term::Invalid)
        } else {
            Term::Invalid
        }
    };
    match key.as_str() {
        "kind" => mk(
            "kind",
            eq_only(all_or_invalid(&vals, parse_kind).map(|ks| Term::Kind(ks.concat()))),
        ),
        "course" => mk(
            "course",
            eq_only((!vals.is_empty()).then(|| Term::Course(vals.clone()))),
        ),
        "status" => mk(
            "status",
            eq_only(all_or_invalid(&vals, Status::from_name).map(Term::Status)),
        ),
        "src" | "source" => mk(
            "src",
            eq_only((!vals.is_empty()).then(|| Term::Src(vals.clone()))),
        ),
        "tag" => {
            let tags: Vec<String> = vals
                .iter()
                .map(|t| t.trim_start_matches('#').to_string())
                .collect();
            mk(
                "tag",
                eq_only((!tags.is_empty()).then_some(Term::Tag(tags))),
            )
        }
        "pri" | "priority" => {
            let term = match all_or_invalid(&vals, parse_pri) {
                Some(ns) if op == Op::Eq || ns.len() == 1 => Term::Pri(op, ns),
                _ => Term::Invalid,
            };
            mk("pri", term)
        }
        "is" => mk("is", eq_only(all_or_invalid(&vals, parse_is).map(Term::Is))),
        "due" => {
            let term = match all_or_invalid(&vals, parse_due_val) {
                Some(vs) if op == Op::Eq || vs.len() == 1 => Term::Due(op, vs),
                _ => Term::Invalid,
            };
            mk("due", term)
        }
        _ => mk("text", Term::Text(body.to_lowercase())),
    }
}

fn start_of(off: &FixedOffset, day: NaiveDate) -> DateTime<Utc> {
    off.from_local_datetime(&day.and_time(NaiveTime::MIN))
        .single()
        .expect("fixed offset")
        .with_timezone(&Utc)
}

impl Filter {
    pub fn parse(query: &str) -> Filter {
        let clauses: Vec<Clause> = tokenize(query).iter().map(|t| parse_clause(t)).collect();
        let show_excluded = clauses.iter().any(|c| {
            !c.negated && matches!(&c.term, Term::Is(flags) if flags.contains(&IsFlag::Excluded))
        });
        Filter {
            clauses,
            show_excluded,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.clauses.is_empty()
    }

    /// Parsed terms for UI chips.
    pub fn terms(&self) -> Vec<FilterTerm> {
        self.clauses
            .iter()
            .map(|c| FilterTerm {
                raw: c.raw.clone(),
                key: c.key.to_string(),
                negated: c.negated,
                valid: c.term != Term::Invalid,
            })
            .collect()
    }

    pub fn matches(&self, item: &Item, ctx: &Ctx) -> bool {
        if item.deleted {
            return false;
        }
        let course = item
            .course_id
            .as_ref()
            .and_then(|id| ctx.courses.iter().find(|c| &c.id == id));
        if !self.show_excluded && course.is_some_and(|c| !c.included) {
            return false;
        }
        self.clauses
            .iter()
            .all(|cl| match term_matches(&cl.term, item, course, ctx) {
                None => true,
                Some(m) => m != cl.negated,
            })
    }
}

/// None = term is invalid (ignored).
fn term_matches(term: &Term, item: &Item, course: Option<&Course>, ctx: &Ctx) -> Option<bool> {
    let now = ctx.now.with_timezone(&Utc);
    Some(match term {
        Term::Invalid => return None,
        Term::Kind(ks) => ks.iter().any(|k| match k {
            KindVal::Kind(k) => *k == item.kind,
            KindVal::Section => is_section(item),
            KindVal::Lecture => item.kind == ItemKind::Class && !is_section(item),
        }),
        Term::Course(vs) => vs.iter().any(|v| match (&item.course_id, course) {
            (None, _) => v == "none",
            (Some(_), Some(c)) => c.matches_token(v),
            (Some(id), None) => normalize_token(id) == normalize_token(v),
        }),
        Term::Status(ss) => ss.contains(&item.status),
        Term::Src(vs) => vs
            .iter()
            .any(|v| item.source.adapter.eq_ignore_ascii_case(v)),
        Term::Tag(ts) => ts
            .iter()
            .any(|t| item.tags.iter().any(|it| it.eq_ignore_ascii_case(t))),
        Term::Pri(op, ns) => {
            let p = item.priority;
            match op {
                Op::Eq => ns.contains(&p),
                Op::Lt => p < ns[0],
                Op::Le => p <= ns[0],
                Op::Gt => p > ns[0],
                Op::Ge => p >= ns[0],
            }
        }
        Term::Is(flags) => flags.iter().any(|f| match f {
            IsFlag::Open => item.is_open(now),
            IsFlag::Done => item.status == Status::Done,
            IsFlag::Actionable => item.kind.is_actionable(),
            IsFlag::Scheduled => item.kind.is_scheduled(),
            IsFlag::Overdue => item.is_overdue(now),
            IsFlag::Snoozed => item.is_snoozed(now),
            IsFlag::Excluded => course.is_some_and(|c| !c.included),
        }),
        Term::Due(op, vals) => vals.iter().any(|v| due_matches(*op, *v, item, ctx)),
        Term::Text(t) => {
            let has = |s: &str| s.to_lowercase().contains(t);
            has(&item.title)
                || has(&item.notes)
                || item.location.as_deref().is_some_and(has)
                || item.tags.iter().any(|g| has(g))
                || kind_words(item).contains(t.as_str())
                || course.is_some_and(|c| {
                    has(&c.code)
                        || has(&c.title)
                        || normalize_token(&c.code).contains(t)
                        || c.matches_token(t)
                })
        }
    })
}

fn due_matches(op: Op, v: DueVal, item: &Item, ctx: &Ctx) -> bool {
    let (now, due) = (ctx.now.with_timezone(&Utc), item.due);
    match v {
        DueVal::None => return due.is_none(),
        DueVal::Overdue => return item.is_overdue(now),
        _ => {}
    }
    let Some(due) = due else { return false };
    let off = ctx.now.offset();
    let today = ctx.now.date_naive();
    let day = match v {
        DueVal::Day(n) | DueVal::Within(n) => today + Duration::days(n),
        DueVal::Weekday(wd) => next_weekday(today, wd),
        DueVal::Week => next_weekday(today, Weekday::Sun),
        DueVal::Overdue | DueVal::None => unreachable!(),
    };
    let start = start_of(off, day);
    let next_start = start_of(off, day + Duration::days(1));
    match op {
        Op::Eq => match v {
            DueVal::Week | DueVal::Within(_) => due >= start_of(off, today) && due < next_start,
            _ => due >= start && due < next_start,
        },
        Op::Lt => due < start,
        Op::Le => due < next_start,
        Op::Gt => due >= next_start,
        Op::Ge => due >= start,
    }
}

/// Run a query: filter, score, sort. The core of every view.
pub fn run_query(items: &[Item], query: &str, sort: Sort, ctx: &Ctx) -> Vec<RankedItem> {
    let f = Filter::parse(query);
    let now = ctx.now.with_timezone(&Utc);
    let mut rows: Vec<RankedItem> = items
        .iter()
        .filter(|it| f.matches(it, ctx))
        .map(|it| RankedItem {
            item: it.clone(),
            score: score(it, now),
        })
        .collect();
    sort_ranked(&mut rows, sort);
    rows
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::default_views;

    fn now() -> DateTime<FixedOffset> {
        // Wednesday 2026-10-28 10:00 PDT
        DateTime::parse_from_rfc3339("2026-10-28T10:00:00-07:00").unwrap()
    }

    fn local(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn courses() -> Vec<Course> {
        let mut algo = Course::new("cmpsc130a", "CMPSC 130A");
        algo.aliases = vec!["algo".into()];
        let mut art = Course::new("art1a", "ART 1A");
        art.included = false;
        vec![algo, art]
    }

    fn mk(title: &str, kind: ItemKind) -> Item {
        Item::new(title, kind, now().with_timezone(&Utc), "d")
    }

    /// Fixture keyed by title.
    fn items() -> Vec<Item> {
        let mut hw = mk("hw4 graphs", ItemKind::Assignment);
        hw.course_id = Some("cmpsc130a".into());
        hw.due = Some(local("2026-10-29T23:59:00-07:00"));
        hw.tags = vec!["Exam".into()];
        hw.priority = 2;
        hw.source.adapter = "canvas".into();

        let mut exam = mk("midterm 2", ItemKind::Exam);
        exam.course_id = Some("cmpsc130a".into());
        exam.due = Some(local("2026-11-12T14:00:00-07:00"));

        let mut class = mk("CMPSC 130A lecture", ItemKind::Class);
        class.course_id = Some("cmpsc130a".into());
        class.due = Some(local("2026-10-28T14:00:00-07:00"));
        class.end = Some(local("2026-10-28T15:15:00-07:00"));

        let mut done = mk("old lab", ItemKind::Lab);
        done.status = Status::Done;
        done.due = Some(local("2026-10-20T23:59:00-07:00"));

        let mut art = mk("art sketchbook", ItemKind::Assignment);
        art.course_id = Some("art1a".into());
        art.due = Some(local("2026-10-28T23:59:00-07:00"));

        let mut inbox = mk("buy blue books", ItemKind::Errand);
        inbox.status = Status::Inbox;
        inbox.notes = "for the regrade".into();

        let mut late = mk("late reading", ItemKind::Reading);
        late.due = Some(local("2026-10-27T23:59:00-07:00"));

        let mut snoozed = mk("snoozed thing", ItemKind::Task);
        snoozed.snoozed_until = Some(local("2026-10-30T09:00:00-07:00"));
        snoozed.due = Some(local("2026-11-01T12:00:00-07:00"));
        snoozed.priority = 1;

        let mut gone = mk("deleted hw", ItemKind::Assignment);
        gone.deleted = true;

        vec![hw, exam, class, done, art, inbox, late, snoozed, gone]
    }

    fn titles(q: &str) -> Vec<String> {
        let cs = courses();
        let ctx = Ctx {
            now: now(),
            courses: &cs,
        };
        let f = Filter::parse(q);
        let mut v: Vec<String> = items()
            .into_iter()
            .filter(|i| f.matches(i, &ctx))
            .map(|i| i.title)
            .collect();
        v.sort();
        v
    }

    fn set(xs: &[&str]) -> Vec<String> {
        let mut v: Vec<String> = xs.iter().map(|s| s.to_string()).collect();
        v.sort();
        v
    }

    #[test]
    fn empty_query_hides_excluded_and_deleted() {
        let all = titles("");
        assert_eq!(all.len(), 7);
        assert!(!all.contains(&"art sketchbook".to_string()));
        assert!(!all.contains(&"deleted hw".to_string()));
    }

    #[test]
    fn kind_terms() {
        assert_eq!(titles("kind:hw"), set(&["hw4 graphs"]));
        assert_eq!(
            titles("kind:exam,class"),
            set(&["midterm 2", "CMPSC 130A lecture"])
        );
        assert_eq!(titles("-kind:class kind:exam,class"), set(&["midterm 2"]));
        assert_eq!(titles("kind:lecture"), set(&["CMPSC 130A lecture"]));
        assert_eq!(titles("kind:exams"), set(&["midterm 2"]));
        assert_eq!(titles("kind:classes"), set(&["CMPSC 130A lecture"]));
        assert_eq!(titles("kind:quizzes"), Vec::<String>::new());
        assert_eq!(
            titles("kind:work"),
            set(&["hw4 graphs", "old lab", "late reading"])
        );
        assert_eq!(
            titles("is:open kind:work"),
            set(&["hw4 graphs", "late reading"])
        );
        assert_eq!(titles("kind:section"), Vec::<String>::new());
        assert!(Filter::parse("kind:works").terms()[0].valid);
        assert!(!Filter::parse("kind:workz").terms()[0].valid);
    }

    #[test]
    fn notes_by_kind_and_words() {
        let cs = courses();
        let ctx = Ctx {
            now: now(),
            courses: &cs,
        };
        let mut idea = mk("island shows deadlines", ItemKind::Note);
        idea.notes = "- [ ] blink at **zero**".into();
        let hw = mk("hw5", ItemKind::Assignment);
        let pick = |q: &str| -> Vec<String> {
            let f = Filter::parse(q);
            [idea.clone(), hw.clone()]
                .into_iter()
                .filter(|i| f.matches(i, &ctx))
                .map(|i| i.title)
                .collect()
        };
        for q in [
            "kind:note",
            "kind:notes",
            "kind:idea",
            "ideas",
            "blink",
            "-kind:hw",
        ] {
            assert_eq!(pick(q), vec!["island shows deadlines"], "{q}");
        }
        assert_eq!(pick("is:actionable"), vec!["hw5"], "notes are not to-dos");
        assert!(pick("is:scheduled").is_empty());
    }

    #[test]
    fn sections_and_lectures() {
        let cs = courses();
        let ctx = Ctx {
            now: now(),
            courses: &cs,
        };
        let mut sec = mk("CMPSC 130A dis", ItemKind::Class);
        sec.tags = vec!["Section".into()];
        let lec = mk("CMPSC 130A", ItemKind::Class);
        let hits = |q: &str| {
            let f = Filter::parse(q);
            [&sec, &lec].iter().filter(|i| f.matches(i, &ctx)).count()
        };
        assert!(Filter::parse("kind:section").matches(&sec, &ctx));
        assert!(!Filter::parse("kind:section").matches(&lec, &ctx));
        assert!(Filter::parse("kind:lecture").matches(&lec, &ctx));
        assert!(!Filter::parse("kind:lecture").matches(&sec, &ctx));
        assert_eq!(hits("kind:class"), 2);
        assert_eq!(hits("sections"), 1, "a bare word finds the kind");
        assert_eq!(hits("lecture"), 1);
        assert_eq!(hits("classes"), 2);
    }

    #[test]
    fn course_terms() {
        let expect = set(&["hw4 graphs", "midterm 2", "CMPSC 130A lecture"]);
        assert_eq!(titles("course:130a"), expect);
        assert_eq!(titles("course:cs130a"), expect);
        assert_eq!(titles("course:algo"), expect);
        assert_eq!(titles("course:CMPSC130A"), expect);
        assert_eq!(titles("course:none kind:errand"), set(&["buy blue books"]));
    }

    #[test]
    fn status_src_tag_pri() {
        assert_eq!(titles("status:inbox"), set(&["buy blue books"]));
        assert_eq!(titles("src:canvas"), set(&["hw4 graphs"]));
        assert_eq!(titles("#exam"), set(&["hw4 graphs"]));
        assert_eq!(titles("tag:EXAM"), set(&["hw4 graphs"]));
        assert_eq!(titles("!2"), set(&["hw4 graphs"]));
        assert_eq!(titles("pri>=1"), set(&["hw4 graphs", "snoozed thing"]));
        assert_eq!(titles("!"), set(&["hw4 graphs", "snoozed thing"]));
        assert_eq!(titles("pri:1"), set(&["snoozed thing"]));
        assert_eq!(titles("pri<1 is:actionable is:open").len(), 3);
    }

    #[test]
    fn is_terms() {
        assert_eq!(titles("is:done"), set(&["old lab"]));
        assert_eq!(titles("is:overdue"), set(&["late reading"]));
        assert_eq!(titles("is:scheduled"), set(&["CMPSC 130A lecture"]));
        assert_eq!(titles("is:snoozed"), set(&["snoozed thing"]));
        assert_eq!(
            titles("is:open is:actionable"),
            set(&[
                "hw4 graphs",
                "midterm 2",
                "buy blue books",
                "late reading",
                "snoozed thing"
            ])
        );
        assert_eq!(titles("-is:actionable"), set(&["CMPSC 130A lecture"]));
    }

    #[test]
    fn excluded_courses() {
        assert_eq!(titles("is:excluded"), set(&["art sketchbook"]));
        assert_eq!(
            titles("art"),
            Vec::<String>::new(),
            "hidden from text search"
        );
        assert_eq!(titles("-is:excluded").len(), 7);
    }

    #[test]
    fn due_terms() {
        assert_eq!(
            titles("is:open due<=today"),
            set(&["late reading", "CMPSC 130A lecture"])
        );
        assert_eq!(titles("due:today"), set(&["CMPSC 130A lecture"]));
        assert_eq!(titles("due:tomorrow"), set(&["hw4 graphs"]));
        assert_eq!(
            titles("due:tmr,today"),
            set(&["hw4 graphs", "CMPSC 130A lecture"])
        );
        assert_eq!(titles("due:thu"), set(&["hw4 graphs"]));
        // week = through Sunday Nov 1
        assert_eq!(
            titles("due:week"),
            set(&["hw4 graphs", "CMPSC 130A lecture", "snoozed thing"])
        );
        assert_eq!(titles("due>week"), set(&["midterm 2"]));
        assert_eq!(titles("due<today"), set(&["old lab", "late reading"]));
        assert_eq!(
            titles("due>=tomorrow"),
            set(&["hw4 graphs", "midterm 2", "snoozed thing"])
        );
        assert_eq!(
            titles("due<=1d -is:done"),
            set(&["hw4 graphs", "CMPSC 130A lecture", "late reading"])
        );
        assert_eq!(titles("due:none"), set(&["buy blue books"]));
        assert_eq!(
            titles("due:overdue"),
            set(&["late reading"]),
            "finished work isn't overdue"
        );
        assert_eq!(titles("due:30d is:actionable").len(), 3);
    }

    #[test]
    fn text_terms() {
        assert_eq!(titles("graphs"), set(&["hw4 graphs"]));
        assert_eq!(
            titles("regrade"),
            set(&["buy blue books"]),
            "notes are searched"
        );
        assert_eq!(titles("\"blue books\""), set(&["buy blue books"]));
        assert_eq!(titles("-\"blue books\" kind:errand"), Vec::<String>::new());
        assert_eq!(
            titles("cmpsc kind:exam"),
            set(&["midterm 2"]),
            "course code is searched"
        );
        assert_eq!(
            titles("assignments"),
            set(&["hw4 graphs"]),
            "kind words are searched"
        );
        assert_eq!(
            titles("work -is:done"),
            set(&["hw4 graphs", "late reading"])
        );
        assert_eq!(
            titles("exam"),
            set(&["hw4 graphs", "midterm 2"]),
            "tags too"
        );
        assert_eq!(
            titles("algo kind:exam"),
            set(&["midterm 2"]),
            "course alias"
        );
        assert_eq!(
            titles("https://x.y/z"),
            Vec::<String>::new(),
            "unknown key = text"
        );
    }

    #[test]
    fn invalid_terms_are_ignored_and_flagged() {
        let f = Filter::parse("kind:nope due: -#x hello");
        let t = f.terms();
        assert_eq!(t.len(), 4);
        assert_eq!((t[0].key.as_str(), t[0].valid), ("kind", false));
        assert_eq!((t[1].key.as_str(), t[1].valid), ("due", false));
        assert_eq!(
            (t[2].key.as_str(), t[2].negated, t[2].valid),
            ("tag", true, true)
        );
        assert_eq!((t[3].key.as_str(), t[3].valid), ("text", true));
        assert_eq!(titles("kind:nope").len(), 7);
    }

    #[test]
    fn default_views_parse_cleanly() {
        for v in default_views() {
            assert!(
                Filter::parse(&v.query).terms().iter().all(|t| t.valid),
                "{}",
                v.id
            );
        }
    }

    #[test]
    fn run_query_sorts() {
        let cs = courses();
        let ctx = Ctx {
            now: now(),
            courses: &cs,
        };
        let rows = run_query(&items(), "is:open", Sort::Score, &ctx);
        assert_eq!(rows[0].item.title, "late reading", "overdue first");
        assert!(rows.last().unwrap().score.is_none(), "unscored rows last");
        let rows = run_query(&items(), "", Sort::Due, &ctx);
        assert_eq!(rows[0].item.title, "old lab");
        assert_eq!(rows.last().unwrap().item.title, "buy blue books");
    }
}
