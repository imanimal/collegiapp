/* Collegiapp — notes. A note is an Item of kind "note" whose `notes` field holds its document in Collegiapp Markdown
   (docs/NOTES.md): # ## ### headings, paragraphs (a single newline is a line break), - bullets, 1. numbers, - [ ] / - [x]
   checklists (nested by indenting), > quotes, > [!TIP] callouts (NOTE TIP IMPORTANT WARNING), ``` code ```, ---,
   | pipe | tables |, and inline **bold** *italic* <u>underline</u> ~~strike~~ ==highlight== `code` [links](url) ![images](url).
   This file is pure: Markdown in, the editor's HTML out (toHTML), the editor's DOM back to Markdown (fromDOM), and the
   files a note goes out as and comes in from (.md .txt .html .docx, a .json backup). app.js owns the editor and the
   Notes lens; print and PDF go through the page's print view (#printArea). */
(function () {
  const CA = (window.CA = window.CA || {});
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ESCAPABLE = "\\`*_{}[]()#+-.!|~=<>";
  const CALLOUTS = ["note", "tip", "important", "warning"];
  const CALLOUT_LABEL = { note: "Note", tip: "Tip", important: "Important", warning: "Warning" };
  // only web and mail links; anything else (javascript:, data:) becomes plain text
  const safeUrl = (u) => (/^(https?:|mailto:|#)/i.test(String(u).trim()) ? String(u).trim() : "");
  const safeImg = (u) => (/^(https?:|data:image\/(png|jpe?g|gif|webp);)/i.test(String(u).trim()) ? String(u).trim() : "");

  /* ───────────── inline: Markdown text → a small tree ─────────────
     nodes: { t: "text", v } { t: "br" } { t: "code", v } { t: "b"|"i"|"u"|"s"|"mark", c } { t: "a", href, c } { t: "img", src, alt } */
  const DELIMS = [["**", "b"], ["__", "b"], ["~~", "s"], ["==", "mark"], ["*", "i"], ["_", "i"]];
  const isWord = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
  const isSpace = (c) => !c || /\s/.test(c);
  function codeEnd(s, i) { let k = i; while (s[k] === "`") k++; const run = s.slice(i, k), end = s.indexOf(run, k); return end > k - 1 && end >= k ? { k, end, run } : null; }
  // [text](url) starting at i (s[i] === "["): the bracket may hold brackets of its own, the url balanced parentheses
  function linkAt(s, i) {
    let depth = 0, j = i;
    for (; j < s.length; j++) {
      if (s[j] === "\\") { j++; continue; }
      if (s[j] === "[") depth++;
      else if (s[j] === "]" && --depth === 0) break;
    }
    if (j >= s.length || s[j + 1] !== "(") return null;
    let p = 0, k = j + 1;
    for (; k < s.length; k++) { if (s[k] === "(") p++; else if (s[k] === ")" && --p === 0) break; }
    if (k >= s.length) return null;
    const url = s.slice(j + 2, k).trim().replace(/\s+"[^"]*"$/, "");
    return { text: s.slice(i + 1, j), url, end: k + 1 };
  }
  const canOpen = (s, i, d) => !isSpace(s[i + d.length]) && (d[0] !== "_" || !isWord(s[i - 1]));
  // the closer of delimiter d from j: not after a space, `_` not inside a word, skipping escapes, code and nested pairs
  function findClose(s, j, d) {
    while (j < s.length) {
      const c = s[j];
      if (c === "\\") { j += 2; continue; }
      if (c === "`") { const m = codeEnd(s, j); if (m) { j = m.end + m.run.length; continue; } }
      if (s.startsWith(d, j) && !isSpace(s[j - 1]) && (d[0] !== "_" || !isWord(s[j + d.length])) && !(d === "*" && s[j + 1] === "*" && s[j + 2] !== "*")) return j;
      // a nested pair of the other emphasis is skipped whole, so *a **b** c* finds its own closer
      const other = d === "*" ? "**" : d === "**" ? "*" : null;
      if (other && s.startsWith(other, j) && (other === "*" ? s[j + 1] !== "*" : true) && canOpen(s, j, other)) {
        const e = findClose(s, j + other.length, other);
        if (e > j) { j = e + other.length; continue; }
      }
      j++;
    }
    return -1;
  }
  function inline(s) {
    const out = []; let buf = "", i = 0;
    const text = () => { if (buf) { out.push({ t: "text", v: buf }); buf = ""; } };
    const push = (n) => { text(); out.push(n); };
    while (i < s.length) {
      const c = s[i];
      if (c === "\\" && ESCAPABLE.includes(s[i + 1] || "\0")) { buf += s[i + 1]; i += 2; continue; }
      if (c === "\n") { push({ t: "br" }); i++; continue; }
      if (c === "`") {
        const m = codeEnd(s, i);
        if (m) { let v = s.slice(m.k, m.end); if (/^ .* $/.test(v) && v.trim()) v = v.slice(1, -1); push({ t: "code", v }); i = m.end + m.run.length; continue; }
        let k = i; while (s[k] === "`") k++; buf += s.slice(i, k); i = k; continue;
      }
      if (c === "!" && s[i + 1] === "[") { const m = linkAt(s, i + 1); if (m && safeImg(m.url)) { push({ t: "img", src: safeImg(m.url), alt: m.text }); i = m.end; continue; } }
      if (c === "[") { const m = linkAt(s, i); if (m) { const href = safeUrl(m.url); if (href) { push({ t: "a", href, c: inline(m.text) }); i = m.end; continue; } } }
      if (c === "<") {
        if (s.startsWith("<u>", i)) { const e = s.indexOf("</u>", i + 3); if (e > i + 3) { push({ t: "u", c: inline(s.slice(i + 3, e)) }); i = e + 4; continue; } }
        const m = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/i.exec(s.slice(i)); if (m) { push({ t: "a", href: m[1], c: [{ t: "text", v: m[1] }] }); i += m[0].length; continue; }
        if (s.startsWith("<br>", i) || s.startsWith("<br/>", i)) { push({ t: "br" }); i += s.startsWith("<br>", i) ? 4 : 5; continue; }
      }
      let hit = false;
      for (const [d, t] of DELIMS) {
        if (!s.startsWith(d, i) || !canOpen(s, i, d)) continue;
        if (d === "*" && s[i + 1] === "*") continue;
        const e = findClose(s, i + d.length, d);
        if (e > i + d.length) { push({ t, c: inline(s.slice(i + d.length, e)) }); i = e + d.length; hit = true; break; }
      }
      if (hit) continue;
      if ((c === "h" || c === "H") && (i === 0 || /[\s(]/.test(s[i - 1]))) {
        const m = /^https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"*_~=]/i.exec(s.slice(i));
        if (m) { push({ t: "a", href: m[0], c: [{ t: "text", v: m[0] }], bare: true }); i += m[0].length; continue; }
      }
      buf += c; i++;
    }
    text();
    return out;
  }
  const TAGS = { b: "strong", i: "em", u: "u", s: "s", mark: "mark" };
  function inlineHTML(nodes) {
    return nodes.map((n) => n.t === "text" ? esc(n.v) : n.t === "br" ? "<br>" : n.t === "code" ? `<code>${esc(n.v)}</code>`
      : n.t === "a" ? `<a href="${esc(n.href)}" rel="noopener">${inlineHTML(n.c)}</a>` : n.t === "img" ? `<img src="${esc(n.src)}" alt="${esc(n.alt)}">`
      : `<${TAGS[n.t]}>${inlineHTML(n.c)}</${TAGS[n.t]}>`).join("");
  }
  function inlineText(nodes) {
    return nodes.map((n) => n.t === "text" || n.t === "code" ? n.v : n.t === "br" ? "\n" : n.t === "img" ? n.alt : inlineText(n.c)).join("");
  }

  /* ───────────── blocks: Markdown → a list of blocks ─────────────
     { t: "h", level, text } { t: "p", text } { t: "list", kind: "ul"|"ol"|"todo", start, items: [{ text, done, sub: [list] }] }
     { t: "quote", paras: [text] } { t: "callout", kind, paras } { t: "code", lang, v } { t: "hr" } { t: "table", head, align, rows } */
  const RE = {
    fence: /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/, h: /^(#{1,6})\s+(.*?)\s*#*\s*$/, hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
    li: /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/, quote: /^\s*>\s?/, tsep: /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/,
  };
  const indentOf = (s) => { let n = 0; for (const ch of s) { if (ch === " ") n++; else if (ch === "\t") n += 4; else break; } return n; };
  const startsBlock = (line, next) => RE.fence.test(line) || RE.h.test(line) || RE.hr.test(line) || RE.li.test(line) || RE.quote.test(line) || (line.includes("|") && next != null && RE.tsep.test(next) && next.includes("-"));
  const cells = (line) => { let s = line.trim(); if (s.startsWith("|")) s = s.slice(1); if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1); const out = []; let cur = ""; for (let i = 0; i < s.length; i++) { if (s[i] === "\\" && s[i + 1] === "|") { cur += "\\|"; i++; } else if (s[i] === "|") { out.push(cur.trim()); cur = ""; } else cur += s[i]; } out.push(cur.trim()); return out; };
  function parse(md) {
    const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n"), out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;
      if ((m = RE.fence.exec(line))) {
        const close = m[1][0], len = m[1].length, body = []; i++;
        while (i < lines.length && !(new RegExp("^\\s*\\" + close + "{" + len + ",}\\s*$").test(lines[i]))) body.push(lines[i++]);
        i++; out.push({ t: "code", lang: m[2] || "", v: body.join("\n") }); continue;
      }
      if ((m = RE.h.exec(line))) { out.push({ t: "h", level: Math.min(3, m[1].length), text: m[2] }); i++; continue; }
      if (RE.hr.test(line) && !RE.li.test(line.replace(/^\s*[-*]\s+[-*]/, "x"))) { out.push({ t: "hr" }); i++; continue; }
      if (RE.hr.test(line)) { out.push({ t: "hr" }); i++; continue; }
      if (RE.quote.test(line)) {
        const body = [];
        while (i < lines.length && RE.quote.test(lines[i])) body.push(lines[i++].replace(RE.quote, ""));
        const cm = /^\[!(note|tip|important|warning|caution)\]\s*(.*)$/i.exec(body[0] || "");
        if (cm) body[0] = cm[2];
        const paras = body.join("\n").split(/\n\s*\n/).map((p) => p.replace(/^\n+|\n+$/g, "")).filter((p) => p.trim());
        out.push(cm ? { t: "callout", kind: cm[1].toLowerCase() === "caution" ? "warning" : cm[1].toLowerCase(), paras } : { t: "quote", paras });
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && RE.tsep.test(lines[i + 1]) && lines[i + 1].includes("-")) {
        const head = cells(line), align = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : /^:-/.test(c) ? "left" : ""));
        const rows = []; i += 2;
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) { const r = cells(lines[i++]); while (r.length < head.length) r.push(""); rows.push(r.slice(0, head.length)); }
        out.push({ t: "table", head, align: head.map((_, k) => align[k] || ""), rows }); continue;
      }
      if (RE.li.test(line)) { const r = parseList(lines, i); out.push(r.list); i = r.i; continue; }
      const para = [line.replace(/^\s+/, "")]; i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++].replace(/^\s+/, ""));
      out.push({ t: "p", text: para.join("\n") });
    }
    return out;
  }
  // A list and everything nested in it. An item's children are the lines indented past its marker; a line indented
  // under an item without a marker continues its text (a line break). One blank line between items keeps the list.
  function parseList(lines, i) {
    const first = RE.li.exec(lines[i]), base = indentOf(first[1]);
    const kindOf = (mk, rest) => (/^\[( |x|X)\]\s/.test(rest + " ") && /^[-*+]$/.test(mk) ? "todo" : /^\d/.test(mk) ? "ol" : "ul");
    const list = { t: "list", kind: kindOf(first[2], first[3]), start: /^\d/.test(first[2]) ? parseInt(first[2], 10) : 1, items: [] };
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        const nx = lines[i + 1];
        if (nx != null && ((RE.li.test(nx) && indentOf(nx) >= base) || (nx.trim() && indentOf(nx) > base))) { i++; continue; }
        break;
      }
      const m = RE.li.exec(line), ind = indentOf(line);
      if (m && ind === base) {
        if (kindOf(m[2], m[3]) === "ol" !== (list.kind === "ol")) break; // a bullet after numbers starts a new list
        let text = m[3], done = null;
        const t = /^\[( |x|X)\]\s?(.*)$/.exec(text);
        if (t && /^[-*+]$/.test(m[2])) { done = t[1] !== " "; text = t[2]; }
        list.items.push({ text, done: list.kind === "todo" ? !!done : null, sub: [], w: m[1].length + m[2].length + 1 });
        i++; continue;
      }
      const cur = list.items[list.items.length - 1];
      if (!cur || ind <= base && !m) break;
      if (m && ind > base) { const r = parseList(lines, i); cur.sub.push(r.list); i = r.i; continue; }
      if (ind > base) { cur.text += "\n" + line.trim(); i++; continue; }
      break;
    }
    return { list, i };
  }

  /* ───────────── blocks → the editor's HTML ───────────── */
  function listHTML(l) {
    const tag = l.kind === "ol" ? "ol" : "ul", attr = l.kind === "todo" ? ' class="todo"' : l.kind === "ol" && l.start !== 1 ? ` start="${l.start}"` : "";
    return `<${tag}${attr}>${l.items.map((it) => `<li${l.kind === "todo" && it.done ? ' data-done="1"' : ""}>${inlineHTML(inline(it.text)) || "<br>"}${it.sub.map(listHTML).join("")}</li>`).join("")}</${tag}>`;
  }
  const paraHTML = (p) => `<p>${inlineHTML(inline(p)) || "<br>"}</p>`;
  function blockHTML(b) {
    switch (b.t) {
      case "h": return `<h${b.level}>${inlineHTML(inline(b.text)) || "<br>"}</h${b.level}>`;
      case "p": return paraHTML(b.text);
      case "list": return listHTML(b);
      case "quote": return `<blockquote>${(b.paras.length ? b.paras : [""]).map(paraHTML).join("")}</blockquote>`;
      case "callout": return `<div class="callout" data-kind="${b.kind}">${(b.paras.length ? b.paras : [""]).map(paraHTML).join("")}</div>`;
      case "code": return `<pre${b.lang ? ` data-lang="${esc(b.lang)}"` : ""}><code>${esc(b.v) || "<br>"}</code></pre>`;
      case "hr": return "<hr>";
      case "table": {
        const st = (k) => (b.align[k] ? ` style="text-align:${b.align[k]}"` : "");
        return `<table><thead><tr>${b.head.map((c, k) => `<th${st(k)}>${inlineHTML(inline(c)) || "<br>"}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c, k) => `<td${st(k)}>${inlineHTML(inline(c)) || "<br>"}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      }
    }
    return "";
  }
  const toHTML = (md) => parse(md).map(blockHTML).join("") || "<p><br></p>";

  /* ───────────── the editor's DOM (or pasted HTML) → Markdown ───────────── */
  const BLOCK = /^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|HR|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|NAV|FIGURE|FIGCAPTION|DL|DT|DD|ADDRESS|DETAILS|SUMMARY)$/;
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IFRAME|OBJECT|SVG|CANVAS|HEAD|TITLE|META|LINK|BUTTON|INPUT|SELECT|TEXTAREA)$/;
  // text that would read as Markdown is escaped where it would, so what you typed comes back as typed
  function escText(s) {
    return s.replace(/\\(?=[\\`*_{}\[\]()#+\-.!|~=<>])/g, "\\\\").replace(/[*`[]/g, "\\$&").replace(/~~/g, "\\~~").replace(/==/g, "\\==")
      .replace(/<(\/?u>|br\/?>|https?:)/gi, "\\<$1").replace(/(^|[^\p{L}\p{N}\\])_|_(?=[^\p{L}\p{N}]|$)/gu, (m, a) => (a != null ? a + "\\_" : "\\_"));
  }
  function lineStart(s) { return s.split("\n").map((l) => l.replace(/^(\s*)(#{1,6}\s|>|[-+]\s|\d{1,9}[.)]\s|\||`{3,}|~{3,}|---)/, (m, sp, x) => sp + "\\" + x)).join("\n"); }
  function styleFmt(el) {
    const st = el.getAttribute && el.getAttribute("style"); if (!st) return {};
    const w = /font-weight\s*:\s*(\d+|bold)/i.exec(st), fs = /font-style\s*:\s*italic/i.test(st), td = /text-decoration[^;]*?(underline|line-through)/i.exec(st);
    return { b: !!w && (w[1] === "bold" || +w[1] >= 600), i: fs, u: !!td && td[1] === "underline", s: !!td && td[1] === "line-through" };
  }
  function wrap(inner, open, close) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    return m[2] ? m[1] + open + m[2] + (close == null ? open : close) + m[3] : inner;
  }
  function inlineMD(node, on) {
    on = on || {};
    let out = "";
    for (const n of node.childNodes) {
      // (the editor leaves a zero-width space after a mark it formats as you type, so the caret lands outside it)
      if (n.nodeType === 3) { out += escText(n.nodeValue.replace(/[\t ]*\n[\t ]*/g, " ").replace(/\u00a0/g, " ").replace(/\u200b/g, "")); continue; }
      if (n.nodeType !== 1 || SKIP.test(n.tagName)) continue;
      const tag = n.tagName;
      if (tag === "BR") { out += "\n"; continue; }
      if (tag === "IMG") { const src = safeImg(n.getAttribute("src") || ""); if (src) out += `![${(n.getAttribute("alt") || "").replace(/[\[\]]/g, "")}](${src})`; continue; }
      if (tag === "CODE" || tag === "KBD" || tag === "SAMP" || tag === "TT") {
        const v = n.textContent.replace(/\n/g, " "); if (!v) continue;
        const runs = (v.match(/`+/g) || []).map((r) => r.length), tick = "`".repeat(runs.length ? Math.max(...runs) + 1 : 1), pad = /^`|`$/.test(v) ? " " : "";
        out += tick + pad + v + pad + tick; continue;
      }
      if (tag === "A") {
        const href = safeUrl(n.getAttribute("href") || ""), inner = inlineMD(n, on);
        if (!href || !inner.trim()) { out += inner; continue; }
        out += inner.trim() === href || inner.trim() === escText(href) ? href : wrap(inner, "[", "](" + href.replace(/[()\s]/g, encodeURIComponent) + ")"); continue;
      }
      const st = styleFmt(n), f = {
        b: tag === "B" || tag === "STRONG" || st.b, i: tag === "I" || tag === "EM" || st.i, u: tag === "U" || tag === "INS" || st.u,
        s: tag === "S" || tag === "STRIKE" || tag === "DEL" || st.s, mark: tag === "MARK",
      };
      if (/^SPAN$|^FONT$/.test(tag) && /font-weight\s*:\s*(normal|[1-5]00)/i.test(n.getAttribute("style") || "")) { /* Google Docs wraps everything in a bold-off span */ }
      const nest = Object.assign({}, on);
      for (const k in f) if (f[k] && !on[k]) nest[k] = true;
      let inner = inlineMD(n, nest);
      if (f.mark && !on.mark) inner = wrap(inner, "==");
      if (f.s && !on.s) inner = wrap(inner, "~~");
      if (f.u && !on.u) inner = wrap(inner, "<u>", "</u>");
      if (f.i && !on.i) inner = wrap(inner, "*");
      if (f.b && !on.b) inner = wrap(inner, "**");
      out += inner;
    }
    // neighbours with the same mark run together: **a****b** reads as **ab**
    return out.replace(/\*\*\*\*|~~~~|====/g, "").replace(/<\/u><u>/g, "");
  }
  const isBlock = (n) => n.nodeType === 1 && (BLOCK.test(n.tagName) || n.classList.contains("callout"));
  const clean = (s) => s.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/^\n+|\n+$/g, "").replace(/^[ \t]+|[ \t]+$/g, "");
  // the inline runs of a container; its block children are handed to `onBlock` in order
  function runs(el, onBlock) {
    let buf = [], out = [];
    const flush = () => { if (buf.length) { const tmp = document.createElement("span"); buf.forEach((n) => tmp.appendChild(n.cloneNode(true))); const t = clean(inlineMD(tmp)); if (t) out.push({ t: "p", md: t }); buf = []; } };
    for (const n of el.childNodes) {
      if (n.nodeType === 1 && SKIP.test(n.tagName)) continue;
      if (isBlock(n)) { flush(); out.push(...onBlock(n)); } else buf.push(n);
    }
    flush();
    return out;
  }
  const fence = (v) => { const runs = (v.match(/^`{3,}/gm) || []).map((r) => r.length); return "`".repeat(Math.max(3, ...runs.map((r) => r + 1))); };
  function listMD(el, depth) {
    const ol = el.tagName === "OL", todo = el.classList.contains("todo") || el.dataset.type === "todo" || [...el.children].some((li) => li.classList && li.classList.contains("task"));
    let n = ol ? parseInt(el.getAttribute("start") || "1", 10) || 1 : 1;
    const lines = [];
    for (const li of el.children) {
      if (li.tagName === "UL" || li.tagName === "OL") { const sub = listMD(li, depth); if (lines.length) lines[lines.length - 1] += "\n" + sub.replace(/^/gm, "  "); else lines.push(sub); continue; }
      if (li.tagName !== "LI") continue;
      const box = li.querySelector(":scope > input[type=checkbox]");
      const done = li.dataset.done === "1" || li.getAttribute("aria-checked") === "true" || (!!box && box.checked);
      const marker = ol ? `${n++}. ` : todo || box ? `- [${done ? "x" : " "}] ` : "- ", pad = " ".repeat(ol ? marker.length : 2);
      const parts = runs(li, (b) => (b.tagName === "UL" || b.tagName === "OL" ? [{ t: "sub", md: listMD(b, depth + 1) }] : blocksOf(b)));
      let head = "", rest = [];
      parts.forEach((p, k) => {
        const md = p.t === "sub" ? p.md : p.md;
        if (k === 0 && p.t !== "sub") head = md.replace(/\n/g, "\n" + pad);
        else rest.push(md.replace(/^/gm, pad));
      });
      lines.push(marker + head + (rest.length ? "\n" + rest.join("\n") : ""));
    }
    return lines.join("\n");
  }
  function cellMD(el) { return clean(inlineMD(el)).replace(/\n/g, "<br>").replace(/\|/g, "\\|") || " "; }
  function tableMD(el) {
    const rows = [...el.querySelectorAll("tr")].filter((tr) => tr.closest("table") === el);
    if (!rows.length) return "";
    const grid = rows.map((tr) => [...tr.children].filter((c) => /^T[DH]$/.test(c.tagName)));
    const w = Math.max(...grid.map((r) => r.length));
    const al = grid[0].map((c) => (c.style && c.style.textAlign) || c.getAttribute("align") || "");
    const line = (r) => "| " + Array.from({ length: w }, (_, k) => (r[k] ? cellMD(r[k]) : " ")).join(" | ") + " |";
    const sep = "| " + Array.from({ length: w }, (_, k) => (al[k] === "center" ? ":---:" : al[k] === "right" ? "---:" : al[k] === "left" ? ":---" : "---")).join(" | ") + " |";
    return [line(grid[0]), sep, ...grid.slice(1).map(line)].join("\n");
  }
  function quoteLines(md) { return md.split("\n").map((l) => (l ? "> " + l : ">")).join("\n"); }
  // one block element → its Markdown blocks
  function blocksOf(el) {
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) { const t = clean(inlineMD(el)).replace(/\n/g, " "); return t ? [{ t: "h", md: "#".repeat(Math.min(3, +tag[1])) + " " + t }] : []; }
    if (tag === "UL" || tag === "OL") return [{ t: "list", md: listMD(el, 0) }];
    if (tag === "HR") return [{ t: "hr", md: "---" }];
    if (tag === "PRE") {
      const v = (el.innerText != null && el.isConnected ? el.innerText : el.textContent).replace(/\n$/, ""), f = fence(v);
      return [{ t: "code", md: f + (el.dataset.lang || "") + "\n" + v + "\n" + f }];
    }
    if (tag === "TABLE") { const t = tableMD(el); return t ? [{ t: "table", md: t }] : []; }
    if (tag === "BLOCKQUOTE" || (tag === "DIV" && el.classList.contains("callout"))) {
      const inner = runs(el, blocksOf).map((b) => b.md).join("\n\n");
      const kind = el.classList.contains("callout") && CALLOUTS.includes(el.dataset.kind) ? el.dataset.kind : "";
      return [{ t: "quote", md: kind ? "> [!" + kind.toUpperCase() + "]\n" + quoteLines(inner) : quoteLines(inner || " ") }];
    }
    return runs(el, blocksOf).map((b) => (b.t === "p" ? { t: "p", md: lineStart(b.md) } : b));
  }
  function fromDOM(root) { return runs(root, blocksOf).map((b) => (b.t === "p" ? lineStart(b.md) : b.md)).filter((s) => s.trim()).join("\n\n"); }
  function fromHTML(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    // Word and Google Docs: their headings and lists are styled paragraphs, their bold a span
    doc.querySelectorAll("p[class*=Heading], p[class*=heading]").forEach((p) => { const m = /(\d)/.exec(p.className); if (m) { const h = doc.createElement("h" + Math.min(3, +m[1])); h.innerHTML = p.innerHTML; p.replaceWith(h); } });
    doc.querySelectorAll("b[id^=docs-internal-guid]").forEach((b) => b.replaceWith(...b.childNodes));
    return fromDOM(doc.body);
  }

  /* ───────────── reading a note: plain text, checklist, outline, stats ───────────── */
  function toText(md) {
    return parse(md).map((b) => {
      if (b.t === "h" || b.t === "p") return inlineText(inline(b.text));
      if (b.t === "code") return b.v;
      if (b.t === "hr") return "———";
      if (b.t === "quote" || b.t === "callout") return b.paras.map((p) => inlineText(inline(p))).join("\n");
      if (b.t === "table") return [b.head, ...b.rows].map((r) => r.map((c) => inlineText(inline(c))).join("\t")).join("\n");
      const walk = (l, d) => l.items.map((it, k) => "  ".repeat(d) + (l.kind === "todo" ? (it.done ? "☑ " : "☐ ") : l.kind === "ol" ? l.start + k + ". " : "• ") + inlineText(inline(it.text)) + it.sub.map((s) => "\n" + walk(s, d + 1)).join("")).join("\n");
      return walk(b, 0);
    }).join("\n\n");
  }
  function checklist(md) {
    let done = 0, total = 0;
    for (const l of String(md || "").split("\n")) { const m = /^\s*[-*+]\s+\[( |x|X)\]/.exec(l); if (m) { total++; if (m[1] !== " ") done++; } }
    return { done, total };
  }
  function outline(md) { return parse(md).filter((b) => b.t === "h").map((b) => ({ level: b.level, text: inlineText(inline(b.text)) })); }
  function stats(md) {
    const t = toText(md), words = (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    return { words, chars: t.replace(/\s/g, "").length, minutes: Math.max(1, Math.round(words / 230)) };
  }
  // a first line for a card: the first paragraph's text, or the first heading's when the note is only headings
  function preview(md, n) { const t = toText(md).replace(/\s+/g, " ").trim(); return t.length > (n || 160) ? t.slice(0, n || 160).replace(/\s\S*$/, "") + "…" : t; }
  // the title a pasted or imported document gives itself: a leading # heading, else its first line
  function titleOf(md) {
    const b = parse(md)[0]; if (!b) return "";
    return (b.t === "h" || b.t === "p" ? inlineText(inline(b.text)).split("\n")[0] : "").trim().slice(0, 120);
  }
  // a leading heading that only repeats the title is dropped (the title is the note's own field)
  function withoutTitle(md, title) {
    const m = /^\s*#{1,3}\s+(.*)\n?/.exec(md);
    return m && m[1].trim().toLowerCase() === String(title || "").trim().toLowerCase() ? md.slice(m[0].length).replace(/^\n+/, "") : md;
  }

  /* ───────────── templates (the New note menu) ───────────── */
  const TEMPLATES = [
    { id: "blank", label: "Blank note", title: "", body: "" },
    { id: "list", label: "Checklist", title: "", body: "- [ ] " },
    { id: "lecture", label: "Lecture notes", title: "Lecture · ", body: "> [!NOTE]\n> Course · week · topic\n\n## Key ideas\n\n- \n\n## Details\n\n\n## Questions\n\n- [ ] \n\n## Summary\n\n" },
    { id: "cornell", label: "Cornell notes", title: "Cornell · ", body: "| Cues | Notes |\n| --- | --- |\n|  |  |\n|  |  |\n|  |  |\n\n## Summary\n\n" },
    { id: "study", label: "Study guide", title: "Study guide · ", body: "## Topics\n\n- [ ] \n\n## Formulas and definitions\n\n| Term | Meaning |\n| --- | --- |\n|  |  |\n\n## Practice problems\n\n1. \n\n> [!TIP]\n> Go to office hours with the ones you miss.\n" },
    { id: "meeting", label: "Meeting notes", title: "Meeting · ", body: "**Who:** \n**When:** \n\n## Agenda\n\n- \n\n## Notes\n\n\n## Action items\n\n- [ ] \n" },
    { id: "ideas", label: "App ideas", title: "Ideas · ", body: "## Bugs\n\n- [ ] \n\n## Features\n\n- [ ] \n\n## Polish\n\n- [ ] \n\n## Someday\n\n- \n" },
    { id: "project", label: "Project plan", title: "Project · ", body: "## Goal\n\n\n## Milestones\n\n| Milestone | Due | Done |\n| --- | --- | --- |\n|  |  |  |\n\n## Tasks\n\n- [ ] \n\n## Links\n\n- \n" },
    { id: "week", label: "Weekly plan", title: "Week of ", body: "## Must do\n\n- [ ] \n\n## Should do\n\n- [ ] \n\n## Could do\n\n- [ ] \n\n## Notes\n\n" },
    { id: "journal", label: "Journal", title: "", body: "## How it went\n\n\n## What I learned\n\n\n## Tomorrow\n\n- [ ] \n" },
  ];

  /* ───────────── files out ───────────── */
  const fileName = (title, ext) => (String(title || "Note").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Note") + "." + ext;
  function frontMatter(it, courseCode) {
    const lines = [];
    if (it.tags && it.tags.length) lines.push("tags: [" + it.tags.map((t) => JSON.stringify(t)).join(", ") + "]");
    if (courseCode) lines.push("course: " + JSON.stringify(courseCode));
    if (it.created) lines.push("created: " + new Date(it.created).toISOString());
    return lines.length ? "---\n" + lines.join("\n") + "\n---\n\n" : "";
  }
  function toMarkdownFile(it, courseCode) { return frontMatter(it, courseCode) + "# " + (it.title || "Note") + "\n\n" + (it.notes || "") + "\n"; }
  function toTextFile(it) { return (it.title || "Note") + "\n" + "=".repeat(Math.min(60, (it.title || "Note").length)) + "\n\n" + toText(it.notes || "") + "\n"; }
  // the styles a note prints and exports with: readable on paper, its callouts and code shaded, no app chrome
  const DOC_CSS = `body{font:11pt/1.55 "Space Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;color:#1b1915;max-width:46em;margin:2.2em auto;padding:0 1.2em}
h1{font-size:1.9em;line-height:1.2;margin:0 0 .25em}h2{font-size:1.4em;margin:1.4em 0 .4em}h3{font-size:1.15em;margin:1.2em 0 .3em}.meta{color:#6a645a;font-size:.9em;margin:0 0 1.6em}
p{margin:.55em 0}ul,ol{margin:.4em 0;padding-left:1.6em}li{margin:.15em 0}ul.todo{list-style:none;padding-left:.3em}ul.todo>li{position:relative;padding-left:1.6em}
ul.todo>li::before{content:"";position:absolute;left:0;top:.28em;width:.85em;height:.85em;border:1.5px solid #4a453c;border-radius:3px}ul.todo>li[data-done="1"]::before{background:#4a453c;box-shadow:inset 0 0 0 2px #fff}ul.todo>li[data-done="1"]{color:#6a645a;text-decoration:line-through}
blockquote{margin:.8em 0;padding:.1em 1em;border-left:3px solid #d3ccbd;color:#4a453c}.callout{margin:.9em 0;padding:.5em 1em;border-radius:8px;border-left:4px solid #3b6fd8;background:#eef2fb}
.callout[data-kind=tip]{border-color:#2f8f5b;background:#eaf6ef}.callout[data-kind=important]{border-color:#7b4fd0;background:#f2edfb}.callout[data-kind=warning]{border-color:#c4581f;background:#fbf0e8}
.callout::before{content:attr(data-label);display:block;font-weight:700;font-size:.85em;margin-top:.3em}code{font:.9em "Space Mono",ui-monospace,Menlo,Consolas,monospace;background:#efebe2;padding:.05em .3em;border-radius:4px}
pre{background:#f3f0e8;border:1px solid #e1dbcf;border-radius:8px;padding:.8em 1em;overflow:auto;white-space:pre-wrap}pre code{background:none;padding:0}mark{background:#ffe27a;color:inherit;padding:0 .1em}
table{border-collapse:collapse;margin:.8em 0;width:100%}th,td{border:1px solid #d3ccbd;padding:.35em .6em;vertical-align:top;text-align:left}th{background:#f3f0e8}hr{border:0;border-top:1px solid #d3ccbd;margin:1.4em 0}a{color:#2a5bc4}img{max-width:100%}`;
  // the same styles scoped to the page's print view (#printArea, core.css), which print and PDF go through
  const PRINT_CSS = DOC_CSS.replace(/(^|\})\s*([^{}]+)\{/g, (m, close, sel) => close + sel.split(",").map((x) => (x.trim() === "body" ? "#printArea .doc" : "#printArea .doc " + x.trim())).join(",") + "{");
  // callout labels are a CSS attr() in exports, so the editor's own markup can be printed as is
  const labelCallouts = (html) => html.replace(/<div class="callout" data-kind="(\w+)">/g, (m, k) => `<div class="callout" data-kind="${k}" data-label="${CALLOUT_LABEL[k] || ""}">`);
  function docHTML(it, meta) { return `<h1>${esc(it.title || "Note")}</h1>${meta ? `<p class="meta">${esc(meta)}</p>` : ""}${labelCallouts(toHTML(it.notes || ""))}`; }
  function toHTMLFile(it, meta) {
    return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(it.title || "Note")}</title><style>${DOC_CSS}</style></head><body>${docHTML(it, meta)}</body></html>\n`;
  }

  /* ── .docx: WordprocessingML in a zip (stored, no compression), from the blocks above ── */
  const xe = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  function docxRuns(nodes, f, ctx) {
    let out = "";
    for (const n of nodes) {
      if (n.t === "text" || n.t === "code") {
        // WordprocessingML wants rPr children in schema order: b, i, strike, highlight, u
        const pr = (f.b ? "<w:b/>" : "") + (f.i ? "<w:i/>" : "") + (f.s ? "<w:strike/>" : "") + (f.mark ? '<w:highlight w:val="yellow"/>' : "") + (f.u ? '<w:u w:val="single"/>' : "");
        const style = n.t === "code" ? '<w:rStyle w:val="CodeChar"/>' : f.link ? '<w:rStyle w:val="Hyperlink"/>' : "";
        out += `<w:r>${style || pr ? `<w:rPr>${style}${pr}</w:rPr>` : ""}<w:t xml:space="preserve">${xe(n.v)}</w:t></w:r>`;
      } else if (n.t === "br") out += "<w:r><w:br/></w:r>";
      else if (n.t === "img") out += docxRuns([{ t: "text", v: n.alt ? `[${n.alt}]` : "[image]" }], f, ctx);
      else if (n.t === "a") { const id = ctx.link(n.href); out += `<w:hyperlink r:id="${id}" w:history="1">${docxRuns(n.c, Object.assign({}, f, { link: true }), ctx)}</w:hyperlink>`; }
      else out += docxRuns(n.c, Object.assign({}, f, { [n.t]: true }), ctx);
    }
    return out;
  }
  function toDocx(it) {
    const links = [], nums = [];
    const ctx = { link: (href) => { links.push(href); return "rIdL" + links.length; } };
    const para = (text, ppr, f) => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${docxRuns(inline(text), f || {}, ctx)}</w:p>`;
    let body = `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${xe(it.title || "Note")}</w:t></w:r></w:p>`;
    const list = (l, lvl) => {
      let numId = null;
      if (l.kind === "ol") { nums.push(l.start); numId = 2 + nums.length; } // 1 bullets, 2 is unused, 3+ one per numbered list
      for (const item of l.items) {
        const ind = `<w:ind w:left="${360 + 360 * (lvl + 1)}" w:hanging="360"/>`;
        if (l.kind === "todo") body += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/>${ind}</w:pPr><w:r><w:t xml:space="preserve">${item.done ? "☑" : "☐"}\t</w:t></w:r>${docxRuns(inline(item.text), item.done ? { s: true } : {}, ctx)}</w:p>`;
        else body += para(item.text, `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${Math.min(lvl, 8)}"/><w:numId w:val="${numId || 1}"/></w:numPr>`);
        item.sub.forEach((s) => list(s, lvl + 1));
      }
    };
    for (const b of parse(it.notes || "")) {
      if (b.t === "h") body += para(b.text, `<w:pStyle w:val="Heading${b.level}"/>`);
      else if (b.t === "p") body += para(b.text);
      else if (b.t === "list") list(b, 0);
      else if (b.t === "quote") b.paras.forEach((p) => (body += para(p, '<w:pStyle w:val="Quote"/>')));
      else if (b.t === "callout") {
        const col = { note: "3B6FD8", tip: "2F8F5B", important: "7B4FD0", warning: "C4581F" }[b.kind], fill = { note: "EEF2FB", tip: "EAF6EF", important: "F2EDFB", warning: "FBF0E8" }[b.kind];
        const ppr = `<w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="${col}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/><w:ind w:left="240"/>`;
        body += `<w:p><w:pPr>${ppr}</w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${CALLOUT_LABEL[b.kind]}</w:t></w:r></w:p>`;
        b.paras.forEach((p) => (body += para(p, ppr)));
      } else if (b.t === "code") b.v.split("\n").forEach((l) => (body += `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr><w:r><w:t xml:space="preserve">${xe(l)}</w:t></w:r></w:p>`));
      else if (b.t === "hr") body += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D3CCBD"/></w:pBdr></w:pPr></w:p>';
      else if (b.t === "table") {
        const w = Math.floor(9000 / b.head.length), jc = (k) => (b.align[k] ? `<w:jc w:val="${b.align[k] === "right" ? "right" : b.align[k] === "center" ? "center" : "left"}"/>` : "");
        const cell = (c, k, head) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="F3F0E8"/>' : ""}</w:tcPr><w:p>${jc(k) ? `<w:pPr>${jc(k)}</w:pPr>` : ""}${docxRuns(inline(c), head ? { b: true } : {}, ctx)}</w:p></w:tc>`;
        body += `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${b.head.map(() => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`
          + `<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.head.map((c, k) => cell(c, k, true)).join("")}</w:tr>${b.rows.map((r) => `<w:tr>${r.map((c, k) => cell(c, k, false)).join("")}</w:tr>`).join("")}</w:tbl><w:p/>`;
      }
    }
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const font = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>', mono = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>';
    const st = (id, name, ppr, rpr, type) => `<w:style w:type="${type || "paragraph"}" w:styleId="${id}"><w:name w:val="${name}"/>${type === "character" ? "" : '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>'}<w:qFormat/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}</w:style>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
      + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
      + st("Title", "Title", '<w:spacing w:after="240"/>', '<w:b/><w:sz w:val="48"/><w:szCs w:val="48"/>')
      + st("Heading1", "heading 1", '<w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="36"/><w:szCs w:val="36"/>')
      + st("Heading2", "heading 2", '<w:keepNext/><w:spacing w:before="300" w:after="100"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="30"/><w:szCs w:val="30"/>')
      + st("Heading3", "heading 3", '<w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="2"/>', '<w:b/><w:sz w:val="26"/><w:szCs w:val="26"/>')
      + st("Quote", "Quote", '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="D3CCBD"/></w:pBdr><w:ind w:left="360"/>', '<w:color w:val="4A453C"/>')
      + st("ListParagraph", "List Paragraph", '<w:spacing w:after="40"/><w:contextualSpacing/>', "")
      + st("Code", "Code", '<w:shd w:val="clear" w:color="auto" w:fill="F3F0E8"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:contextualSpacing/>', mono + '<w:sz w:val="19"/>')
      + st("CodeChar", "Code Char", "", mono + '<w:shd w:val="clear" w:color="auto" w:fill="EFEBE2"/>', "character")
      + st("Hyperlink", "Hyperlink", "", '<w:color w:val="2A5BC4"/><w:u w:val="single"/>', "character")
      + `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="D3CCBD"/>`).join("")}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
    const lvls = (fmt) => Array.from({ length: 9 }, (_, l) => {
      const f = fmt === "bullet" ? ["•", "◦", "▪"][l % 3] : ["%" + (l + 1) + ".", "%" + (l + 1) + ".", "%" + (l + 1) + "."][l % 3];
      const nf = fmt === "bullet" ? "bullet" : ["decimal", "lowerLetter", "lowerRoman"][l % 3];
      return `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${nf}"/><w:lvlText w:val="${f}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + 360 * l}" w:hanging="360"/></w:pPr></w:lvl>`;
    }).join("");
    const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvls("bullet")}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls("decimal")}</w:abstractNum>`
      + `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>${nums.map((s, k) => `<w:num w:numId="${3 + k}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${s}"/></w:lvlOverride></w:num>`).join("")}</w:numbering>`;
    const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rIdN" Type="${R}/numbering" Target="numbering.xml"/>${links.map((h, k) => `<Relationship Id="rIdL${k + 1}" Type="${R}/hyperlink" Target="${xe(h)}" TargetMode="External"/>`).join("")}</Relationships>`;
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xe(it.title || "Note")}</dc:title><dc:creator>Collegiapp</dc:creator>${it.tags && it.tags.length ? `<cp:keywords>${xe(it.tags.join(", "))}</cp:keywords>` : ""}<dcterms:created xsi:type="dcterms:W3CDTF">${it.created ? new Date(it.created).toISOString().replace(/\.\d+Z$/, "Z") : now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
    return zip([["[Content_Types].xml", types], ["_rels/.rels", rels], ["word/document.xml", doc], ["word/styles.xml", styles], ["word/numbering.xml", numbering], ["word/_rels/document.xml.rels", docRels], ["docProps/core.xml", core]]);
  }
  // A zip of stored (uncompressed) files: local headers, the central directory, the end record.
  let CRC = null;
  function crc32(b) {
    if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    const enc = new TextEncoder(), parts = [], dir = []; let off = 0;
    const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff, dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
    for (const [name, text] of files) {
      const nb = enc.encode(name), data = typeof text === "string" ? enc.encode(text) : text, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, dt, 2], [12, dd, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, nb.length, 2], [28, 0, 2]].forEach(([o, v, n]) => (n === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true)));
      const c = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, dt, 2], [14, dd, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nb.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]].forEach(([o, v, n]) => (n === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true)));
      parts.push(new Uint8Array(h.buffer), nb, data); dir.push(new Uint8Array(c.buffer), nb); off += 30 + nb.length + data.length;
    }
    const size = dir.reduce((n, p) => n + p.length, 0), e = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, off, 4], [20, 0, 2]].forEach(([o, v, n]) => (n === 4 ? e.setUint32(o, v, true) : e.setUint16(o, v, true)));
    const all = parts.concat(dir, [new Uint8Array(e.buffer)]), out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0; for (const p of all) { out.set(p, at); at += p.length; }
    return out;
  }

  /* ───────────── files in ───────────── */
  async function unzip(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = {};
    let e = bytes.length - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("not a zip file");
    let p = v.getUint32(e + 16, true); const n = v.getUint16(e + 10, true), dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nl));
      const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true), raw = bytes.subarray(start, start + csize);
      out[name] = { method, raw };
      p += 46 + nl + xl + cl;
    }
    const read = async (name) => {
      const f = out[name]; if (!f) return null;
      if (f.method === 0) return dec.decode(f.raw);
      if (f.method !== 8 || typeof DecompressionStream === "undefined") throw new Error("this web view can't unpack .docx files");
      const s = new Blob([f.raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return dec.decode(await new Response(s).arrayBuffer());
    };
    return read;
  }
  // .docx → Markdown: headings, lists (bullets or numbers from numbering.xml), checkboxes, bold/italic/underline/strike/
  // highlight, links, tables. Everything else comes in as plain paragraphs.
  async function fromDocx(bytes) {
    const read = await unzip(bytes), xml = (s) => (s ? new DOMParser().parseFromString(s, "application/xml") : null);
    const doc = xml(await read("word/document.xml")); if (!doc) throw new Error("not a Word document");
    const rels = xml(await read("word/_rels/document.xml.rels")), num = xml(await read("word/numbering.xml"));
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main", R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const kids = (el, name) => Array.from(el.childNodes).filter((c) => c.nodeType === 1 && c.namespaceURI === W && (!name || c.localName === name));
    const one = (el, name) => (el ? kids(el, name)[0] : null);
    const val = (el) => (el ? el.getAttributeNS(W, "val") || el.getAttribute("w:val") : null);
    const href = {}; if (rels) for (const r of rels.getElementsByTagName("Relationship")) href[r.getAttribute("Id")] = r.getAttribute("Target");
    const fmtOf = {};
    if (num) {
      const abs = {};
      for (const a of num.getElementsByTagNameNS(W, "abstractNum")) abs[a.getAttributeNS(W, "abstractNumId")] = Object.fromEntries(Array.from(a.getElementsByTagNameNS(W, "lvl")).map((l) => [l.getAttributeNS(W, "ilvl"), val(one(l, "numFmt"))]));
      for (const n of num.getElementsByTagNameNS(W, "num")) fmtOf[n.getAttributeNS(W, "numId")] = abs[val(one(n, "abstractNumId"))] || {};
    }
    const runMD = (r) => {
      const pr = one(r, "rPr"), on = (name) => { const x = pr && one(pr, name); return !!x && val(x) !== "0" && val(x) !== "false" && val(x) !== "none"; };
      let t = "";
      for (const c of kids(r)) { if (c.localName === "t") t += escText(c.textContent); else if (c.localName === "tab") t += " "; else if (c.localName === "br" || c.localName === "cr") t += "\n"; }
      if (!t.trim()) return t;
      if (pr && one(pr, "rStyle") && /code/i.test(val(one(pr, "rStyle")))) return "`" + t.replace(/\\(.)/g, "$1") + "`";
      if (on("highlight")) t = wrap(t, "==");
      if (on("strike")) t = wrap(t, "~~");
      if (on("u")) t = wrap(t, "<u>", "</u>");
      if (on("i")) t = wrap(t, "*");
      if (on("b")) t = wrap(t, "**");
      return t;
    };
    const parMD = (p) => kids(p).map((c) => c.localName === "r" ? runMD(c) : c.localName === "hyperlink" ? (() => { const id = c.getAttributeNS(R, "id"), inner = kids(c, "r").map(runMD).join(""); return id && href[id] ? `[${inner}](${href[id]})` : inner; })() : "").join("").replace(/\*\*\*\*|~~~~|====/g, "");
    const out = []; let olCount = {};
    for (const el of kids(one(doc.documentElement, "body"))) {
      if (el.localName === "tbl") {
        const rows = kids(el, "tr").map((tr) => kids(tr, "tc").map((tc) => kids(tc, "p").map(parMD).join("<br>").replace(/\|/g, "\\|").trim() || " "));
        if (rows.length) { const w = Math.max(...rows.map((r) => r.length)); out.push(["| " + rows[0].join(" | ") + " |", "| " + Array(w).fill("---").join(" | ") + " |", ...rows.slice(1).map((r) => "| " + r.join(" | ") + " |")].join("\n")); }
        continue;
      }
      if (el.localName !== "p") continue;
      const ppr = one(el, "pPr"), style = (ppr && val(one(ppr, "pStyle"))) || "", np = ppr && one(ppr, "numPr");
      let text = parMD(el).trim();
      const h = /^(?:Heading|heading)\s*(\d)$/.exec(style) || (/^Title$/i.test(style) ? [0, "1"] : null);
      if (np) {
        const lvl = +(val(one(np, "ilvl")) || 0), id = val(one(np, "numId")), f = (fmtOf[id] || {})[String(lvl)] || "bullet";
        const box = /^[☐☑☒]\s*/.exec(text);
        const key = id + ":" + lvl; olCount[key] = (olCount[key] || 0) + 1;
        const marker = box ? `- [${box[0][0] === "☐" ? " " : "x"}] ` : f === "bullet" || f === "none" ? "- " : olCount[key] + ". ";
        out.push({ li: "  ".repeat(lvl) + marker + (box ? text.slice(box[0].length) : text) });
        continue;
      }
      olCount = {};
      if (!text) continue;
      if (/^[☐☑☒]/.test(text)) { out.push({ li: `- [${text[0] === "☐" ? " " : "x"}] ` + text.slice(1).trim() }); continue; }
      if (h) out.push("#".repeat(Math.min(3, +h[1] || 1)) + " " + text.replace(/\n/g, " "));
      else if (/quote/i.test(style)) out.push(text.split("\n").map((l) => "> " + l).join("\n"));
      else if (/code|source|preformatted/i.test(style)) out.push("```\n" + text.replace(/\\(.)/g, "$1") + "\n```");
      else out.push(lineStart(text));
    }
    // consecutive list lines are one list
    const md = []; for (const x of out) { if (typeof x === "object") { if (md.length && md[md.length - 1].li != null) md[md.length - 1].li += "\n" + x.li; else md.push({ li: x.li }); } else md.push(x); }
    return md.map((x) => (typeof x === "object" ? x.li : x)).join("\n\n").replace(/```\n([\s\S]*?)\n```\n\n```\n/g, "```\n$1\n");
  }
  // A file someone gives you → { title, body, tags }. Markdown keeps its front matter's tags; a leading # heading is the title.
  async function readFile(file) {
    const name = file.name || "", ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1] || "", base = name.replace(/\.[^.]+$/, "");
    let body, tags = [];
    if (/^docx$/i.test(ext)) body = await fromDocx(new Uint8Array(await file.arrayBuffer()));
    else {
      const text = await file.text();
      if (/^html?$/i.test(ext) || /^\s*<(!doctype|html)/i.test(text)) body = fromHTML(text);
      else if (/^(md|markdown|mdown|mkd)$/i.test(ext)) {
        const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text.replace(/\r\n?/g, "\n"));
        body = fm ? text.replace(/\r\n?/g, "\n").slice(fm[0].length) : text;
        const tl = fm && /^tags:\s*\[(.*)\]\s*$/m.exec(fm[1]); if (tl) tags = tl[1].split(",").map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      } else body = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => lineStart(escText(p))).join("\n\n"); // plain text stays plain
    }
    body = body.trim();
    const head = /^#{1,3}\s+(.+)\n?/.exec(body), title = head ? head[1].trim() : base || titleOf(body) || "Imported note";
    if (head) body = body.slice(head[0].length).replace(/^\n+/, "");
    return { title, body, tags };
  }

  CA.notes = { parse, inline, toHTML, fromDOM, fromHTML, toText, checklist, outline, stats, preview, titleOf, withoutTitle, TEMPLATES, CALLOUTS, CALLOUT_LABEL,
    files: { name: fileName, md: toMarkdownFile, txt: toTextFile, html: toHTMLFile, docx: toDocx, docHTML, css: DOC_CSS, printCss: PRINT_CSS }, readFile, fromDocx, zip };
})();
