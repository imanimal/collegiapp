/* Runs server.js against a fake bridge: node integrations/claude-desktop/test.js
   The fake answers like src-tauri/src/bridge.rs: pairing, then the note, class and capture routes with a token. */
"use strict";
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert"), { spawn } = require("child_process");

const notes = [], things = [], tokens = new Set(), asks = [];
let polls = 0;
const bridge = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const out = (status, v) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(v)); };
    assert.strictEqual(req.headers.origin, undefined, "no Origin, so the bridge takes it");
    assert.strictEqual(req.headers.host, "127.0.0.1:" + bridge.address().port);
    const url = new URL(req.url, "http://x"), p = url.pathname, json = body ? JSON.parse(body) : null;
    if (p === "/v1/ping") return out(200, { app: "collegiapp", version: "0.1.3", paired: false });
    if (req.method === "POST" && p === "/v1/pair") { asks.push(json); polls = 0; return out(200, { id: "p" + asks.length, code: "4821" }); }
    if (p.startsWith("/v1/pair/")) return out(200, ++polls < 2 ? { status: "pending" } : (tokens.add("tok" + asks.length), { status: "allowed", token: "tok" + asks.length }));
    if (!tokens.has((req.headers.authorization || "").replace("Bearer ", ""))) return out(401, { error: "not paired" });
    const sum = (n) => ({ id: n.id, title: n.title, class: n.class, tags: n.tags, pinned: n.tags.includes("pinned"), archived: false, updated: "2026-11-02T20:00:00Z", checklist: null, preview: n.text.slice(0, 20) });
    if (req.method === "GET" && p === "/v1/notes") return out(200, { notes: notes.filter((n) => (n.title + n.text).includes(url.searchParams.get("q"))).map(sum) });
    if (req.method === "POST" && p === "/v1/notes") {
      const n = { id: "n" + (notes.length + 1), title: json.title, text: json.text, class: json.class && "CMPSC 130A", tags: json.tags.concat(json.pinned ? ["pinned"] : []) };
      notes.push(n); return out(200, { note: sum(n), changed: true });
    }
    const n = notes.find((x) => p === "/v1/notes/" + x.id);
    if (p.startsWith("/v1/notes/") && !n) return out(404, { error: "no such note (list_notes shows their ids)" });
    if (req.method === "GET" && n) return out(200, { note: Object.assign(sum(n), { text: n.text }) });
    if (req.method === "POST" && n) {
      if (json.append) n.text += "\n\n" + json.append;
      if (json.text) n.text = json.text;
      if (json.title) n.title = json.title;
      return out(200, { note: sum(n), changed: !!(json.append || json.text || json.title) });
    }
    const row = (t) => Object.assign({ kind: "task", status: "todo", class: null, due: null, end: null, location: null, tags: [], priority: 0, source: "manual", notes: "", links: [] }, t);
    if (req.method === "GET" && p === "/v1/items") return out(200, { items: things.filter((t) => (t.title + t.notes).toLowerCase().includes(url.searchParams.get("q").toLowerCase())).map(row) });
    if (req.method === "POST" && p === "/v1/items") { const t = Object.assign({ id: "i" + (things.length + 1), kind: json.due && json.end ? "event" : "task" }, json); things.push(t); return out(200, { item: row(t), changed: true }); }
    const thing = things.find((x) => p === "/v1/items/" + x.id);
    if (p.startsWith("/v1/items/") && !thing) return out(404, { error: "no such item (search_items shows their ids)" });
    if (req.method === "GET" && thing) return out(200, { item: row(thing) });
    if (req.method === "POST" && thing) {
      if (json.delete) { things.splice(things.indexOf(thing), 1); return out(200, { item: row(thing), changed: true, deleted: true }); }
      if (json.status) thing.status = json.status;
      if (json.due) thing.due = json.due;
      return out(200, { item: row(thing), changed: !!(json.status || json.due) });
    }
    if (p === "/v1/classes") return out(200, { classes: [{ id: "c", code: "CMPSC 130A", title: "Algorithms", aliases: ["algo"], quarter: "F26", hidden: false }] });
    if (p === "/v1/capture") return out(200, { title: json.text.split(" ")[0] });
    out(404, { error: "not found" });
  });
});

// Claude Desktop's built-in Node imports the entry point (import(), argv[1] = server.js), so require.main isn't the
// server's module there; it still has to answer initialize.
function hostStyle() {
  return new Promise((resolve, reject) => {
    const host = 'import(require("url").pathToFileURL(process.argv[1]).href);';
    const p = spawn(process.execPath, ["-e", host, path.join(__dirname, "server.js")], { stdio: ["pipe", "pipe", "inherit"] });
    const t = setTimeout(() => { p.kill(); reject(new Error("no answer to initialize when imported by a host")); }, 5000);
    let out = "";
    p.stdout.on("data", (d) => {
      out += d; const i = out.indexOf("\n"); if (i < 0) return;
      clearTimeout(t); p.kill();
      try { assert.strictEqual(JSON.parse(out.slice(0, i)).result.serverInfo.name, "collegiapp"); resolve(); } catch (e) { reject(e); }
    });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "1" } } }) + "\n");
  });
}

bridge.listen(0, "127.0.0.1", async () => {
  const tokenFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "collegiapp-mcp-")), "assistant.json");
  const srv = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: Object.assign({}, process.env, { COLLEGIAPP_BRIDGE: "http://127.0.0.1:" + bridge.address().port, COLLEGIAPP_TOKEN_FILE: tokenFile }),
    stdio: ["pipe", "pipe", "inherit"],
  });
  const waiting = new Map();
  let buf = "", next = 1;
  srv.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) { const m = JSON.parse(buf.slice(0, i)); waiting.get(m.id)(m); }
  });
  const rpc = (method, params) => new Promise((r) => { const id = next++; waiting.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const call = async (name, args) => { const m = await rpc("tools/call", { name, arguments: args }); return { text: m.result.content[0].text, error: !!m.result.isError }; };

  try {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "1" } });
    assert.strictEqual(init.result.protocolVersion, "2025-06-18");
    assert.match(init.result.instructions, /COLLEGIAPP MARKDOWN/);
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const tools = (await rpc("tools/list")).result.tools.map((t) => t.name);
    assert.deepStrictEqual(tools, ["search_notes", "read_note", "create_note", "append_to_note", "update_note", "search_items", "read_item", "add_item", "update_item", "list_classes", "add_tasks"]);

    // the first call pairs (two at once share the request), then goes through
    const [made, found] = await Promise.all([call("create_note", { title: "Heaps", text: "- [ ] read 6.1", class: "algo", tags: ["exam"], pinned: true }), call("search_notes", { query: "zzz" })]);
    assert.deepStrictEqual(asks, [{ name: "Claude", kind: "assistant" }]);
    assert.match(made.text, /Saved "Heaps" in Collegiapp \(id n1\) under CMPSC 130A/);
    assert.strictEqual(found.text, 'No notes match "zzz".');
    assert.strictEqual(JSON.parse(fs.readFileSync(tokenFile, "utf8")).token, "tok1");

    assert.match((await call("search_notes", { query: "Heaps" })).text, /^1 note:\n- "Heaps" \(id n1\) · CMPSC 130A · #exam · pinned · edited Nov 2, 2026/);
    assert.match((await call("append_to_note", { id: "n1", text: "- [ ] heapify" })).text, /Added to "Heaps"/);
    assert.match((await call("read_note", { id: "n1" })).text, /---\n- \[ \] read 6.1\n\n- \[ \] heapify$/);
    assert.match((await call("update_note", { id: "n1", title: "Heaps and heapsort" })).text, /Changed "Heaps and heapsort"/);
    assert.match((await call("list_classes", {})).text, /CMPSC 130A · Algorithms \(also algo\) · F26/);
    assert.strictEqual((await call("add_tasks", { tasks: ["pa3 130a fri", "read ch6 tmr"] })).text, 'Added to Collegiapp: "pa3", "read".');

    const added = await call("add_item", { title: "OBSD appointment", due: "2026-11-04T14:00:00Z", end: "2026-11-04T14:30:00Z", location: "SRB", tags: ["advising"] });
    assert.match(added.text, /^Added to Collegiapp:\n- "OBSD appointment" \(id i1\) · event · todo · .*Nov 4.* · at SRB/);
    assert.match((await call("search_items", { query: "obsd" })).text, /^1 item:\n- "OBSD appointment"/);
    assert.strictEqual((await call("search_items", { query: "zzz" })).text, 'Nothing on the list matches "zzz".');
    assert.match((await call("update_item", { id: "i1", status: "done" })).text, /^Changed in Collegiapp:/);
    assert.match((await call("update_item", { id: "i1", status: "done" })).text, /Changed in Collegiapp/);
    assert.match((await call("read_item", { id: "i1" })).text, /OBSD appointment/);
    assert.match((await call("update_item", { id: "i1", delete: true })).text, /Deleted "OBSD appointment"/);
    assert.ok((await call("read_item", { id: "i1" })).error);
    assert.ok((await call("update_item", { id: " " })).error);

    const missing = await call("read_note", { id: "nope" });
    assert.ok(missing.error && /no such note/.test(missing.text));
    assert.ok((await call("append_to_note", { id: "n1", text: " " })).error);
    assert.strictEqual((await rpc("tools/call", { name: "nope" })).error.code, -32602);
    assert.strictEqual((await rpc("resources/list")).error.code, -32601);

    // a forgotten token pairs again
    tokens.clear();
    assert.match((await call("search_notes", { query: "Heaps" })).text, /1 note/);
    assert.strictEqual(asks.length, 2);
    await hostStyle();
    console.log("ok: the MCP server pairs, then searches, reads, creates, appends to and changes notes, searches, adds, changes and deletes list items and calendar events, lists classes and adds tasks, and answers when a host imports it");
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    srv.kill();
    bridge.close();
  }
});
