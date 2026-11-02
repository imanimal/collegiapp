//! The trash: items you deleted and the versions an undo threw away, kept beside the store so
//! they can be restored. The item list itself only keeps tombstones of what was deleted (for
//! sync); the trash keeps what they looked like.
//!
//! Location: `<data dir>/trash/`, chunk files `00000001.trash`, `00000002.trash`, … oldest
//! first. Each chunk is a 12-byte header (`CAT1`, the length of the meta block, the raw length
//! of the body, both u32 LE), then the meta block (brotli JSON: what the Trash dialog lists),
//! then the body (brotli JSON: the item snapshots, in the same order). Listing reads only the
//! meta blocks, and only once (on first use), so the app starts without touching the trash.
//!
//! New entries go into the newest chunk until its body passes [`CHUNK_RAW`]; then a new one
//! starts. Many snapshots per chunk compress far better than one at a time (the same keys, and
//! the versions of one item, are back-references), and a full chunk is written at brotli's best
//! quality. When the files pass the limit (Settings::trash_limit_mb, 50 MB by default) the
//! oldest chunks go first, so the trash never grows past it.

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use collegiapp_core::{Item, ItemKind};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A chunk takes new entries until its body (JSON) is this big.
pub const CHUNK_RAW: usize = 128 * 1024;
pub const DEFAULT_LIMIT_MB: u32 = 50;
const MAGIC: &[u8; 4] = b"CAT1";
const EXT: &str = "trash";

/// One trashed snapshot as the Trash dialog lists it; its item is in the chunk's body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meta {
    pub id: String,
    pub at: DateTime<Utc>,
    /// "Deleted", "Undone add", "Undone rename", "Replaced by a restore", …
    pub why: String,
    /// The item was removed (deleted, or an add undone), not just changed. Bringing the item
    /// back any other way (undo, redo) drops these entries.
    pub gone: bool,
    pub item_id: Uuid,
    pub title: String,
    pub kind: ItemKind,
    pub course_id: Option<String>,
    pub due: Option<DateTime<Utc>>,
}

/// What the Trash dialog shows: entries newest first, the bytes on disk and the limit.
#[derive(Debug, Clone, Serialize)]
pub struct TrashInfo {
    pub entries: Vec<Meta>,
    pub bytes: u64,
    pub limit: u64,
}

struct Chunk {
    seq: u64,
    bytes: u64,
    raw: usize,
    metas: Vec<Meta>,
}

pub struct Trash {
    dir: PathBuf,
    /// None until first used.
    chunks: Option<Vec<Chunk>>,
    /// The newest chunk's items (seq, items): appends rewrite it without reading it back.
    open: Option<(u64, Vec<Item>)>,
}

pub fn limit_bytes(mb: u32) -> u64 {
    u64::from(mb.max(1)) * 1024 * 1024
}

impl Trash {
    pub fn new(dir: PathBuf) -> Trash {
        Trash {
            dir,
            chunks: None,
            open: None,
        }
    }

    fn path(&self, seq: u64) -> PathBuf {
        self.dir.join(format!("{seq:08}.{EXT}"))
    }

    fn chunks(&mut self) -> &mut Vec<Chunk> {
        if self.chunks.is_none() {
            self.chunks = Some(scan(&self.dir));
        }
        self.chunks.as_mut().unwrap()
    }

    pub fn info(&mut self, limit: u64) -> TrashInfo {
        let chunks = self.chunks();
        TrashInfo {
            entries: chunks
                .iter()
                .rev()
                .flat_map(|c| c.metas.iter().rev().cloned())
                .collect(),
            bytes: chunks.iter().map(|c| c.bytes).sum(),
            limit,
        }
    }

    /// Trash these snapshots, `(item, why, gone)`, then keep under `limit` bytes.
    pub fn put(&mut self, snaps: Vec<(Item, String, bool)>, limit: u64) -> io::Result<()> {
        if snaps.is_empty() {
            return Ok(());
        }
        let now = Utc::now();
        let (mut metas, mut items) = (Vec::new(), Vec::new());
        for (item, why, gone) in snaps {
            metas.push(Meta {
                id: Uuid::new_v4().simple().to_string(),
                at: now,
                why,
                gone,
                item_id: item.id,
                title: item.title.clone(),
                kind: item.kind,
                course_id: item.course_id.clone(),
                due: item.due,
            });
            items.push(item);
        }
        let last = self.chunks().last().map(|c| (c.seq, c.raw));
        let (seq, mut all_metas, mut all_items) = match last {
            Some((seq, raw)) if raw < CHUNK_RAW => {
                let old = self.items_of(seq)?;
                let c = self.chunks().pop().unwrap();
                (seq, c.metas, old)
            }
            Some((seq, _)) => (seq + 1, Vec::new(), Vec::new()),
            None => (1, Vec::new(), Vec::new()),
        };
        all_metas.append(&mut metas);
        all_items.append(&mut items);
        self.write(seq, all_metas, all_items)?;
        self.enforce(limit)
    }

    /// The items came back (an undo, a redo): their "gone" entries are no longer needed.
    pub fn revived(&mut self, ids: &[Uuid]) -> io::Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        self.remove_where(|m| m.gone && ids.contains(&m.item_id))
            .map(|_| ())
    }

    /// Take entries out (to restore them): their metas and items, oldest first.
    pub fn take(&mut self, ids: &[String]) -> io::Result<Vec<(Meta, Item)>> {
        self.remove_where(|m| ids.contains(&m.id))
    }

    /// Delete for good: these entries, or with None everything.
    pub fn purge(&mut self, ids: Option<&[String]>) -> io::Result<()> {
        match ids {
            Some(ids) => self.remove_where(|m| ids.contains(&m.id)).map(|_| ()),
            None => {
                for c in self.chunks().drain(..).collect::<Vec<_>>() {
                    remove_file(&self.path(c.seq))?;
                }
                self.open = None;
                Ok(())
            }
        }
    }

    /// Drop the oldest chunks until the files fit in `limit`; a lone chunk sheds its oldest
    /// quarter at a time.
    pub fn enforce(&mut self, limit: u64) -> io::Result<()> {
        loop {
            let chunks = self.chunks();
            let total: u64 = chunks.iter().map(|c| c.bytes).sum();
            if total <= limit || chunks.is_empty() {
                return Ok(());
            }
            if chunks.len() > 1 {
                let c = chunks.remove(0);
                remove_file(&self.path(c.seq))?;
                continue;
            }
            let seq = chunks[0].seq;
            let mut items = self.items_of(seq)?;
            let mut metas = self.chunks().pop().unwrap().metas;
            let cut = metas.len().div_ceil(4);
            metas.drain(..cut);
            items.drain(..cut);
            self.write(seq, metas, items)?;
        }
    }

    fn remove_where(&mut self, hit: impl Fn(&Meta) -> bool) -> io::Result<Vec<(Meta, Item)>> {
        let seqs: Vec<u64> = self
            .chunks()
            .iter()
            .filter(|c| c.metas.iter().any(&hit))
            .map(|c| c.seq)
            .collect();
        let mut out = Vec::new();
        for seq in seqs {
            let items = self.items_of(seq)?;
            let at = self.chunks().iter().position(|c| c.seq == seq).unwrap();
            let c = self.chunks().remove(at);
            let (mut metas, mut kept) = (Vec::new(), Vec::new());
            for (m, it) in c.metas.into_iter().zip(items) {
                if hit(&m) {
                    out.push((m, it));
                } else {
                    metas.push(m);
                    kept.push(it);
                }
            }
            self.write(seq, metas, kept)?;
        }
        Ok(out)
    }

    fn items_of(&mut self, seq: u64) -> io::Result<Vec<Item>> {
        match &self.open {
            Some((s, items)) if *s == seq => Ok(items.clone()),
            _ => read_body(&self.path(seq)),
        }
    }

    /// Write a chunk (or delete it when empty) and put it back in order.
    fn write(&mut self, seq: u64, metas: Vec<Meta>, items: Vec<Item>) -> io::Result<()> {
        let path = self.path(seq);
        if metas.is_empty() {
            if self.open.as_ref().is_some_and(|(s, _)| *s == seq) {
                self.open = None;
            }
            return remove_file(&path);
        }
        let (bytes, raw) = write_chunk(&self.dir, &path, &metas, &items)?;
        let newest = self.chunks().last().is_none_or(|c| c.seq < seq);
        if newest {
            self.open = Some((seq, items));
        }
        let chunks = self.chunks();
        let at = chunks.partition_point(|c| c.seq < seq);
        chunks.insert(
            at,
            Chunk {
                seq,
                bytes,
                raw,
                metas,
            },
        );
        Ok(())
    }
}

fn remove_file(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

fn brotli(data: &[u8], quality: u32) -> io::Result<Vec<u8>> {
    let mut out = Vec::with_capacity(data.len() / 6);
    {
        let mut w = brotli::CompressorWriter::new(&mut out, 4096, quality, 22);
        w.write_all(data)?;
    }
    Ok(out)
}

fn unbrotli(data: &[u8]) -> io::Result<Vec<u8>> {
    let mut out = Vec::new();
    brotli::Decompressor::new(data, 4096).read_to_end(&mut out)?;
    Ok(out)
}

fn bad(e: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, e.to_string())
}

/// Atomic write: temp file + rename. Returns (bytes on disk, raw body length).
fn write_chunk(
    dir: &Path,
    path: &Path,
    metas: &[Meta],
    items: &[Item],
) -> io::Result<(u64, usize)> {
    let body = serde_json::to_vec(items).map_err(bad)?;
    // a chunk that is full won't take more entries: worth brotli's slowest, best setting
    let q = if body.len() >= CHUNK_RAW { 11 } else { 9 };
    let meta = brotli(&serde_json::to_vec(metas).map_err(bad)?, q)?;
    let body_z = brotli(&body, q)?;
    let mut file = Vec::with_capacity(12 + meta.len() + body_z.len());
    file.extend_from_slice(MAGIC);
    file.extend_from_slice(&(meta.len() as u32).to_le_bytes());
    file.extend_from_slice(&(body.len() as u32).to_le_bytes());
    file.extend_from_slice(&meta);
    file.extend_from_slice(&body_z);
    fs::create_dir_all(dir)?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, &file)?;
    fs::rename(&tmp, path)?;
    Ok((file.len() as u64, body.len()))
}

/// (meta length, raw body length) from a chunk's header.
fn header(head: &[u8]) -> io::Result<(usize, usize)> {
    if head.len() < 12 || &head[..4] != MAGIC {
        return Err(bad("not a trash chunk"));
    }
    let n = |i: usize| u32::from_le_bytes(head[i..i + 4].try_into().unwrap()) as usize;
    Ok((n(4), n(8)))
}

fn read_metas(path: &Path) -> io::Result<(Vec<Meta>, usize, u64)> {
    let mut f = fs::File::open(path)?;
    let bytes = f.metadata()?.len();
    let mut head = [0u8; 12];
    f.read_exact(&mut head)?;
    let (meta_len, raw) = header(&head)?;
    let mut meta = vec![0u8; meta_len];
    f.read_exact(&mut meta)?;
    let metas = serde_json::from_slice(&unbrotli(&meta)?).map_err(bad)?;
    Ok((metas, raw, bytes))
}

fn read_body(path: &Path) -> io::Result<Vec<Item>> {
    let file = fs::read(path)?;
    let (meta_len, _) = header(&file)?;
    let body = file
        .get(12 + meta_len..)
        .ok_or_else(|| bad("truncated trash chunk"))?;
    serde_json::from_slice(&unbrotli(body)?).map_err(bad)
}

/// Every chunk in `dir`, oldest first. An unreadable one is set aside (`.bad`), not lost.
fn scan(dir: &Path) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let Ok(list) = fs::read_dir(dir) else {
        return chunks;
    };
    for e in list.flatten() {
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) != Some(EXT) {
            continue;
        }
        let Some(seq) = path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse().ok())
        else {
            continue;
        };
        match read_metas(&path) {
            Ok((metas, raw, bytes)) => chunks.push(Chunk {
                seq,
                bytes,
                raw,
                metas,
            }),
            Err(err) => {
                eprintln!(
                    "collegiapp: trash chunk {} unreadable ({err}); set aside",
                    path.display()
                );
                let _ = fs::rename(&path, path.with_extension("bad"));
            }
        }
    }
    chunks.sort_by_key(|c| c.seq);
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ca-trash-{name}-{}", Uuid::new_v4().simple()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    fn item(title: &str, notes: String) -> Item {
        let mut it = Item::new(title, ItemKind::Assignment, Utc::now(), "d");
        it.notes = notes;
        it
    }

    fn prose(words: usize) -> String {
        "read chapter four and do the practice problems before section on thursday "
            .repeat(words / 12 + 1)
    }

    /// Notes that hardly compress, so the limit is reached.
    fn noise(n: usize) -> String {
        (0..n)
            .map(|_| Uuid::new_v4().simple().to_string())
            .collect()
    }

    #[test]
    fn keeps_restores_and_survives_a_restart() {
        let d = dir("basic");
        let mut t = Trash::new(d.clone());
        let a = item("hw4", prose(40));
        let b = item("lab2", prose(40));
        t.put(
            vec![
                (a.clone(), "Deleted".into(), true),
                (b.clone(), "Undone rename".into(), false),
            ],
            limit_bytes(50),
        )
        .unwrap();
        let info = t.info(limit_bytes(50));
        assert_eq!(info.entries.len(), 2);
        assert_eq!(info.entries[0].title, "lab2", "newest first");
        assert!(info.bytes > 0);

        // a fresh Trash reads the same chunks back
        let mut t2 = Trash::new(d.clone());
        let id = t2.info(limit_bytes(50)).entries[1].id.clone();
        let got = t2.take(&[id]).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].1, a, "the snapshot comes back whole");
        assert_eq!(t2.info(limit_bytes(50)).entries.len(), 1);

        // an item that came back drops only its "gone" entries
        t2.put(vec![(a.clone(), "Deleted".into(), true)], limit_bytes(50))
            .unwrap();
        t2.revived(&[a.id, b.id]).unwrap();
        let left: Vec<String> = t2
            .info(limit_bytes(50))
            .entries
            .into_iter()
            .map(|m| m.title)
            .collect();
        assert_eq!(left, vec!["lab2"]);

        t2.purge(None).unwrap();
        assert!(Trash::new(d.clone()).info(0).entries.is_empty());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn rolls_chunks_and_stays_under_the_limit() {
        let d = dir("limit");
        let mut t = Trash::new(d.clone());
        let limit = 112 * 1024;
        for i in 0..200 {
            t.put(
                vec![(
                    item(&format!("item {i}"), noise(40)),
                    "Deleted".into(),
                    true,
                )],
                limit,
            )
            .unwrap();
        }
        let info = t.info(limit);
        assert!(info.bytes <= limit, "{} > {limit}", info.bytes);
        assert!(info.entries.len() < 200, "the oldest were dropped");
        assert_eq!(info.entries[0].title, "item 199", "the newest stay");
        assert!(
            fs::read_dir(&d).unwrap().count() > 1,
            "rolled over into new chunks"
        );
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn versions_of_real_items_compress_well() {
        let d = dir("ratio");
        let mut t = Trash::new(d.clone());
        let mut raw = 0;
        for i in 0..200 {
            // undo after undo: versions of a few items with a little changed each time
            let mut it = item(&format!("pset {}", i % 7), prose(60 + i % 13));
            it.priority = (i % 4) as u8;
            raw += serde_json::to_vec(&it).unwrap().len();
            t.put(vec![(it, "Undone edit".into(), false)], limit_bytes(50))
                .unwrap();
        }
        let info = t.info(limit_bytes(50));
        assert_eq!(info.entries.len(), 200);
        assert!(
            info.bytes as usize * 10 < raw,
            "{} bytes on disk for {raw} of JSON",
            info.bytes
        );
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_lone_chunk_sheds_its_oldest_entries() {
        let d = dir("lone");
        let mut t = Trash::new(d.clone());
        let many: Vec<_> = (0..40)
            .map(|i| {
                (
                    item(&format!("n{i}"), noise(8)),
                    "Deleted".to_string(),
                    true,
                )
            })
            .collect();
        t.put(many, limit_bytes(50)).unwrap();
        let before = t.info(limit_bytes(50)).bytes;
        t.enforce(before / 2).unwrap();
        let info = t.info(before / 2);
        assert!(info.bytes <= before / 2);
        assert_eq!(info.entries[0].title, "n39");
        let _ = fs::remove_dir_all(&d);
    }
}
