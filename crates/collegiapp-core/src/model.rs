//! The unified data model.
//!
//! Everything the student deals with is ONE [`Item`] with a [`ItemKind`]: an assignment,
//! an exam, a class session, a Shoreline event, a ticket, an errand, a manual task, a note.
//! Screens are saved filters ([`View`]) over the same item list.
//!
//! A note ([`ItemKind::Note`]) keeps its document in `notes` as Collegiapp Markdown
//! (`docs/NOTES.md`); it is neither ranked nor scheduled, and Done archives it.
//!
//! Info ([`ItemKind::Info`]) is something a reader brought in that isn't to do: a Canvas grade
//! column or notice listed as an assignment. Like a note it's neither ranked nor scheduled;
//! Canvas work a reader isn't sure about lands as Info in the Inbox for you to sort
//! ([`canvas_kind`]).

use chrono::{DateTime, SubsecRound, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// What sort of thing an item is. Serialized snake_case (`"office_hours"`, `"assignment"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ItemKind {
    #[default]
    Task,
    Assignment,
    Exam,
    Quiz,
    Lab,
    Reading,
    Project,
    Class,
    OfficeHours,
    Event,
    Ticket,
    Errand,
    Application,
    Note,
    Info,
}

impl ItemKind {
    pub const ALL: [ItemKind; 15] = [
        ItemKind::Task,
        ItemKind::Assignment,
        ItemKind::Exam,
        ItemKind::Quiz,
        ItemKind::Lab,
        ItemKind::Reading,
        ItemKind::Project,
        ItemKind::Class,
        ItemKind::OfficeHours,
        ItemKind::Event,
        ItemKind::Ticket,
        ItemKind::Errand,
        ItemKind::Application,
        ItemKind::Note,
        ItemKind::Info,
    ];

    /// Things you *do* (vs. things that happen at a time and you attend, notes you keep, and
    /// info you read).
    pub fn is_actionable(self) -> bool {
        !self.is_scheduled() && !matches!(self, ItemKind::Note | ItemKind::Info)
    }

    /// Things that occupy a time slot (`due` = start, `end` = end).
    pub fn is_scheduled(self) -> bool {
        matches!(
            self,
            ItemKind::Class | ItemKind::Event | ItemKind::Ticket | ItemKind::OfficeHours
        )
    }

    /// Coursework with a deadline: the Assignments view and `kind:work`. Exams have their own.
    pub const WORK: [ItemKind; 5] = [
        ItemKind::Assignment,
        ItemKind::Lab,
        ItemKind::Quiz,
        ItemKind::Project,
        ItemKind::Reading,
    ];

    /// The serde name (`"office_hours"`).
    pub fn as_str(self) -> &'static str {
        match self {
            ItemKind::Task => "task",
            ItemKind::Assignment => "assignment",
            ItemKind::Exam => "exam",
            ItemKind::Quiz => "quiz",
            ItemKind::Lab => "lab",
            ItemKind::Reading => "reading",
            ItemKind::Project => "project",
            ItemKind::Class => "class",
            ItemKind::OfficeHours => "office_hours",
            ItemKind::Event => "event",
            ItemKind::Ticket => "ticket",
            ItemKind::Errand => "errand",
            ItemKind::Application => "application",
            ItemKind::Note => "note",
            ItemKind::Info => "info",
        }
    }

    /// Parse a kind name or a filter alias (`hw`, `homework`, `oh`, `officehours`, `lecture`,
    /// `idea`, `jot`, `fyi`).
    pub fn from_name(s: &str) -> Option<ItemKind> {
        let s = s.trim().to_ascii_lowercase();
        let k = match s.as_str() {
            "hw" | "homework" => ItemKind::Assignment,
            "oh" | "officehours" | "office-hours" => ItemKind::OfficeHours,
            "lecture" => ItemKind::Class,
            "idea" | "jot" => ItemKind::Note,
            "fyi" => ItemKind::Info,
            _ => return ItemKind::ALL.iter().copied().find(|k| k.as_str() == s),
        };
        Some(k)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    #[default]
    Inbox,
    Todo,
    Doing,
    Done,
    Dropped,
}

impl Status {
    pub fn from_name(s: &str) -> Option<Status> {
        match s.trim().to_ascii_lowercase().as_str() {
            "inbox" => Some(Status::Inbox),
            "todo" => Some(Status::Todo),
            "doing" => Some(Status::Doing),
            "done" => Some(Status::Done),
            "dropped" => Some(Status::Dropped),
            _ => None,
        }
    }
}

/// How hard an item may interrupt the user when it comes up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum InterruptLevel {
    #[default]
    None,
    Nudge,
    Alert,
    Takeover,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Link {
    pub label: String,
    pub url: String,
}

impl Link {
    /// A link labelled with its site's name ([`link_label`]).
    pub fn from_url(url: &str) -> Link {
        Link {
            label: link_label(url),
            url: url.to_string(),
        }
    }
}

/// Sites a link is named after instead of its host: the host is the domain or a subdomain of it.
const SITES: [(&str, &str); 16] = [
    ("zoom.us", "Zoom"),
    ("drive.google.com", "Google Drive"),
    ("meet.google.com", "Google Meet"),
    ("forms.gle", "Google Forms"),
    ("colab.research.google.com", "Colab"),
    ("instructure.com", "Canvas"),
    ("gradescope.com", "Gradescope"),
    ("piazza.com", "Piazza"),
    ("edstem.org", "Ed"),
    ("prairielearn.com", "PrairieLearn"),
    ("github.com", "GitHub"),
    ("youtube.com", "YouTube"),
    ("youtu.be", "YouTube"),
    ("overleaf.com", "Overleaf"),
    ("notion.so", "Notion"),
    ("notion.site", "Notion"),
];

/// The name a link shows: Google Docs, Sheets, Slides or Forms by the path on docs.google.com,
/// WeBWorK for a `/webwork2/` path, Canvas for a `canvas.` host, a site in [`SITES`] by name,
/// else the host in lowercase without `www.` (`https://www.example.com/a` -> `example.com`).
/// Mirrored in engine.js `linkLabel`.
pub fn link_label(url: &str) -> String {
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = rest[..end]
        .rsplit('@')
        .next()
        .and_then(|h| h.split(':').next())
        .unwrap_or("")
        .to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    let path = rest[end..].to_lowercase();
    let on = |d: &str| host == d || host.ends_with(&format!(".{d}"));
    let name = if host == "docs.google.com" {
        if path.starts_with("/spreadsheets") {
            "Google Sheets"
        } else if path.starts_with("/presentation") {
            "Google Slides"
        } else if path.starts_with("/forms") {
            "Google Forms"
        } else {
            "Google Docs"
        }
    } else if path.contains("/webwork2/") {
        "WeBWorK"
    } else if host.starts_with("canvas.") {
        "Canvas"
    } else if let Some(&(_, n)) = SITES.iter().find(|(d, _)| on(d)) {
        n
    } else if host.is_empty() {
        url
    } else {
        host
    };
    name.to_string()
}

/// Where an item came from. `adapter` is open-ended: "manual", "canvas", "gcal", "ics",
/// "shoreline", "gradescope", ...
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Source {
    pub adapter: String,
    #[serde(default)]
    pub external_id: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    /// The kind the reader last gave it ([`merge_imported`] fills it in). When the item's own
    /// kind differs, you chose it, and re-imports keep yours.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<ItemKind>,
    /// What the reader last gave the other fields it fills in ([`merge_imported`] keeps it).
    /// A field that no longer matches is your edit, and re-imports keep it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub said: Option<Said>,
}

impl Default for Source {
    fn default() -> Self {
        Source::manual()
    }
}

impl Source {
    pub fn manual() -> Source {
        Source {
            adapter: "manual".into(),
            external_id: None,
            url: None,
            kind: None,
            said: None,
        }
    }
}

/// The fields a reader fills in, as it last gave them ([`Source::said`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Said {
    pub title: String,
    pub due: Option<DateTime<Utc>>,
    pub end: Option<DateTime<Utc>>,
    pub location: Option<String>,
    pub course_id: Option<String>,
}

impl Said {
    fn of(it: &Item) -> Said {
        Said {
            title: it.title.clone(),
            due: it.due,
            end: it.end,
            location: it.location.clone(),
            course_id: it.course_id.clone(),
        }
    }
}

/// Times as the UI keeps them (whole milliseconds), so a save from the UI doesn't look like an
/// edit.
fn same_time(a: Option<DateTime<Utc>>, b: Option<DateTime<Utc>>) -> bool {
    a.map(|t| t.trunc_subsecs(3)) == b.map(|t| t.trunc_subsecs(3))
}

/// Text as the UI keeps it: trimmed, and empty is none.
fn same_text(a: Option<&str>, b: Option<&str>) -> bool {
    fn norm(s: Option<&str>) -> Option<&str> {
        s.map(str::trim).filter(|s| !s.is_empty())
    }
    norm(a) == norm(b)
}

/// The one record type. See module docs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Item {
    pub id: Uuid,
    pub title: String,
    #[serde(default)]
    pub kind: ItemKind,
    #[serde(default)]
    pub status: Status,
    #[serde(default)]
    pub course_id: Option<String>,
    /// Due time; for scheduled kinds (class/event/...) this is the START time.
    #[serde(default)]
    pub due: Option<DateTime<Utc>>,
    #[serde(default)]
    pub end: Option<DateTime<Utc>>,
    #[serde(default)]
    pub est_minutes: Option<u32>,
    /// 0..=3 (`!`, `!!`, `!!!`).
    #[serde(default)]
    pub priority: u8,
    /// Percent of the course grade this is worth.
    #[serde(default)]
    pub weight_pct: Option<f32>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub links: Vec<Link>,
    /// The course link this item's course key opens, when you picked one for it alone (a URL
    /// from its course's `links`). None follows the course's quick link, its first link. Yours:
    /// re-imports keep it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quick_link: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub interrupt: InterruptLevel,
    #[serde(default)]
    pub source: Source,
    #[serde(default)]
    pub snoozed_until: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Device id that made the last change (sync tie-break).
    #[serde(default)]
    pub updated_by: String,
    /// Tombstone: deleted items are kept so the deletion syncs.
    #[serde(default)]
    pub deleted: bool,
}

impl Item {
    /// A fresh manual item.
    pub fn new(title: impl Into<String>, kind: ItemKind, now: DateTime<Utc>, device: &str) -> Item {
        Item {
            id: Uuid::new_v4(),
            title: title.into(),
            kind,
            status: Status::Todo,
            course_id: None,
            due: None,
            end: None,
            est_minutes: None,
            priority: 0,
            weight_pct: None,
            tags: Vec::new(),
            links: Vec::new(),
            quick_link: None,
            location: None,
            notes: String::new(),
            interrupt: InterruptLevel::None,
            source: Source::manual(),
            snoozed_until: None,
            created_at: now,
            updated_at: now,
            updated_by: device.to_string(),
            deleted: false,
        }
    }

    /// Open = still on the plate: not Done/Dropped, not deleted, and not a scheduled
    /// class/event/ticket/office hours that is already over (end, or start if no end, is in
    /// the past).
    pub fn is_open(&self, now: DateTime<Utc>) -> bool {
        if self.deleted || matches!(self.status, Status::Done | Status::Dropped) {
            return false;
        }
        if self.kind.is_scheduled() {
            if let Some(t) = self.end.or(self.due) {
                if t < now {
                    return false;
                }
            }
        }
        true
    }

    pub fn is_snoozed(&self, now: DateTime<Utc>) -> bool {
        self.snoozed_until.is_some_and(|t| t > now)
    }

    /// Open work past its due date. A class or event that has started is never overdue.
    pub fn is_overdue(&self, now: DateTime<Utc>) -> bool {
        self.kind.is_actionable() && self.is_open(now) && self.due.is_some_and(|d| d < now)
    }

    /// Record a local edit (bumps `updated_at`/`updated_by` for last-write-wins sync).
    pub fn touch(&mut self, now: DateTime<Utc>, device: &str) {
        self.updated_at = now;
        self.updated_by = device.to_string();
    }

    /// Re-import from an external source: take the reader's fields from `fresh` (title,
    /// due/end, location, source url, kind, course) while keeping everything the user owns
    /// (status, priority, estimate, notes, tags, snooze, interrupt, weight).
    ///
    /// A reader's field is yours once you change it: it no longer matches what the reader last
    /// gave it (`source.said`, `source.kind`), and re-imports keep your version until you put
    /// the reader's back. An item from before the reader's word was kept takes all of them once.
    /// A reader that isn't sure (it says Info) doesn't undo another reader's work kind. When a
    /// reader changes the kind of an item still in the Inbox or to do, the item takes the
    /// reader's status: unsure work goes to the Inbox for you to sort, sure work comes out of it.
    /// Returns true if anything you see changed (and then touches the item, so it syncs).
    pub fn refresh_from_source(&mut self, fresh: &Item, now: DateTime<Utc>, device: &str) -> bool {
        let seen = |it: &Item| {
            let s = &it.source;
            (
                (it.title.clone(), it.due, it.end, it.location.clone()),
                (
                    s.adapter.clone(),
                    s.external_id.clone(),
                    s.url.clone(),
                    s.kind,
                ),
                (it.kind, it.course_id.clone(), it.status),
            )
        };
        let before = seen(self);
        let said = self.source.kind;
        let yours = said.is_some_and(|k| k != self.kind);
        let surer = fresh.kind == ItemKind::Info && said.is_some_and(|k| k != ItemKind::Info);
        let last = self.source.said.take();
        let follows = |same: &dyn Fn(&Said) -> bool| last.as_ref().is_none_or(same);
        let title = follows(&|s| s.title.trim() == self.title.trim());
        let due = follows(&|s| same_time(s.due, self.due));
        let end = follows(&|s| same_time(s.end, self.end));
        let location = follows(&|s| same_text(s.location.as_deref(), self.location.as_deref()));
        let course = follows(&|s| same_text(s.course_id.as_deref(), self.course_id.as_deref()));
        // a reader with no course for it leaves the course where it was
        let said_course = if fresh.course_id.is_some() {
            fresh.course_id.clone()
        } else if let Some(s) = &last {
            s.course_id.clone()
        } else {
            self.course_id.clone()
        };
        if title {
            self.title = fresh.title.clone();
        }
        if due {
            self.due = fresh.due;
        }
        if end {
            self.end = fresh.end;
        }
        if location {
            self.location = fresh.location.clone();
        }
        if course && fresh.course_id.is_some() {
            self.course_id = fresh.course_id.clone();
        }
        self.source = Source {
            kind: if surer { said } else { Some(fresh.kind) },
            said: Some(Said {
                course_id: said_course,
                ..Said::of(fresh)
            }),
            ..fresh.source.clone()
        };
        if !yours && !surer && self.kind != fresh.kind {
            self.kind = fresh.kind;
            if matches!(self.status, Status::Inbox | Status::Todo) {
                self.status = fresh.status;
            }
        }
        for l in &fresh.links {
            if !self.links.iter().any(|x| x.url == l.url) {
                self.links.push(l.clone());
            }
        }
        let changed = before != seen(self);
        if changed {
            self.touch(now, device);
        }
        changed
    }
}

/// Deterministic id for an imported record, so two devices importing the same Canvas/GCal
/// feed produce the same item id (and sync merges instead of duplicating).
/// 128-bit FNV-1a over `adapter \0 external_id`, stamped as an RFC 4122 v8 ("custom") UUID.
pub fn stable_id(adapter: &str, external_id: &str) -> Uuid {
    const OFFSET: u128 = 0x6c62272e07bb014262b821756295c58d;
    const PRIME: u128 = 0x0000000001000000000000000000013B;
    let mut h = OFFSET;
    for b in adapter
        .bytes()
        .chain(std::iter::once(0u8))
        .chain(external_id.bytes())
    {
        h ^= b as u128;
        h = h.wrapping_mul(PRIME);
    }
    uuid::Builder::from_bytes(h.to_be_bytes())
        .with_variant(uuid::Variant::RFC4122)
        .with_version(uuid::Version::Custom)
        .into_uuid()
}

/// Note the reader's word for imported items saved before it was kept: what they hold now, which
/// is what the last read gave them. Then an edit made before the next read already counts as
/// yours. Returns how many it noted.
pub fn note_readers_word(items: &mut [Item]) -> usize {
    let mut n = 0;
    for it in items.iter_mut().filter(|i| {
        i.source.adapter != "manual" && i.source.external_id.is_some() && i.source.said.is_none()
    }) {
        it.source.said = Some(Said::of(it));
        n += 1;
    }
    n
}

/// What an import did, from [`merge_imported`] (plus series the caller pruned).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportCounts {
    pub added: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub removed: usize,
}

/// Merge freshly imported items (stable ids, see [`stable_id`]) into `items`: unknown ids are
/// added, known ones take the reader's fields you haven't changed and keep the rest
/// ([`Item::refresh_from_source`]). An item the user deleted stays deleted. Each item's
/// `source.kind` and `source.said` record what its reader gave it.
pub fn merge_imported(
    items: &mut Vec<Item>,
    incoming: Vec<Item>,
    now: DateTime<Utc>,
    device: &str,
) -> ImportCounts {
    let mut n = ImportCounts::default();
    for mut fresh in incoming {
        fresh.source.kind = Some(fresh.kind);
        fresh.source.said = Some(Said::of(&fresh));
        match items.iter_mut().find(|i| i.id == fresh.id) {
            Some(existing) => {
                if existing.refresh_from_source(&fresh, now, device) {
                    n.updated += 1;
                } else {
                    n.unchanged += 1;
                }
            }
            None => {
                items.push(fresh);
                n.added += 1;
            }
        }
    }
    n
}

/// What a Canvas reader makes of a piece of work. Canvas also lists grade columns ("Final
/// course grade", "Max(Midterm 1, Avg(Midterm 2, Final)) (15%)") and notices ("Midterm 1
/// (FYI)") as assignments, so only work the reader is sure of keeps `kind` and is to do.
/// Anything else is Info: to do (read) when its title says it's a grade or a notice
/// ([`reads_as_info`]), else in the Inbox for you to say what it is.
pub fn canvas_kind(title: &str, kind: ItemKind, sure: bool) -> (ItemKind, Status) {
    if sure {
        (kind, Status::Todo)
    } else if reads_as_info(title) {
        (ItemKind::Info, Status::Todo)
    } else {
        (ItemKind::Info, Status::Inbox)
    }
}

/// A title that says it's a grade or a notice rather than work: the words grade(s), total(s),
/// FYI, attendance or participation, or a formula such as `max(` or `avg(`.
pub fn reads_as_info(title: &str) -> bool {
    let t = title.to_lowercase();
    let squeezed: String = t.chars().filter(|c| !c.is_whitespace()).collect();
    ["max(", "min(", "avg(", "average(", "sum("]
        .iter()
        .any(|f| squeezed.contains(f))
        || t.split(|c: char| !c.is_alphanumeric()).any(|w| {
            matches!(
                w,
                "grade" | "grades" | "total" | "totals" | "fyi" | "attendance" | "participation"
            )
        })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Course {
    /// Stable id, e.g. "cmpsc130a-f26".
    pub id: String,
    /// "CMPSC 130A"
    pub code: String,
    #[serde(default)]
    pub title: String,
    /// Extra quick-add/filter names: "algo", "pstat".
    #[serde(default)]
    pub aliases: Vec<String>,
    /// Palette index for the UI.
    #[serde(default)]
    pub color: u8,
    /// "F26"
    #[serde(default)]
    pub quarter: String,
    /// False = user excluded this Canvas course as clutter; its items are hidden by filters.
    #[serde(default = "default_true")]
    pub included: bool,
    /// The first is the quick link its items show (swapping it moves another to the front);
    /// readers only append theirs, so the order you pick survives refreshes.
    #[serde(default)]
    pub links: Vec<Link>,
    #[serde(default)]
    pub canvas_id: Option<String>,
}

fn default_true() -> bool {
    true
}

/// Lowercase and drop all whitespace: "CMPSC 130A" -> "cmpsc130a".
pub fn normalize_token(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

impl Course {
    pub fn new(id: &str, code: &str) -> Course {
        Course {
            id: id.into(),
            code: code.into(),
            title: String::new(),
            aliases: Vec::new(),
            color: 0,
            quarter: String::new(),
            included: true,
            links: Vec::new(),
            canvas_id: None,
        }
    }

    /// The catalog number: last word of the code if it starts with a digit ("130a").
    pub fn number(&self) -> Option<String> {
        let last = self.code.split_whitespace().last()?;
        if last.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            Some(last.to_lowercase())
        } else {
            None
        }
    }

    /// The quick-add / filter course rule. `token` (case-insensitive, spaces removed) equals
    /// an alias, the code without spaces ("cmpsc130a"), the number ("130a"), or "cs"+number
    /// ("cs130a").
    pub fn matches_token(&self, token: &str) -> bool {
        let t = normalize_token(token);
        if t.is_empty() {
            return false;
        }
        if self.aliases.iter().any(|a| normalize_token(a) == t) {
            return true;
        }
        if normalize_token(&self.code) == t {
            return true;
        }
        if let Some(n) = self.number() {
            if t == n || t == format!("cs{n}") {
                return true;
            }
        }
        false
    }
}

/// Find the course a single token refers to (first match in list order).
pub fn course_for_token<'a>(token: &str, courses: &'a [Course]) -> Option<&'a Course> {
    courses.iter().find(|c| c.matches_token(token))
}

/// Find a course mentioned anywhere in free text: tries each word and each adjacent word
/// pair ("CMPSC 130A Lecture" -> CMPSC 130A).
pub fn course_in_text<'a>(text: &str, courses: &'a [Course]) -> Option<&'a Course> {
    let words: Vec<&str> = text
        .split(|c: char| c.is_whitespace() || matches!(c, '[' | ']' | '(' | ')' | ',' | ':' | '-'))
        .filter(|w| !w.is_empty())
        .collect();
    for pair in words.windows(2) {
        if let Some(c) = course_for_token(&format!("{}{}", pair[0], pair[1]), courses) {
            return Some(c);
        }
    }
    words.iter().find_map(|w| course_for_token(w, courses))
}

/// Remove course `id`. With `into`, it merges: its items move there, and the kept course takes
/// its links, its Canvas id when it has none, and its code and aliases as aliases, so the feed
/// or Gradescope course that made the duplicate lands in the kept course instead of adding it
/// again. Without `into`, its items stay as personal items, or are tombstoned with
/// `drop_items`. Returns the removed course, or `None` if `id` (or `into`) is not there.
pub fn remove_course(
    courses: &mut Vec<Course>,
    items: &mut [Item],
    id: &str,
    into: Option<&str>,
    drop_items: bool,
    now: DateTime<Utc>,
    device: &str,
) -> Option<Course> {
    let at = courses.iter().position(|c| c.id == id)?;
    if into.is_some_and(|k| k == id || !courses.iter().any(|c| c.id == k)) {
        return None;
    }
    let gone = courses.remove(at);
    if let Some(keep) = into.and_then(|k| courses.iter_mut().find(|c| c.id == k)) {
        for l in &gone.links {
            if !keep.links.iter().any(|x| x.url == l.url) {
                keep.links.push(l.clone());
            }
        }
        if keep.canvas_id.is_none() {
            keep.canvas_id = gone.canvas_id.clone();
        }
        for a in std::iter::once(&gone.code).chain(&gone.aliases) {
            if !keep.matches_token(a) {
                keep.aliases.push(a.clone());
            }
        }
    }
    for it in items
        .iter_mut()
        .filter(|it| it.course_id.as_deref() == Some(id))
    {
        match into {
            Some(k) => it.course_id = Some(k.to_string()),
            None if drop_items => it.deleted = true,
            None => it.course_id = None,
        }
        it.touch(now, device);
    }
    Some(gone)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Sort {
    #[default]
    Score,
    Due,
    Updated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Lens {
    #[default]
    List,
    Week,
    Courses,
    Links,
    /// Note cards and the editor (`kind:note`).
    Notes,
}

/// A screen = a saved filter query + sort + presentation lens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct View {
    pub id: String,
    pub label: String,
    pub query: String,
    #[serde(default)]
    pub sort: Sort,
    #[serde(default)]
    pub lens: Lens,
}

impl View {
    pub fn new(id: &str, label: &str, query: &str, sort: Sort, lens: Lens) -> View {
        View {
            id: id.into(),
            label: label.into(),
            query: query.into(),
            sort,
            lens,
        }
    }
}

pub fn default_views() -> Vec<View> {
    use Lens::*;
    use Sort::*;
    vec![
        View::new("now", "Now", "is:open is:actionable", Score, List),
        View::new("today", "Today", "is:open due<=today", Due, List),
        View::new("inbox", "Inbox", "status:inbox", Updated, List),
        View::new("work", "Work", "is:open kind:work", Score, List),
        View::new("exams", "Exams", "kind:exam", Due, List),
        View::new("week", "Week", "due:week", Due, Week),
        View::new("classes", "Classes", "", Due, Courses),
        View::new("events", "Events", "kind:event,ticket", Due, List),
        View::new("links", "Links", "", Updated, Links),
        View::new("notes", "Notes", "is:open kind:note", Updated, Notes),
        View::new("done", "Done", "is:done", Updated, List),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn serde_names() {
        assert_eq!(
            serde_json::to_string(&ItemKind::OfficeHours).unwrap(),
            "\"office_hours\""
        );
        assert_eq!(serde_json::to_string(&Status::Inbox).unwrap(), "\"inbox\"");
        assert_eq!(
            serde_json::to_string(&Sort::Updated).unwrap(),
            "\"updated\""
        );
        assert_eq!(ItemKind::from_name("hw"), Some(ItemKind::Assignment));
        assert_eq!(
            ItemKind::from_name("office_hours"),
            Some(ItemKind::OfficeHours)
        );
        assert_eq!(ItemKind::from_name("nope"), None);
    }

    #[test]
    fn item_roundtrip_with_defaults() {
        let json = r#"{"id":"6f1c1b1e-0000-4000-8000-000000000001","title":"x",
            "created_at":"2026-10-28T00:00:00Z","updated_at":"2026-10-28T00:00:00Z"}"#;
        let it: Item = serde_json::from_str(json).unwrap();
        assert_eq!(it.kind, ItemKind::Task);
        assert_eq!(it.source.adapter, "manual");
        let back: Item = serde_json::from_str(&serde_json::to_string(&it).unwrap()).unwrap();
        assert_eq!(back, it);
    }

    #[test]
    fn open_and_actionable() {
        let now = t("2026-10-28T17:00:00Z");
        let mut it = Item::new("lecture", ItemKind::Class, now, "d");
        it.due = Some(t("2026-10-28T15:00:00Z"));
        it.end = Some(t("2026-10-28T16:15:00Z"));
        assert!(!it.is_open(now), "class that ended is not open");
        it.end = Some(t("2026-10-28T18:00:00Z"));
        assert!(it.is_open(now));
        let mut hw = Item::new("hw", ItemKind::Assignment, now, "d");
        hw.due = Some(t("2026-10-27T00:00:00Z"));
        assert!(hw.is_open(now), "overdue homework is still open");
        assert!(hw.is_overdue(now));
        hw.status = Status::Done;
        assert!(!hw.is_open(now));
        assert!(!ItemKind::OfficeHours.is_actionable());
        let mut oh = Item::new("oh", ItemKind::OfficeHours, now, "d");
        oh.due = Some(t("2026-10-28T15:00:00Z"));
        oh.end = Some(t("2026-10-28T16:00:00Z"));
        assert!(!oh.is_open(now), "office hours that ended are over");
        it.end = Some(t("2026-10-28T18:00:00Z"));
        assert!(
            it.is_open(now) && !it.is_overdue(now),
            "a class in progress is not overdue"
        );
        assert!(ItemKind::Errand.is_actionable());
    }

    #[test]
    fn course_tokens() {
        let mut c = Course::new("cmpsc130a", "CMPSC 130A");
        c.aliases = vec!["algo".into()];
        for tok in ["130a", "130A", "cs130a", "CMPSC130A", "algo", "ALGO"] {
            assert!(c.matches_token(tok), "{tok}");
        }
        for tok in ["130", "cmpsc", "cs130", ""] {
            assert!(!c.matches_token(tok), "{tok}");
        }
        let cs = [c];
        assert_eq!(
            course_in_text("CMPSC 130A Lecture", &cs).map(|c| c.id.as_str()),
            Some("cmpsc130a")
        );
    }

    #[test]
    fn merge_imported_keeps_user_fields_and_deletions() {
        let now = t("2026-10-28T17:00:00Z");
        let imported = |title: &str, ext: &str| {
            let mut it = Item::new(title, ItemKind::Assignment, now, "dev");
            it.id = stable_id("canvas", ext);
            it.source.adapter = "canvas".into();
            it
        };
        let mut items = Vec::new();
        let n = merge_imported(
            &mut items,
            vec![imported("HW 4", "a4"), imported("HW 5", "a5")],
            now,
            "dev",
        );
        assert_eq!((n.added, n.updated, n.unchanged), (2, 0, 0));
        items[0].status = Status::Done;
        items[0].priority = 2;
        items[0].quick_link = Some("https://webwork.math.ucsb.edu/webwork2/MATH4B/".into());
        items[1].deleted = true;
        let later = now + chrono::Duration::hours(1);
        let n = merge_imported(
            &mut items,
            vec![imported("HW 4 (revised)", "a4"), imported("HW 5", "a5")],
            later,
            "dev",
        );
        assert_eq!((n.added, n.updated, n.unchanged), (0, 1, 1));
        assert_eq!(items[0].title, "HW 4 (revised)");
        assert_eq!((items[0].status, items[0].priority), (Status::Done, 2));
        assert!(items[0].quick_link.is_some(), "the link you picked stays");
        assert!(
            items[1].deleted,
            "a re-import must not bring back what you deleted"
        );
    }

    #[test]
    fn your_edits_to_an_imported_event_outlast_re_imports() {
        let now = t("2026-11-10T17:00:00Z");
        let at = |h: i64| Some(now + chrono::Duration::hours(h));
        let google = |title: &str, start: i64, place: &str| {
            let mut it = Item::new(title, ItemKind::Event, now, "dev");
            it.id = stable_id("gcalev", "uid-1@google.com");
            it.source.adapter = "gcalev".into();
            it.source.external_id = Some("uid-1@google.com".into());
            (it.due, it.end) = (at(start), at(start + 1));
            it.location = Some(place.into());
            it.course_id = Some("math4b".into());
            it
        };
        let mut items = Vec::new();
        merge_imported(&mut items, vec![google("Study", 2, "Library")], now, "dev");

        // you rename it, move it an hour later and put it in no class, as the UI saves it
        let it = &mut items[0];
        it.title = "Study with Ana".into();
        (it.due, it.end) = (at(3), at(4));
        it.course_id = None;
        it.touch(now + chrono::Duration::minutes(1), "phone");
        let mine = items[0].clone();

        // the same event again changes nothing, and doesn't bump the item over your edit
        let later = now + chrono::Duration::minutes(30);
        let n = merge_imported(
            &mut items,
            vec![google("Study", 2, "Library")],
            later,
            "dev",
        );
        assert_eq!((n.updated, n.unchanged), (0, 1));
        assert_eq!(items[0], mine);

        // Google moves the room: that follows, your title, time and class stay
        let n = merge_imported(
            &mut items,
            vec![google("Study", 2, "HSSB 1173")],
            later,
            "dev",
        );
        assert_eq!(n.updated, 1);
        let it = &items[0];
        assert_eq!(it.location.as_deref(), Some("HSSB 1173"));
        assert_eq!(
            (it.title.as_str(), it.due, it.end),
            ("Study with Ana", at(3), at(4))
        );
        assert_eq!(it.course_id, None);

        // Google renames it too: yours still wins, and Google's word is noted without a change
        let n = merge_imported(
            &mut items,
            vec![google("Review", 2, "HSSB 1173")],
            later,
            "dev",
        );
        assert_eq!((n.updated, n.unchanged), (0, 1));
        assert_eq!(items[0].title, "Study with Ana");
        assert_eq!(items[0].source.said.as_ref().unwrap().title, "Review");

        // put Google's title back and it follows Google again
        items[0].title = "Review".into();
        merge_imported(
            &mut items,
            vec![google("Final review", 2, "HSSB 1173")],
            later,
            "dev",
        );
        assert_eq!(items[0].title, "Final review");
        assert_eq!(items[0].due, at(3), "the time is still yours");
    }

    #[test]
    fn an_item_from_before_the_readers_word_was_kept_takes_it_once() {
        let now = t("2026-11-10T17:00:00Z");
        let canvas = |title: &str| {
            let mut it = Item::new(title, ItemKind::Assignment, now, "dev");
            it.id = stable_id("canvas", "a1");
            it.source.adapter = "canvas".into();
            it
        };
        let mut old = canvas("HW 1 (old title)");
        old.source.kind = Some(ItemKind::Assignment);
        let mut items = vec![old];
        merge_imported(&mut items, vec![canvas("HW 1")], now, "dev");
        assert_eq!(items[0].title, "HW 1");
        assert_eq!(items[0].source.said.as_ref().unwrap().title, "HW 1");
        // and from then on an edit is yours
        items[0].title = "HW 1 (do the bonus)".into();
        merge_imported(&mut items, vec![canvas("HW 1")], now, "dev");
        assert_eq!(items[0].title, "HW 1 (do the bonus)");
    }

    #[test]
    fn an_edit_right_after_the_update_already_counts() {
        let now = t("2026-11-10T17:00:00Z");
        let mut lecture = Item::new("MATH 4B lecture", ItemKind::Class, now, "dev");
        lecture.id = stable_id("gcal", "uid-3");
        lecture.source.adapter = "gcal".into();
        lecture.source.external_id = Some("uid-3".into());
        let mine = Item::new("groceries", ItemKind::Errand, now, "dev");
        let mut items = vec![lecture.clone(), mine];
        // only what a reader brought in
        assert_eq!(note_readers_word(&mut items), 1);
        assert_eq!(note_readers_word(&mut items), 0);
        items[0].title = "MATH 4B lecture (in HSSB today)".into();
        merge_imported(&mut items, vec![lecture], now, "dev");
        assert_eq!(items[0].title, "MATH 4B lecture (in HSSB today)");
    }

    #[test]
    fn kinds_you_pick_and_sure_readers_stick() {
        let now = t("2026-11-01T17:00:00Z");
        let canvas = |kind: ItemKind, status: Status| {
            let mut it = Item::new("Midterm 2 (25%)", kind, now, "dev");
            it.id = stable_id("canvas", "event-assignment-4");
            it.source.adapter = "canvas".into();
            it.status = status;
            it
        };
        let unsure = || vec![canvas(ItemKind::Info, Status::Inbox)];
        let sure = || vec![canvas(ItemKind::Exam, Status::Todo)];
        let mut items = Vec::new();
        merge_imported(&mut items, unsure(), now, "dev");
        assert_eq!(items[0].source.kind, Some(ItemKind::Info));
        let got = |items: &[Item]| (items[0].kind, items[0].status);
        // a sure reader takes it out of the Inbox, and an unsure one doesn't undo that
        merge_imported(&mut items, sure(), now, "dev");
        assert_eq!(got(&items), (ItemKind::Exam, Status::Todo));
        let n = merge_imported(&mut items, unsure(), now, "dev");
        assert_eq!(
            (got(&items), n.unchanged),
            ((ItemKind::Exam, Status::Todo), 1)
        );
        // you call it info: neither reader changes that
        items[0].kind = ItemKind::Info;
        merge_imported(&mut items, sure(), now, "dev");
        merge_imported(&mut items, unsure(), now, "dev");
        assert_eq!(got(&items), (ItemKind::Info, Status::Todo));
        // a reader's kind change leaves work you've started or finished where it is
        let mut items = Vec::new();
        merge_imported(&mut items, sure(), now, "dev");
        items[0].status = Status::Doing;
        items[0].source.kind = None;
        merge_imported(&mut items, unsure(), now, "dev");
        assert_eq!(got(&items), (ItemKind::Info, Status::Doing));
    }

    #[test]
    fn canvas_kinds() {
        let hw = |t: &str, sure: bool| canvas_kind(t, ItemKind::Assignment, sure);
        assert_eq!(hw("Homework 6", true), (ItemKind::Assignment, Status::Todo));
        assert_eq!(hw("Homework 6", false), (ItemKind::Info, Status::Inbox));
        assert_eq!(
            hw("Final Exam (30%)", false),
            (ItemKind::Info, Status::Inbox)
        );
        for t in [
            "Final course grade (with bonus)",
            "Final Course Grade (without bonus, percentage)",
            "Max( Midterm1, Avg(Midterm2, Final) ) (15%)",
            "Midterm 1 (FYI)",
            "Attendance",
            "Section participation",
            "Lab totals",
        ] {
            assert!(reads_as_info(t), "{t}");
            assert_eq!(hw(t, false), (ItemKind::Info, Status::Todo), "{t}");
        }
        for t in [
            "Homework 6",
            "Regrade requests",
            "Midterm 2 (25%)",
            "Maximum flow",
        ] {
            assert!(!reads_as_info(t), "{t}");
        }
        assert_eq!(ItemKind::from_name("fyi"), Some(ItemKind::Info));
        assert!(!ItemKind::Info.is_actionable() && !ItemKind::Info.is_scheduled());
    }

    #[test]
    fn stable_ids() {
        let a = stable_id("canvas", "event-assignment-1");
        assert_eq!(a, stable_id("canvas", "event-assignment-1"));
        assert_ne!(a, stable_id("canvas", "event-assignment-2"));
        assert_ne!(a, stable_id("gcal", "event-assignment-1"));
        assert_eq!(a.get_version_num(), 8);
    }

    #[test]
    fn views() {
        let v = default_views();
        assert_eq!(v.len(), 11);
        assert_eq!(v[0].id, "now");
        assert_eq!(v[0].query, "is:open is:actionable");
        assert!(v.iter().any(|v| v.id == "week" && v.lens == Lens::Week));
        assert!(v
            .iter()
            .any(|v| v.id == "classes" && v.lens == Lens::Courses));
        assert!(v.iter().any(|v| v.id == "links" && v.lens == Lens::Links));
        assert!(v.iter().any(|v| v.id == "notes" && v.lens == Lens::Notes));
    }

    #[test]
    fn notes_are_kept_not_ranked_or_scheduled() {
        let now = t("2026-11-01T12:00:00Z");
        assert!(!ItemKind::Note.is_actionable() && !ItemKind::Note.is_scheduled());
        assert!(ItemKind::Class.is_scheduled() && !ItemKind::Class.is_actionable());
        assert_eq!(ItemKind::from_name("idea"), Some(ItemKind::Note));
        assert_eq!(serde_json::to_string(&ItemKind::Note).unwrap(), "\"note\"");
        let mut n = Item::new("ideas for the island", ItemKind::Note, now, "d");
        n.due = Some(t("2026-10-01T00:00:00Z"));
        assert!(
            n.is_open(now) && !n.is_overdue(now),
            "a dated note is never overdue"
        );
        n.status = Status::Done;
        assert!(!n.is_open(now), "done archives a note");
    }

    #[test]
    fn link_label() {
        for (url, label) in [
            ("https://canvas.ucsb.edu/courses/1", "Canvas"),
            ("https://ucsb.instructure.com/courses/1", "Canvas"),
            ("https://docs.google.com/spreadsheets/d/x/edit", "Google Sheets"),
            ("https://docs.google.com/document/d/x/edit", "Google Docs"),
            ("https://ucsb.zoom.us/j/123?pwd=x", "Zoom"),
            ("https://webwork.math.ucsb.edu/webwork2/math4a/", "WeBWorK"),
            ("https://www.gradescope.com/courses/9", "Gradescope"),
            ("https://WWW.Example.com:8080/a?b#c", "example.com"),
            ("https://notzoom.us/x", "notzoom.us"),
            ("://", "://"),
        ] {
            assert_eq!(Link::from_url(url).label, label, "{url}");
        }
    }

    #[test]
    fn removing_a_course_merges_or_unlinks() {
        let now = t("2026-11-01T12:00:00Z");
        let mut canvas = Course::new("cmpsc130a", "CMPSC 130A");
        canvas.canvas_id = Some("1".into());
        let mut dup = Course::new("cmpsc130a-gs9", "CMPSC 130A");
        dup.aliases.push("algo".into());
        dup.links
            .push(Link::from_url("https://www.gradescope.com/courses/9"));
        let mut other = Course::new("pstat120a", "PSTAT 120A");
        other.links.push(Link::from_url("https://x.edu/p"));
        let mut courses = vec![canvas, dup, other];
        let mut hw = Item::new("hw", ItemKind::Assignment, now, "d");
        hw.course_id = Some("cmpsc130a-gs9".into());
        let mut ps = Item::new("ps", ItemKind::Assignment, now, "d");
        ps.course_id = Some("pstat120a".into());
        let mut items = vec![hw, ps];

        assert!(remove_course(&mut courses, &mut items, "nope", None, false, now, "d").is_none());
        assert!(remove_course(
            &mut courses,
            &mut items,
            "cmpsc130a",
            Some("cmpsc130a"),
            false,
            now,
            "d"
        )
        .is_none());
        let gone = remove_course(
            &mut courses,
            &mut items,
            "cmpsc130a-gs9",
            Some("cmpsc130a"),
            false,
            now,
            "d",
        );
        assert_eq!(gone.map(|c| c.id).as_deref(), Some("cmpsc130a-gs9"));
        assert_eq!(courses.len(), 2);
        assert_eq!(items[0].course_id.as_deref(), Some("cmpsc130a"));
        let keep = &courses[0];
        assert_eq!(
            keep.aliases,
            vec!["algo".to_string()],
            "the same code is not repeated as an alias"
        );
        assert_eq!(keep.links.len(), 1);
        assert_eq!(keep.canvas_id.as_deref(), Some("1"));
        assert_eq!(
            course_for_token("algo", &courses).map(|c| c.id.as_str()),
            Some("cmpsc130a")
        );

        remove_course(&mut courses, &mut items, "pstat120a", None, false, now, "d").unwrap();
        assert_eq!(items[1].course_id, None);
        assert!(!items[1].deleted);
        remove_course(&mut courses, &mut items, "cmpsc130a", None, true, now, "d").unwrap();
        assert!(items[0].deleted);
        assert!(courses.is_empty());
    }
}
