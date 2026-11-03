//! Collegiapp's MCP server (`integrations/claude-desktop`), handed out by the app so nobody needs
//! the repo. `mcp_desktop` saves it to Downloads as a Claude Desktop extension, `Collegiapp.mcpb`
//! (a zip of manifest.json, stamped with this app's version, and server.js), and opens it, so
//! Claude Desktop offers to install it and runs it on its own Node. `mcp_code` copies the server to
//! `~/.collegiapp` and adds it to Claude Code with `claude mcp add --scope user`, which needs Node.
//! Either way the server pairs with the bridge (bridge.rs) the first time it's used, and keeps its
//! token in `~/.collegiapp` too. `tools/build_mcpb.py` packs the same extension for releases.

use std::ffi::OsStr;
use std::path::Path;
use std::process::{Command, Output};

use serde::Serialize;
use tauri::{AppHandle, Manager};

type CmdResult<T> = Result<T, String>;

const SERVER: &str = include_str!("../../integrations/claude-desktop/server.js");
const MANIFEST: &str = include_str!("../../integrations/claude-desktop/manifest.json");
const NAME: &str = "collegiapp";

/// The manifest with this app's version, so Claude Desktop takes a newer one as an update.
fn manifest(version: &str) -> String {
    let mut m: serde_json::Value = serde_json::from_str(MANIFEST).expect("manifest.json is JSON");
    m["version"] = version.into();
    serde_json::to_string_pretty(&m).expect("a JSON value prints") + "\n"
}

/// The extension: the manifest and the server in a zip.
pub fn mcpb(version: &str) -> Vec<u8> {
    let m = manifest(version);
    zip(&[
        ("manifest.json", m.as_bytes()),
        ("server.js", SERVER.as_bytes()),
    ])
}

fn le16(v: &mut Vec<u8>, x: u16) {
    v.extend_from_slice(&x.to_le_bytes());
}

fn le32(v: &mut Vec<u8>, x: u32) {
    v.extend_from_slice(&x.to_le_bytes());
}

/// A zip whose files are stored as they are (the server is a few kilobytes), names in UTF-8.
fn zip(files: &[(&str, &[u8])]) -> Vec<u8> {
    let (mut out, mut dir) = (Vec::new(), Vec::new());
    // 1980-01-01 00:00, the first DOS date
    let (time, date) = (0u16, (1u16 << 5) | 1);
    for (name, data) in files {
        let (crc, len, at, n) = (
            crc32(data),
            data.len() as u32,
            out.len() as u32,
            name.len() as u16,
        );
        // local header: version needed, flags (UTF-8 names), method (stored), time, date
        le32(&mut out, 0x0403_4b50);
        for x in [20, 0x0800, 0, time, date] {
            le16(&mut out, x);
        }
        for x in [crc, len, len] {
            le32(&mut out, x);
        }
        for x in [n, 0] {
            le16(&mut out, x);
        }
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(data);
        // central directory: made by, needed, flags, method, time, date, sizes, then name, extra and
        // comment lengths, disk, internal and external attributes, and where the local header is
        le32(&mut dir, 0x0201_4b50);
        for x in [20, 20, 0x0800, 0, time, date] {
            le16(&mut dir, x);
        }
        for x in [crc, len, len] {
            le32(&mut dir, x);
        }
        for x in [n, 0, 0, 0, 0] {
            le16(&mut dir, x);
        }
        le32(&mut dir, 0);
        le32(&mut dir, at);
        dir.extend_from_slice(name.as_bytes());
    }
    let (at, len, n) = (out.len() as u32, dir.len() as u32, files.len() as u16);
    out.extend_from_slice(&dir);
    le32(&mut out, 0x0605_4b50);
    for x in [0, 0, n, n] {
        le16(&mut out, x);
    }
    le32(&mut out, len);
    le32(&mut out, at);
    le16(&mut out, 0);
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut c = !0u32;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 {
                (c >> 1) ^ 0xEDB8_8320
            } else {
                c >> 1
            };
        }
    }
    !c
}

#[derive(Serialize)]
pub struct Saved {
    path: String,
    /// The system opened it (Claude Desktop, when it's installed, shows its Install dialog).
    opened: bool,
}

#[tauri::command]
pub fn mcp_desktop(app: AppHandle) -> CmdResult<Saved> {
    use tauri_plugin_opener::OpenerExt;
    let dir = crate::export::downloads(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = crate::export::unique(&dir, "Collegiapp", "mcpb");
    let version = app.package_info().version.to_string();
    std::fs::write(&path, mcpb(&version)).map_err(|e| e.to_string())?;
    let path = path.display().to_string();
    let opened = app.opener().open_path(&path, None::<&str>).is_ok();
    Ok(Saved { path, opened })
}

#[derive(Serialize)]
pub struct CodeSetup {
    added: bool,
    /// The command that adds it, to run by hand when the app couldn't.
    command: String,
    error: Option<String>,
}

#[tauri::command]
pub fn mcp_code(app: AppHandle) -> CmdResult<CodeSetup> {
    let dir = app.path().home_dir().map_err(|e| e.to_string())?;
    let dir = dir.join(".collegiapp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let server = dir.join("server.js");
    let version = app.package_info().version.to_string();
    std::fs::write(&server, SERVER).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("manifest.json"), manifest(&version)).map_err(|e| e.to_string())?;
    let shown = |node: &Path| {
        format!(
            "claude mcp add --scope user {NAME} -- \"{}\" \"{}\"",
            node.display(),
            server.display()
        )
    };
    let not_added = |command, error: &str| {
        Ok(CodeSetup {
            added: false,
            command,
            error: Some(error.into()),
        })
    };
    let Some(node) = crate::ai::locate("node") else {
        return not_added(
            shown(Path::new("node")),
            "Claude Code runs this with Node, which isn't installed (nodejs.org)",
        );
    };
    let command = shown(&node);
    let Some(claude) = crate::ai::locate("claude") else {
        return not_added(command, "Claude Code isn't installed here");
    };
    // `mcp add` refuses a name that's taken, so an older entry goes first
    let _ = run(
        &claude,
        &["mcp", "remove", "--scope", "user", NAME].map(OsStr::new),
    );
    let mut add = ["mcp", "add", "--scope", "user", NAME, "--"]
        .map(OsStr::new)
        .to_vec();
    add.extend([node.as_os_str(), server.as_os_str()]);
    let out = run(&claude, &add);
    match out {
        Ok(o) if o.status.success() => Ok(CodeSetup {
            added: true,
            command,
            error: None,
        }),
        Ok(o) => {
            let e = String::from_utf8_lossy(if o.stderr.is_empty() {
                &o.stdout
            } else {
                &o.stderr
            });
            not_added(command, e.trim())
        }
        Err(e) => not_added(command, &e.to_string()),
    }
}

fn run(exe: &Path, args: &[&OsStr]) -> std::io::Result<Output> {
    let mut cmd = Command::new(exe);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.output()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u16_at(b: &[u8], i: usize) -> usize {
        u16::from_le_bytes([b[i], b[i + 1]]) as usize
    }

    fn u32_at(b: &[u8], i: usize) -> usize {
        u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as usize
    }

    #[test]
    fn checksums() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b""), 0);
    }

    #[test]
    fn packs_the_extension() {
        let z = mcpb("9.8.7");
        // the end record points at a directory of two entries
        let end = z.len() - 22;
        assert_eq!(u32_at(&z, end), 0x0605_4b50);
        assert_eq!((u16_at(&z, end + 8), u16_at(&z, end + 10)), (2, 2));
        let mut at = u32_at(&z, end + 16);
        let mut files = Vec::new();
        for _ in 0..2 {
            assert_eq!(u32_at(&z, at), 0x0201_4b50);
            let (crc, len, n, local) = (
                u32_at(&z, at + 16),
                u32_at(&z, at + 24),
                u16_at(&z, at + 28),
                u32_at(&z, at + 42),
            );
            let name = String::from_utf8(z[at + 46..at + 46 + n].to_vec()).unwrap();
            assert_eq!(u32_at(&z, local), 0x0403_4b50);
            let data = &z[local + 30 + n..local + 30 + n + len];
            assert_eq!(crc32(data) as usize, crc);
            files.push((name, String::from_utf8(data.to_vec()).unwrap()));
            at += 46 + n;
        }
        assert_eq!(
            (files[0].0.as_str(), files[1].0.as_str()),
            ("manifest.json", "server.js")
        );
        let m: serde_json::Value = serde_json::from_str(&files[0].1).unwrap();
        assert_eq!(m["version"], "9.8.7");
        assert_eq!(m["server"]["entry_point"], "server.js");
        assert!(files[1].1.contains("tools/list"));
    }
}
