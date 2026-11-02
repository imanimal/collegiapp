//! Last-write-wins merge, per record. Used for Firebase (Firestore REST) sync later.
//!
//! Winner = later `updated_at`; on a tie a tombstone (`deleted`) wins; then the greater
//! `updated_by` (device id, lexicographic); then (only if two records are still tied but
//! differ) the greater canonical JSON, so `merge(a, b) == merge(b, a)` always.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use uuid::Uuid;

use crate::model::Item;

fn precedence(a: &Item, b: &Item) -> Ordering {
    a.updated_at
        .cmp(&b.updated_at)
        .then_with(|| a.deleted.cmp(&b.deleted))
        .then_with(|| a.updated_by.cmp(&b.updated_by))
        .then_with(|| {
            let ja = serde_json::to_string(a).unwrap_or_default();
            let jb = serde_json::to_string(b).unwrap_or_default();
            ja.cmp(&jb)
        })
}

/// Pick the winning version of one record (ids are assumed equal).
pub fn merge(local: &Item, remote: &Item) -> Item {
    if precedence(remote, local) == Ordering::Greater {
        remote.clone()
    } else {
        local.clone()
    }
}

/// Result of merging two record sets.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MergeReport {
    /// The merged set: local order first, then remote-only records in remote order.
    pub items: Vec<Item>,
    /// Ids where the remote version won (or was new) -> local store changed.
    pub pulled: Vec<Uuid>,
    /// Ids where the local version won over a different/missing remote -> push these.
    pub to_push: Vec<Uuid>,
}

/// Merge two sets keyed by `id`.
pub fn merge_sets(local: &[Item], remote: &[Item]) -> Vec<Item> {
    merge_sets_report(local, remote).items
}

/// Like [`merge_sets`] but also says what to pull/push.
pub fn merge_sets_report(local: &[Item], remote: &[Item]) -> MergeReport {
    let remote_by_id: HashMap<Uuid, &Item> = remote.iter().map(|r| (r.id, r)).collect();
    let mut seen: HashSet<Uuid> = HashSet::new();
    let mut report = MergeReport::default();
    for l in local {
        if !seen.insert(l.id) {
            continue; // duplicate id in local input: first wins
        }
        match remote_by_id.get(&l.id) {
            Some(r) => {
                let m = merge(l, r);
                if &m != l {
                    report.pulled.push(l.id);
                } else if &m != *r {
                    report.to_push.push(l.id);
                }
                report.items.push(m);
            }
            None => {
                report.to_push.push(l.id);
                report.items.push(l.clone());
            }
        }
    }
    for r in remote {
        if seen.insert(r.id) {
            report.pulled.push(r.id);
            report.items.push(r.clone());
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Item, ItemKind, Status};
    use chrono::{DateTime, Duration, Utc};

    fn t0() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-28T17:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn base() -> Item {
        Item::new("hw", ItemKind::Assignment, t0(), "laptop")
    }

    #[test]
    fn newer_wins() {
        let a = base();
        let mut b = a.clone();
        b.title = "hw (edited on phone)".into();
        b.updated_at = t0() + Duration::seconds(5);
        b.updated_by = "phone".into();
        assert_eq!(merge(&a, &b).title, "hw (edited on phone)");
        assert_eq!(merge(&b, &a).title, "hw (edited on phone)");
    }

    #[test]
    fn tie_breaks_on_device_id() {
        let a = base(); // updated_by laptop
        let mut b = a.clone();
        b.status = Status::Done;
        b.updated_by = "phone".into(); // "phone" > "laptop"
        assert_eq!(merge(&a, &b).status, Status::Done);
        assert_eq!(merge(&b, &a).status, Status::Done);
    }

    #[test]
    fn tombstone_wins_ties() {
        let a = base();
        let mut b = a.clone();
        b.deleted = true;
        b.updated_by = "aaa".into(); // would lose the device tie-break
        assert!(merge(&a, &b).deleted);
        assert!(merge(&b, &a).deleted);
        // ...but a newer edit beats an older tombstone
        let mut c = a.clone();
        c.updated_at = t0() + Duration::seconds(1);
        assert!(!merge(&b, &c).deleted);
    }

    #[test]
    fn fully_tied_is_commutative() {
        let a = base();
        let mut b = a.clone();
        b.notes = "different".into();
        assert_eq!(merge(&a, &b), merge(&b, &a));
    }

    #[test]
    fn sets_union_and_report() {
        let shared = base();
        let mut shared_remote = shared.clone();
        shared_remote.updated_at = t0() + Duration::minutes(1);
        shared_remote.title = "remote".into();
        let local_only = Item::new("local only", ItemKind::Task, t0(), "laptop");
        let mut local_newer = Item::new("mine", ItemKind::Task, t0(), "laptop");
        let mut stale_remote = local_newer.clone();
        local_newer.updated_at = t0() + Duration::minutes(2);
        stale_remote.title = "stale".into();
        let remote_only = Item::new("remote only", ItemKind::Task, t0(), "phone");

        let local = vec![shared.clone(), local_only.clone(), local_newer.clone()];
        let remote = vec![remote_only.clone(), shared_remote.clone(), stale_remote];
        let rep = merge_sets_report(&local, &remote);
        let titles: Vec<&str> = rep.items.iter().map(|i| i.title.as_str()).collect();
        assert_eq!(titles, vec!["remote", "local only", "mine", "remote only"]);
        assert_eq!(rep.pulled, vec![shared.id, remote_only.id]);
        assert_eq!(rep.to_push, vec![local_only.id, local_newer.id]);
        assert_eq!(merge_sets(&local, &remote).len(), 4);
    }

    #[test]
    fn identical_records_need_nothing() {
        let a = base();
        let rep = merge_sets_report(std::slice::from_ref(&a), std::slice::from_ref(&a));
        assert!(rep.pulled.is_empty() && rep.to_push.is_empty());
        assert_eq!(rep.items, vec![a]);
    }
}
