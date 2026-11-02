//! AI through the user's own chatbot plan, never a paid API key: a chat CLI they're signed in to
//! (Claude Code; Codex CLI or Gemini CLI) runs headless on this computer with no tools, in an empty
//! folder, the prompt on stdin. Its reply streams to the asking window as "ai-chunk" events
//! `{ id, delta }` and the command returns the whole of it. API-key variables are taken out of the
//! child's environment so the CLI answers on the plan it's signed in with (docs/AI.md).
//!
//! Claude Code is told to load no settings, hooks, MCP servers, slash commands or CLAUDE.md files
//! (`--setting-sources ""`, `--strict-mcp-config`), to keep no session, and gets the app's rules as
//! its whole system prompt from a file (long rules would overflow a Windows command line).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Window};

/// A run gives up after this long.
const TIMEOUT: Duration = Duration::from_secs(180);

const TOOLS: [&str; 3] = ["claude", "codex", "gemini"];

/// Running children by run id, so `ai_cancel` can stop one.
#[derive(Default)]
pub struct AiRuns(Mutex<HashMap<String, Arc<Mutex<Child>>>>);

#[derive(Serialize)]
pub struct AiTool {
    id: String,
    found: bool,
    path: Option<String>,
}

#[derive(Serialize, Default)]
pub struct AiReply {
    text: String,
    error: Option<String>,
    hint: Option<String>,
    usage: Option<String>,
}

#[derive(Serialize, Clone)]
struct Chunk<'a> {
    id: &'a str,
    delta: &'a str,
}

fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Where these CLIs install besides PATH. A GUI app on macOS gets a bare PATH, so these matter there.
fn extra_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(h) = home() {
        v.push(h.join(".local").join("bin"));
        v.push(h.join(".claude").join("local"));
        v.push(h.join(".bun").join("bin"));
        v.push(h.join(".volta").join("bin"));
        if cfg!(windows) {
            v.push(h.join("scoop").join("shims"));
        } else {
            v.push(h.join(".npm-global").join("bin"));
            // nvm: every installed node's bin
            if let Ok(rd) = std::fs::read_dir(h.join(".nvm").join("versions").join("node")) {
                v.extend(rd.flatten().map(|e| e.path().join("bin")));
            }
        }
    }
    if cfg!(windows) {
        if let Some(a) = std::env::var_os("APPDATA") {
            v.push(PathBuf::from(a).join("npm"));
        }
        if let Some(a) = std::env::var_os("LOCALAPPDATA") {
            v.push(PathBuf::from(a).join("Volta").join("bin"));
        }
        if let Some(p) = std::env::var_os("ProgramFiles") {
            v.push(PathBuf::from(p).join("nodejs"));
        }
    } else {
        v.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
    }
    v
}

fn search_dirs() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for d in extra_dirs() {
        if !v.contains(&d) {
            v.push(d);
        }
    }
    v
}

/// The CLI's executable: a native binary first, then an npm shim.
fn locate(name: &str) -> Option<PathBuf> {
    let names: Vec<String> = if cfg!(windows) {
        ["exe", "cmd", "bat"]
            .iter()
            .map(|x| format!("{name}.{x}"))
            .collect()
    } else {
        vec![name.to_string()]
    };
    for d in search_dirs() {
        for n in &names {
            let p = d.join(n);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

#[tauri::command]
pub fn ai_tools() -> Vec<AiTool> {
    TOOLS
        .iter()
        .map(|id| {
            let p = locate(id);
            AiTool {
                id: id.to_string(),
                found: p.is_some(),
                path: p.map(|p| p.display().to_string()),
            }
        })
        .collect()
}

/// The command line for one run. The system prompt is in `sys_file` for Claude Code; the others
/// have no system prompt of their own, so it heads their stdin instead (`stdin_prefix`).
fn build(
    tool: &str,
    exe: &Path,
    sys_file: &Path,
    model: Option<&str>,
    effort: Option<&str>,
) -> Command {
    // an npm shim (.cmd) runs too: std quotes arguments for cmd.exe itself
    let mut cmd = Command::new(exe);
    let model = model.filter(|m| {
        !m.is_empty()
            && m.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-._[]".contains(c))
    });
    match tool {
        "claude" => {
            cmd.args([
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
            ]);
            cmd.args([
                "--tools",
                "",
                "--no-session-persistence",
                "--setting-sources",
                "",
                "--strict-mcp-config",
                "--disable-slash-commands",
            ]);
            cmd.arg("--system-prompt-file").arg(sys_file);
            if let Some(m) = model {
                cmd.args(["--model", m]);
            }
            if let Some(e) =
                effort.filter(|e| matches!(*e, "low" | "medium" | "high" | "xhigh" | "max"))
            {
                cmd.args(["--effort", e]);
            }
        }
        "codex" => {
            cmd.args([
                "exec",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "--color",
                "never",
            ]);
            if let Some(m) = model {
                cmd.args(["-m", m]);
            }
            cmd.arg("-");
        }
        _ => {
            if let Some(m) = model {
                cmd.args(["-m", m]);
            }
        }
    }
    // the plan they're signed in with, not an API key that bills per use
    for k in [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
    ] {
        cmd.env_remove(k);
    }
    // npm shims need node, which a GUI app's PATH may not have
    let mut path: Vec<PathBuf> = exe
        .parent()
        .map(|p| vec![p.to_path_buf()])
        .unwrap_or_default();
    path.extend(search_dirs());
    if let Ok(p) = std::env::join_paths(path) {
        cmd.env("PATH", p);
    }
    cmd.env("NO_COLOR", "1");
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Stops a run and whatever it started (an npm shim is cmd.exe running node).
fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

/// What a run read back: the text so far, and anything Claude Code's stream said about the run.
#[derive(Default)]
struct Reader {
    text: String,
    streamed: bool,
    result_error: Option<String>,
    tokens: Option<(u64, u64)>,
    five_hour: Option<f64>,
}

impl Reader {
    /// One line of Claude Code's stream-json; returns the text it adds.
    fn claude_line(&mut self, line: &str) -> Option<String> {
        let v: Value = serde_json::from_str(line.trim()).ok()?;
        match v.get("type")?.as_str()? {
            "stream_event" => {
                let ev = v.get("event")?;
                if ev.get("type")?.as_str()? != "content_block_delta" {
                    return None;
                }
                let d = ev.get("delta")?;
                if d.get("type")?.as_str()? != "text_delta" {
                    return None;
                }
                self.streamed = true;
                Some(d.get("text")?.as_str()?.to_string())
            }
            // the whole message: only used when no deltas came
            "assistant" if !self.streamed => {
                let parts = v.get("message")?.get("content")?.as_array()?;
                let t: String = parts
                    .iter()
                    .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|p| p.get("text").and_then(Value::as_str))
                    .collect();
                (!t.is_empty()).then_some(t)
            }
            "rate_limit_event" => {
                let w = v
                    .get("rate_limit_info")?
                    .get("unifiedWindows")?
                    .get("five_hour")?;
                self.five_hour = w.get("utilization").and_then(Value::as_f64);
                None
            }
            "result" => {
                if let Some(u) = v.get("usage") {
                    let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
                    self.tokens = Some((
                        n("input_tokens")
                            + n("cache_read_input_tokens")
                            + n("cache_creation_input_tokens"),
                        n("output_tokens"),
                    ));
                }
                if v.get("is_error").and_then(Value::as_bool) == Some(true) {
                    let r = v
                        .get("result")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    let sub = v.get("subtype").and_then(Value::as_str).unwrap_or("error");
                    self.result_error = Some(if r.is_empty() {
                        sub.replace('_', " ")
                    } else {
                        r
                    });
                    return None;
                }
                // the final text, when the stream had none
                let r = v.get("result").and_then(Value::as_str).unwrap_or("");
                (self.text.is_empty() && !r.is_empty()).then(|| r.to_string())
            }
            _ => None,
        }
    }

    fn usage(&self) -> Option<String> {
        let mut parts = Vec::new();
        if let Some((i, o)) = self.tokens {
            parts.push(format!("{} in · {} out", short(i), short(o)));
        }
        if let Some(u) = self.five_hour {
            parts.push(format!(
                "{}% of your 5-hour limit used",
                (u * 100.0).round() as i64
            ));
        }
        (!parts.is_empty()).then(|| parts.join(" · "))
    }
}

fn short(n: u64) -> String {
    if n >= 10_000 {
        format!("{}k", n / 1000)
    } else if n >= 1000 {
        format!("{:.1}k", n as f64 / 1000.0)
    } else {
        n.to_string()
    }
}

/// A one-line hint for what usually went wrong.
fn hint_for(tool: &str, msg: &str) -> Option<String> {
    let m = msg.to_lowercase();
    let sign_in = match tool {
        "claude" => "Open a terminal, run claude, and sign in with /login (choose your Claude subscription, not an API key).",
        "codex" => "Open a terminal, run codex, and sign in with ChatGPT.",
        _ => "Open a terminal, run gemini, and sign in with Google.",
    };
    if [
        "login",
        "log in",
        "sign in",
        "authenticat",
        "api key",
        "credential",
        "unauthorized",
        "401",
        "oauth",
        "token",
    ]
    .iter()
    .any(|k| m.contains(k))
    {
        return Some(sign_in.into());
    }
    if [
        "rate limit",
        "usage limit",
        "limit reached",
        "quota",
        "429",
        "overloaded",
    ]
    .iter()
    .any(|k| m.contains(k))
    {
        return Some("Your plan's limit was reached. It resets on its own; the chat website in AI settings works meanwhile.".into());
    }
    if m.contains("unknown option")
        || m.contains("unexpected argument")
        || m.contains("unrecognized")
    {
        return Some(format!("This version of the {tool} CLI doesn't know a flag Collegiapp uses. Update it, or pick the chat website in AI settings."));
    }
    if m.contains("node") && (m.contains("not recognized") || m.contains("not found")) {
        return Some("This CLI needs Node.js, which isn't on this computer's PATH.".into());
    }
    None
}

fn work_dir(app: &AppHandle) -> PathBuf {
    let base = std::env::var_os("COLLEGIAPP_DATA")
        .map(PathBuf::from)
        .or_else(|| app.path().app_data_dir().ok())
        .unwrap_or_else(std::env::temp_dir);
    let d = base.join("ai");
    let _ = std::fs::create_dir_all(&d);
    d
}

#[allow(clippy::too_many_arguments)]
fn run_blocking(
    app: AppHandle,
    window: Window,
    id: String,
    tool: String,
    prompt: String,
    system: String,
    model: Option<String>,
    effort: Option<String>,
) -> AiReply {
    let fail = |error: String, hint: Option<String>| AiReply {
        error: Some(error),
        hint,
        ..Default::default()
    };
    if !TOOLS.contains(&tool.as_str()) {
        return fail(format!("unknown tool {tool}"), None);
    }
    let Some(exe) = locate(&tool) else {
        return fail(
            format!("{tool} isn't installed on this computer"),
            Some("Open AI settings for how to set it up, or use the chat website.".into()),
        );
    };
    let dir = work_dir(&app);
    let safe_id: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(40)
        .collect();
    let sys_file = dir.join(format!("system-{safe_id}.md"));
    if let Err(e) = std::fs::write(&sys_file, &system) {
        return fail(format!("couldn't write the instructions: {e}"), None);
    }
    let mut cmd = build(&tool, &exe, &sys_file, model.as_deref(), effort.as_deref());
    cmd.current_dir(&dir);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_file(&sys_file);
            return fail(format!("couldn't start {}: {e}", exe.display()), None);
        }
    };
    let stdin_text = if tool == "claude" {
        prompt
    } else {
        format!("{system}\n\n=====\n\n{prompt}")
    };
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    let runs = app.state::<AiRuns>();
    runs.0.lock().unwrap().insert(id.clone(), child.clone());

    // the prompt goes in on its own thread, so a full stdout pipe can't stall it
    if let Some(mut si) = stdin {
        std::thread::spawn(move || {
            let _ = si.write_all(stdin_text.as_bytes());
        });
    }
    let err_buf = Arc::new(Mutex::new(String::new()));
    if let Some(mut se) = stderr {
        let eb = err_buf.clone();
        std::thread::spawn(move || {
            let mut s = String::new();
            let _ = se.read_to_string(&mut s);
            *eb.lock().unwrap() = s;
        });
    }
    // a watchdog: past the timeout the run is stopped
    let finished = Arc::new(AtomicBool::new(false));
    let timed_out = Arc::new(AtomicBool::new(false));
    {
        let (finished, timed_out, child) = (finished.clone(), timed_out.clone(), child.clone());
        std::thread::spawn(move || {
            let t0 = Instant::now();
            while !finished.load(Ordering::Relaxed) {
                if t0.elapsed() > TIMEOUT {
                    timed_out.store(true, Ordering::Relaxed);
                    kill_tree(&mut child.lock().unwrap());
                    break;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        });
    }

    let mut r = Reader::default();
    let emit = |delta: &str| {
        if !delta.is_empty() {
            let _ = window.emit_to(window.label(), "ai-chunk", Chunk { id: &id, delta });
        }
    };
    if let Some(out) = stdout {
        if tool == "claude" {
            for line in BufReader::new(out).lines() {
                let Ok(line) = line else { break };
                if let Some(t) = r.claude_line(&line) {
                    r.text.push_str(&t);
                    emit(&t);
                }
            }
        } else {
            // plain text: passed on as it arrives, never splitting a UTF-8 character
            let mut out = out;
            let (mut buf, mut pending) = ([0u8; 4096], Vec::new());
            while let Ok(n) = out.read(&mut buf) {
                if n == 0 {
                    break;
                }
                pending.extend_from_slice(&buf[..n]);
                let ok = match std::str::from_utf8(&pending) {
                    Ok(s) => s.len(),
                    Err(e) => e.valid_up_to(),
                };
                let s = String::from_utf8_lossy(&pending[..ok]).into_owned();
                pending.drain(..ok);
                r.text.push_str(&s);
                emit(&s);
            }
            if !pending.is_empty() {
                let s = String::from_utf8_lossy(&pending).into_owned();
                r.text.push_str(&s);
                emit(&s);
            }
        }
    }
    // try_wait, so the watchdog and ai_cancel can still take the child while it exits
    let status = loop {
        match child.lock().unwrap().try_wait() {
            Ok(Some(s)) => break Ok(s),
            Ok(None) => {}
            Err(e) => break Err(e),
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    finished.store(true, Ordering::Relaxed);
    let cancelled = runs.0.lock().unwrap().remove(&id).is_none();
    let _ = std::fs::remove_file(&sys_file);
    // let stderr's reader finish
    std::thread::sleep(Duration::from_millis(30));
    let stderr = err_buf.lock().unwrap().trim().to_string();

    let usage = r.usage();
    if cancelled {
        return AiReply {
            text: r.text,
            error: Some("Stopped".into()),
            usage,
            ..Default::default()
        };
    }
    if timed_out.load(Ordering::Relaxed) {
        return AiReply {
            text: r.text,
            error: Some(format!(
                "No answer after {} minutes, so it was stopped",
                TIMEOUT.as_secs() / 60
            )),
            usage,
            ..Default::default()
        };
    }
    if let Some(e) = r.result_error.take() {
        let hint = hint_for(&tool, &e);
        return AiReply {
            text: r.text,
            error: Some(e),
            hint,
            usage,
        };
    }
    let ok = status.as_ref().map(|s| s.success()).unwrap_or(false);
    if !ok && r.text.trim().is_empty() {
        let last: String = stderr
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .trim()
            .chars()
            .take(400)
            .collect();
        let msg = if last.is_empty() {
            format!("{tool} stopped without answering")
        } else {
            last
        };
        let hint = hint_for(&tool, &format!("{msg}\n{stderr}"));
        return AiReply {
            text: r.text,
            error: Some(msg),
            hint,
            usage,
        };
    }
    AiReply {
        text: r.text,
        error: None,
        hint: None,
        usage,
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ai_run(
    app: AppHandle,
    window: Window,
    id: String,
    tool: String,
    prompt: String,
    system: String,
    model: Option<String>,
    effort: Option<String>,
) -> Result<AiReply, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_blocking(app, window, id, tool, prompt, system, model, effort)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_cancel(app: AppHandle, id: String) {
    let child = app.state::<AiRuns>().0.lock().unwrap().remove(&id);
    if let Some(c) = child {
        kill_tree(&mut c.lock().unwrap());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_claude_codes_stream() {
        let mut r = Reader::default();
        let lines = [
            r#"{"type":"system","subtype":"init"}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}"#,
            r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","unifiedWindows":{"five_hour":{"utilization":0.55}}}}"#,
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Hello","usage":{"input_tokens":1200,"cache_read_input_tokens":300,"output_tokens":42}}"#,
        ];
        for l in lines {
            if let Some(t) = r.claude_line(l) {
                r.text.push_str(&t);
            }
        }
        assert_eq!(r.text, "Hello");
        assert_eq!(
            r.usage().as_deref(),
            Some("1.5k in · 42 out · 55% of your 5-hour limit used")
        );
    }

    #[test]
    fn uses_the_whole_message_without_deltas_and_reads_errors() {
        let mut r = Reader::default();
        let t = r.claude_line(r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"},{"type":"tool_use"}]}}"#);
        assert_eq!(t.as_deref(), Some("Hi"));
        r.text.push_str("Hi");
        assert!(r.claude_line(r#"{"type":"result","is_error":true,"subtype":"success","result":"Invalid API key · Please run /login"}"#).is_none());
        let e = r.result_error.clone().unwrap();
        assert!(hint_for("claude", &e).unwrap().contains("/login"));
    }

    #[test]
    fn rejects_odd_model_names() {
        let exe = PathBuf::from(if cfg!(windows) {
            "claude.exe"
        } else {
            "claude"
        });
        let cmd = build(
            "claude",
            &exe,
            Path::new("sys.md"),
            Some("opus; rm -rf"),
            Some("silly"),
        );
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert!(!args.iter().any(|a| a == "--model" || a == "--effort"));
        assert!(args
            .windows(2)
            .any(|w| w[0] == "--tools" && w[1].is_empty()));
        let cmd = build(
            "claude",
            &exe,
            Path::new("sys.md"),
            Some("sonnet"),
            Some("low"),
        );
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert!(args
            .windows(2)
            .any(|w| w[0] == "--model" && w[1] == "sonnet"));
        assert!(args.windows(2).any(|w| w[0] == "--effort" && w[1] == "low"));
    }
}
