//! "Live activity": the class/event happening now or next (within 12h), for the floating
//! island, tray title (macOS), tooltip (Windows) and taskbar/dock progress.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::model::{InterruptLevel, Item, ItemKind, Status};
use crate::score::fmt_minutes;

/// How far ahead `next_up` looks.
pub const LOOKAHEAD_HOURS: i64 = 12;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Presence {
    /// Item title, e.g. "CMPSC 130A Lecture".
    pub label: String,
    /// "in 12m · Phelps 3526" / "ends in 45m · Phelps 3526".
    pub detail: String,
    /// Seconds until start; <= 0 once it has started.
    pub starts_in_secs: i64,
    /// 0..1 through the current session; None if it has not started.
    pub progress: Option<f64>,
    pub item_id: Uuid,
    pub kind: ItemKind,
    pub location: Option<String>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
    /// Seconds until the end, when in progress.
    pub ends_in_secs: Option<i64>,
}

fn countdown(secs: i64) -> String {
    let mins = (secs.max(0) + 59) / 60;
    fmt_minutes(mins.max(1) as u32)
}

impl Presence {
    /// Compact label: the course number if the title has one ("130A"), else the first
    /// 12 characters of the title.
    pub fn short_label(&self) -> String {
        if let Some(w) = self
            .label
            .split_whitespace()
            .find(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()))
        {
            return w.to_string();
        }
        self.label
            .chars()
            .take(12)
            .collect::<String>()
            .trim_end()
            .to_string()
    }

    /// Tray/menu-bar text: "130A 12m" (upcoming) or "130A 45m left" (in progress).
    pub fn short_text(&self) -> String {
        match (self.progress, self.ends_in_secs) {
            (Some(_), Some(left)) => format!("{} {} left", self.short_label(), countdown(left)),
            _ => format!("{} {}", self.short_label(), countdown(self.starts_in_secs)),
        }
    }
}

fn candidate(it: &Item) -> bool {
    it.kind.is_scheduled()
        && !it.deleted
        && !matches!(it.status, Status::Done | Status::Dropped)
        && it.due.is_some()
}

/// The scheduled item (class, office hours, event, ticket) in progress now — the one ending
/// soonest — or else the next one starting within [`LOOKAHEAD_HOURS`].
pub fn next_up(items: &[Item], now: DateTime<Utc>) -> Option<Presence> {
    let current = items
        .iter()
        .filter(|it| candidate(it))
        .filter_map(|it| {
            let s = it.due?;
            let e = it.end?;
            (s <= now && now < e).then_some((it, s, e))
        })
        .min_by_key(|(_, _, e)| *e);
    if let Some((it, s, e)) = current {
        let total = (e - s).num_seconds().max(1) as f64;
        let progress = ((now - s).num_seconds() as f64 / total).clamp(0.0, 1.0);
        let left = (e - now).num_seconds();
        return Some(build(it, s, Some(e), now, Some(progress), Some(left)));
    }
    let horizon = now + Duration::hours(LOOKAHEAD_HOURS);
    items
        .iter()
        .filter(|it| candidate(it))
        .filter_map(|it| {
            let s = it.due?;
            (s > now && s <= horizon).then_some((it, s))
        })
        .min_by_key(|(_, s)| *s)
        .map(|(it, s)| build(it, s, it.end, now, None, None))
}

/// Scheduled items that asked to interrupt (nudge, alert or takeover) and start within `lead`
/// of `now`, soonest first. The caller remembers which it already fired.
pub fn alerts_due(items: &[Item], now: DateTime<Utc>, lead: Duration) -> Vec<&Item> {
    let mut due: Vec<&Item> = items
        .iter()
        .filter(|it| candidate(it) && it.interrupt != InterruptLevel::None)
        .filter(|it| it.due.is_some_and(|s| s > now && s <= now + lead))
        .collect();
    due.sort_by_key(|it| it.due);
    due
}

fn build(
    it: &Item,
    start: DateTime<Utc>,
    end: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
    progress: Option<f64>,
    ends_in: Option<i64>,
) -> Presence {
    let starts_in = (start - now).num_seconds();
    let when = match ends_in {
        Some(left) => format!("ends in {}", countdown(left)),
        None => format!("in {}", countdown(starts_in)),
    };
    let detail = match &it.location {
        Some(loc) if !loc.is_empty() => format!("{when} · {loc}"),
        _ => when,
    };
    Presence {
        label: it.title.clone(),
        detail,
        starts_in_secs: starts_in,
        progress,
        item_id: it.id,
        kind: it.kind,
        location: it.location.clone(),
        starts_at: start,
        ends_at: end,
        ends_in_secs: ends_in,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn class(title: &str, start: &str, end: &str) -> Item {
        let mut it = Item::new(title, ItemKind::Class, u(start), "d");
        it.due = Some(u(start));
        it.end = Some(u(end));
        it.location = Some("Phelps 3526".into());
        it
    }

    fn items() -> Vec<Item> {
        let mut hw = Item::new("hw", ItemKind::Assignment, u("2026-10-28T00:00:00Z"), "d");
        hw.due = Some(u("2026-10-28T21:10:00Z"));
        vec![
            class(
                "CMPSC 130A Lecture",
                "2026-10-28T21:00:00Z",
                "2026-10-28T22:15:00Z",
            ),
            class(
                "PSTAT 120A Lecture",
                "2026-10-28T23:00:00Z",
                "2026-10-29T00:15:00Z",
            ),
            hw,
        ]
    }

    #[test]
    fn upcoming() {
        let p = next_up(&items(), u("2026-10-28T20:48:00Z")).unwrap();
        assert_eq!(p.label, "CMPSC 130A Lecture");
        assert_eq!(p.starts_in_secs, 12 * 60);
        assert_eq!(p.progress, None);
        assert_eq!(p.detail, "in 12m · Phelps 3526");
        assert_eq!(p.short_text(), "130A 12m");
    }

    #[test]
    fn in_progress() {
        let p = next_up(&items(), u("2026-10-28T21:30:00Z")).unwrap();
        assert_eq!(p.label, "CMPSC 130A Lecture");
        assert!((p.progress.unwrap() - 0.4).abs() < 1e-9);
        assert_eq!(p.starts_in_secs, -1800);
        assert_eq!(p.ends_in_secs, Some(45 * 60));
        assert_eq!(p.detail, "ends in 45m · Phelps 3526");
        assert_eq!(p.short_text(), "130A 45m left");
    }

    #[test]
    fn between_classes_and_horizon() {
        let p = next_up(&items(), u("2026-10-28T22:20:00Z")).unwrap();
        assert_eq!(p.label, "PSTAT 120A Lecture");
        assert_eq!(p.short_text(), "120A 40m");
        assert!(
            next_up(&items(), u("2026-10-28T08:00:00Z")).is_none(),
            "13h away"
        );
        assert!(
            next_up(&items(), u("2026-10-29T01:00:00Z")).is_none(),
            "all over"
        );
    }

    #[test]
    fn skips_done_and_dropped() {
        let mut v = items();
        v[0].status = Status::Dropped;
        let p = next_up(&v, u("2026-10-28T21:30:00Z")).unwrap();
        assert_eq!(p.label, "PSTAT 120A Lecture");
        assert_eq!(p.short_text(), "120A 1h30m");
    }

    #[test]
    fn alerts_within_lead() {
        let now = u("2026-10-28T20:50:00Z");
        let mut its = items();
        for it in its.iter_mut() {
            it.interrupt = InterruptLevel::Alert;
        }
        let titles = |due: Vec<&Item>| due.iter().map(|i| i.title.clone()).collect::<Vec<_>>();
        // the class 10 minutes out; the assignment is not a scheduled kind
        assert_eq!(
            titles(alerts_due(&its, now, Duration::minutes(15))),
            vec!["CMPSC 130A Lecture"]
        );
        its[0].interrupt = InterruptLevel::None;
        assert!(alerts_due(&its, now, Duration::minutes(15)).is_empty());
        assert_eq!(
            titles(alerts_due(&its, now, Duration::hours(3))),
            vec!["PSTAT 120A Lecture"]
        );
        // already started: no alert
        assert!(alerts_due(&its, u("2026-10-28T23:01:00Z"), Duration::hours(3)).is_empty());
    }

    #[test]
    fn short_label_fallback() {
        let mut v = vec![class(
            "Shoreline Info Night",
            "2026-10-28T21:00:00Z",
            "2026-10-28T22:00:00Z",
        )];
        v[0].kind = ItemKind::Event;
        let p = next_up(&v, u("2026-10-28T19:00:00Z")).unwrap();
        assert_eq!(p.short_label(), "Shoreline In");
        assert_eq!(p.short_text(), "Shoreline In 2h");
    }
}
