#!/usr/bin/env node
/* Collegiapp's MCP server: Claude Desktop, Claude Code or any MCP client can search, read and write your notes and
   add items from a chat, through the app's bridge on 127.0.0.1:4747 (src-tauri/src/bridge.rs). Plain Node, no
   dependencies, MCP over stdio (one JSON-RPC message per line).

   The app has to be running (in the tray is enough); if it isn't, the first call starts it. The first call also asks
   you in the app to allow the connection, with a code the chat shows too, and the token it gets back is kept in
   ~/.collegiapp/assistant.json for every client on this computer. COLLEGIAPP_BRIDGE and COLLEGIAPP_TOKEN_FILE point
   it somewhere else (tests). */
"use strict";
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");

// the manifest beside it carries the version (the app stamps its own when it hands the server out, src-tauri/src/mcp.rs)
const VERSION = (() => { try { return require("./manifest.json").version; } catch (e) { return "0.0.0"; } })();
const BRIDGE = new URL(process.env.COLLEGIAPP_BRIDGE || "http://127.0.0.1:4747");
const TOKEN_FILE = process.env.COLLEGIAPP_TOKEN_FILE || path.join(os.homedir(), ".collegiapp", "assistant.json");
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const PAIR_WAIT = 50e3, PAIR_TTL = 115e3, START_WAIT = 25e3;

const MARKDOWN = `COLLEGIAPP MARKDOWN (the only formatting a note can hold)
- # Heading 1, ## Heading 2, ### Heading 3 (no deeper). The title is the note's own field, so the text doesn't start with a heading that repeats it.
- A blank line separates paragraphs; a single newline is a line break inside one.
- **bold**, *italic*, <u>underline</u>, ~~strikethrough~~, ==highlight==, \`inline code\`, [link text](https://example.com); a bare https:// link also works.
- "- " bullets, "1. " numbered items, "- [ ] " and "- [x] " checklist items. Nest any list by indenting two spaces.
- "> " quotes. A callout is a quote whose first line is [!NOTE], [!TIP], [!IMPORTANT] or [!WARNING].
- Code blocks fenced with \`\`\` (a language after the opening fence is fine), a divider is ---, tables use | pipes | with a | --- | line under the header row.
- Drawings appear as ![Drawing|center 40%](drawing:1). Keep each one exactly as written, where it belongs unless the user asks to move it; you can't make new ones.
- Nothing else: no HTML besides <u>, no other images, footnotes, math markup or heading levels past ###. Write formulas in plain text or \`code\`.
- Headings in sentence case. Students skim: short paragraphs, lists where they help, ==highlight== only the few things to remember.`;

const GRAMMAR = `Each task is one line in Collegiapp's quick-add grammar: the words left over are the title. A class like 130a or cs16 sets the course; dates like fri, tmr, 11/12, "in 3d"; times like 5pm or 11:59p; ~2h is an estimate; ! !! !!! is priority; #tag; @place; whenfree moves it to the nearest slot clear of classes and events. Words like hw, lab, quiz, midterm, final, read, project, apply or oh set the kind. Example: pa3 130a fri 11:59p ~4h !!`;

const INSTRUCTIONS = `Collegiapp is the user's planner and notes app (they're a university student). These tools reach it on this computer while it runs, even in the tray, so the user doesn't have to open it.
- When the user asks to save, jot, write up or keep something in their notes, write it with create_note. To add to a note they already have, find it with search_notes and use append_to_note. Say what you saved; don't repeat the whole note in the chat unless asked.
- Notes tagged #ai hold the user's standing rules for notes an AI writes: search "#ai" before writing and follow them.
- update_note with text replaces the whole note (the old text goes to the app's trash). Read it first and keep every fact, link, number, date and checkbox the user wrote unless they asked you to drop it. Prefer append_to_note for additions.
- File a note under a class when it's for one (list_classes shows them; a code like "CMPSC 130A" or an alias works).
- The first call asks the user to click Allow in Collegiapp. If a tool says it's waiting for that, tell the user the code and to click Allow, then try again.

${MARKDOWN}`;

class Fail extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────────── the bridge ───────────── */

function request(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { Accept: "application/json" };
    if (data) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": data.length });
    if (token) headers.Authorization = "Bearer " + token;
    const req = http.request({ host: BRIDGE.hostname, port: BRIDGE.port || 80, method, path: p, headers, timeout: 15e3 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"); } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Collegiapp didn't answer")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const saved = {
  load() { try { return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")); } catch (e) { return null; } },
  save(v) { fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true }); fs.writeFileSync(TOKEN_FILE, JSON.stringify(v, null, 2) + "\n", { mode: 0o600 }); },
  clear() { try { fs.unlinkSync(TOKEN_FILE); } catch (e) { /* already gone */ } },
};

async function up() {
  try { const r = await request("GET", "/v1/ping"); return r.status === 200 && !!r.body && r.body.app === "collegiapp"; } catch (e) { return false; }
}

// Start the installed app in the tray. On Windows it goes through Explorer: Claude Desktop is an MSIX package that
// redirects its children's AppData, so a direct start would run a private copy of the app with its own data.
function launch() {
  const quiet = { detached: true, stdio: "ignore" };
  try {
    if (process.platform === "win32") {
      const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
      spawn("explorer.exe", [path.join(local, "Collegiapp", "collegiapp.exe")], quiet).unref();
    } else if (process.platform === "darwin") spawn("open", ["-g", "-a", "Collegiapp", "--args", "--minimized"], quiet).unref();
    else spawn("collegiapp", ["--minimized"], quiet).unref();
  } catch (e) { /* not installed where we looked */ }
}

let starting = null;
async function ready() {
  if (await up()) return;
  if (!starting) starting = (async () => {
    if (!process.env.COLLEGIAPP_BRIDGE) launch();
    for (const end = Date.now() + START_WAIT; Date.now() < end;) { await sleep(1000); if (await up()) return; }
    throw new Fail("Collegiapp isn't running and didn't start. Open it (it can stay in the tray), then try again.");
  })().finally(() => { starting = null; });
  return starting;
}

// Ask the app to allow this client: it shows a code and Allow; the client polls until you answer. Calls made while
// one request is open share it.
let client = "Claude", pending = null, pairing = null;
async function pair() {
  if (!pending || Date.now() - pending.at > PAIR_TTL) {
    const r = await request("POST", "/v1/pair", { name: client, kind: "assistant" });
    if (r.status !== 200 || !r.body || !r.body.id) throw new Fail("Collegiapp didn't take the connection request: " + errText(r));
    pending = { id: r.body.id, code: r.body.code, at: Date.now() };
  }
  for (const end = Date.now() + PAIR_WAIT; Date.now() < end;) {
    const r = await request("GET", "/v1/pair/" + pending.id), st = r.body && r.body.status;
    if (st === "allowed" && r.body.token) {
      pending = null;
      saved.save({ token: r.body.token, name: client, paired: new Date().toISOString() });
      return r.body.token;
    }
    if (st === "denied") { pending = null; throw new Fail("Collegiapp wasn't allowed to connect (Don't allow). Ask again for a new request."); }
    if (st === "expired") { pending = null; throw new Fail("The connection request in Collegiapp expired. Ask again for a new one."); }
    await sleep(1000);
  }
  throw new Fail(`Waiting for you to allow ${client} in Collegiapp: click Allow in its window (the code there is ${pending.code}), then ask again.`);
}
const pairOnce = () => pairing || (pairing = pair().finally(() => { pairing = null; }));

function errText(r) {
  const e = r.body && r.body.error;
  if (r.status === 404 && e === "not found") return "this Collegiapp is too old for notes from a chat; update it (tray › Check for updates)";
  return e || "HTTP " + r.status;
}

async function api(method, p, body) {
  await ready();
  let token = (saved.load() || {}).token || (await pairOnce());
  let r = await request(method, p, body, token);
  if (r.status === 401) { // forgotten in Connect sources: ask again
    saved.clear();
    token = await pairOnce();
    r = await request(method, p, body, token);
  }
  if (r.status >= 400) throw new Fail(errText(r));
  return r.body;
}

/* ───────────── what the tools say ───────────── */

const day = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
function about(n) {
  return [n.class, ...(n.tags || []).filter((t) => t.toLowerCase() !== "pinned").map((t) => "#" + t), n.pinned && "pinned", n.archived && "archived",
    n.checklist && `${n.checklist[0]}/${n.checklist[1]} done`, "edited " + day(n.updated)].filter(Boolean).join(" · ");
}
const line = (n) => `- "${n.title}" (id ${n.id}) · ${about(n)}${n.preview ? "\n  " + n.preview : ""}`;
const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const list = (v) => (Array.isArray(v) ? v.map(str) : typeof v === "string" && v.trim() ? [v] : []);
const needId = (a) => { const id = str(a.id).trim(); if (!id) throw new Fail("Which note? Pass its id from search_notes."); return encodeURIComponent(id); };

const TOOLS = [
  {
    name: "search_notes",
    title: "Search notes",
    description: "Search the user's Collegiapp notes, pinned first, then the newest edit. The query takes words from the title or text, #tag, or a class like 130a; leave it empty for recent notes. Returns each note's id, title, class, tags and a preview; read_note gives the whole text.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "Words, #tag or a class; empty for the newest notes" },
      include_archived: { type: "boolean", description: "Also archived notes (default false)" },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "At most this many (default 20)" },
    } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a) {
      const q = new URLSearchParams({ q: str(a.query), limit: String(Math.min(100, Math.max(1, parseInt(a.limit, 10) || 20))) });
      if (a.include_archived) q.set("archived", "1");
      const notes = (await api("GET", "/v1/notes?" + q)).notes || [];
      if (!notes.length) return a.query ? `No notes match "${str(a.query)}".` : "There are no notes yet.";
      return `${notes.length} note${notes.length > 1 ? "s" : ""}:\n` + notes.map(line).join("\n");
    },
  },
  {
    name: "read_note",
    title: "Read a note",
    description: "The whole text of one Collegiapp note, in Collegiapp Markdown, with its class and tags. Drawings show as ![Drawing|…](drawing:N) stand-ins; keep them as they are when you write the note back.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The note's id from search_notes" } }, required: ["id"] },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a) {
      const n = (await api("GET", "/v1/notes/" + needId(a))).note;
      return `"${n.title}" (id ${n.id}) · ${about(n)}\n---\n${n.text || "(empty)"}`;
    },
  },
  {
    name: "create_note",
    title: "Create a note",
    description: "Save a new note in Collegiapp. Write the text in Collegiapp Markdown (see the server instructions); the title is its own field, so the text shouldn't start with a heading that repeats it.",
    inputSchema: { type: "object", properties: {
      title: { type: "string", description: "Short, sentence case" },
      text: { type: "string", description: "The note in Collegiapp Markdown" },
      class: { type: "string", description: "A class to file it under: a code like \"CMPSC 130A\", an alias, or a number like 130a" },
      tags: { type: "array", items: { type: "string" }, description: "Tags without #" },
      pinned: { type: "boolean", description: "Pin it to the top of Notes" },
    }, required: ["title", "text"] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(a) {
      const n = (await api("POST", "/v1/notes", { title: str(a.title), text: str(a.text), class: a.class ? str(a.class) : null, tags: list(a.tags), pinned: !!a.pinned })).note;
      return `Saved "${n.title}" in Collegiapp (id ${n.id})${n.class ? " under " + n.class : ""}.`;
    },
  },
  {
    name: "append_to_note",
    title: "Add to a note",
    description: "Add Collegiapp Markdown to the end of an existing note, after a blank line. Nothing already there changes.",
    inputSchema: { type: "object", properties: {
      id: { type: "string", description: "The note's id from search_notes" },
      text: { type: "string", description: "What to add, in Collegiapp Markdown" },
    }, required: ["id", "text"] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(a) {
      if (!str(a.text).trim()) throw new Fail("Nothing to add.");
      const r = await api("POST", "/v1/notes/" + needId(a), { append: str(a.text) });
      return `Added to "${r.note.title}" in Collegiapp.`;
    },
  },
  {
    name: "update_note",
    title: "Change a note",
    description: "Change an existing note: text replaces its whole text (read it first and keep what the user wrote; the old text goes to the app's trash), and title, class, tags, pinned and archived change only what you pass.",
    inputSchema: { type: "object", properties: {
      id: { type: "string", description: "The note's id from search_notes" },
      title: { type: "string" },
      text: { type: "string", description: "The whole new text, in Collegiapp Markdown, with its drawing stand-ins kept" },
      class: { type: "string", description: "A class to file it under; an empty string takes it out of its class" },
      add_tags: { type: "array", items: { type: "string" } },
      remove_tags: { type: "array", items: { type: "string" } },
      pinned: { type: "boolean" },
      archived: { type: "boolean", description: "Archived notes leave the Notes view; the Done view keeps them" },
    }, required: ["id"] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async run(a) {
      const e = {};
      for (const k of ["title", "text", "class"]) if (typeof a[k] === "string") e[k] = a[k];
      for (const k of ["pinned", "archived"]) if (typeof a[k] === "boolean") e[k] = a[k];
      e.add_tags = list(a.add_tags); e.remove_tags = list(a.remove_tags);
      const r = await api("POST", "/v1/notes/" + needId(a), e);
      return r.changed ? `Changed "${r.note.title}" in Collegiapp (${about(r.note)}).` : `"${r.note.title}" already looked like that; nothing changed.`;
    },
  },
  {
    name: "list_classes",
    title: "List classes",
    description: "The user's classes in Collegiapp, with the codes and aliases create_note and update_note take for class.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run() {
      const cs = (await api("GET", "/v1/classes")).classes || [];
      if (!cs.length) return "No classes in Collegiapp yet.";
      return cs.map((c) => `- ${c.code}${c.title ? " · " + c.title : ""}${c.aliases && c.aliases.length ? " (also " + c.aliases.join(", ") + ")" : ""}${c.quarter ? " · " + c.quarter : ""}${c.hidden ? " · hidden" : ""}`).join("\n");
    },
  },
  {
    name: "add_tasks",
    title: "Add tasks",
    description: "Add tasks to the user's Collegiapp list. " + GRAMMAR,
    inputSchema: { type: "object", properties: { tasks: { type: "array", items: { type: "string" }, minItems: 1, description: "One quick-add line per task" } }, required: ["tasks"] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(a) {
      const lines = list(a.tasks).map((t) => t.trim()).filter(Boolean);
      if (!lines.length) throw new Fail("No tasks to add.");
      const titles = [];
      for (const text of lines) titles.push((await api("POST", "/v1/capture", { text })).title);
      return `Added to Collegiapp: ${titles.map((t) => `"${t}"`).join(", ")}.`;
    },
  },
];

/* ───────────── MCP over stdio ───────────── */

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");

async function dispatch(m) {
  if (!m || typeof m !== "object") return;
  const has = m.id !== undefined && m.id !== null;
  const reply = (result) => has && send({ jsonrpc: "2.0", id: m.id, result });
  const fail = (code, message) => has && send({ jsonrpc: "2.0", id: m.id, error: { code, message } });
  const p = m.params || {};
  switch (m.method) {
    case "initialize": {
      const who = str((p.clientInfo || {}).name);
      client = /claude/i.test(who) ? "Claude" : who.trim().slice(0, 40) || "An assistant";
      return reply({
        protocolVersion: PROTOCOLS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "collegiapp", title: "Collegiapp", version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
    case "tools/call": {
      const t = TOOLS.find((x) => x.name === p.name);
      if (!t) return fail(-32602, "Unknown tool: " + p.name);
      try {
        return reply({ content: [{ type: "text", text: await t.run(p.arguments || {}) }] });
      } catch (e) {
        const text = e instanceof Fail ? e.message : e && e.code === "ECONNREFUSED" ? "Collegiapp stopped answering. Open it, then try again." : "Collegiapp: " + (e && e.message);
        return reply({ content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      if (has && m.method) return fail(-32601, "Method not found: " + m.method);
  }
}

if (require.main === module) {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0;) {
      const text = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!text) continue;
      let m;
      try { m = JSON.parse(text); } catch (e) { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
      (Array.isArray(m) ? m : [m]).forEach((x) => dispatch(x).catch((e) => process.stderr.write("collegiapp: " + e.stack + "\n")));
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

module.exports = { TOOLS, dispatch, INSTRUCTIONS };
