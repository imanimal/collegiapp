//! Last-write-wins merge, per record (Firebase sync: src-tauri/src/cloud.rs, ui/js/cloud.js).
//!
//! Winner = later `updated_at`; on a tie a tombstone (`deleted`) wins; then the greater
//! `updated_by` (device id, lexicographic); then (only if two records are still tied but
//! differ) the greater canonical JSON, so `merge(a, b) == merge(b, a)` always.
//!
//! Settings sync the same way, per key ([`SyncedSettings`]): each key carries the time and
//! device of its last change, the later one wins, then the greater device id. A device stamps
//! a key when its value there changes ([`stamp_settings`]); a key it never changed that still
//! has its default stays unstamped, so a new device's defaults never overwrite the account's.
//! ui/js/cloud.js mirrors both functions for the web app.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, SubsecRound, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
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

/// One synced setting: its value, and when and on which device it last changed. Times are
/// whole milliseconds, so the web app (JS dates) orders them the same way.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Setting {
    pub v: Value,
    pub at: DateTime<Utc>,
    pub by: String,
}

/// The settings that follow you between devices, by key ("gcal_series", "look.pal"). The
/// settings document holds this map as its JSON.
pub type SyncedSettings = BTreeMap<String, Setting>;

/// Stamp the keys whose value here differs from their last stamp. `current` holds every key
/// this device keeps (null for a look key at its default); keys it doesn't know are left
/// alone. A key never stamped whose value is still its default (`defaults`, else null) stays
/// unstamped. Returns whether anything was stamped.
pub fn stamp_settings(
    synced: &mut SyncedSettings,
    current: &BTreeMap<String, Value>,
    defaults: &BTreeMap<String, Value>,
    at: DateTime<Utc>,
    by: &str,
) -> bool {
    let at = at.trunc_subsecs(3);
    let mut stamped = false;
    for (k, v) in current {
        let unset = defaults.get(k).unwrap_or(&Value::Null) == v;
        match synced.get(k) {
            Some(s) if &s.v == v => continue,
            None if unset => continue,
            _ => {}
        }
        synced.insert(
            k.clone(),
            Setting {
                v: v.clone(),
                at,
                by: by.to_string(),
            },
        );
        stamped = true;
    }
    stamped
}

/// What [`merge_settings`] did.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SettingsMerge {
    /// Keys whose value here changed to the other device's.
    pub pulled: Vec<String>,
    /// The merged map differs from the other device's: write it back.
    pub push: bool,
}

/// Merge another device's settings into these, key by key: the later stamp wins, then the
/// greater device id; a full tie (one device, one change) keeps this one.
pub fn merge_settings(local: &mut SyncedSettings, remote: &SyncedSettings) -> SettingsMerge {
    let mut report = SettingsMerge::default();
    for (k, r) in remote {
        let wins = local.get(k).is_none_or(|l| (&r.at, &r.by) > (&l.at, &l.by));
        if wins {
            if local.get(k).is_none_or(|l| l.v != r.v) {
                report.pulled.push(k.clone());
            }
            local.insert(k.clone(), r.clone());
        }
    }
    report.push = local.iter().any(|(k, l)| remote.get(k) != Some(l));
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Item, ItemKind, Status};
    use chrono::{DateTime, Duration, Utc};
    use serde_json::json;

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

    fn values(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    #[test]
    fn a_new_device_stamps_only_what_it_changed() {
        let defaults = values(&[("tray_focus_level", json!("hard"))]);
        let mut mac = SyncedSettings::new();
        // fresh: the default focus level and an unset look stay unstamped
        let fresh = values(&[
            ("tray_focus_level", json!("hard")),
            ("look.pal", Value::Null),
        ]);
        assert!(!stamp_settings(&mut mac, &fresh, &defaults, t0(), "mac"));
        assert!(mac.is_empty());
        // a change is stamped (to the millisecond), and only once
        let picked = values(&[
            ("tray_focus_level", json!("hard")),
            ("look.pal", json!("P13")),
        ]);
        let at = t0() + Duration::nanoseconds(1_234_567);
        assert!(stamp_settings(&mut mac, &picked, &defaults, at, "mac"));
        assert_eq!(mac["look.pal"].at, t0() + Duration::milliseconds(1));
        assert!(!stamp_settings(&mut mac, &picked, &defaults, at, "mac"));
        // going back to the default is a change too
        assert!(stamp_settings(
            &mut mac,
            &fresh,
            &defaults,
            t0() + Duration::seconds(1),
            "mac"
        ));
        assert_eq!(mac["look.pal"].v, Value::Null);
        // a key this device doesn't keep (the web app has no class picks) is left alone
        mac.insert(
            "gcal_hidden".into(),
            Setting {
                v: json!(["uid-1"]),
                at: t0(),
                by: "win".into(),
            },
        );
        assert!(!stamp_settings(
            &mut mac,
            &fresh,
            &defaults,
            t0() + Duration::seconds(2),
            "mac"
        ));
        assert_eq!(mac["gcal_hidden"].v, json!(["uid-1"]));
    }

    #[test]
    fn settings_merge_per_key_by_last_write() {
        let s = |v: Value, secs: i64, by: &str| Setting {
            v,
            at: t0() + Duration::seconds(secs),
            by: by.into(),
        };
        let mut win: SyncedSettings = [
            ("look.pal".to_string(), s(json!("P13"), 10, "win")),
            ("look.motion".to_string(), s(json!("1"), 1, "win")),
            ("gcal_hidden".to_string(), s(json!(["a"]), 5, "win")),
        ]
        .into();
        let account: SyncedSettings = [
            ("look.pal".to_string(), s(json!("P11"), 2, "mac")),
            ("look.motion".to_string(), s(json!("3"), 20, "mac")),
            ("look.night".to_string(), s(json!("auto"), 3, "mac")),
        ]
        .into();
        let rep = merge_settings(&mut win, &account);
        assert_eq!(rep.pulled, ["look.motion", "look.night"]);
        assert!(rep.push, "the newer theme and the hidden series go up");
        assert_eq!(win["look.pal"].v, json!("P13"));
        assert_eq!(win["look.motion"].v, json!("3"));
        assert_eq!(win["gcal_hidden"].v, json!(["a"]));

        // the other side then takes the merged map whole, and merging it again changes nothing
        let mut mac = account.clone();
        let back = merge_settings(&mut mac, &win);
        assert_eq!(back.pulled, ["gcal_hidden", "look.pal"]);
        assert!(!back.push);
        assert_eq!(mac, win);
        assert_eq!(merge_settings(&mut win, &mac), SettingsMerge::default());

        // same time: the greater device id wins, on both sides
        let mut a: SyncedSettings = [("k".to_string(), s(json!(1), 0, "aaa"))].into();
        let mut b: SyncedSettings = [("k".to_string(), s(json!(2), 0, "bbb"))].into();
        let (ra, rb) = (a.clone(), b.clone());
        merge_settings(&mut a, &rb);
        merge_settings(&mut b, &ra);
        assert_eq!((a["k"].v.clone(), b["k"].v.clone()), (json!(2), json!(2)));

        // a newer stamp with the same value moves the stamp without reporting a change
        let mut here: SyncedSettings = [("k".to_string(), s(json!(1), 0, "aaa"))].into();
        let there: SyncedSettings = [("k".to_string(), s(json!(1), 9, "bbb"))].into();
        let rep = merge_settings(&mut here, &there);
        assert!(rep.pulled.is_empty() && !rep.push);
        assert_eq!(here, there);
    }

    #[test]
    fn synced_settings_read_the_web_apps_json() {
        // ui/js/cloud.js writes `at` from Date.toISOString()
        let j = r#"{"look.pal":{"v":"P13","at":"2026-10-28T17:00:00.001Z","by":"web-1a2b3c4d"},"look.night":{"v":null,"at":"2026-10-28T17:00:00Z","by":"web-1a2b3c4d"}}"#;
        let s: SyncedSettings = serde_json::from_str(j).unwrap();
        assert_eq!(s["look.pal"].at, t0() + Duration::milliseconds(1));
        assert_eq!(s["look.night"].v, Value::Null);
        // and Rust writes it back with millisecond times JS reads
        let out = serde_json::to_string(&s).unwrap();
        assert!(out.contains(r#""at":"2026-10-28T17:00:00.001Z""#), "{out}");
    }
}
