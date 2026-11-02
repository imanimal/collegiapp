//! The browser bridge: a small HTTP server on 127.0.0.1:4747 for the PocketCanvas extension
//! (`pocketcanvas/src/lib/collegiapp.js` is the client). Desktop only.
//!
//!   GET  /v1/ping              { app, version, paired }
//!   POST /v1/pair  {name}      { id, code }: Collegiapp shows the code and asks you to allow it
//!   GET  /v1/pair/<id>         { status: pending | allowed | denied | expired, token? }
//!   POST /v1/canvas            classes and work (collegiapp_core::pocketcanvas::Push)
//!                              -> { added, updated, unchanged, items }
//!   POST /v1/capture {text, url, title, notes}   quick add -> { title }
//!   POST /v1/work              one piece of work from its page, with an estimate, priority and
//!                              notes (collegiapp_core::pocketcanvas::Send) -> { item, added }
//!   POST /v1/work/find {refs}  whether that work is here already -> { item } (null when not)
//!   GET  /v1/dofirst           the top of Do first, or null
//!   GET  /v1/focus             { active, until, level }
//!
//! Everything but ping and pair needs `Authorization: Bearer <token>`. Only this computer can
//! reach it (it listens on 127.0.0.1), the Host header must name 127.0.0.1 or localhost (no DNS
//! rebinding), and a request with an Origin must come from a browser extension, so web pages
//! can't use it. Paired browsers live in `bridge.json` beside the store, not in Settings, so a
//! settings save from the UI never drops one and tokens never reach the UI.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration as StdDuration, Instant};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[cfg(desktop)]
pub use http::spawn;

pub const PORT: u16 = 4747;
const FILE: &str = "bridge.json";
/// A pairing request nobody answered is dropped after this long.
const PAIR_TTL: StdDuration = StdDuration::from_secs(120);

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Client {
    id: String,
    name: String,
    token: String,
    created: DateTime<Utc>,
    #[serde(default)]
    seen: Option<DateTime<Utc>>,
}

/// A paired browser as the UI sees it (no token).
#[derive(Debug, Clone, Serialize)]
pub struct ClientInfo {
    pub id: String,
    pub name: String,
    pub created: DateTime<Utc>,
    pub seen: Option<DateTime<Utc>>,
}

struct Pending {
    id: String,
    name: String,
    code: String,
    at: Instant,
    /// Some(token) once allowed, Some("") once refused.
    answer: Option<String>,
}

pub struct Bridge {
    file: PathBuf,
    clients: Mutex<Vec<Client>>,
    pending: Mutex<Vec<Pending>>,
}

fn guard<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Bridge {
    pub fn load(store: &std::path::Path) -> Bridge {
        let file = store.with_file_name(FILE);
        let clients = fs::read_to_string(&file)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        Bridge {
            file,
            clients: Mutex::new(clients),
            pending: Mutex::new(Vec::new()),
        }
    }

    fn save(&self, clients: &[Client]) {
        if let Ok(text) = serde_json::to_string_pretty(clients) {
            let tmp = self.file.with_extension("json.tmp");
            if fs::write(&tmp, text).is_ok() {
                let _ = fs::rename(&tmp, &self.file);
            }
        }
    }

    /// The client a bearer token belongs to (and note that it was seen).
    fn client(&self, token: Option<&str>) -> Option<String> {
        let token = token.filter(|t| !t.is_empty())?;
        let mut cs = guard(&self.clients);
        let c = cs.iter_mut().find(|c| c.token == token)?;
        let now = Utc::now();
        let stale = c
            .seen
            .is_none_or(|s| now - s > chrono::Duration::minutes(10));
        c.seen = Some(now);
        let id = c.id.clone();
        if stale {
            self.save(&cs);
        }
        Some(id)
    }
}

#[tauri::command]
pub fn bridge_clients(bridge: State<'_, Bridge>) -> Vec<ClientInfo> {
    guard(&bridge.clients)
        .iter()
        .map(|c| ClientInfo {
            id: c.id.clone(),
            name: c.name.clone(),
            created: c.created,
            seen: c.seen,
        })
        .collect()
}

/// Pairing requests waiting for an answer (the UI shows them if it missed the "pair-request").
#[tauri::command]
pub fn bridge_pending(bridge: State<'_, Bridge>) -> Vec<serde_json::Value> {
    guard(&bridge.pending)
        .iter()
        .filter(|p| p.answer.is_none() && p.at.elapsed() < PAIR_TTL)
        .map(|p| serde_json::json!({ "id": p.id, "name": p.name, "code": p.code }))
        .collect()
}

/// Answer a "pair-request": allow the browser (it gets a token on its next poll) or refuse it.
#[tauri::command]
pub fn bridge_answer(id: String, allow: bool, bridge: State<'_, Bridge>) -> Result<(), String> {
    let mut ps = guard(&bridge.pending);
    let p = ps
        .iter_mut()
        .find(|p| p.id == id && p.at.elapsed() < PAIR_TTL)
        .ok_or("that request expired; connect again from the browser")?;
    if !allow {
        p.answer = Some(String::new());
        return Ok(());
    }
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    p.answer = Some(token.clone());
    let mut cs = guard(&bridge.clients);
    cs.push(Client {
        id: p.id.clone(),
        name: p.name.clone(),
        token,
        created: Utc::now(),
        seen: None,
    });
    bridge.save(&cs);
    Ok(())
}

/// Forget a paired browser: its token stops working at once.
#[tauri::command]
pub fn bridge_forget(id: String, bridge: State<'_, Bridge>) {
    let mut cs = guard(&bridge.clients);
    cs.retain(|c| c.id != id);
    bridge.save(&cs);
}

#[cfg(desktop)]
mod http {
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};

    use serde_json::{json, Value};
    use tauri::{AppHandle, Emitter, Manager};

    use super::*;
    use crate::store::{lock, SharedState};

    const MAX_BODY: usize = 8 << 20;

    /// Listen on 127.0.0.1:4747, one thread per connection. If the port is taken, the bridge is off.
    pub fn spawn(app: AppHandle) {
        std::thread::spawn(move || {
            let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("collegiapp: browser bridge off ({e})");
                    return;
                }
            };
            for stream in listener.incoming().flatten() {
                let app = app.clone();
                std::thread::spawn(move || {
                    let _ = serve(&app, stream);
                });
            }
        });
    }

    pub(super) struct Request {
        pub(super) method: String,
        pub(super) path: String,
        pub(super) host: String,
        pub(super) origin: Option<String>,
        pub(super) token: Option<String>,
        pub(super) body: Vec<u8>,
    }

    pub(super) fn read_request(s: &mut TcpStream) -> Option<Request> {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 8192];
        let head_end = loop {
            let n = s.read(&mut chunk).ok()?;
            if n == 0 {
                return None;
            }
            buf.extend_from_slice(&chunk[..n]);
            if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                break i;
            }
            if buf.len() > 32 << 10 {
                return None;
            }
        };
        let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
        let mut lines = head.split("\r\n");
        let mut first = lines.next()?.split(' ');
        let (method, path) = (first.next()?.to_string(), first.next()?.to_string());
        let (mut host, mut origin, mut token, mut len) = (String::new(), None, None, 0usize);
        for l in lines {
            let Some((k, v)) = l.split_once(':') else {
                continue;
            };
            let v = v.trim();
            match k.trim().to_ascii_lowercase().as_str() {
                "host" => host = v.to_ascii_lowercase(),
                "origin" => origin = Some(v.to_string()),
                "authorization" => token = v.strip_prefix("Bearer ").map(|t| t.trim().to_string()),
                "content-length" => len = v.parse().ok()?,
                _ => {}
            }
        }
        if len > MAX_BODY {
            return None;
        }
        let mut body = buf[head_end + 4..].to_vec();
        while body.len() < len {
            let n = s.read(&mut chunk).ok()?;
            if n == 0 {
                return None;
            }
            body.extend_from_slice(&chunk[..n]);
        }
        body.truncate(len);
        Some(Request {
            method,
            path,
            host,
            origin,
            token,
            body,
        })
    }

    fn reply(
        s: &mut TcpStream,
        status: u16,
        origin: Option<&str>,
        body: &Value,
    ) -> std::io::Result<()> {
        let text = if status == 204 {
            String::new()
        } else {
            body.to_string()
        };
        let reason = match status {
            200 => "OK",
            204 => "No Content",
            400 => "Bad Request",
            401 => "Unauthorized",
            403 => "Forbidden",
            404 => "Not Found",
            429 => "Too Many Requests",
            _ => "Internal Server Error",
        };
        let cors = origin.map_or(String::new(), |o| {
            format!(
                "Access-Control-Allow-Origin: {o}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nAccess-Control-Max-Age: 600\r\n"
            )
        });
        write!(
            s,
            "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\n{cors}Connection: close\r\n\r\n{text}",
            text.len()
        )?;
        s.flush()
    }

    pub(super) fn from_extension(origin: &str) -> bool {
        [
            "moz-extension://",
            "chrome-extension://",
            "safari-web-extension://",
        ]
        .iter()
        .any(|p| origin.starts_with(p))
    }

    fn serve(app: &AppHandle, mut s: TcpStream) -> std::io::Result<()> {
        s.set_read_timeout(Some(StdDuration::from_secs(10)))?;
        let Some(r) = read_request(&mut s) else {
            return reply(&mut s, 400, None, &json!({ "error": "bad request" }));
        };
        let host_ok = [format!("127.0.0.1:{PORT}"), format!("localhost:{PORT}")].contains(&r.host);
        let origin = r.origin.as_deref().filter(|o| from_extension(o));
        if !host_ok || (r.origin.is_some() && origin.is_none()) {
            return reply(&mut s, 403, None, &json!({ "error": "forbidden" }));
        }
        if r.method == "OPTIONS" {
            return reply(&mut s, 204, origin, &Value::Null);
        }
        let (status, body) = route(app, &r);
        reply(&mut s, status, origin, &body)
    }

    fn route(app: &AppHandle, r: &Request) -> (u16, Value) {
        let bridge = app.state::<Bridge>();
        let path = r.path.split('?').next().unwrap_or("");
        let client = bridge.client(r.token.as_deref());
        match (r.method.as_str(), path) {
            ("GET", "/v1/ping") => (
                200,
                json!({ "app": "collegiapp", "version": app.package_info().version.to_string(), "paired": client.is_some() }),
            ),
            ("POST", "/v1/pair") => pair(app, &bridge, &r.body),
            ("GET", p) if p.starts_with("/v1/pair/") => {
                pair_status(&bridge, &p["/v1/pair/".len()..])
            }
            _ if client.is_none() => (401, json!({ "error": "not paired" })),
            ("POST", "/v1/canvas") => canvas(app, &r.body),
            ("POST", "/v1/capture") => capture(app, &r.body),
            ("POST", "/v1/work") => work(app, &r.body),
            ("POST", "/v1/work/find") => find(app, &r.body),
            ("GET", "/v1/dofirst") => (200, json!(crate::commands::do_first(app.state()))),
            ("GET", "/v1/focus") => {
                let f = app.state::<crate::focus::FocusManager>().state();
                (
                    200,
                    json!({ "active": f.active, "until": f.ends_at, "level": f.level }),
                )
            }
            _ => (404, json!({ "error": "not found" })),
        }
    }

    fn pair(app: &AppHandle, bridge: &Bridge, body: &[u8]) -> (u16, Value) {
        #[derive(Deserialize)]
        struct Ask {
            #[serde(default)]
            name: String,
        }
        let name = serde_json::from_slice::<Ask>(body)
            .map(|a| a.name)
            .unwrap_or_default();
        let name: String = name.trim().chars().take(60).collect();
        let name = if name.is_empty() {
            "A browser extension".to_string()
        } else {
            name
        };
        let mut ps = guard(&bridge.pending);
        ps.retain(|p| p.at.elapsed() < PAIR_TTL);
        if ps.iter().filter(|p| p.answer.is_none()).count() >= 3 {
            return (
                429,
                json!({ "error": "answer the open requests in Collegiapp first" }),
            );
        }
        let u = Uuid::new_v4();
        let b = u.as_bytes();
        let code = format!("{:04}", u16::from_le_bytes([b[0], b[1]]) % 10000);
        let id = u.simple().to_string();
        ps.push(Pending {
            id: id.clone(),
            name: name.clone(),
            code: code.clone(),
            at: Instant::now(),
            answer: None,
        });
        drop(ps);
        crate::tray::show_main(app);
        let _ = app.emit(
            "pair-request",
            json!({ "id": id, "name": name, "code": code }),
        );
        (200, json!({ "id": id, "code": code }))
    }

    fn pair_status(bridge: &Bridge, id: &str) -> (u16, Value) {
        let mut ps = guard(&bridge.pending);
        let Some(i) = ps.iter().position(|p| p.id == id) else {
            return (200, json!({ "status": "expired" }));
        };
        let (status, token) = match &ps[i].answer {
            Some(t) if t.is_empty() => ("denied", None),
            Some(t) => ("allowed", Some(t.clone())),
            None if ps[i].at.elapsed() >= PAIR_TTL => ("expired", None),
            None => return (200, json!({ "status": "pending" })),
        };
        ps.remove(i);
        (200, json!({ "status": status, "token": token }))
    }

    fn canvas(app: &AppHandle, body: &[u8]) -> (u16, Value) {
        use collegiapp_core::pocketcanvas::{import, Push};
        let push: Push = match serde_json::from_slice(body) {
            Ok(p) => p,
            Err(e) => return (400, json!({ "error": e.to_string() })),
        };
        let state = app.state::<SharedState>();
        let (n, changed) = {
            let mut g = lock(&state);
            let device = g.device_id();
            let before = g.data.courses.clone();
            let d = &mut g.data;
            let n = import(&mut d.courses, &mut d.items, &push, Utc::now(), &device);
            let changed = n.added + n.updated > 0 || d.courses != before;
            (n, changed)
        };
        if changed {
            if let Err(e) = crate::commands::changed_by(app, &state, "import") {
                return (500, json!({ "error": e }));
            }
        }
        (
            200,
            json!({ "added": n.added, "updated": n.updated, "unchanged": n.unchanged, "items": push.work.len() }),
        )
    }

    fn work(app: &AppHandle, body: &[u8]) -> (u16, Value) {
        use collegiapp_core::pocketcanvas::{send, Send};
        let s: Send = match serde_json::from_slice(body) {
            Ok(s) => s,
            Err(e) => return (400, json!({ "error": e.to_string() })),
        };
        let state = app.state::<SharedState>();
        let out = {
            let mut g = lock(&state);
            let device = g.device_id();
            let d = &mut g.data;
            send(&mut d.courses, &mut d.items, &s, Utc::now(), &device)
        };
        let Some((item, added)) = out else {
            return (400, json!({ "error": "nothing to send" }));
        };
        if let Err(e) = crate::commands::changed_by(app, &state, "app") {
            return (500, json!({ "error": e }));
        }
        (200, json!({ "item": item, "added": added }))
    }

    fn find(app: &AppHandle, body: &[u8]) -> (u16, Value) {
        use collegiapp_core::pocketcanvas::{find, SourceRef};
        #[derive(Deserialize, Default)]
        #[serde(default)]
        struct Find {
            refs: Vec<SourceRef>,
        }
        let f: Find = serde_json::from_slice(body).unwrap_or_default();
        let state = app.state::<SharedState>();
        let g = lock(&state);
        (
            200,
            json!({ "item": find(&g.data.items, &g.data.courses, &f.refs) }),
        )
    }

    fn capture(app: &AppHandle, body: &[u8]) -> (u16, Value) {
        #[derive(Deserialize, Default)]
        #[serde(default)]
        struct Capture {
            text: String,
            url: Option<String>,
            title: Option<String>,
            notes: Option<String>,
        }
        let c: Capture = serde_json::from_slice(body).unwrap_or_default();
        if c.text.trim().is_empty() {
            return (400, json!({ "error": "nothing to add" }));
        }
        let state = app.state::<SharedState>();
        let title = {
            let mut g = lock(&state);
            let draft = collegiapp_core::quickadd::parse(
                &c.text,
                chrono::Local::now().fixed_offset(),
                &g.data.courses,
            );
            let mut item = draft.into_item(Utc::now(), &g.device_id());
            if let Some(url) = c.url.filter(|u| u.starts_with("http")) {
                let label = c
                    .title
                    .filter(|t| !t.trim().is_empty())
                    .unwrap_or_else(|| "Link".into());
                item.links.push(collegiapp_core::Link {
                    label: label.chars().take(80).collect(),
                    url,
                });
            }
            if let Some(n) = c.notes.filter(|n| !n.trim().is_empty()) {
                item.notes = n;
            }
            let title = item.title.clone();
            g.data.items.push(item);
            title
        };
        if let Err(e) = crate::commands::changed_by(app, &state, "app") {
            return (500, json!({ "error": e }));
        }
        (200, json!({ "title": title }))
    }
}

#[cfg(all(test, desktop))]
mod tests {
    use std::io::Write;
    use std::net::{TcpListener, TcpStream};

    use super::http::{from_extension, read_request};

    fn send(raw: &'static [u8]) -> Option<super::http::Request> {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        let t = std::thread::spawn(move || {
            let mut c = TcpStream::connect(addr).unwrap();
            // the head and the body arrive in separate reads
            let cut = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
            c.write_all(&raw[..cut]).unwrap();
            c.flush().unwrap();
            std::thread::sleep(std::time::Duration::from_millis(30));
            c.write_all(&raw[cut..]).unwrap();
        });
        let (mut s, _) = l.accept().unwrap();
        let r = read_request(&mut s);
        t.join().unwrap();
        r
    }

    #[test]
    fn reads_a_request() {
        let r = send(b"POST /v1/canvas HTTP/1.1\r\nHost: 127.0.0.1:4747\r\nOrigin: moz-extension://abc\r\nAuthorization: Bearer tok\r\nContent-Length: 9\r\n\r\n{\"a\": 1}\n").unwrap();
        assert_eq!(
            (r.method.as_str(), r.path.as_str(), r.host.as_str()),
            ("POST", "/v1/canvas", "127.0.0.1:4747")
        );
        assert_eq!(
            (r.origin.as_deref(), r.token.as_deref()),
            (Some("moz-extension://abc"), Some("tok"))
        );
        assert_eq!(r.body, b"{\"a\": 1}\n");
    }

    #[test]
    fn only_extensions_count_as_origins() {
        assert!(from_extension("moz-extension://1234"));
        assert!(from_extension("chrome-extension://abcd"));
        assert!(!from_extension("https://canvas.ucsb.edu"));
        assert!(!from_extension("null"));
    }
}
