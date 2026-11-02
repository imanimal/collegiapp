/* Collegiapp — the note editor (CA.editor): a contenteditable over the notes engine's HTML (notes.js). It writes
   only what Collegiapp Markdown can hold, so what you see is what's saved: paste is cleaned through Markdown, and
   every edit goes through execCommand where one exists, so the web view's own Ctrl+Z walks the typing.
   Markdown typed at the start of a line becomes its block (# ## ### - 1. [] > ``` ---), and **b** *i* ~~s~~ ==h== `c`
   format as their closing mark is typed. app.js owns the sheet around it (the toolbar's look, the title, saving). */
(function () {
  const CA = (window.CA = window.CA || {});
  const N = () => CA.notes;
  const BLOCKS = "P,H1,H2,H3,H4,H5,H6,LI,PRE,BLOCKQUOTE,DIV,TD,TH";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const exec = (c, v) => document.execCommand(c, false, v == null ? null : v);
  const KINDS = ["note", "tip", "important", "warning"];

  // The tools, in toolbar order. `k` is the shortcut shown in the tooltip (Mod is Ctrl, or ⌘ on a Mac).
  const TOOLS = [
    { id: "undo", label: "Undo", icon: "undo", k: "Mod+Z", g: "edit" }, { id: "redo", label: "Redo", icon: "redo", k: "Mod+Shift+Z", g: "edit" },
    { id: "p", label: "Text", text: "Aa", k: "Mod+Alt+0", g: "block" }, { id: "h1", label: "Heading 1", text: "H1", k: "Mod+Alt+1", g: "block" },
    { id: "h2", label: "Heading 2", text: "H2", k: "Mod+Alt+2", g: "block" }, { id: "h3", label: "Heading 3", text: "H3", k: "Mod+Alt+3", g: "block" },
    { id: "b", label: "Bold", text: "B", k: "Mod+B", g: "inline" }, { id: "i", label: "Italic", text: "I", k: "Mod+I", g: "inline" },
    { id: "u", label: "Underline", text: "U", k: "Mod+U", g: "inline" }, { id: "s", label: "Strikethrough", text: "S", k: "Mod+Shift+X", g: "inline" },
    { id: "mark", label: "Highlight", icon: "mark", k: "Mod+Shift+H", g: "inline" }, { id: "code", label: "Inline code", icon: "code", k: "Mod+E", g: "inline" },
    { id: "link", label: "Link", icon: "links", k: "Mod+K", g: "inline" },
    { id: "ul", label: "Bulleted list", icon: "ul", k: "Mod+Shift+8", g: "list" }, { id: "ol", label: "Numbered list", icon: "ol", k: "Mod+Shift+7", g: "list" },
    { id: "todo", label: "Checklist", icon: "done", k: "Mod+Shift+9", g: "list" }, { id: "outdent", label: "Outdent", icon: "outdent", k: "Shift+Tab", g: "list" },
    { id: "indent", label: "Indent", icon: "indent", k: "Tab", g: "list" },
    { id: "quote", label: "Quote", icon: "quote", k: "Mod+Shift+.", g: "insert" }, { id: "callout", label: "Callout (click again for the next kind)", icon: "callout", k: "Mod+Shift+C", g: "insert" },
    { id: "pre", label: "Code block", icon: "codeblock", k: "Mod+Alt+C", g: "insert" }, { id: "table", label: "Table", icon: "table", k: "", g: "insert" },
    { id: "hr", label: "Divider", icon: "hr", k: "---", g: "insert" }, { id: "clear", label: "Clear formatting", icon: "clearf", k: "Mod+\\", g: "insert" },
  ];
  // the tools a caret in a table adds
  const TABLE_TOOLS = [["rowAbove", "Row above"], ["rowBelow", "Row below"], ["colLeft", "Column left"], ["colRight", "Column right"], ["rowDel", "Delete row"], ["colDel", "Delete column"], ["tableDel", "Delete table"]];

  function mount(el, opts) {
    opts = opts || {};
    let timer = 0, last = null, saved = null, lastRange = null;
    el.classList.add("ned"); el.contentEditable = "true"; el.spellcheck = true;
    el.setAttribute("role", "textbox"); el.setAttribute("aria-multiline", "true");
    try { exec("defaultParagraphSeparator", "p"); exec("styleWithCSS", false); } catch (e) { /* older engines: divs are read as paragraphs too */ }

    const sel = () => window.getSelection();
    const inEd = (n) => !!n && el.contains(n.nodeType === 1 ? n : n.parentNode);
    const anchor = () => { const s = sel(); return s && s.rangeCount && inEd(s.anchorNode) ? s.anchorNode : null; };
    const up = (n, test) => { for (n = n && (n.nodeType === 1 ? n : n.parentNode); n && n !== el; n = n.parentNode) if (test(n)) return n; return null; };
    const block = (n) => up(n || anchor(), (x) => BLOCKS.includes(x.tagName) && !(x.tagName === "DIV" && x.classList.contains("callout")));
    const tagUp = (tag, n) => up(n || anchor(), (x) => x.tagName === tag);
    const place = (node, atEnd) => { const r = document.createRange(); r.selectNodeContents(node); r.collapse(!atEnd); const s = sel(); s.removeAllRanges(); s.addRange(r); };
    const selectNode = (node) => { const r = document.createRange(); r.selectNode(node); const s = sel(); s.removeAllRanges(); s.addRange(r); };
    // the text of the caret's block up to the caret
    function before() {
      const s = sel(), b = block(); if (!b || !s.rangeCount) return null;
      const r = document.createRange(); r.setStart(b, 0); r.setEnd(s.anchorNode, s.anchorOffset);
      return { b, text: r.toString(), r };
    }
    function changed(now) {
      clearTimeout(timer);
      const fire = () => { const md = api.md(); if (md !== last) { last = md; opts.onChange && opts.onChange(md); } };
      if (now) fire(); else timer = setTimeout(fire, 450);
      opts.onInput && opts.onInput();
    }
    // tidy what the engine left: nested lists inside a checklist are checklists, a fresh item isn't done, no empty editor
    function tidy() {
      el.querySelectorAll("ul.todo ul:not(.todo), ul.todo ol").forEach((l) => { if (l.tagName === "UL") l.classList.add("todo"); });
      el.querySelectorAll("li[data-done]").forEach((li) => { if (!li.closest("ul.todo")) li.removeAttribute("data-done"); });
      el.querySelectorAll(":scope > div:not(.callout)").forEach((d) => { if (!d.querySelector("p,ul,ol,table,pre,h1,h2,h3,blockquote")) { const p = document.createElement("p"); p.innerHTML = d.innerHTML; d.replaceWith(p); } });
      el.querySelectorAll("span[style], font").forEach((s) => { if (!/font-weight|font-style|text-decoration/.test(s.getAttribute("style") || "")) s.replaceWith(...s.childNodes); });
      if (!el.firstElementChild) el.innerHTML = "<p><br></p>";
    }

    /* ── commands ── */
    function setBlock(tag) {
      const b = block(); if (!b) return exec("formatBlock", "<" + tag + ">");
      if (b.tagName === "LI" || b.tagName === "TD" || b.tagName === "TH") { if (tag === "p") return; }
      exec("formatBlock", "<" + (b.tagName === tag.toUpperCase() && tag !== "p" ? "p" : tag) + ">");
    }
    function wrapInline(tag) {
      const s = sel(); if (!s.rangeCount || !inEd(s.anchorNode)) return;
      const on = tagUp(tag.toUpperCase());
      if (on) { selectNode(on); exec("insertHTML", tag === "code" ? esc(on.textContent) : on.innerHTML); return; }
      if (s.isCollapsed) { s.modify("move", "backward", "word"); s.modify("extend", "forward", "word"); if (s.isCollapsed) return; }
      const d = document.createElement("div"); d.appendChild(s.getRangeAt(0).cloneContents());
      exec("insertHTML", `<${tag}>${tag === "code" ? esc(d.textContent) : d.innerHTML}</${tag}>`);
    }
    function list(kind) {
      const li = tagUp("LI"), l = li && li.parentNode;
      if (kind === "todo") {
        if (l && l.tagName === "UL") { l.classList.toggle("todo"); if (!l.classList.contains("todo")) l.querySelectorAll("li[data-done]").forEach((x) => x.removeAttribute("data-done")); return changed(); }
        if (l && l.tagName === "OL") exec("insertOrderedList"); // out of the numbers first
        exec("insertUnorderedList");
        const nl = tagUp("UL"); if (nl) nl.classList.add("todo");
        return changed();
      }
      if (l && l.tagName === "UL" && l.classList.contains("todo") && kind === "ul") { l.classList.remove("todo"); l.querySelectorAll("li[data-done]").forEach((x) => x.removeAttribute("data-done")); return changed(); }
      exec(kind === "ol" ? "insertOrderedList" : "insertUnorderedList");
    }
    // wrap the caret's block (or the blocks the selection spans) in a quote or a callout; again, unwrap or next kind
    function wrapBlock(kind) {
      const box = up(anchor(), (x) => x.tagName === "BLOCKQUOTE" || (x.tagName === "DIV" && x.classList.contains("callout")));
      if (box) {
        const isQ = box.tagName === "BLOCKQUOTE", cur = box.dataset.kind;
        if (kind === "callout" && !isQ && KINDS.indexOf(cur) < KINDS.length - 1) { box.dataset.kind = KINDS[KINDS.indexOf(cur) + 1]; opts.onCallout && opts.onCallout(box.dataset.kind); return changed(); }
        if (kind === "callout" && isQ) { const d = document.createElement("div"); d.className = "callout"; d.dataset.kind = "note"; d.append(...box.childNodes); box.replaceWith(d); place(d.lastChild || d, true); return changed(); }
        if (kind === "quote" && !isQ) { const q = document.createElement("blockquote"); q.append(...box.childNodes); box.replaceWith(q); place(q.lastChild || q, true); return changed(); }
        selectNode(box); exec("insertHTML", box.innerHTML || "<p><br></p>"); return;
      }
      const s = sel(), r = s.rangeCount && s.getRangeAt(0);
      let a = block(r && r.startContainer), b = block(r && r.endContainer);
      // lists and tables move whole
      const top = (n) => { while (n && n.parentNode !== el) n = n.parentNode; return n; };
      a = top(a); b = top(b) || a; if (!a) return;
      const parts = []; for (let n = a; n; n = n.nextElementSibling) { parts.push(n.outerHTML); if (n === b) break; }
      const r2 = document.createRange(); r2.setStartBefore(a); r2.setEndAfter(b); s.removeAllRanges(); s.addRange(r2);
      exec("insertHTML", kind === "quote" ? `<blockquote>${parts.join("")}</blockquote>` : `<div class="callout" data-kind="note">${parts.join("")}</div>`);
      if (kind === "callout") opts.onCallout && opts.onCallout("note");
    }
    function codeBlock() {
      const pre = tagUp("PRE");
      if (pre) { selectNode(pre); exec("insertHTML", pre.textContent.split("\n").map((l) => `<p>${esc(l) || "<br>"}</p>`).join("")); return; }
      const s = sel(), t = s.rangeCount ? s.toString() : "";
      if (t.includes("\n") || (t && !block())) { exec("insertHTML", `<pre><code>${esc(t)}</code></pre><p><br></p>`); return; }
      exec("formatBlock", "<pre>");
    }
    function insertTable(rows, cols) {
      rows = rows || 3; cols = cols || 3;
      const row = (tag) => `<tr>${Array.from({ length: cols }, () => `<${tag}><br></${tag}>`).join("")}</tr>`;
      exec("insertHTML", `<table><thead>${row("th")}</thead><tbody>${Array.from({ length: rows - 1 }, () => row("td")).join("")}</tbody></table><p><br></p>`);
      const t = [...el.querySelectorAll("table")].find((x) => x.contains(anchor()) || x.nextElementSibling && x.nextElementSibling.contains(anchor()));
      if (t) place(t.querySelector("th"));
      changed();
    }
    function tableOp(op) {
      const cell = up(anchor(), (x) => x.tagName === "TD" || x.tagName === "TH"); if (!cell) return;
      const tr = cell.parentNode, table = cell.closest("table"), ci = [...tr.children].indexOf(cell), rows = [...table.querySelectorAll("tr")];
      const blank = (tag) => { const c = document.createElement(tag); c.innerHTML = "<br>"; return c; };
      if (op === "rowAbove" || op === "rowBelow") {
        const head = tr.parentNode.tagName === "THEAD", nr = document.createElement("tr");
        [...tr.children].forEach(() => nr.appendChild(blank("td")));
        if (head) table.tBodies[0] ? table.tBodies[0].prepend(nr) : table.appendChild(document.createElement("tbody")).appendChild(nr);
        else tr.parentNode.insertBefore(nr, op === "rowAbove" ? tr : tr.nextSibling);
        place(nr.children[Math.min(ci, nr.children.length - 1)]);
      } else if (op === "colLeft" || op === "colRight") {
        rows.forEach((r) => { const ref = r.children[ci], c = blank(r.parentNode.tagName === "THEAD" ? "th" : "td"); r.insertBefore(c, op === "colLeft" ? ref : ref ? ref.nextSibling : null); });
        place(tr.children[op === "colLeft" ? ci : ci + 1]);
      } else if (op === "rowDel") {
        if (tr.parentNode.tagName === "THEAD" || rows.length <= 1) return opts.onRefuse && opts.onRefuse("The header row stays; delete the table instead");
        const next = tr.nextElementSibling || tr.previousElementSibling; tr.remove(); if (next) place(next.children[Math.min(ci, next.children.length - 1)]);
      } else if (op === "colDel") {
        if (tr.children.length <= 1) return opts.onRefuse && opts.onRefuse("A table keeps one column; delete the table instead");
        rows.forEach((r) => r.children[ci] && r.children[ci].remove()); place(tr.children[Math.max(0, ci - 1)]);
      } else if (op === "tableDel") { const p = document.createElement("p"); p.innerHTML = "<br>"; table.replaceWith(p); place(p); }
      changed();
    }
    function link(url) {
      restore();
      const a = tagUp("A");
      if (!url) { if (a) { selectNode(a); exec("unlink"); } return changed(); }
      if (!/^(https?:|mailto:|#)/i.test(url)) url = /^[\w.-]+@[\w.-]+$/.test(url) ? "mailto:" + url : "https://" + url;
      if (a) { a.setAttribute("href", url); return changed(); }
      const s = sel(); if (s.isCollapsed) exec("insertHTML", `<a href="${esc(url)}">${esc(url.replace(/^mailto:/, ""))}</a>`); else exec("createLink", url);
      changed();
    }
    // the selection is lost when a toolbar field takes focus: keep it for the link box
    function keep() { const s = sel(); saved = s.rangeCount && inEd(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; return saved; }
    function restore() { if (!saved) return; el.focus(); const s = sel(); s.removeAllRanges(); s.addRange(saved); saved = null; }
    function toggleCheck(li) {
      li = li || tagUp("LI"); if (!li || !li.closest("ul.todo")) return false;
      if (li.dataset.done === "1") li.removeAttribute("data-done"); else li.dataset.done = "1";
      opts.onCheck && opts.onCheck(li, li.dataset.done === "1"); changed(); return true;
    }
    function hr() { exec("insertHTML", "<hr><p><br></p>"); }
    function clear() { exec("removeFormat"); exec("unlink"); const b = block(); if (b && /^H\d$|^PRE$/.test(b.tagName)) exec("formatBlock", "<p>"); }

    const RUN = {
      undo: () => exec("undo"), redo: () => exec("redo"), p: () => setBlock("p"), h1: () => setBlock("h1"), h2: () => setBlock("h2"), h3: () => setBlock("h3"),
      b: () => exec("bold"), i: () => exec("italic"), u: () => exec("underline"), s: () => exec("strikeThrough"), mark: () => wrapInline("mark"), code: () => wrapInline("code"),
      link: () => opts.onLink && opts.onLink(keep(), (tagUp("A") || {}).href || ""), ul: () => list("ul"), ol: () => list("ol"), todo: () => list("todo"),
      indent: () => exec("indent"), outdent: () => exec("outdent"), quote: () => wrapBlock("quote"), callout: () => wrapBlock("callout"), pre: codeBlock,
      table: () => insertTable(3, 3), hr, clear, check: () => toggleCheck(),
    };
    TABLE_TOOLS.forEach(([id]) => (RUN[id] = () => tableOp(id)));

    /* ── typing ── */
    // Markdown at the start of a line: the marker goes, the block takes its place (in the web view's undo history)
    function autoBlock() {
      const at = before(); if (!at) return false;
      const { b, text, r } = at, t = text.replace(/\u00a0/g, " ");
      const rules = [[/^(#{1,3}) $/, (m) => setBlock("h" + m[1].length)], [/^[-*+] $/, () => list("ul")], [/^1[.)] $/, () => list("ol")],
        [/^(?:[-*+] )?\[( |x)?\] $/i, (m) => { list("todo"); if (m[1] && m[1].toLowerCase() === "x") { const li = tagUp("LI"); if (li) li.dataset.done = "1"; } }],
        [/^> $/, () => wrapBlock("quote")], [/^>\s?\[!(note|tip|important|warning)\] $/i, () => wrapBlock("callout")], [/^```\w* $/, codeBlock]];
      if (b.tagName === "LI") {
        // "[] " at the start of a bullet makes the list a checklist
        if (/^\[( |x)?\] $/i.test(t) && b.parentNode.tagName === "UL") { const s = sel(); s.removeAllRanges(); s.addRange(r); exec("delete"); b.parentNode.classList.add("todo"); if (/x/i.test(t)) b.dataset.done = "1"; changed(); return true; }
        return false;
      }
      if (!/^(P|DIV|H[1-6])$/.test(b.tagName)) return false;
      for (const [re, fn] of rules) {
        const m = re.exec(t); if (!m) continue;
        const s = sel(); s.removeAllRanges(); s.addRange(r); exec("delete");
        fn(m); tidy(); changed(); return true;
      }
      return false;
    }
    // **bold** *italic* ~~strike~~ ==highlight== `code`, as the closing mark is typed, inside one run of text
    const INLINE = [[/(^|[^*\\])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, "b"], [/(^|[^~\\])~~([^~\s](?:[^~]*[^~\s])?)~~$/, "s"], [/(^|[^=\\])==([^=\s](?:[^=]*[^=\s])?)==$/, "mark"],
      [/(^|[^*\\\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, "i"], [/(^|[^`\\])`([^`]+)`$/, "code"]];
    function autoInline() {
      const s = sel(), n = s.anchorNode; if (!n || n.nodeType !== 3 || tagUp("PRE") || tagUp("CODE")) return false;
      const text = n.nodeValue.slice(0, s.anchorOffset);
      for (const [re, tag] of INLINE) {
        const m = re.exec(text); if (!m) continue;
        const start = m.index + m[1].length, r = document.createRange(); r.setStart(n, start); r.setEnd(n, s.anchorOffset);
        s.removeAllRanges(); s.addRange(r);
        const T = { b: "strong", i: "em", s: "s", mark: "mark", code: "code" }[tag];
        exec("insertHTML", `<${T}>${esc(m[2])}</${T}>&#8203;`); // the zero-width space puts the caret outside the mark
        changed(); return true;
      }
      return false;
    }
    function onInput(e) {
      if (e.inputType === "insertText" && e.data === " ") autoBlock();
      else if (e.inputType === "insertText" && /[*~=`]/.test(e.data || "")) autoInline();
      else if (e.inputType === "insertText" && e.data === "-") {
        const at = before(); if (at && at.b.tagName === "P" && at.text === "---" && at.b.textContent === "---") { selectNode(at.b); exec("insertHTML", "<hr><p><br></p>"); }
      } else if (e.inputType === "insertParagraph") {
        const li = tagUp("LI"); if (li && !li.textContent.trim()) li.removeAttribute("data-done");
      }
      tidy(); changed();
    }
    // Enter at an empty last line leaves a code block, a quote or a callout, like it leaves a list
    function leaveBox(e) {
      const pre = tagUp("PRE"), s = sel();
      if (pre) {
        e.preventDefault();
        const r = document.createRange(); r.selectNodeContents(pre); r.setStart(s.anchorNode, s.anchorOffset);
        const after = r.toString(), all = pre.textContent;
        if (!after && /\n$/.test(all) && all.length > 1) { pre.lastChild && pre.lastChild.nodeName === "BR" ? pre.lastChild.remove() : (pre.textContent = all.replace(/\n$/, "")); const p = document.createElement("p"); p.innerHTML = "<br>"; pre.after(p); place(p); changed(); return true; }
        exec("insertText", "\n"); if (!after) exec("insertText", ""); return true;
      }
      const b = block(), box = b && up(b, (x) => x.tagName === "BLOCKQUOTE" || (x.tagName === "DIV" && x.classList.contains("callout")));
      if (box && b.parentNode === box && !b.textContent.trim() && b === box.lastElementChild && box.children.length > 1) {
        e.preventDefault(); box.after(b); place(b); changed(); return true;
      }
      return false;
    }
    function moveCell(d) {
      const cell = up(anchor(), (x) => x.tagName === "TD" || x.tagName === "TH"); if (!cell) return false;
      const cells = [...cell.closest("table").querySelectorAll("th, td")], i = cells.indexOf(cell) + d;
      if (i >= cells.length) { tableOp("rowBelow"); return true; }
      if (i >= 0) { const r = document.createRange(); r.selectNodeContents(cells[i]); const s = sel(); s.removeAllRanges(); s.addRange(r); }
      return true;
    }
    function onKey(e) {
      const mod = e.ctrlKey || e.metaKey, k = e.key, lk = k.toLowerCase();
      const go = (id) => { e.preventDefault(); e.stopPropagation(); RUN[id](); changed(); };
      if (k === "Enter" && !e.shiftKey && !mod && leaveBox(e)) return;
      if (k === "Enter" && mod && !e.shiftKey && tagUp("LI")) { if (toggleCheck()) { e.preventDefault(); return; } }
      if (k === "Tab" && !mod && !e.altKey) {
        if (tagUp("TD") || tagUp("TH")) { e.preventDefault(); moveCell(e.shiftKey ? -1 : 1); return; }
        if (tagUp("LI")) { e.preventDefault(); RUN[e.shiftKey ? "outdent" : "indent"](); tidy(); changed(); return; }
        if (tagUp("PRE")) { e.preventDefault(); exec("insertText", "  "); return; }
        return; // Tab elsewhere moves focus, as it should
      }
      if (!mod) return;
      if (e.altKey && /^[0-3]$/.test(k)) return go(k === "0" ? "p" : "h" + k);
      if (e.altKey && (lk === "c" || e.code === "KeyC")) return go("pre");
      if (e.shiftKey && (e.code === "Digit8" || k === "*")) return go("ul");
      if (e.shiftKey && (e.code === "Digit7" || k === "&")) return go("ol");
      if (e.shiftKey && (e.code === "Digit9" || k === "(")) return go("todo");
      if (e.shiftKey && (lk === "x")) return go("s");
      if (e.shiftKey && (lk === "h")) return go("mark");
      if (e.shiftKey && (lk === "c")) return go("callout");
      if (e.shiftKey && (k === ">" || e.code === "Period")) return go("quote");
      if (!e.shiftKey && lk === "e") return go("code");
      if (!e.shiftKey && lk === "k") return go("link");
      if (!e.shiftKey && k === "\\") return go("clear");
      if (lk === "z" || lk === "y") { e.stopPropagation(); setTimeout(() => { tidy(); changed(); }, 0); } // the web view's own undo, not the app's
    }
    // paste: HTML (a web page, Word, Google Docs) and Markdown come in through Markdown, so only what a note can hold stays
    function onPaste(e) {
      const cd = e.clipboardData; if (!cd) return;
      if ([...cd.files || []].some((f) => /^image\//.test(f.type))) { e.preventDefault(); opts.onRefuse && opts.onRefuse("Images aren't kept in notes yet · paste an image link instead"); return; }
      const html = cd.getData("text/html"), text = cd.getData("text/plain");
      if (tagUp("PRE") || tagUp("CODE")) { e.preventDefault(); exec("insertText", text); return; }
      let md = null;
      if (html && !/^\s*$/.test(html)) md = N().fromHTML(html);
      else if (text && /(^|\n)(#{1,3} |[-*+] |\d+[.)] |> |```|\|.*\|)|\*\*\S|\[[^\]]+\]\(/.test(text)) md = text;
      if (md == null) { if (text) { e.preventDefault(); exec("insertText", text); } return; }
      e.preventDefault();
      const out = N().toHTML(md), single = !/\n/.test(md.trim()) && !/^(#|[-*+] |\d+[.)] |>|```|\|)/.test(md.trim());
      exec("insertHTML", single ? out.replace(/^<p>|<\/p>$/g, "") : out);
      tidy(); changed();
    }
    // files dropped on the page come in where they land (Markdown, text, HTML, Word)
    function onDrop(e) {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
      e.preventDefault();
      if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(e.clientX, e.clientY); if (r) { const s = sel(); s.removeAllRanges(); s.addRange(r); } }
      N().readFile(f).then((d) => { el.focus(); exec("insertHTML", N().toHTML((d.title && !/^#/.test(d.body) ? "## " + d.title + "\n\n" : "") + d.body)); tidy(); changed(); })
        .catch((err) => opts.onRefuse && opts.onRefuse("Couldn't read " + f.name + " · " + err.message));
    }
    // a click on a checklist item's box (its left padding) ticks it
    function onDown(e) {
      const li = e.target.closest && e.target.closest("ul.todo > li"); if (!li || e.target !== li) return;
      const pad = parseFloat(getComputedStyle(li).paddingLeft) || 0, x = e.clientX - li.getBoundingClientRect().left;
      if (x >= 0 && x < pad) { e.preventDefault(); toggleCheck(li); }
    }
    // links open with Ctrl/⌘+click (a plain click puts the caret in them)
    function onClick(e) {
      const a = e.target.closest && e.target.closest("a[href]"); if (!a || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault(); opts.onOpen && opts.onOpen(a.getAttribute("href"));
    }
    function state() {
      const n = anchor(); if (!n) return null;
      const q = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };
      const b = block(n), li = tagUp("LI", n), l = li && li.parentNode;
      return {
        block: b ? b.tagName.toLowerCase() : "p", b: q("bold"), i: q("italic"), u: q("underline"), s: q("strikeThrough"), mark: !!tagUp("MARK", n), code: !!tagUp("CODE", n) && !tagUp("PRE", n),
        link: !!tagUp("A", n), ul: !!l && l.tagName === "UL" && !l.classList.contains("todo"), ol: !!l && l.tagName === "OL", todo: !!l && l.classList.contains("todo"),
        quote: !!tagUp("BLOCKQUOTE", n), callout: (up(n, (x) => x.classList && x.classList.contains("callout")) || { dataset: {} }).dataset.kind || "", pre: !!tagUp("PRE", n),
        table: !!up(n, (x) => x.tagName === "TD" || x.tagName === "TH"),
      };
    }
    // the last place the caret was in the text, for tools that take focus away (the AI panel inserts there)
    const onSel = () => { if (!anchor()) return; lastRange = sel().getRangeAt(0).cloneRange(); opts.onState && opts.onState(state()); };
    el.addEventListener("input", onInput); el.addEventListener("keydown", onKey); el.addEventListener("paste", onPaste);
    el.addEventListener("drop", onDrop); el.addEventListener("mousedown", onDown); el.addEventListener("click", onClick);
    document.addEventListener("selectionchange", onSel);

    const api = {
      el, run(id) { if (!RUN[id]) return; if (!anchor() && id !== "link") { el.focus(); if (!anchor()) place(el.lastElementChild || el, true); } RUN[id](); tidy(); changed(); onSel(); },
      md: () => N().fromDOM(el), set(md) { el.innerHTML = N().toHTML(md || ""); last = N().fromDOM(el); tidy(); },
      flush: () => changed(true), focus(atEnd) { el.focus(); if (atEnd !== false) place(el.lastElementChild || el, true); },
      link, keep, restore, state, insertTable,
      selectionMD() { if (!lastRange || lastRange.collapsed || !el.contains(lastRange.commonAncestorContainer)) return ""; const d = document.createElement("div"); d.appendChild(lastRange.cloneContents()); return N().fromDOM(d); },
      restoreLast() { el.focus(); const s = sel(); s.removeAllRanges(); if (lastRange && el.contains(lastRange.commonAncestorContainer)) s.addRange(lastRange); else place(el.lastElementChild || el, true); }, insertMD(md) { el.focus(); if (!anchor()) place(el.lastElementChild || el, true); exec("insertHTML", N().toHTML(md)); tidy(); changed(); },
      // headings as they stand, for the outline
      headings: () => [...el.querySelectorAll("h1, h2, h3")].map((h) => ({ level: +h.tagName[1], text: h.textContent.trim(), el: h })).filter((h) => h.text),
      destroy() { clearTimeout(timer); document.removeEventListener("selectionchange", onSel); },
    };
    api.set(opts.md || "");
    return api;
  }

  CA.editor = { mount, TOOLS, TABLE_TOOLS };
})();
