/* Collegiapp — drawing (CA.draw): quick sketches in notes. A drawing is a small vector SVG kept in the note as a Markdown
   image with a data address, ![Drawing|center 40%](data:image/svg+xml;base64,…), so it syncs, exports, prints and moves
   with the text like anything else in it (docs/NOTES.md). This file is the layer that covers the note sheet while you
   draw: select, pen, highlighter, eraser, line, arrow, box, ellipse and text, seven inks, three sizes and its own undo;
   and the SVG out and back in. The canvas is in page units, 800 across the note's text column, so a drawing goes into
   the note at the size it was drawn. Ink is chosen for paper; a dark theme shows the canvas and the note's drawings
   inverted (pocket.css), so black ink reads as white there. app.js opens the layer and puts the result in the editor. */
(function () {
  const CA = (window.CA = window.CA || {});
  const COL = 800, MARK = 'data-collegiapp="drawing"';
  const FONT = "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";
  const INKS = [["ink", "Ink", "#1b1915"], ["red", "Red", "#d4402c"], ["orange", "Orange", "#e5791a"], ["yellow", "Yellow", "#f2c12e"], ["green", "Green", "#2f8f5b"], ["blue", "Blue", "#2f6fd8"], ["purple", "Purple", "#7b4fd0"]];
  // [id, label, pen width, text size]; the highlighter is 4.5 times the pen, the eraser's reach 2.5 times
  const SIZES = [["s", "Fine", 2, 18], ["m", "Medium", 4, 26], ["l", "Thick", 8, 38]];
  const TOOLS = [
    { id: "select", label: "Select and move", icon: "pick", k: "V" }, { id: "pen", label: "Pen", icon: "jot", k: "P" }, { id: "hl", label: "Highlighter", icon: "mark", k: "H" },
    { id: "erase", label: "Eraser", icon: "erase", k: "E" }, { id: "line", label: "Line", icon: "line", k: "L" }, { id: "arrow", label: "Arrow", icon: "arrow", k: "A" },
    { id: "box", label: "Box", icon: "box", k: "R" }, { id: "oval", label: "Ellipse", icon: "oval", k: "O" }, { id: "text", label: "Text", text: "T", k: "T" },
  ];
  const PREF = "capp.draw";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const r1 = (n) => String(Math.round(n * 10) / 10);
  const P = (p) => r1(p[0]) + " " + r1(p[1]);
  const hexOf = (id) => (INKS.find((x) => x[0] === id) || INKS[0])[2];

  /* ── the SVG: elements are { k: "p", d, c, w, o } paths (absolute M L Q C Z only, so moving one shifts every pair)
     and { k: "t", x, y, s, c, v } single-line texts ── */
  function elSVG(e) {
    if (e.k === "t") return `<text x="${r1(e.x)}" y="${r1(e.y)}" font-size="${r1(e.s)}" fill="${e.c}" stroke="none">${esc(e.v)}</text>`;
    return `<path d="${e.d}" stroke="${e.c}" stroke-width="${r1(e.w)}"${e.o < 1 ? ` stroke-opacity="${e.o}"` : ""}/>`;
  }
  const svgOf = (els, b) => `<svg xmlns="http://www.w3.org/2000/svg" ${MARK} viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="${b.w}" height="${b.h}"><g fill="none" stroke-linecap="round" stroke-linejoin="round" font-family="${FONT}">${els.map(elSVG).join("")}</g></svg>`;
  function toB64(s) { const b = new TextEncoder().encode(s); let bin = ""; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); }
  const fromB64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  const DATA = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)$/;
  // one of ours: the mark sits in the first few bytes, so only those are decoded
  function isDrawing(src) {
    const m = DATA.exec(String(src || "")); if (!m) return false;
    try { return fromB64(m[1].slice(0, 160)).includes(MARK); } catch (e) { return false; }
  }
  // a drawing's src → { els, box }, or null when it isn't one made here
  function read(src) {
    const m = DATA.exec(String(src || "")); if (!m) return null;
    let root; try { root = new DOMParser().parseFromString(fromB64(m[1]), "image/svg+xml").documentElement; } catch (e) { return null; }
    if (!root || root.localName !== "svg" || root.getAttribute("data-collegiapp") !== "drawing") return null;
    const vb = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    if (vb.length !== 4 || vb.some((n) => !isFinite(n))) return null;
    const col = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : INKS[0][2]), num = (v, d) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);
    const els = [];
    for (const n of root.querySelectorAll("path, text")) {
      if (n.localName === "path") { const d = (n.getAttribute("d") || "").trim(); if (d && /^[MLQCZ\d\s.,eE+-]+$/.test(d)) els.push({ k: "p", d, c: col(n.getAttribute("stroke")), w: num(n.getAttribute("stroke-width"), 4), o: num(n.getAttribute("stroke-opacity"), 1) }); }
      else { const v = n.textContent.trim(); if (v) els.push({ k: "t", x: num(n.getAttribute("x"), 0), y: num(n.getAttribute("y"), 0), s: num(n.getAttribute("font-size"), 26), c: col(n.getAttribute("fill")), v }); }
    }
    return { els, box: { x: vb[0], y: vb[1], w: vb[2], h: vb[3] } };
  }
  const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
  function moved(e, dx, dy) {
    if (e.k === "t") return Object.assign({}, e, { x: e.x + dx, y: e.y + dy });
    let i = 0; return Object.assign({}, e, { d: e.d.replace(NUM, (n) => r1(+n + (i++ % 2 ? dy : dx))) });
  }

  /* ── strokes and shapes ── */
  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  // Ramer–Douglas–Peucker: the fewest points that stay within eps of the line you drew
  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]]; keep[0] = keep[pts.length - 1] = 1;
    while (stack.length) {
      const [a, b] = stack.pop(); let md = 0, mi = -1;
      for (let i = a + 1; i < b; i++) { const d = segDist(pts[i], pts[a], pts[b]); if (d > md) { md = d; mi = i; } }
      if (mi > 0 && md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  // a smooth stroke: quadratic curves through the midpoints, each point its control
  function strokeD(pts) {
    if (pts.length < 2) return `M${P(pts[0])}L${r1(pts[0][0] + 0.1)} ${r1(pts[0][1])}`;
    if (pts.length === 2) return `M${P(pts[0])}L${P(pts[1])}`;
    let d = "M" + P(pts[0]);
    for (let i = 1; i < pts.length - 1; i++) d += "Q" + P(pts[i]) + " " + P([(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]);
    return d + "L" + P(pts[pts.length - 1]);
  }
  function shapeD(tool, a, b, w) {
    if (tool === "line") return `M${P(a)}L${P(b)}`;
    if (tool === "arrow") {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = Math.max(12, w * 3.2), s = 0.5;
      return `M${P(a)}L${P(b)}M${P([b[0] - h * Math.cos(ang - s), b[1] - h * Math.sin(ang - s)])}L${P(b)}L${P([b[0] - h * Math.cos(ang + s), b[1] - h * Math.sin(ang + s)])}`;
    }
    const x1 = Math.min(a[0], b[0]), y1 = Math.min(a[1], b[1]), x2 = Math.max(a[0], b[0]), y2 = Math.max(a[1], b[1]);
    if (tool === "box") return `M${P([x1, y1])}L${P([x2, y1])}L${P([x2, y2])}L${P([x1, y2])}Z`;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2, ry = (y2 - y1) / 2, kx = 0.5523 * rx, ky = 0.5523 * ry;
    return `M${P([cx - rx, cy])}C${P([cx - rx, cy - ky])} ${P([cx - kx, cy - ry])} ${P([cx, cy - ry])}C${P([cx + kx, cy - ry])} ${P([cx + rx, cy - ky])} ${P([cx + rx, cy])}`
      + `C${P([cx + rx, cy + ky])} ${P([cx + kx, cy + ry])} ${P([cx, cy + ry])}C${P([cx - kx, cy + ry])} ${P([cx - rx, cy + ky])} ${P([cx - rx, cy])}Z`;
  }
  // Shift: lines at 15° steps, squares and circles
  function constrain(tool, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (tool === "line" || tool === "arrow") { const len = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12); return [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)]; }
    const m = Math.max(Math.abs(dx), Math.abs(dy)); return [a[0] + (dx < 0 ? -m : m), a[1] + (dy < 0 ? -m : m)];
  }

  function loadPref() { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch (e) { return {}; } }
  function savePref(p) { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch (e) { /* private window: the next drawing starts on the pen */ } }

  /* ── the layer ──
     open(host, { src, keyLabel, onDone({ src, w, h } | null), onCancel(), onRefuse(msg) }) covers `host` and returns
     { act(d, v), done(), el }. done() keeps what's drawn, as Done and Esc do. */
  function open(host, opts) {
    opts = opts || {};
    const kl = opts.keyLabel || ((k) => k), pref = loadPref();
    let tool = TOOLS.some((t) => t.id === pref.tool) && pref.tool !== "text" ? pref.tool : "pen";
    let size = SIZES.some((s) => s[0] === pref.size) ? pref.size : "m";
    const inks = Object.assign({ ink: "ink", hl: "yellow" }, pref.inks);
    const start = opts.src ? read(opts.src) : null;
    let els = start ? start.els : [];
    // a drawing that reached past the top or left edge comes back just inside it
    if (start && (start.box.x < 0 || start.box.y < 0)) els = els.map((e) => moved(e, Math.max(0, -start.box.x), Math.max(0, -start.box.y)));
    const first = els;
    let hist = [els], at = 0, sel = new Set(), drag = null, input = null, H = 600, closed = false, armed = 0;
    const boxes = new WeakMap(), samp = new WeakMap();

    const root = document.createElement("div");
    root.className = "ns-draw"; root.tabIndex = -1; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Drawing");
    root.innerHTML = layout(!!start);
    host.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const cv = $(".dr-cv"), g = $(".dr-els"), live = $(".dr-live"), ui = $(".dr-ui"), selBox = $(".dr-sel"), marq = $(".dr-marq"), box = $(".dr-box"), scroller = $(".dr-scroll"), inp = $(".dr-in");

    function layout(editing) {
      const ic = CA.app.ic;
      const key = (t) => `<button class="btn ns-t" data-act="draw" data-d="tool" data-v="${t.id}" title="${t.label} · ${t.k}" aria-label="${t.label}" aria-pressed="false">${t.icon ? ic(t.icon) : `<span class="ns-tx">${t.text}</span>`}</button>`;
      const sw = (x, i) => `<button class="btn ns-t dr-ink" data-act="draw" data-d="ink" data-v="${x[0]}" title="${x[1]} · ${i + 1}" aria-label="${x[1]}" aria-pressed="false"><span class="dr-dot" style="--c:${x[2]}"></span></button>`;
      const sz = (x) => `<button class="btn ns-t dr-size" data-act="draw" data-d="size" data-v="${x[0]}" title="${x[1]} · [ ]" aria-label="${x[1]}" aria-pressed="false"><span class="dr-w dr-w-${x[0]}"></span></button>`;
      const ed = (d, icon, label, k) => `<button class="btn ns-t" data-act="draw" data-d="${d}" title="${label}${k ? " · " + esc(kl(k)) : ""}" aria-label="${label}">${ic(icon)}</button>`;
      return `<div class="ph"><span class="pt">${ic("draw")}Drawing</span><span class="ns-st">${editing ? "Editing" : "New"}</span><span class="sp"></span>
          <button class="btn ghost sm" data-act="draw" data-d="discard" title="Close without keeping this drawing">${ic("close")}<span class="bl">Discard</span></button>
          <button class="btn sm primary" data-act="draw" data-d="done" title="Put the drawing in the note">${ic("check")}Done<kbd>Esc</kbd></button></div>
        <div class="ns-tools dr-tools" role="toolbar" aria-label="Drawing tools"><span class="ns-g">${TOOLS.map(key).join("")}</span><span class="ns-g">${INKS.map(sw).join("")}</span>
          <span class="ns-g">${SIZES.map(sz).join("")}</span><span class="ns-g">${ed("undo", "undo", "Undo", "Mod+Z")}${ed("redo", "redo", "Redo", "Mod+Shift+Z")}${ed("clear", "trash", "Clear the drawing")}</span></div>
        <div class="dr-scroll"><div class="dr-page"><div class="dr-box">
          <svg class="dr-cv" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COL} 600" role="img" aria-label="Canvas"><g class="dr-els" fill="none" stroke-linecap="round" stroke-linejoin="round" font-family="${FONT}"></g><path class="dr-live" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <svg class="dr-ui" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COL} 600" aria-hidden="true"><rect class="dr-sel"/><rect class="dr-marq"/></svg>
          <input class="dr-in" hidden aria-label="Text" autocomplete="off" spellcheck="false"></div></div></div>
        <div class="ns-foot dr-foot"><span class="dim">${esc(kl("Shift"))} keeps lines straight and shapes even · V P H E L A R O T pick tools, 1–7 inks · drag a drawing in the note to move it</span></div>`;
    }

    /* geometry */
    const upx = () => COL / (cv.getBoundingClientRect().width || COL); // page units per screen pixel
    function pt(e) {
      const m = cv.getScreenCTM(); if (!m) return [0, 0];
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      return [Math.max(0, Math.min(COL, p.x)), Math.max(0, Math.min(H, p.y))];
    }
    const nodeOf = (e) => { const i = els.indexOf(e); return i < 0 ? null : g.children[i]; };
    function bboxOf(e) {
      let b = boxes.get(e); if (b) return b;
      const n = nodeOf(e); if (!n) return null;
      const r = n.getBBox(), pad = e.k === "t" ? 2 : e.w / 2;
      b = { x: r.x - pad, y: r.y - pad, w: r.width + 2 * pad, h: r.height + 2 * pad }; boxes.set(e, b); return b;
    }
    function samplesOf(e) {
      let s = samp.get(e); if (s) return s;
      const n = nodeOf(e); s = [];
      if (n && e.k === "p") { const L = n.getTotalLength(); for (let l = 0; l < L; l += 3) { const q = n.getPointAtLength(l); s.push([q.x, q.y]); } const q = n.getPointAtLength(L); s.push([q.x, q.y]); }
      samp.set(e, s); return s;
    }
    function near(e, p, r) {
      const b = bboxOf(e); if (!b || p[0] < b.x - r || p[0] > b.x + b.w + r || p[1] < b.y - r || p[1] > b.y + b.h + r) return false;
      if (e.k === "t") return true;
      const d = r + e.w / 2; return samplesOf(e).some((q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= d * d);
    }
    function hitAt(p, r) { for (let i = els.length - 1; i >= 0; i--) if (near(els[i], p, r)) return els[i]; return null; }
    function union(bs) {
      bs = bs.filter(Boolean); if (!bs.length) return null;
      const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
      return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
    }
    const sz = () => SIZES.find((s) => s[0] === size);
    const width = (t) => sz()[2] * (t === "hl" ? 4.5 : 1);
    const fam = (t) => (t === "hl" ? "hl" : "ink");

    /* drawing the canvas */
    function setH(h) {
      H = Math.max(200, Math.round(h));
      [cv, ui].forEach((s) => s.setAttribute("viewBox", `0 0 ${COL} ${H}`));
      box.style.backgroundSize = `${100 / 40}% ${(2000 / H).toFixed(4)}%`; // a dot every 20 units
    }
    const bottom = () => Math.max(0, ...els.map((e) => { const b = bboxOf(e); return b ? b.y + b.h : 0; }));
    // at least the visible page; it grows as you draw near the bottom
    function fit() {
      const vis = Math.max(320, (scroller.clientHeight - 48) * upx());
      if (H < vis || H < bottom() + 120) setH(Math.max(vis, bottom() + 320));
    }
    function render() { g.innerHTML = els.map(elSVG).join(""); showSel(); }
    function showSel() {
      sel = new Set([...sel].filter((e) => els.includes(e)));
      const u = union([...sel].map(bboxOf));
      if (!u) { selBox.style.display = "none"; return; }
      Object.entries({ x: u.x - 4, y: u.y - 4, width: u.w + 8, height: u.h + 8 }).forEach(([k, v]) => selBox.setAttribute(k, r1(v)));
      selBox.removeAttribute("transform"); selBox.style.display = "";
    }
    function keys() {
      root.dataset.tool = tool;
      const ink = sel.size ? null : inks[fam(tool)];
      root.querySelectorAll(".dr-tools .ns-t").forEach((b) => {
        const d = b.dataset.d, v = b.dataset.v;
        const on = d === "tool" ? v === tool : d === "ink" ? v === ink : d === "size" ? v === size : false;
        if (b.classList.contains("on") !== on) { b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }
        if (d === "undo") b.disabled = at <= 0; else if (d === "redo") b.disabled = at >= hist.length - 1; else if (d === "clear") b.disabled = !els.length;
      });
    }
    function commit(next) {
      hist = hist.slice(0, at + 1); hist.push(next);
      if (hist.length > 101) hist.shift();
      at = hist.length - 1; els = next; render(); fit(); keys();
    }
    function undo() { if (at <= 0) return; cancelText(); at--; els = hist[at]; sel.clear(); render(); keys(); }
    function redo() { if (at >= hist.length - 1) return; cancelText(); at++; els = hist[at]; sel.clear(); render(); fit(); keys(); }

    /* tools, inks, sizes */
    function setTool(t) { commitText(); tool = t; if (t !== "select" && sel.size) { sel.clear(); showSel(); } savePref({ tool, size, inks }); keys(); }
    function setInk(v) {
      if (sel.size) { const c = hexOf(v); commit(els.map((e) => (sel.has(e) && e.c !== c ? (swap(e, Object.assign({}, e, { c }))) : e))); return; }
      inks[fam(tool)] = v; savePref({ tool, size, inks }); keys();
    }
    function setSize(v) {
      size = v; savePref({ tool, size, inks });
      if (sel.size) {
        const s = sz();
        commit(els.map((e) => (!sel.has(e) ? e : swap(e, e.k === "t" ? Object.assign({}, e, { s: s[3] }) : Object.assign({}, e, { w: s[2] * (e.o < 1 ? 4.5 : 1) })))));
      } else keys();
    }
    // a changed element is a new object: the selection follows it
    function swap(from, to) { if (sel.has(from)) { sel.delete(from); sel.add(to); } return to; }
    const step = (d) => SIZES[Math.max(0, Math.min(SIZES.length - 1, SIZES.findIndex((s) => s[0] === size) + d))][0];
    function removeSel() { if (!sel.size) return; const gone = sel; sel = new Set(); commit(els.filter((e) => !gone.has(e))); }
    function nudge(k, n) {
      const dx = k === "ArrowLeft" ? -n : k === "ArrowRight" ? n : 0, dy = k === "ArrowUp" ? -n : k === "ArrowDown" ? n : 0;
      commit(els.map((e) => (sel.has(e) ? swap(e, moved(e, dx, dy)) : e)));
    }
    function duplicate() {
      if (!sel.size) return;
      const copies = els.filter((e) => sel.has(e)).map((e) => moved(e, 16, 16));
      sel = new Set(copies); commit(els.concat(copies));
    }

    /* text: an input over the canvas where you click; Enter keeps it, Esc drops it */
    function textAt(old, p) {
      const s = old ? old.s : sz()[3], k = 1 / upx();
      input = { old, x: old ? old.x : p[0], y: old ? old.y : p[1] + s * 0.35, s, c: old ? old.c : hexOf(inks.ink) };
      if (old) { const n = nodeOf(old); if (n) n.style.visibility = "hidden"; }
      inp.value = old ? old.v : ""; inp.hidden = false;
      Object.assign(inp.style, { left: input.x * k + "px", top: (input.y - s * 0.98) * k + "px", fontSize: s * k + "px", color: input.c });
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
    }
    function closeText() {
      const t = input; input = null; inp.hidden = true;
      if (t && t.old) { const n = nodeOf(t.old); if (n) n.style.visibility = ""; }
      if (!closed) root.focus({ preventScroll: true });
      return t;
    }
    function commitText() {
      if (!input) return;
      const v = inp.value.replace(/\s+/g, " ").trim(), t = closeText();
      if (t.old && v === t.old.v) return;
      if (!v && !t.old) return;
      const e = { k: "t", x: t.x, y: t.y, s: t.s, c: t.c, v };
      commit(t.old ? (v ? els.map((x) => (x === t.old ? e : x)) : els.filter((x) => x !== t.old)) : els.concat(e));
    }
    function cancelText() { if (input) closeText(); }

    /* the pointer */
    function eraseAlong(a, b) {
      const r = sz()[2] * 2.5, n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
      for (let i = 0; i <= n; i++) {
        const p = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
        for (const e of els) if (!drag.gone.has(e) && near(e, p, r)) { drag.gone.add(e); const nd = nodeOf(e); if (nd) nd.style.display = "none"; }
      }
    }
    function liveStyle(t) {
      live.setAttribute("stroke", t === "hl" ? hexOf(inks.hl) : hexOf(inks.ink)); live.setAttribute("stroke-width", r1(width(t)));
      if (t === "hl") live.setAttribute("stroke-opacity", "0.35"); else live.removeAttribute("stroke-opacity");
    }
    function rectAttrs(el, a, b) {
      const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
      Object.entries({ x, y, width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) }).forEach(([k, v]) => el.setAttribute(k, r1(v)));
    }
    const meets = (b, r) => !!b && b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
    function down(e) {
      if ((e.pointerType === "mouse" && e.button !== 0) || drag) return;
      e.preventDefault();
      if (input) { commitText(); if (tool === "text") return; } // a click away from the text you're typing keeps it
      root.focus({ preventScroll: true });
      const p = pt(e), t = e.pointerType === "pen" && e.buttons & 32 ? "erase" : tool; // a pen's eraser end erases
      if (t === "text") { const hit = hitAt(p, 4 * upx()); return textAt(hit && hit.k === "t" ? hit : null, p); }
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* already gone */ }
      drag = { id: e.pointerId, t, p0: p, last: p, pts: [p], dx: 0, dy: 0 };
      if (t === "pen" || t === "hl") { liveStyle(t); live.setAttribute("d", strokeD([p])); }
      else if (t === "erase") { drag.gone = new Set(); eraseAlong(p, p); }
      else if (t === "select") {
        const hit = hitAt(p, 6 * upx());
        if (hit) { if (e.shiftKey) { if (sel.has(hit)) sel.delete(hit); else sel.add(hit); } else if (!sel.has(hit)) sel = new Set([hit]); drag.move = sel.has(hit); }
        else { if (!e.shiftKey) sel.clear(); drag.marq = true; drag.base = new Set(sel); }
        showSel(); keys();
      }
    }
    function move(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const t = drag.t;
      if (t === "pen" || t === "hl") {
        const list = (e.getCoalescedEvents && e.getCoalescedEvents()) || []; // every sample the screen got between frames
        for (const ev of list.length ? list : [e]) { const p = pt(ev), q = drag.pts[drag.pts.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 0.8) drag.pts.push(p); }
        live.setAttribute("d", "M" + drag.pts.map(P).join("L")); return;
      }
      const p = pt(e);
      if (t === "erase") { eraseAlong(drag.last, p); drag.last = p; return; }
      if (t === "select") {
        if (drag.move) {
          drag.dx = p[0] - drag.p0[0]; drag.dy = p[1] - drag.p0[1];
          const tr = `translate(${r1(drag.dx)} ${r1(drag.dy)})`;
          sel.forEach((s) => { const n = nodeOf(s); if (n) n.setAttribute("transform", tr); });
          selBox.setAttribute("transform", tr);
        } else if (drag.marq) {
          rectAttrs(marq, drag.p0, p); marq.style.display = "";
          const r = { x: Math.min(drag.p0[0], p[0]), y: Math.min(drag.p0[1], p[1]), w: Math.abs(p[0] - drag.p0[0]), h: Math.abs(p[1] - drag.p0[1]) };
          sel = new Set([...drag.base, ...els.filter((x) => meets(bboxOf(x), r))]); showSel();
        }
        return;
      }
      drag.b = e.shiftKey ? constrain(t, drag.p0, p) : p;
      liveStyle(t); live.setAttribute("d", shapeD(t, drag.p0, drag.b, width(t)));
    }
    function up(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      live.setAttribute("d", ""); marq.style.display = "none";
      if (d.t === "pen" || d.t === "hl") {
        const c = hexOf(inks[fam(d.t)]);
        commit(els.concat({ k: "p", d: strokeD(simplify(d.pts, 0.6)), c, w: width(d.t), o: d.t === "hl" ? 0.35 : 1 }));
      } else if (d.t === "erase") { if (d.gone.size) commit(els.filter((x) => !d.gone.has(x))); }
      else if (d.t === "select") {
        if (d.move && Math.abs(d.dx) + Math.abs(d.dy) > 0.5) commit(els.map((x) => (sel.has(x) ? swap(x, moved(x, d.dx, d.dy)) : x)));
        else { render(); keys(); }
      } else if (d.b && Math.hypot(d.b[0] - d.p0[0], d.b[1] - d.p0[1]) > 2) {
        commit(els.concat({ k: "p", d: shapeD(d.t, d.p0, d.b, width(d.t)), c: hexOf(inks.ink), w: width(d.t), o: 1 }));
      }
    }
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    inp.addEventListener("blur", () => { if (input) commitText(); });
    // paste goes to the text you're typing, never to the app behind (which would make tasks of it)
    root.addEventListener("paste", (e) => { e.stopPropagation(); if (e.target !== inp) e.preventDefault(); });

    /* keys stay in the layer: the app's own shortcuts wait until the drawing is done */
    root.addEventListener("keydown", (e) => {
      e.stopPropagation();
      const k = e.key, lk = k.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (e.target === inp) { if (k === "Enter") { e.preventDefault(); commitText(); } else if (k === "Escape") { e.preventDefault(); cancelText(); } return; }
      const go = (f) => { e.preventDefault(); f(); };
      if (mod && lk === "z") return go(e.shiftKey ? redo : undo);
      if (mod && lk === "y") return go(redo);
      if (mod && k === "Enter") return go(done);
      if (mod && lk === "a") return go(() => { setTool("select"); sel = new Set(els); showSel(); keys(); });
      if (mod && lk === "d") return go(duplicate);
      if (mod || e.altKey) return;
      if (k === "Escape") return go(() => { if (sel.size) { sel.clear(); showSel(); keys(); } else done(); });
      if (k === "Delete" || k === "Backspace") return go(removeSel);
      if (k.startsWith("Arrow") && sel.size) return go(() => nudge(k, e.shiftKey ? 10 : 1));
      const t = TOOLS.find((x) => x.k.toLowerCase() === lk); if (t) return go(() => setTool(t.id));
      if (/^[1-7]$/.test(k)) return go(() => setInk(INKS[+k - 1][0]));
      if (k === "[" || k === "]") return go(() => setSize(step(k === "]" ? 1 : -1)));
    });

    // the smallest box around everything, with room for the ink's width
    function crop() {
      const u = union(els.map(bboxOf)); if (!u) return null;
      const x = Math.floor(u.x - 4), y = Math.floor(u.y - 4);
      return { x, y, w: Math.max(8, Math.ceil(u.x + u.w + 4) - x), h: Math.max(8, Math.ceil(u.y + u.h + 4) - y) };
    }
    function close() { closed = true; drag = null; ro.disconnect(); root.remove(); }
    function done() {
      if (closed) return; commitText();
      if (els === first) { close(); return opts.onCancel && opts.onCancel(); }
      const b = els.length ? crop() : null, out = b ? { src: "data:image/svg+xml;base64," + toB64(svgOf(els, b)), w: b.w, h: b.h } : null;
      close(); opts.onDone && opts.onDone(out);
    }
    function discard() {
      if (closed) return;
      if (els !== first && Date.now() - armed > 3000) {
        armed = Date.now();
        const b = root.querySelector('[data-d="discard"] .bl'); if (b) { b.textContent = "Click again to discard"; setTimeout(() => { if (b.isConnected) b.textContent = "Discard"; }, 3000); }
        return opts.onRefuse && opts.onRefuse("Click Discard again to throw this drawing away");
      }
      cancelText(); close(); opts.onCancel && opts.onCancel();
    }
    function act(d, v) {
      if (d === "tool") setTool(v); else if (d === "ink") setInk(v); else if (d === "size") setSize(v);
      else if (d === "undo") undo(); else if (d === "redo") redo(); else if (d === "clear") { if (els.length) { sel.clear(); commit([]); } }
      else if (d === "done") done(); else if (d === "discard") discard();
      if (!closed && d !== "done" && d !== "discard") root.focus({ preventScroll: true });
    }

    const ro = new ResizeObserver(() => { if (!closed) { fit(); showSel(); } });
    ro.observe(scroller);
    setH(600); render(); fit(); keys();
    root.focus({ preventScroll: true });
    return { act, done, el: root, dirty: () => els !== first };
  }

  CA.draw = { open, read, isDrawing, INKS, COL };
})();
