//! Focus sessions.
//!
//! - `Soft`: a timer. Can be ended any time.
//! - `Hard`: every 2s, terminate processes whose executable name is on the session blocklist.
//!   Ending early requires typing the phrase "i choose distraction".
//! - `Lockdown`: Hard + the tray "Quit" is refused and closing the main window only hides it.
//!
//! Matching is case-insensitive and exact on the executable file name, with a trailing
//! ".exe" ignored on both sides so the same list works on macOS ("Discord" == "discord.exe").
//! [`PROTECTED`] names (and this process) are never terminated, even if listed.
//!
//! Terminating processes is desktop-only. On iOS/Android every level runs as a timer
//! (Hard/Lockdown still need the phrase to end early); the OS decides what else runs.
//!
//! Website blocking is out of scope for now. Planned mechanism: Firefox enterprise policies —
//! during Hard/Lockdown write `distribution/policies.json` into the Firefox install
//! (`C:\Program Files\Mozilla Firefox\distribution\` on Windows,
//! `Firefox.app/Contents/Resources/distribution/` on macOS) containing
//! `{"policies":{"WebsiteFilter":{"Block":["*://*.reddit.com/*", ...],"Exceptions":[...]}}}`
//! and remove it when the session ends (Windows can also use the registry policy key
//! `HKLM\Software\Policies\Mozilla\Firefox\WebsiteFilter`). Needs admin rights once.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
#[cfg(desktop)]
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

/// Games / launchers / chat. `javaw.exe` is deliberately NOT here (too broad: IDEs, tools).
pub const DEFAULT_BLOCKLIST: &[&str] = &[
    "steam.exe",
    "steamwebhelper.exe",
    "epicgameslauncher.exe",
    "riotclientservices.exe",
    "leagueclient.exe",
    "valorant.exe",
    "battle.net.exe",
    "discord.exe",
    "robloxplayerbeta.exe",
    "minecraft.exe",
];

/// Never terminated, even if a user lists them.
pub const PROTECTED: &[&str] = &[
    "explorer.exe",
    "csrss.exe",
    "winlogon.exe",
    "svchost.exe",
    "lsass.exe",
    "dwm.exe",
    "system",
    "collegiapp.exe",
    "firefox.exe",
    "code.exe",
    "windowsterminal.exe",
];

pub const UNLOCK_PHRASE: &str = "i choose distraction";
pub const TICK: StdDuration = StdDuration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum FocusLevel {
    #[default]
    #[serde(alias = "Soft")]
    Soft,
    #[serde(alias = "Hard")]
    Hard,
    #[serde(alias = "Lockdown")]
    Lockdown,
}

impl FocusLevel {
    pub fn kills(self) -> bool {
        !matches!(self, FocusLevel::Soft)
    }
}

#[derive(Debug, Clone)]
struct Session {
    id: u64,
    level: FocusLevel,
    started_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    blocklist: Vec<String>,
    killed: Vec<String>,
}

/// Snapshot sent to the UI (`focus_state`, "focus-tick", "focus-started", "focus-ended").
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FocusState {
    pub active: bool,
    pub level: Option<FocusLevel>,
    pub started_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub remaining_secs: i64,
    pub total_secs: i64,
    pub blocklist: Vec<String>,
    /// Executable names terminated this session (one entry per kill).
    pub killed: Vec<String>,
    /// True when `end_focus` will succeed without the phrase.
    pub can_end_freely: bool,
    /// Set on "focus-ended": "completed" | "ended" | "unlocked".
    pub ended_reason: Option<String>,
}

fn state_of(s: Option<&Session>, now: DateTime<Utc>) -> FocusState {
    match s {
        None => FocusState {
            can_end_freely: true,
            ..Default::default()
        },
        Some(s) => FocusState {
            active: true,
            level: Some(s.level),
            started_at: Some(s.started_at),
            ends_at: Some(s.ends_at),
            remaining_secs: (s.ends_at - now).num_seconds().max(0),
            total_secs: (s.ends_at - s.started_at).num_seconds(),
            blocklist: s.blocklist.clone(),
            killed: s.killed.clone(),
            can_end_freely: !s.level.kills() || now >= s.ends_at,
            ended_reason: None,
        },
    }
}

/// The list a session blocks: `list`, or [`DEFAULT_BLOCKLIST`] when it is empty.
pub fn effective_blocklist(list: Vec<String>) -> Vec<String> {
    if list.iter().all(|b| b.trim().is_empty()) {
        DEFAULT_BLOCKLIST.iter().map(|s| s.to_string()).collect()
    } else {
        list
    }
}

/// Lowercase, trimmed, trailing ".exe" removed.
pub fn normalize_exe(name: &str) -> String {
    let n = name.trim().to_lowercase();
    match n.strip_suffix(".exe") {
        Some(base) => base.to_string(),
        None => n,
    }
}

pub fn is_protected(name: &str) -> bool {
    let n = normalize_exe(name);
    PROTECTED.iter().any(|p| normalize_exe(p) == n)
}

/// Normalized kill set: blocklist minus protected names.
pub fn kill_set(blocklist: &[String]) -> HashSet<String> {
    blocklist
        .iter()
        .map(|b| normalize_exe(b))
        .filter(|b| !b.is_empty() && !is_protected(b))
        .collect()
}

#[derive(Default)]
pub struct FocusManager {
    inner: Arc<Mutex<Option<Session>>>,
    next_id: AtomicU64,
}

fn lock(m: &Mutex<Option<Session>>) -> MutexGuard<'_, Option<Session>> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl FocusManager {
    pub fn state(&self) -> FocusState {
        state_of(lock(&self.inner).as_ref(), Utc::now())
    }

    pub fn is_lockdown(&self) -> bool {
        let now = Utc::now();
        lock(&self.inner)
            .as_ref()
            .is_some_and(|s| s.level == FocusLevel::Lockdown && now < s.ends_at)
    }

    /// Start a session (replacing a Soft or finished one). Empty blocklist = default list.
    pub fn start(
        &self,
        app: &AppHandle,
        minutes: u32,
        level: FocusLevel,
        blocklist: Vec<String>,
    ) -> Result<FocusState, String> {
        if minutes == 0 || minutes > 12 * 60 {
            return Err("minutes must be between 1 and 720".into());
        }
        let now = Utc::now();
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let state = {
            let mut g = lock(&self.inner);
            if let Some(cur) = g.as_ref() {
                if !state_of(Some(cur), now).can_end_freely {
                    return Err("a hard focus session is already running".into());
                }
            }
            let blocklist = effective_blocklist(blocklist);
            let s = Session {
                id,
                level,
                started_at: now,
                ends_at: now + Duration::minutes(minutes as i64),
                blocklist,
                killed: Vec::new(),
            };
            let st = state_of(Some(&s), now);
            *g = Some(s);
            st
        };
        let _ = app.emit("focus-started", &state);
        spawn_enforcer(app.clone(), self.inner.clone(), id);
        Ok(state)
    }

    /// Push the end of the running session back by `minutes` (at most 120 at a time).
    pub fn extend(&self, app: &AppHandle, minutes: u32) -> Result<FocusState, String> {
        let now = Utc::now();
        let st = {
            let mut g = lock(&self.inner);
            let s = g.as_mut().ok_or("no focus session is running")?;
            s.ends_at = s.ends_at.max(now) + Duration::minutes(minutes.clamp(1, 120) as i64);
            state_of(Some(s), now)
        };
        let _ = app.emit("focus-tick", &st);
        Ok(st)
    }

    /// End the session. Hard/Lockdown before the timer is up needs [`UNLOCK_PHRASE`]
    /// (compared trimmed + case-insensitively).
    pub fn end(&self, app: &AppHandle, phrase: Option<String>) -> Result<FocusState, String> {
        let now = Utc::now();
        let ended = {
            let mut g = lock(&self.inner);
            let Some(cur) = g.as_ref() else {
                return Ok(state_of(None, now));
            };
            let mut st = state_of(Some(cur), now);
            let unlocked = phrase
                .as_deref()
                .is_some_and(|p| p.trim().eq_ignore_ascii_case(UNLOCK_PHRASE));
            if !st.can_end_freely && !unlocked {
                return Err(format!(
                    "This is a {:?} session. Type \"{UNLOCK_PHRASE}\" to end it early.",
                    cur.level
                ));
            }
            st.active = false;
            st.ended_reason = Some(
                if now >= cur.ends_at {
                    "completed"
                } else if st.can_end_freely {
                    "ended"
                } else {
                    "unlocked"
                }
                .into(),
            );
            *g = None;
            st
        };
        let _ = app.emit("focus-ended", &ended);
        Ok(ended)
    }
}

fn spawn_enforcer(app: AppHandle, inner: Arc<Mutex<Option<Session>>>, id: u64) {
    thread::spawn(move || {
        #[cfg(desktop)]
        let own_pid = sysinfo::get_current_pid().ok();
        #[cfg(desktop)]
        let mut sys: Option<System> = None;
        loop {
            thread::sleep(TICK);
            let now = Utc::now();
            // read session under the lock, act outside it
            let (level, set, ends_at) = {
                let g = lock(&inner);
                match g.as_ref() {
                    Some(s) if s.id == id => (s.level, kill_set(&s.blocklist), s.ends_at),
                    _ => return, // ended or replaced
                }
            };
            if now >= ends_at {
                let ended = {
                    let mut g = lock(&inner);
                    let mut st = state_of(g.as_ref(), now);
                    st.active = false;
                    st.ended_reason = Some("completed".into());
                    *g = None;
                    st
                };
                let _ = app.emit("focus-ended", &ended);
                return;
            }
            #[cfg(mobile)]
            let _ = (level, &set);
            #[cfg(desktop)]
            if level.kills() {
                if sys.is_none() {
                    sys = System::new().ok();
                }
                if let Some(sys) = sys.as_mut() {
                    let killed = kill_matching(sys, &set, own_pid);
                    if !killed.is_empty() {
                        let mut g = lock(&inner);
                        if let Some(s) = g.as_mut().filter(|s| s.id == id) {
                            s.killed.extend(killed);
                        }
                    }
                }
            }
            let st = {
                let g = lock(&inner);
                match g.as_ref() {
                    Some(s) if s.id == id => state_of(Some(s), now),
                    _ => return,
                }
            };
            let _ = app.emit("focus-tick", &st);
        }
    });
}

/// Terminate running processes whose normalized name is in `set`. Returns names killed.
#[cfg(desktop)]
fn kill_matching(sys: &mut System, set: &HashSet<String>, own_pid: Option<Pid>) -> Vec<String> {
    if set.is_empty() {
        return Vec::new();
    }
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let mut killed = Vec::new();
    for (pid, p) in sys.processes() {
        if Some(*pid) == own_pid {
            continue;
        }
        let raw = p.name().to_string_lossy();
        let name = normalize_exe(&raw);
        if set.contains(&name) && !is_protected(&name) && p.kill() {
            killed.push(raw.to_string());
        }
    }
    killed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protected_never_in_kill_set() {
        let list: Vec<String> = [
            "Discord.exe",
            "explorer.exe",
            "FIREFOX.EXE",
            "System",
            "steam.exe",
            " ",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let set = kill_set(&list);
        assert!(set.contains("discord"));
        assert!(set.contains("steam"));
        assert!(!set.contains("explorer"));
        assert!(!set.contains("firefox"));
        assert!(!set.contains("system"));
        assert_eq!(set.len(), 2);
    }

    #[test]
    fn default_list_is_sane() {
        assert!(!DEFAULT_BLOCKLIST.contains(&"javaw.exe"));
        assert!(DEFAULT_BLOCKLIST.iter().all(|b| !is_protected(b)));
        assert_eq!(normalize_exe("Discord"), normalize_exe("discord.exe"));
    }

    #[test]
    fn hard_needs_phrase() {
        let now = Utc::now();
        let s = Session {
            id: 1,
            level: FocusLevel::Hard,
            started_at: now,
            ends_at: now + Duration::minutes(25),
            blocklist: vec![],
            killed: vec![],
        };
        assert!(!state_of(Some(&s), now).can_end_freely);
        assert!(state_of(Some(&s), now + Duration::minutes(26)).can_end_freely);
        let soft = Session {
            level: FocusLevel::Soft,
            ..s
        };
        assert!(state_of(Some(&soft), now).can_end_freely);
    }
}
