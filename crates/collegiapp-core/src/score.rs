//! "Do first" ranking: one explainable score for actionable items.
//!
//! Mirrored in JS by the UI; keep both in sync.
//!
//! ```text
//! hours_left = (due - now) in hours (fractional)
//! urgency    = no due -> 0.15 ; hours_left <= 0 -> 1.5 ; else 1 / (1 + hours_left/24)
//! importance = 1 + 0.5*priority + kind_bonus + weight_pct/20
//!              kind_bonus: exam .75, project .5, assignment/quiz/lab .3, reading .1, else 0
//! crunch     = est & due & hours_left > 0: r = (est_minutes/60)/hours_left;
//!              r >= .25 -> 1.5 ; r >= .1 -> 1.2 ; else 1.0      (otherwise 1.0)
//! momentum   = status doing -> 1.15 else 1.0
//! total      = urgency * importance * crunch * momentum
//! ```
//! Not scored (None): not open, not actionable (class/event/ticket/office hours), or snoozed
//! into the future.

use std::cmp::Ordering;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::model::{Item, ItemKind, Sort, Status};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Score {
    pub total: f64,
    pub urgency: f64,
    pub importance: f64,
    pub crunch: f64,
    pub momentum: f64,
    /// Human-readable why, in display order: "overdue" / "due in 5h", "3h of work vs 9h left",
    /// "!! priority", "worth 10% of grade", "in progress", "no due date".
    pub reasons: Vec<String>,
}

/// An item with its score (None for unscored items such as classes or done work).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RankedItem {
    pub item: Item,
    pub score: Option<Score>,
}

pub fn kind_bonus(kind: ItemKind) -> f64 {
    match kind {
        ItemKind::Exam => 0.75,
        ItemKind::Project => 0.5,
        ItemKind::Assignment | ItemKind::Quiz | ItemKind::Lab => 0.3,
        ItemKind::Reading => 0.1,
        _ => 0.0,
    }
}

/// "45m", "5h", "3d" for a span of hours (rounded).
pub fn fmt_hours(hours: f64) -> String {
    let h = hours.abs();
    if h < 1.0 {
        format!("{}m", (h * 60.0).round().max(1.0) as i64)
    } else if h < 48.0 {
        format!("{}h", h.round() as i64)
    } else {
        format!("{}d", (h / 24.0).round() as i64)
    }
}

/// "45m", "3h", "1h30m" for an estimate in minutes.
pub fn fmt_minutes(m: u32) -> String {
    if m < 60 {
        format!("{m}m")
    } else if m.is_multiple_of(60) {
        format!("{}h", m / 60)
    } else {
        format!("{}h{}m", m / 60, m % 60)
    }
}

fn fmt_pct(p: f32) -> String {
    if (p - p.round()).abs() < 1e-6 {
        format!("{}", p.round() as i64)
    } else {
        format!("{p:.1}")
    }
}

pub fn score(item: &Item, now: DateTime<Utc>) -> Option<Score> {
    if !item.is_open(now) || !item.kind.is_actionable() || item.is_snoozed(now) {
        return None;
    }
    let mut reasons = Vec::new();
    let hours_left = item.due.map(|d| (d - now).num_seconds() as f64 / 3600.0);

    let urgency = match hours_left {
        None => 0.15,
        Some(h) if h <= 0.0 => 1.5,
        Some(h) => 1.0 / (1.0 + h / 24.0),
    };
    match hours_left {
        None => {}
        Some(h) if h <= 0.0 => reasons.push("overdue".to_string()),
        Some(h) => reasons.push(format!("due in {}", fmt_hours(h))),
    }

    let priority = item.priority.min(3);
    let weight = item.weight_pct.unwrap_or(0.0).max(0.0) as f64;
    let importance = 1.0 + 0.5 * priority as f64 + kind_bonus(item.kind) + weight / 20.0;

    let crunch = match (item.est_minutes, hours_left) {
        (Some(est), Some(h)) if h > 0.0 => {
            let r = (est as f64 / 60.0) / h;
            if r >= 0.25 {
                1.5
            } else if r >= 0.1 {
                1.2
            } else {
                1.0
            }
        }
        _ => 1.0,
    };
    if crunch > 1.0 {
        let est = item.est_minutes.unwrap_or(0);
        let h = hours_left.unwrap_or(0.0);
        reasons.push(format!(
            "{} of work vs {} left",
            fmt_minutes(est),
            fmt_hours(h)
        ));
    }
    if priority > 0 {
        reasons.push(format!("{} priority", "!".repeat(priority as usize)));
    }
    if weight > 0.0 {
        reasons.push(format!("worth {}% of grade", fmt_pct(weight as f32)));
    }

    let momentum = if item.status == Status::Doing {
        1.15
    } else {
        1.0
    };
    if momentum > 1.0 {
        reasons.push("in progress".to_string());
    }
    if hours_left.is_none() {
        reasons.push("no due date".to_string());
    }

    Some(Score {
        total: urgency * importance * crunch * momentum,
        urgency,
        importance,
        crunch,
        momentum,
        reasons,
    })
}

fn cmp_due(a: &Item, b: &Item) -> Ordering {
    match (a.due, b.due) {
        (Some(x), Some(y)) => x.cmp(&y),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

fn cmp_total(a: &Option<Score>, b: &Option<Score>) -> Ordering {
    match (a, b) {
        (Some(x), Some(y)) => y.total.partial_cmp(&x.total).unwrap_or(Ordering::Equal),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

/// Actionable open items, highest score first (ties: earlier due, then title).
pub fn rank(items: &[Item], now: DateTime<Utc>) -> Vec<(Item, Score)> {
    let mut out: Vec<(Item, Score)> = items
        .iter()
        .filter_map(|it| score(it, now).map(|s| (it.clone(), s)))
        .collect();
    out.sort_by(|(a, sa), (b, sb)| {
        sb.total
            .partial_cmp(&sa.total)
            .unwrap_or(Ordering::Equal)
            .then_with(|| cmp_due(a, b))
            .then_with(|| a.title.cmp(&b.title))
    });
    out
}

/// Sort ranked rows for a view.
/// - `Score`: scored rows by total desc, then unscored rows; ties by due asc, then title.
/// - `Due`: due asc (no due last), ties by score desc.
/// - `Updated`: most recently updated first.
pub fn sort_ranked(rows: &mut [RankedItem], sort: Sort) {
    match sort {
        Sort::Score => rows.sort_by(|a, b| {
            cmp_total(&a.score, &b.score)
                .then_with(|| cmp_due(&a.item, &b.item))
                .then_with(|| a.item.title.cmp(&b.item.title))
        }),
        Sort::Due => rows.sort_by(|a, b| {
            cmp_due(&a.item, &b.item)
                .then_with(|| cmp_total(&a.score, &b.score))
                .then_with(|| a.item.title.cmp(&b.item.title))
        }),
        Sort::Updated => rows.sort_by(|a, b| {
            b.item
                .updated_at
                .cmp(&a.item.updated_at)
                .then_with(|| a.item.title.cmp(&b.item.title))
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-28T17:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn item(kind: ItemKind, due_in_h: Option<i64>) -> Item {
        let mut it = Item::new("x", kind, now(), "d");
        it.due = due_in_h.map(|h| now() + Duration::hours(h));
        it
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn no_due_task() {
        let s = score(&item(ItemKind::Task, None), now()).unwrap();
        assert!(close(s.urgency, 0.15));
        assert!(close(s.importance, 1.0));
        assert!(close(s.total, 0.15));
        assert_eq!(s.reasons, vec!["no due date"]);
    }

    #[test]
    fn urgency_curve() {
        let s = score(&item(ItemKind::Task, Some(24)), now()).unwrap();
        assert!(close(s.urgency, 0.5));
        assert_eq!(s.reasons[0], "due in 24h");
        let s = score(&item(ItemKind::Task, Some(-2)), now()).unwrap();
        assert!(close(s.urgency, 1.5));
        assert_eq!(s.reasons[0], "overdue");
        let s = score(&item(ItemKind::Task, Some(0)), now()).unwrap();
        assert!(close(s.urgency, 1.5), "due exactly now counts as overdue");
        let s = score(&item(ItemKind::Task, Some(72)), now()).unwrap();
        assert!(close(s.urgency, 0.25));
        assert_eq!(s.reasons[0], "due in 3d");
    }

    #[test]
    fn importance_formula() {
        let mut it = item(ItemKind::Exam, Some(24));
        it.priority = 2;
        it.weight_pct = Some(20.0);
        let s = score(&it, now()).unwrap();
        assert!(close(s.importance, 1.0 + 1.0 + 0.75 + 1.0));
        assert!(s.reasons.contains(&"!! priority".to_string()));
        assert!(s.reasons.contains(&"worth 20% of grade".to_string()));
        assert!(close(kind_bonus(ItemKind::Lab), 0.3));
        assert!(close(kind_bonus(ItemKind::Reading), 0.1));
        assert!(close(kind_bonus(ItemKind::Errand), 0.0));
    }

    #[test]
    fn crunch_levels() {
        let mut it = item(ItemKind::Task, Some(9));
        it.est_minutes = Some(180); // 3h / 9h = .33
        let s = score(&it, now()).unwrap();
        assert!(close(s.crunch, 1.5));
        assert!(s.reasons.contains(&"3h of work vs 9h left".to_string()));
        it.est_minutes = Some(60); // 1/9 = .11
        assert!(close(score(&it, now()).unwrap().crunch, 1.2));
        it.est_minutes = Some(30); // .055
        assert!(close(score(&it, now()).unwrap().crunch, 1.0));
        let mut overdue = item(ItemKind::Task, Some(-1));
        overdue.est_minutes = Some(600);
        assert!(close(score(&overdue, now()).unwrap().crunch, 1.0));
    }

    #[test]
    fn momentum_and_total_product() {
        let mut it = item(ItemKind::Assignment, Some(24));
        it.status = Status::Doing;
        it.priority = 1;
        it.est_minutes = Some(180); // 3/24 = .125 -> 1.2
        let s = score(&it, now()).unwrap();
        assert!(close(s.momentum, 1.15));
        let expect = 0.5 * (1.0 + 0.5 + 0.3) * 1.2 * 1.15;
        assert!(close(s.total, expect), "{} vs {}", s.total, expect);
        assert!(s.reasons.contains(&"in progress".to_string()));
    }

    #[test]
    fn unscored() {
        assert!(score(&item(ItemKind::Class, Some(1)), now()).is_none());
        assert!(score(&item(ItemKind::OfficeHours, Some(1)), now()).is_none());
        let mut done = item(ItemKind::Task, Some(1));
        done.status = Status::Done;
        assert!(score(&done, now()).is_none());
        let mut snoozed = item(ItemKind::Task, Some(1));
        snoozed.snoozed_until = Some(now() + Duration::hours(2));
        assert!(score(&snoozed, now()).is_none());
        snoozed.snoozed_until = Some(now() - Duration::hours(2));
        assert!(
            score(&snoozed, now()).is_some(),
            "expired snooze scores again"
        );
        let mut del = item(ItemKind::Task, Some(1));
        del.deleted = true;
        assert!(score(&del, now()).is_none());
    }

    #[test]
    fn rank_orders_by_total() {
        let mut a = item(ItemKind::Task, None);
        a.title = "someday".into();
        let mut b = item(ItemKind::Exam, Some(20));
        b.title = "midterm".into();
        let mut c = item(ItemKind::Assignment, Some(-3));
        c.title = "late hw".into();
        let d = item(ItemKind::Class, Some(1));
        let ranked = rank(&[a, b, c, d], now());
        let titles: Vec<&str> = ranked.iter().map(|(i, _)| i.title.as_str()).collect();
        assert_eq!(titles, vec!["late hw", "midterm", "someday"]);
        assert!(ranked.windows(2).all(|w| w[0].1.total >= w[1].1.total));
    }

    #[test]
    fn formatting() {
        assert_eq!(fmt_minutes(90), "1h30m");
        assert_eq!(fmt_minutes(45), "45m");
        assert_eq!(fmt_hours(0.5), "30m");
        assert_eq!(fmt_hours(5.2), "5h");
        let mut it = item(ItemKind::Task, Some(10));
        it.weight_pct = Some(7.5);
        assert!(score(&it, now())
            .unwrap()
            .reasons
            .contains(&"worth 7.5% of grade".to_string()));
    }
}
