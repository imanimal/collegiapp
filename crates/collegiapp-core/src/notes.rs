//! Notes from outside the app: what an assistant connected over the bridge lists, reads and
//! writes (`/v1/notes`, src-tauri/src/bridge.rs; the client is `integrations/claude-desktop`).
//!
//! A note is an Item of kind `note` whose text is Collegiapp Markdown (docs/NOTES.md). Drawings
//! and pasted pictures are `data:` addresses tens of kilobytes long, so the assistant sees each as
//! a numbered stand-in, `![Drawing|center 40%](drawing:1)`, as Ask AI does (`CA.ai.pack` in
//! ui/js/ai.js), and [`edit`] puts the real ones back in what it writes. An archived note is a
//! done one and a pinned note carries the tag `pinned`, as in the Notes view.

use chrono::{DateTime, FixedOffset, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::filter::{run_query, Ctx};
use crate::model::{course_for_token, course_in_text, Course, Item, ItemKind, Sort, Status};

/// A synced note can't pass about this many bytes (docs/NOTES.md); a write that would is refused.
pub const MAX_BYTES: usize = 900_000;
/// How long a preview is, in characters.
const PREVIEW: usize = 160;

/// A note as a list shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Summary {
    pub id: Uuid,
    pub title: String,
    /// The class's code ("CMPSC 130A"), if the note is filed under one.
    pub class: Option<String>,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub archived: bool,
    pub updated: DateTime<Utc>,
    /// `[done, total]` when the note has checklist items.
    pub checklist: Option<[usize; 2]>,
    pub preview: String,
}

/// A whole note: its summary and its text with drawings as stand-ins.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Note {
    #[serde(flatten)]
    pub summary: Summary,
    pub text: String,
}

/// A note to add.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct NewNote {
    pub title: String,
    pub text: String,
    /// A class by code, alias or id ("CMPSC 130A", "algo").
    pub class: Option<String>,
    pub tags: Vec<String>,
    pub pinned: bool,
}

/// A change to a note. `text` replaces the whole text; `append` adds to its end.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Edit {
    pub title: Option<String>,
    pub text: Option<String>,
    pub append: Option<String>,
    /// A class to file it under; an empty string takes it out of its class.
    pub class: Option<String>,
    pub add_tags: Vec<String>,
    pub remove_tags: Vec<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
}

/// What [`edit`] changed. `text` is true when the old text is gone (replaced, not appended to),
/// so the caller keeps that version in the trash.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Changed {
    pub any: bool,
    pub text: bool,
}

pub fn is_note(it: &Item) -> bool {
    it.kind == ItemKind::Note && !it.deleted
}

fn is_pinned(it: &Item) -> bool {
    it.tags.iter().any(|t| t.eq_ignore_ascii_case("pinned"))
}

/// Notes matching `query` (the filter grammar: words, `#tag`, a class name), pinned first, then
/// the newest edit. Archived notes only with `archived`.
pub fn list(
    items: &[Item],
    courses: &[Course],
    query: &str,
    archived: bool,
    limit: usize,
    now: DateTime<FixedOffset>,
) -> Vec<Summary> {
    let q = format!(
        "kind:note{} {}",
        if archived { "" } else { " is:open" },
        query.trim()
    );
    let ctx = Ctx { now, courses };
    let mut rows: Vec<Item> = run_query(items, &q, Sort::Updated, &ctx)
        .into_iter()
        .map(|r| r.item)
        .collect();
    rows.sort_by_key(|it| !is_pinned(it));
    rows.iter()
        .take(limit)
        .map(|it| summary(it, courses))
        .collect()
}

pub fn summary(it: &Item, courses: &[Course]) -> Summary {
    let (text, _) = pack(&it.notes);
    Summary {
        id: it.id,
        title: it.title.clone(),
        class: it.course_id.as_ref().map(|id| {
            courses
                .iter()
                .find(|c| &c.id == id)
                .map_or(id.clone(), |c| c.code.clone())
        }),
        tags: it.tags.clone(),
        pinned: is_pinned(it),
        archived: matches!(it.status, Status::Done | Status::Dropped),
        updated: it.updated_at,
        checklist: checklist(&it.notes),
        preview: preview(&text),
    }
}

pub fn read(it: &Item, courses: &[Course]) -> Note {
    Note {
        summary: summary(it, courses),
        text: pack(&it.notes).0,
    }
}

/// A new note item (status Todo, so the Notes view shows it).
pub fn create(
    n: &NewNote,
    courses: &[Course],
    now: DateTime<Utc>,
    device: &str,
) -> Result<Item, String> {
    let text = n.text.trim_matches('\n').to_string();
    let mut title = clip(n.title.trim(), 200);
    if title.is_empty() {
        title = title_of(&text);
    }
    if title.is_empty() {
        return Err("a note needs a title or some text".into());
    }
    if text.len() > MAX_BYTES {
        return Err(too_big());
    }
    let mut it = Item::new(title, ItemKind::Note, now, device);
    it.notes = text;
    if let Some(c) = n.class.as_deref().filter(|c| !c.trim().is_empty()) {
        it.course_id = Some(class_id(c, courses)?);
    }
    add_tags(&mut it.tags, &n.tags);
    if n.pinned {
        add_tags(&mut it.tags, &["pinned".to_string()]);
    }
    Ok(it)
}

/// Apply `e` to the note `it`. Stand-ins in new text become the note's own drawings again; one
/// the note doesn't have stays a stand-in, which the app drops as an address it can't show.
pub fn edit(it: &mut Item, e: &Edit, courses: &[Course]) -> Result<Changed, String> {
    if e.text.is_some() && e.append.is_some() {
        return Err("send either text (to replace the note) or append, not both".into());
    }
    let (_, media) = pack(&it.notes);
    let mut out = Changed::default();
    let mut notes = it.notes.clone();
    if let Some(t) = &e.text {
        notes = unpack(t.trim_matches('\n'), &media);
    }
    if let Some(a) = e
        .append
        .as_deref()
        .map(|a| a.trim_matches('\n'))
        .filter(|a| !a.trim().is_empty())
    {
        let a = unpack(a, &media);
        let head = notes.trim_end();
        notes = if head.is_empty() {
            a
        } else {
            format!("{head}\n\n{a}")
        };
    }
    if notes.len() > MAX_BYTES && notes.len() > it.notes.len() {
        return Err(too_big());
    }
    let mut title = it.title.clone();
    if let Some(t) = e.title.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        title = clip(t, 200);
    }
    let course = match e.class.as_deref().map(str::trim) {
        None => it.course_id.clone(),
        Some("") => None,
        Some(c) => Some(class_id(c, courses)?),
    };
    let mut tags = it.tags.clone();
    let mut remove: Vec<String> = e.remove_tags.iter().map(|t| tag(t)).collect();
    let mut add = e.add_tags.clone();
    match e.pinned {
        Some(true) => add.push("pinned".into()),
        Some(false) => remove.push("pinned".into()),
        None => {}
    }
    tags.retain(|t| !remove.iter().any(|r| r.eq_ignore_ascii_case(t)));
    add_tags(&mut tags, &add);
    let status = match e.archived {
        Some(true) => Status::Done,
        Some(false) if matches!(it.status, Status::Done | Status::Dropped) => Status::Todo,
        _ => it.status,
    };
    out.text = e.text.is_some() && notes != it.notes;
    out.any = notes != it.notes
        || title != it.title
        || course != it.course_id
        || tags != it.tags
        || status != it.status;
    it.notes = notes;
    it.title = title;
    it.course_id = course;
    it.tags = tags;
    it.status = status;
    Ok(out)
}

/// The id of the class `name` means: its id, a code or alias ("CMPSC 130A", "algo", "130a"),
/// or a class named somewhere in it.
pub fn class_id(name: &str, courses: &[Course]) -> Result<String, String> {
    let n = name.trim();
    courses
        .iter()
        .find(|c| c.id.eq_ignore_ascii_case(n) || c.code.eq_ignore_ascii_case(n))
        .or_else(|| course_for_token(&n.replace(' ', ""), courses))
        .or_else(|| course_in_text(n, courses))
        .map(|c| c.id.clone())
        .ok_or_else(|| format!("no class called \"{n}\" (list_classes shows them)"))
}

fn too_big() -> String {
    format!(
        "that would make the note bigger than {} KB, too big to sync; start a new note",
        MAX_BYTES / 1000
    )
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

fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Drawings and pictures as stand-ins: every `](data:image/…;base64,…)` becomes
/// `](drawing:N)`, numbered in the order they first appear; the second value lists the addresses.
pub fn pack(md: &str) -> (String, Vec<String>) {
    const OPEN: &str = "](data:image/";
    if !md.contains(OPEN) {
        return (md.to_string(), Vec::new());
    }
    let (mut out, mut media, mut rest) = (String::with_capacity(4096), Vec::<String>::new(), md);
    while let Some(i) = rest.find(OPEN) {
        let src_at = i + 2;
        let src_end = rest[src_at..].find(')').map(|j| src_at + j);
        let src = src_end
            .map(|e| &rest[src_at..e])
            .filter(|s| is_data_image(s));
        let (Some(src), Some(end)) = (src, src_end) else {
            out.push_str(&rest[..src_at]);
            rest = &rest[src_at..];
            continue;
        };
        let n = match media.iter().position(|m| m == src) {
            Some(k) => k + 1,
            None => {
                media.push(src.to_string());
                media.len()
            }
        };
        out.push_str(&rest[..src_at]);
        out.push_str(&format!("drawing:{n}"));
        rest = &rest[end..];
    }
    out.push_str(rest);
    (out, media)
}

/// `data:image/<type>;base64,<base64>`, the addresses the editor keeps.
fn is_data_image(s: &str) -> bool {
    let Some(rest) = s.strip_prefix("data:image/") else {
        return false;
    };
    let Some((ty, b64)) = rest.split_once(";base64,") else {
        return false;
    };
    !ty.is_empty()
        && ty.chars().all(|c| c.is_ascii_alphabetic() || c == '+')
        && !b64.is_empty()
        && b64
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '='))
}

/// Put the addresses [`pack`] took out back in place of their stand-ins.
pub fn unpack(md: &str, media: &[String]) -> String {
    const OPEN: &str = "](drawing:";
    if media.is_empty() || !md.contains(OPEN) {
        return md.to_string();
    }
    let (mut out, mut rest) = (String::with_capacity(md.len()), md);
    while let Some(i) = rest.find(OPEN) {
        let num_at = i + OPEN.len();
        let digits = rest[num_at..]
            .chars()
            .take_while(char::is_ascii_digit)
            .count();
        let close = rest[num_at + digits..].starts_with(')');
        let src = rest[num_at..num_at + digits]
            .parse::<usize>()
            .ok()
            .filter(|_| close)
            .and_then(|n| n.checked_sub(1))
            .and_then(|k| media.get(k));
        out.push_str(&rest[..i + 2]);
        match src {
            Some(src) => {
                out.push_str(src);
                rest = &rest[num_at + digits..];
            }
            None => rest = &rest[i + 2..],
        }
    }
    out.push_str(rest);
    out
}

/// `[done, total]` over the note's checklist items (`- [ ]`, `- [x]`, at any depth).
fn checklist(md: &str) -> Option<[usize; 2]> {
    let (mut done, mut total) = (0, 0);
    for l in md.lines().map(str::trim_start) {
        let Some(rest) = l.strip_prefix("- [").or_else(|| l.strip_prefix("* [")) else {
            continue;
        };
        if rest.starts_with(" ]") {
            total += 1;
        } else if rest.starts_with("x]") || rest.starts_with("X]") {
            total += 1;
            done += 1;
        }
    }
    (total > 0).then_some([done, total])
}

/// The first words of the text without its marks, as a card shows them.
fn preview(md: &str) -> String {
    let words: Vec<&str> = md
        .lines()
        .map(strip_line)
        .filter(|l| !l.is_empty() && !l.starts_with("```") && *l != "---")
        .flat_map(str::split_whitespace)
        .collect();
    let t = words
        .join(" ")
        .replace(['*', '`'], "")
        .replace("==", "")
        .replace("~~", "");
    if t.chars().count() <= PREVIEW {
        return t;
    }
    let cut: String = t.chars().take(PREVIEW).collect();
    format!("{}…", cut.rsplit_once(' ').map_or(cut.as_str(), |(a, _)| a))
}

/// A line without its block mark: `# `, `- `, `- [ ] `, `1. `, `> `.
fn strip_line(l: &str) -> &str {
    let mut l = l.trim();
    l = l.trim_start_matches('#').trim_start();
    for p in ["- [ ] ", "- [x] ", "- [X] ", "- ", "* ", "> "] {
        if let Some(r) = l.strip_prefix(p) {
            l = r;
            break;
        }
    }
    let digits = l.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 && l[digits..].starts_with(". ") {
        l = &l[digits + 2..];
    }
    l.trim()
}

/// The title text gives itself: its first line without marks (`ui/js/notes.js` `titleOf`).
pub fn title_of(md: &str) -> String {
    let line = md
        .lines()
        .map(strip_line)
        .find(|l| !l.is_empty() && !l.starts_with("```") && *l != "---" && !l.starts_with("!["))
        .unwrap_or("");
    clip(
        line.replace(['*', '`'], "")
            .replace("==", "")
            .replace("~~", "")
            .trim(),
        120,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &str = "data:image/png;base64,iVBORw0KGgo=";
    const SVG: &str = "data:image/svg+xml;base64,PHN2Zz4=";

    fn now() -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339("2026-10-28T10:00:00-07:00").unwrap()
    }

    fn courses() -> Vec<Course> {
        let mut algo = Course::new("cmpsc130a-f26", "CMPSC 130A");
        algo.aliases = vec!["algo".into()];
        vec![algo, Course::new("pstat120a-f26", "PSTAT 120A")]
    }

    fn note(title: &str, text: &str) -> Item {
        let mut it = Item::new(title, ItemKind::Note, now().with_timezone(&Utc), "d");
        it.notes = text.into();
        it
    }

    #[test]
    fn packs_and_unpacks_drawings() {
        let md = format!("Intro\n\n![Drawing|center 40%]({SVG})\n\n![a]({PNG}) and ![b]({SVG})");
        let (packed, media) = pack(&md);
        assert_eq!(
            packed,
            "Intro\n\n![Drawing|center 40%](drawing:1)\n\n![a](drawing:2) and ![b](drawing:1)"
        );
        assert_eq!(media, vec![SVG.to_string(), PNG.to_string()]);
        assert_eq!(unpack(&packed, &media), md);
        // one the note doesn't have stays a stand-in; links and broken marks pass through
        assert_eq!(
            unpack("![x](drawing:9) ](drawing:", &media),
            "![x](drawing:9) ](drawing:"
        );
        let odd = "[a](data:text/plain;base64,aGk=) ![c](data:image/png;base64,bad!)";
        assert_eq!(pack(odd), (odd.to_string(), vec![]));
    }

    #[test]
    fn creates_a_note() {
        let n = NewNote {
            title: "".into(),
            text: "## Heaps\n\n- [ ] read 6.1\n- [x] lecture".into(),
            class: Some("algo".into()),
            tags: vec!["#exam prep".into(), "Exam-prep".into()],
            pinned: true,
        };
        let it = create(&n, &courses(), now().with_timezone(&Utc), "d").unwrap();
        assert_eq!((it.kind, it.status), (ItemKind::Note, Status::Todo));
        assert_eq!(it.title, "Heaps");
        assert_eq!(it.course_id.as_deref(), Some("cmpsc130a-f26"));
        assert_eq!(it.tags, vec!["exam-prep", "pinned"]);
        let s = summary(&it, &courses());
        assert_eq!(
            (s.class.as_deref(), s.pinned, s.checklist),
            (Some("CMPSC 130A"), true, Some([1, 2]))
        );
        assert_eq!(s.preview, "Heaps read 6.1 lecture");
        let bad = NewNote {
            title: "x".into(),
            class: Some("chem 1a".into()),
            ..Default::default()
        };
        assert!(create(&bad, &courses(), now().with_timezone(&Utc), "d")
            .unwrap_err()
            .contains("chem 1a"));
        assert!(create(
            &NewNote::default(),
            &courses(),
            now().with_timezone(&Utc),
            "d"
        )
        .is_err());
    }

    #[test]
    fn edits_keep_drawings_and_say_what_was_lost() {
        let mut it = note("Graphs", &format!("BFS\n\n![Drawing|right 35%]({SVG})"));
        let e = Edit {
            append: Some("DFS too".into()),
            ..Default::default()
        };
        assert_eq!(
            edit(&mut it, &e, &courses()).unwrap(),
            Changed {
                any: true,
                text: false
            }
        );
        assert_eq!(
            it.notes,
            format!("BFS\n\n![Drawing|right 35%]({SVG})\n\nDFS too")
        );
        let e = Edit {
            text: Some("# BFS\n\n![Drawing|right 35%](drawing:1)\n\nDFS".into()),
            class: Some("PSTAT 120A".into()),
            pinned: Some(true),
            archived: Some(true),
            ..Default::default()
        };
        assert_eq!(
            edit(&mut it, &e, &courses()).unwrap(),
            Changed {
                any: true,
                text: true
            }
        );
        assert_eq!(
            it.notes,
            format!("# BFS\n\n![Drawing|right 35%]({SVG})\n\nDFS")
        );
        assert_eq!(
            (it.course_id.as_deref(), it.status),
            (Some("pstat120a-f26"), Status::Done)
        );
        assert_eq!(it.tags, vec!["pinned"]);
        let e = Edit {
            class: Some("".into()),
            pinned: Some(false),
            archived: Some(false),
            ..Default::default()
        };
        edit(&mut it, &e, &courses()).unwrap();
        assert_eq!(
            (it.course_id.as_deref(), it.status, it.tags.len()),
            (None, Status::Todo, 0)
        );
        let same = Edit {
            text: Some(it.notes.clone()),
            ..Default::default()
        };
        assert_eq!(
            edit(&mut it, &same, &courses()).unwrap(),
            Changed::default()
        );
        let both = Edit {
            text: Some("a".into()),
            append: Some("b".into()),
            ..Default::default()
        };
        assert!(edit(&mut it, &both, &courses()).is_err());
    }

    #[test]
    fn lists_open_notes_pinned_first() {
        let t0 = now().with_timezone(&Utc);
        let mut a = note("Old pinned", "heap sort");
        a.tags = vec!["pinned".into()];
        a.updated_at = t0 - chrono::Duration::days(3);
        let mut b = note("Newer", "heap");
        b.updated_at = t0;
        let mut c = note("Archived", "heap");
        c.status = Status::Done;
        c.updated_at = t0 - chrono::Duration::days(1);
        let mut d = note("Gone", "heap");
        d.deleted = true;
        let task = Item::new("heap task", ItemKind::Task, t0, "d");
        let items = vec![a, b, c, d, task];
        let titles = |v: Vec<Summary>| v.into_iter().map(|s| s.title).collect::<Vec<_>>();
        assert_eq!(
            titles(list(&items, &[], "heap", false, 10, now())),
            ["Old pinned", "Newer"]
        );
        assert_eq!(
            titles(list(&items, &[], "heap", true, 10, now())),
            ["Old pinned", "Newer", "Archived"]
        );
        assert_eq!(
            titles(list(&items, &[], "sort", false, 10, now())),
            ["Old pinned"]
        );
        assert_eq!(list(&items, &[], "", false, 1, now()).len(), 1);
    }

    #[test]
    fn titles_and_classes() {
        assert_eq!(title_of("![Drawing](drawing:1)\n\nSorting"), "Sorting");
        assert_eq!(title_of("- [ ] **Buy** milk\nmore"), "Buy milk");
        assert_eq!(class_id("cmpsc 130a", &courses()).unwrap(), "cmpsc130a-f26");
        assert_eq!(class_id("130A", &courses()).unwrap(), "cmpsc130a-f26");
        assert_eq!(
            class_id("Notes for PSTAT 120A", &courses()).unwrap(),
            "pstat120a-f26"
        );
    }
}
