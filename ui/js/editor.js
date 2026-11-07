/* Collegiapp — the note editor (CA.editor): a contenteditable over the notes engine's HTML (notes.js). It shows only
   what Collegiapp Markdown can hold, so what you see is what's saved: every change that reshapes a block (a list, a
   heading, a format, Enter, a merge, a paste) draws the blocks it touched again from their Markdown, the caret riding
   through as private-use marks in the text. Typing alone is left to the web view.
   The editor keeps its own undo history, one per note, for as long as the app runs: closing a note keeps it and opening
   the note again picks it up. Typing groups by word; every command is a step of its own.
   Markdown typed at the start of a line becomes its block (# ## ### - 1. [] > ``` ---), and **b** *i* ~~s~~ ==h== `c`
   format as their closing mark is typed. Formats toggle over any selection, across lines and list items; with nothing
   selected they apply to what you type next. Lists work like Notion's: Enter splits an item, Enter on an empty one or
   Backspace at its start takes it out of the list (a nested one moves out a level), Tab and Shift+Tab nest it.
   An image (a drawing, draw.js) is picked by a click and moved by dragging it anywhere in the text: dropped near the
   left or right edge it wraps there, elsewhere it sits on a line of its own (or in the line, if it was). The picked one
   takes a place and a width (data-place, data-w). Dragging selected text never moves it: a press starts a new selection.
   app.js owns the sheet around it (the toolbar's look, the title, saving, the drawing layer). */
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
    { id: "draw", label: "Drawing", icon: "draw", k: "Mod+Shift+D", g: "insert" },
    { id: "hr", label: "Divider", icon: "hr", k: "---", g: "insert" }, { id: "clear", label: "Clear formatting", icon: "clearf", k: "Mod+\\", g: "insert" },
  ];
  // the tools a caret in a table adds
  const TABLE_TOOLS = [["rowAbove", "Row above"], ["rowBelow", "Row below"], ["colLeft", "Column left"], ["colRight", "Column right"], ["rowDel", "Delete row"], ["colDel", "Delete column"], ["tableDel", "Delete table"]];
  // where a picked image sits: in the line of text, wrapped by the text on either side, or on a line of its own
  const IMG_PLACES = [["", "In the text"], ["left", "Wrap left"], ["center", "Own line"], ["right", "Wrap right"]];

  // The selection's start and end ride through a redraw as two private-use characters in the text, and an empty
  // paragraph or heading (which Markdown can't hold) as a third, so a redraw keeps the blank lines you left.
  const S0 = "\uE000", S1 = "\uE001", EMPTY = "\uE002", MARKS = /[\uE000-\uE002]/g, JUNK = /[\u200b\uE000-\uE002]/g;
  // the inline formats: the tag a tool makes, and the tags that count as it
  const FMT = { b: ["strong", /^(STRONG|B)$/], i: ["em", /^(EM|I)$/], u: ["u", /^(U|INS)$/], s: ["s", /^(S|STRIKE|DEL)$/], mark: ["mark", /^MARK$/], code: ["code", /^CODE$/] };
  const INLINE_TAGS = /^(STRONG|B|EM|I|U|INS|S|STRIKE|DEL|MARK|CODE|A|SPAN|FONT|SUB|SUP)$/;
  // where text can go: a leaf block or anything inline
  const HOLDS = /^(P|H[1-6]|LI|TD|TH|PRE|STRONG|B|EM|I|U|INS|S|STRIKE|DEL|MARK|CODE|A|SPAN|FONT|SUB|SUP)$/;
  const isList = (n) => !!n && n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName);
  const isBox = (n) => !!n && n.nodeType === 1 && (n.tagName === "BLOCKQUOTE" || (n.tagName === "DIV" && n.classList.contains("callout")));
  // a block with nothing in it: no text but marks, no image
  const bare = (n) => !n.textContent.replace(JUNK, "") && !n.querySelector("img");
  // Each note's history while the app runs, by its id: the steps back and forward, and how the note was when it closed.
  const HISTORY = new Map(), KEEP_NOTES = 40, STEPS = 300;

  /* ── Markdown, a unit at a time: a list item (its marker line and the lines under it), a paragraph, a heading, or a
     block kept whole (code, quote, table, divider). Block commands rewrite the units the selection covers. ── */
  const RE = {
    fence: /^\s*(`{3,}|~{3,})/, h: /^(#{1,6})\s+(.*?)\s*#*\s*$/, hr: /^\s*([-*_])(\s*\1){2,}\s*$/, li: /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/,
    quote: /^\s*>/, tsep: /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/,
  };
  const indentOf = (s) => { let n = 0; for (const ch of s) { if (ch === " ") n++; else if (ch === "\t") n += 4; else break; } return n; };
  const tableAt = (L, i) => L[i].includes("|") && i + 1 < L.length && RE.tsep.test(L[i + 1]) && L[i + 1].includes("-");
  const startsBlock = (L, i) => RE.fence.test(L[i]) || RE.h.test(L[i]) || RE.hr.test(L[i]) || RE.li.test(L[i]) || RE.quote.test(L[i]) || tableAt(L, i);
  function units(md) {
    const L = md.split("\n"), out = [];
    for (let i = 0; i < L.length;) {
      const line = L[i], u = { from: i }; let m;
      if (!line.trim()) { i++; continue; }
      if ((m = RE.fence.exec(line))) {
        const close = new RegExp("^\\s*\\" + m[1][0] + "{" + m[1].length + ",}\\s*$");
        for (i++; i < L.length && !close.test(L[i]); i++);
        i = Math.min(L.length, i + 1); u.t = "keep";
      } else if (RE.quote.test(line)) { while (i < L.length && RE.quote.test(L[i])) i++; u.t = "keep"; }
      else if (tableAt(L, i)) { for (i += 2; i < L.length && L[i].includes("|") && L[i].trim(); i++); u.t = "keep"; }
      else if (RE.hr.test(line)) { i++; u.t = "keep"; }
      else if ((m = RE.h.exec(line))) { i++; Object.assign(u, { t: "h", level: Math.min(3, m[1].length), text: [m[2]] }); }
      else if ((m = RE.li.exec(line))) {
        const box = /^[-*+]$/.test(m[2]) && /^\[( |x|X)\]\s?([\s\S]*)$/.exec(m[3]);
        Object.assign(u, { t: "li", indent: indentOf(m[1]), marker: m[2], kind: box ? "todo" : /^\d/.test(m[2]) ? "ol" : "ul", done: !!box && box[1] !== " ", text: [box ? box[2] : m[3]] });
        for (i++; i < L.length && L[i].trim() && !RE.li.test(L[i]) && indentOf(L[i]) > u.indent; i++) u.text.push(L[i].trim());
      } else {
        Object.assign(u, { t: "p", text: [line.trim()] });
        for (i++; i < L.length && L[i].trim() && !startsBlock(L, i); i++) u.text.push(L[i].trim());
      }
      u.to = i; u.src = L.slice(u.from, i).join("\n"); out.push(u);
    }
    return out;
  }
  const markerW = (u) => (u.kind === "ol" ? (/^\d/.test(u.marker || "") ? u.marker.length : 2) : 1);
  function emit(us) {
    let out = "";
    us.forEach((u, k) => {
      const prev = us[k - 1];
      if (prev) out += prev.t === "li" && u.t === "li" ? "\n" : "\n\n";
      if (u.t === "keep") out += u.src;
      else if (u.t === "h") out += "#".repeat(u.level) + " " + u.text.join(" ");
      else if (u.t === "p") out += N().lineStart(u.text.join("\n"));
      else {
        // a numbered list counts from its first number; a list nested by Tab starts again at 1
        let j = k - 1; while (j >= 0 && us[j].t === "li" && us[j].indent > u.indent) j--;
        const first = !(us[j] && us[j].t === "li" && us[j].indent === u.indent && us[j].kind === u.kind);
        const mk = u.kind === "ol" ? (first && u.indent ? "1." : /^\d/.test(u.marker || "") ? u.marker : "1.") : /^[-*+]$/.test(u.marker || "") ? u.marker : "-";
        u.marker = mk;
        out += " ".repeat(u.indent) + mk + " " + (u.kind === "todo" ? `[${u.done ? "x" : " "}] ` : "") + u.text.join("\n" + " ".repeat(u.indent + mk.length + 1));
      }
    });
    return out;
  }
  // Move list item u (and the items under it) in a level (d 1) or out a level (d -1). False when it can't go.
  function nest(us, u, d) {
    const k = us.indexOf(u), kids = [];
    for (let j = k + 1; j < us.length && us[j].t === "li" && us[j].indent > u.indent; j++) kids.push(us[j]);
    let j = k - 1, to;
    if (d > 0) {
      while (j >= 0 && us[j].t === "li" && us[j].indent > u.indent) j--;
      const sib = us[j]; if (!sib || sib.t !== "li" || sib.indent !== u.indent) return false;
      to = sib.indent + markerW(sib) + 1;
    } else {
      if (!u.indent) return false;
      while (j >= 0 && us[j].t === "li" && us[j].indent >= u.indent) j--;
      to = us[j] && us[j].t === "li" ? us[j].indent : 0;
    }
    const delta = to - u.indent; [u, ...kids].forEach((x) => { x.indent += delta; x.moved = true; });
    return true;
  }

  function mount(el, opts) {
    opts = opts || {};
    let timer = 0, last = null, saved = null, lastRange = null, picked = null, busy = false, composing = false, pending = null, pre = null, resume = null;
    el.classList.add("ned"); el.contentEditable = "true"; el.spellcheck = true;
    el.setAttribute("role", "textbox"); el.setAttribute("aria-multiline", "true");
    try { exec("defaultParagraphSeparator", "p"); exec("styleWithCSS", false); } catch (e) { /* older engines: divs are read as paragraphs too */ }

    const sel = () => window.getSelection();
    const inEd = (n) => !!n && el.contains(n.nodeType === 1 ? n : n.parentNode);
    const anchor = () => { const s = sel(); return s && s.rangeCount && inEd(s.anchorNode) ? s.anchorNode : null; };
    const up = (n, test) => { for (n = n && (n.nodeType === 1 ? n : n.parentNode); n && n !== el; n = n.parentNode) if (test(n)) return n; return null; };
    const block = (n) => up(n || anchor(), (x) => BLOCKS.includes(x.tagName) && !isBox(x));
    const tagUp = (tag, n) => up(n || anchor(), (x) => x.tagName === tag);
    const top = (n) => { if (!n || n === el || !el.contains(n)) return null; while (n.parentNode !== el) n = n.parentNode; return n; };
    const place = (node, atEnd) => { const r = document.createRange(); r.selectNodeContents(node); r.collapse(!atEnd); const s = sel(); s.removeAllRanges(); s.addRange(r); };
    const caret = (node, off) => { const r = document.createRange(); r.setStart(node, off); r.collapse(true); const s = sel(); s.removeAllRanges(); s.addRange(r); };
    const selectNode = (node) => { const r = document.createRange(); r.selectNode(node); const s = sel(); s.removeAllRanges(); s.addRange(r); };
    const refuse = (m) => { opts.onRefuse && opts.onRefuse(m); return false; };
    // the text of the caret's block up to the caret
    function before() {
      const s = sel(), b = block(); if (!b || !s.rangeCount) return null;
      const r = document.createRange(); r.setStart(b, 0); r.setEnd(s.anchorNode, s.anchorOffset);
      return { b, text: r.toString(), r };
    }
    // the caret sits at the very start of block b (a list item's start is before its own text)
    function atStart(b) {
      const s = sel(); if (!s.rangeCount || !s.isCollapsed) return false;
      const r = document.createRange(); r.setStart(b, 0); r.setEnd(s.anchorNode, s.anchorOffset);
      const f = r.cloneContents(); return !f.textContent.replace(JUNK, "") && !f.querySelector("img, br");
    }
    function atEnd(b) {
      const s = sel(); if (!s.rangeCount || !s.isCollapsed) return false;
      const r = document.createRange(); r.setStart(s.anchorNode, s.anchorOffset); r.setEnd(b, b.childNodes.length);
      const f = r.cloneContents(); return !f.textContent.replace(JUNK, "") && !f.querySelector("img");
    }
    function changed(now) {
      clearTimeout(timer);
      const fire = () => { const md = api.md(); if (md !== last) { last = md; opts.onChange && opts.onChange(md); } };
      if (now) fire(); else timer = setTimeout(fire, 450);
      opts.onInput && opts.onInput();
    }
    // a leaf block with nothing left to hold the caret gets a <br>
    function fill(b) {
      if (!b || b.nodeType !== 1 || !(/^(P|H[1-6]|LI|TD|TH)$/.test(b.tagName) || (b.tagName === "CODE" && b.parentNode.tagName === "PRE"))) return;
      const own = [...b.childNodes].filter((c) => !isList(c));
      if (own.every((c) => c.nodeType === 3 && !c.nodeValue)) b.insertBefore(document.createElement("br"), own[0] || b.firstChild);
    }
    // tidy what the engine left: stray text at the top goes in a paragraph, checklists stay checklists, no empty editor
    function tidy() {
      const stray = [...el.childNodes].some((n) => (n.nodeType === 3 && n.nodeValue.trim()) || (n.nodeType === 1 && (INLINE_TAGS.test(n.tagName) || /^(BR|IMG|DIV)$/.test(n.tagName) && !(n.tagName === "DIV" && n.classList.contains("callout")))));
      if (stray) reshape(() => {
        let run = null;
        [...el.childNodes].forEach((n) => {
          if (n.nodeType === 1 && n.tagName === "DIV" && !n.classList.contains("callout")) {
            run = null; if (n.querySelector("p,ul,ol,table,pre,h1,h2,h3,blockquote")) { n.replaceWith(...n.childNodes); return; }
            const p = document.createElement("p"); p.append(...n.childNodes); n.replaceWith(p); fill(p); return;
          }
          if (n.nodeType === 1 && !INLINE_TAGS.test(n.tagName) && !/^(BR|IMG)$/.test(n.tagName)) { run = null; return; }
          if (n.nodeType === 3 && !n.nodeValue.trim() && !run && !/[\uE000\uE001]/.test(n.nodeValue)) { n.remove(); return; }
          if (!run) { run = document.createElement("p"); n.before(run); }
          run.append(n);
        });
      });
      el.querySelectorAll("ul.todo ul:not(.todo), ul.todo ol").forEach((l) => { if (l.tagName === "UL") l.classList.add("todo"); });
      el.querySelectorAll("li[data-done]").forEach((li) => { if (!li.closest("ul.todo")) li.removeAttribute("data-done"); });
      el.querySelectorAll("span[style], font").forEach((s) => { if (!/font-weight|font-style|text-decoration/.test(s.getAttribute("style") || "")) s.replaceWith(...s.childNodes); });
      // an image's width is its data-w; only the picked one is outlined
      el.querySelectorAll("img").forEach((i) => { const w = +i.dataset.w ? i.dataset.w + "%" : ""; if (i.style.width !== w) i.style.width = w; if (i !== picked && i.classList.contains("picked")) i.classList.remove("picked"); });
      if (!el.firstElementChild) el.innerHTML = "<p><br></p>";
    }

    /* ── redrawing from Markdown ── */
    // a boundary moved to where text can go: into the block it's between, before an image or a break
    function spot(n, off) {
      for (let k = 0; k < 40 && n.nodeType === 1 && !HOLDS.test(n.tagName); k++) {
        const kids = n.childNodes;
        if (off < kids.length) { n = kids[off]; off = 0; } else if (kids.length) { n = kids[kids.length - 1]; off = n.nodeType === 3 ? n.length : n.childNodes.length; } else break;
      }
      if (n.nodeType === 1 && /^(IMG|BR|HR)$/.test(n.tagName)) { off = [...n.parentNode.childNodes].indexOf(n); n = n.parentNode; }
      return [n, off];
    }
    function putMark([n, off], ch) { if (n.nodeType === 3) n.insertData(off, ch); else n.insertBefore(document.createTextNode(ch), n.childNodes[off] || null); }
    // the selection as marks in the text (the end first, so the start's offset holds)
    function mark() {
      const s = sel(); if (!s.rangeCount || !inEd(s.anchorNode)) return false;
      const r = s.getRangeAt(0), a = spot(r.startContainer, r.startOffset), b = spot(r.endContainer, r.endOffset);
      if (!inEd(a[0]) || !inEd(b[0])) return false;
      putMark(b, S1); putMark(a, S0); return true;
    }
    // the marks out of the text, the selection back where they were
    function unmark() {
      const pts = {}, hits = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) if (/[\uE000\uE001]/.test(n.nodeValue)) hits.push(n);
      hits.forEach((n) => {
        let out = "";
        for (const ch of n.nodeValue) { if (ch === S0 || ch === S1) pts[ch] = [n, out.length]; else out += ch; }
        // a space at the end of a line before the caret would fold away
        const c = pts[S0]; if (c && c[0] === n && c[1] === out.length && / $/.test(out) && !n.nextSibling) out = out.slice(0, -1) + "\u00a0";
        n.nodeValue = out;
      });
      hits.forEach((n) => {
        if (n.nodeValue) return;
        const p = n.parentNode, i = [...p.childNodes].indexOf(n), br = n.previousSibling && n.previousSibling.nodeName === "BR" && !n.nextSibling;
        for (const k of [S0, S1]) if (pts[k] && pts[k][0] === n) pts[k] = [p, i];
        n.remove(); fill(p);
        // a caret after a closing <br> needs a second one to show its line
        if (br && pts[S0] && pts[S0][0] === p && p.lastChild && p.lastChild.nodeName === "BR") p.append(document.createElement("br"));
      });
      if (!pts[S0]) return;
      const b = pts[S1] || pts[S0], r = document.createRange();
      try { r.setStart(pts[S0][0], Math.min(pts[S0][1], len(pts[S0][0]))); r.setEnd(b[0], Math.min(b[1], len(b[0]))); } catch (e) { return; }
      const s = sel(); s.removeAllRanges(); s.addRange(r);
    }
    const len = (n) => (n.nodeType === 3 ? n.length : n.childNodes.length);
    // top-level blocks as Markdown; an empty paragraph or heading stands in as EMPTY
    function mdOf(nodes) {
      return nodes.map((n) => {
        if (n.nodeType === 1 && /^(P|H[1-6])$/.test(n.tagName) && bare(n)) {
          return (n.tagName === "P" ? "" : "#".repeat(Math.min(3, +n.tagName[1])) + " ") + EMPTY + (n.textContent.match(/[\uE000\uE001]/g) || []).join("");
        }
        return N().fromNodes([n]);
      }).filter((s) => s.trim()).join("\n\n");
    }
    function render(md) {
      const t = document.createElement("template"); t.innerHTML = N().toHTML(md);
      const f = t.content, w = document.createTreeWalker(f, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) if (n.nodeValue.includes(EMPTY)) n.nodeValue = n.nodeValue.replace(/\uE002/g, "");
      f.querySelectorAll("a[href]").forEach((a) => a.setAttribute("href", a.getAttribute("href").replace(MARKS, "")));
      // a code block ending in a newline shows its last, empty line
      f.querySelectorAll("pre > code").forEach((c) => { if (/\n[\uE000\uE001]*$/.test(c.textContent)) c.append("\n"); });
      f.querySelectorAll("p, h1, h2, h3, li, td, th").forEach(fill);
      return f;
    }
    const plain = (html) => html.replace(MARKS, "").replace(/ class="picked"/g, "");
    // put Markdown in place of the blocks (only when it draws something else)
    function redraw(nodes, md) {
      const f = render(md), html = (xs) => plain(xs.map((x) => (x.nodeType === 1 ? x.outerHTML : x.nodeValue)).join(""));
      if (html([...f.childNodes]) === html(nodes)) return false;
      if (picked && nodes.some((n) => n.contains(picked))) picked = null;
      nodes[0].before(f); nodes.forEach((n) => n.remove());
      return true;
    }
    // the top-level blocks from a's to b's, with the lists either side (in Markdown, lists that touch run together)
    function around(a, b) {
      a = top(a); b = top(b) || a; if (!a) return [];
      if (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING) [a, b] = [b, a];
      while (isList(a.previousElementSibling)) a = a.previousElementSibling;
      while (isList(b.nextElementSibling)) b = b.nextElementSibling;
      const out = []; for (let n = a; n; n = n.nextSibling) { out.push(n); if (n === b) break; }
      return out;
    }
    // change the DOM with the selection riding along as marks; fn returns the blocks to draw again from Markdown
    function reshape(fn) {
      const had = mark(), ab = fn();
      if (ab && ab[0]) { const nodes = around(ab[0], ab[1] || ab[0]); if (nodes.length) redraw(nodes, mdOf(nodes)); }
      if (had) unmark();
    }
    const tidyUp = (a, b) => reshape(() => [a, b]);
    const caretTop = () => { const s = sel(); return s.rangeCount && inEd(s.anchorNode) ? top(spot(s.anchorNode, s.anchorOffset)[0]) : null; };
    // rewrite the units the selection covers: fn(units, chosen) changes them in place, false when nothing changed
    function unitOp(fn) {
      const s = sel(); if (!s.rangeCount || !inEd(s.anchorNode)) return false;
      const r = s.getRangeAt(0), nodes = around(spot(r.startContainer, r.startOffset)[0], spot(r.endContainer, r.endOffset)[0]);
      if (!nodes.length || !mark()) return false;
      const md = mdOf(nodes), L = md.split("\n"), us = units(md), at = (ch) => L.findIndex((l) => l.includes(ch));
      const i0 = at(S0), i1 = Math.max(i0, at(S1)), chosen = i0 < 0 ? [] : us.filter((u) => u.from <= i1 && u.to > i0);
      const ok = fn(us, chosen) !== false;
      if (ok) redraw(nodes, emit(us));
      unmark(); return ok;
    }

    /* ── undo: snapshots of the whole note, with the selection as paths from the editor ── */
    let H = opts.key != null && HISTORY.get(opts.key);
    if (H) HISTORY.delete(opts.key); else H = { undo: [], redo: [] };
    let group = "", groupAt = 0, lastSpace = false;
    const pathOf = (node, off) => { const p = []; for (let n = node; n && n !== el; n = n.parentNode) p.unshift([...n.parentNode.childNodes].indexOf(n)); return { p, off }; };
    const nodeAt = (pt) => { let n = el; for (const i of pt.p) { n = n.childNodes[i]; if (!n) return null; } return n; };
    function snapshot() {
      const s = sel(), r = s.rangeCount && inEd(s.anchorNode) ? s.getRangeAt(0) : null;
      return { html: plain(el.innerHTML), a: r && pathOf(r.startContainer, r.startOffset), b: r && pathOf(r.endContainer, r.endOffset) };
    }
    // a snapshot's selection in the editor as it stands (its HTML in place)
    function selectSnap(sn) {
      const a = sn.a && nodeAt(sn.a), b = sn.b && nodeAt(sn.b); if (!a) return false;
      const r = document.createRange();
      try { r.setStart(a, Math.min(sn.a.off, len(a))); r.setEnd(b || a, Math.min((b ? sn.b : sn.a).off, len(b || a))); } catch (e) { return false; }
      el.focus({ preventScroll: true }); const s = sel(); s.removeAllRanges(); s.addRange(r);
      const box = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
      if (box && box.scrollIntoView) box.scrollIntoView({ block: "nearest" });
      return true;
    }
    function putBack(sn) { el.innerHTML = sn.html; picked = null; pending = null; if (!selectSnap(sn)) place(el.lastElementChild || el, true); }
    // before a change: a new step, unless it carries on the last one (typing a word, deleting a run)
    function checkpoint(kind, fresh) {
      const now = Date.now();
      if (kind && kind !== "cmd" && !fresh && kind === group && now - groupAt < 1500) { groupAt = now; return; }
      group = kind || ""; groupAt = now;
      const sn = snapshot(), last = H.undo[H.undo.length - 1];
      if (!last || last.html !== sn.html) { H.undo.push(sn); if (H.undo.length > STEPS) H.undo.shift(); }
      H.redo.length = 0;
    }
    function step(back) {
      const from = back ? H.undo : H.redo, to = back ? H.redo : H.undo, cur = snapshot();
      let sn; while ((sn = from.pop()) && sn.html === cur.html);
      if (!sn) return refuse(back ? "Nothing to undo in this note" : "Nothing to redo in this note");
      to.push(cur); putBack(sn); group = ""; tidy(); changed(); onSel();
      return true;
    }
    const undo = () => step(true), redo = () => step(false);

    /* ── inline formats ── */
    function fmtUp(p, re) { for (let x = p.parentNode; x && x !== el && x.nodeType === 1 && INLINE_TAGS.test(x.tagName); x = x.parentNode) if (re.test(x.tagName)) return x; return null; }
    const fmtAt = (n, k) => !!n && ((n.nodeType === 1 && FMT[k][1].test(n.tagName)) || !!fmtUp(n, FMT[k][1]));
    // the text a range covers, cut at its ends: text nodes (an inline code is one piece for the other formats), none in
    // a code block
    function pieces(r, k) {
      let { startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo } = r;
      if (ec.nodeType === 3 && eo > 0 && eo < ec.length) ec.splitText(eo);
      if (sc.nodeType === 3 && so > 0 && so < sc.length) { const nn = sc.splitText(so); if (ec === sc) { ec = nn; eo -= so; } sc = nn; so = 0; }
      const rr = document.createRange(); rr.setStart(sc, so); rr.setEnd(ec, eo);
      const root = rr.commonAncestorContainer, out = [], w = document.createTreeWalker(root.nodeType === 1 ? root : root.parentNode, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) {
        if (!rr.intersectsNode(n) || (n === sc && so >= n.length) || (n === ec && eo === 0) || !n.nodeValue.replace(JUNK, "").trim() || !el.contains(n)) continue;
        if (up(n, (x) => x.tagName === "PRE")) continue;
        const code = k !== "code" && up(n, (x) => x.tagName === "CODE"), p = code || n;
        if (!out.includes(p)) out.push(p);
      }
      return { ps: out, rr };
    }
    // wrap each text block's share of the range in one new format element (what it held of that format melts into it),
    // so a highlight runs on over bold text and across list items
    function wrapRange(rr, k) {
      const [tag, re] = FMT[k], out = [];
      const bs = [...el.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, td, th")].filter((b) => rr.intersectsNode(b) && !up(b, (x) => x.tagName === "PRE"));
      bs.forEach((b) => {
        const r = document.createRange(); r.selectNodeContents(b);
        const sub = [...b.children].find(isList); if (sub) r.setEndBefore(sub);
        if (r.compareBoundaryPoints(Range.START_TO_START, rr) < 0) r.setStart(rr.startContainer, rr.startOffset);
        if (r.compareBoundaryPoints(Range.END_TO_END, rr) > 0) r.setEnd(rr.endContainer, rr.endOffset);
        if (r.collapsed || !r.toString().replace(JUNK, "").trim()) return;
        const w = document.createElement(tag); w.append(r.extractContents());
        w.querySelectorAll("*").forEach((x) => { if (re.test(x.tagName)) x.replaceWith(...x.childNodes); });
        r.insertNode(w); out.push(w);
      });
      return out;
    }
    // take A's format off the chosen pieces; everything else in A keeps it
    function strip(A, chosen) {
      const keep = (n) => {
        for (const c of [...n.childNodes]) {
          if (chosen.has(c)) continue;
          if (c.nodeType === 1 && [...chosen].some((x) => c.contains(x))) keep(c);
          else { const w = A.cloneNode(false); c.replaceWith(w); w.append(c); }
        }
      };
      keep(A); A.replaceWith(...A.childNodes);
    }
    function setInline(k, on, ps) {
      const [tag, re] = FMT[k];
      if (on) ps.forEach((p) => { if (fmtUp(p, re)) return; const w = document.createElement(tag); p.replaceWith(w); w.append(p); });
      else { const chosen = new Set(ps); ps.forEach((p) => { for (let A; (A = fmtUp(p, re));) strip(A, chosen); }); }
    }
    const selectPieces = (ps) => { const r = document.createRange(); r.setStartBefore(ps[0]); r.setEndAfter(ps[ps.length - 1]); const s = sel(); s.removeAllRanges(); s.addRange(r); };
    // a format with nothing selected waits for what you type next, until the caret moves
    function setPending(f) { const s = sel(); pending = f && Object.keys(f).length ? { f, at: [s.anchorNode, s.anchorOffset] } : null; onSel(); }
    function toggle(k) {
      const s = sel(); if (!s.rangeCount || !inEd(s.anchorNode)) return;
      if (s.isCollapsed) {
        if (tagUp("PRE")) return;
        const cur = fmtAt(s.anchorNode, k), f = Object.assign({}, pending && pending.f), now = k in f ? f[k] : cur;
        if (!now === cur) delete f[k]; else f[k] = !now;
        return setPending(f);
      }
      const { ps, rr } = pieces(s.getRangeAt(0), k); if (!ps.length) return;
      let ends = ps;
      if (ps.every((p) => fmtUp(p, FMT[k][1]))) setInline(k, false, ps); else ends = wrapRange(rr, k);
      if (!ends.length) return;
      selectPieces(ends); tidyUp(ends[0], ends[ends.length - 1]);
    }
    // typed text with the waiting formats
    function typePending(text) {
      const f = pending.f; pending = null;
      checkpoint("type");
      const s = sel(), r = s.getRangeAt(0); if (!r.collapsed) r.deleteContents();
      const tn = document.createTextNode(text.replace(/ /g, "\u00a0")); r.insertNode(tn);
      for (const k in f) setInline(k, f[k], [tn]);
      caret(tn, tn.length); tidy(); changed(); onSel();
    }
    function clear() {
      const s = sel(); if (!s.rangeCount || !inEd(s.anchorNode)) return;
      if (s.isCollapsed) { const f = {}; Object.keys(FMT).forEach((k) => { if (fmtAt(s.anchorNode, k)) f[k] = false; }); return setPending(f); }
      const { ps } = pieces(s.getRangeAt(0), "code"); if (!ps.length) return;
      Object.keys(FMT).forEach((k) => setInline(k, false, ps));
      const chosen = new Set(ps); ps.forEach((p) => { for (let A; (A = fmtUp(p, /^A$/));) strip(A, chosen); });
      selectPieces(ps); tidyUp(ps[0], ps[ps.length - 1]);
    }

    /* ── block commands ── */
    // the selected lines become paragraphs, headings or list items; all of them that already are that turn back to text
    function setKind(kind, done) {
      if (kind === "p" && tagUp("PRE")) return codeBlock();
      const ok = unitOp((us, ch) => {
        const can = ch.filter((u) => u.t !== "keep"); if (!can.length) return false;
        const is = (u) => (kind === "p" ? u.t === "p" : kind[0] === "h" ? u.t === "h" && u.level === +kind[1] : u.t === "li" && u.kind === kind);
        const to = kind !== "p" && done == null && can.every(is) ? "p" : kind;
        can.forEach((u) => {
          if (to === "p") u.t = "p";
          else if (to[0] === "h") Object.assign(u, { t: "h", level: +to[1], text: [u.text.join(" ")] });
          else {
            if (u.t !== "li") Object.assign(u, { t: "li", indent: 0, marker: null, done: false });
            if (u.kind !== to) { u.marker = null; if (to !== "todo") u.done = false; }
            u.kind = to; if (done != null) u.done = done;
          }
        });
      });
      if (!ok && (tagUp("TD") || tagUp("TH") || up(anchor(), isBox) || tagUp("PRE"))) refuse("Tables, quotes and code blocks hold plain text · headings and lists go outside them");
      return ok;
    }
    function shift(d) {
      return unitOp((us, ch) => {
        let any = false;
        ch.filter((u) => u.t === "li").forEach((u) => { if (!u.moved && nest(us, u, d)) any = true; });
        return any;
      });
    }
    // out of the list: a nested item moves out a level, a top one becomes a paragraph
    function unlist() {
      return unitOp((us, ch) => {
        const u = ch.find((x) => x.t === "li"); if (!u) return false;
        if (u.indent) return nest(us, u, -1);
        u.t = "p";
      });
    }
    // Enter in a list item with text: the text after the caret, and the items under it, go to a new item below
    function splitItem(li) {
      const s = sel(), r = s.getRangeAt(0).cloneRange(), sub = [...li.children].find(isList);
      if (sub) r.setEndBefore(sub); else r.setEnd(li, li.childNodes.length);
      const nli = document.createElement("li");
      nli.append(r.extractContents()); [...li.children].filter(isList).forEach((l) => nli.append(l));
      li.after(nli); fill(li); fill(nli);
      [...nli.childNodes].forEach((c) => { if (c.nodeType === 3 && !c.nodeValue) c.remove(); });
      const first = nli.firstChild && nli.firstChild.nodeType === 3 ? nli.firstChild : null;
      if (first) caret(first, 0); else caret(nli, 0);
      tidyUp(nli, nli);
    }
    // wrap the caret's block (or the blocks the selection spans) in a quote or a callout; again, unwrap or next kind
    function wrapBlock(kind, ck) {
      const box = up(anchor(), isBox);
      if (box) {
        const isQ = box.tagName === "BLOCKQUOTE", cur = box.dataset.kind;
        if (kind === "callout" && !isQ && !ck && KINDS.indexOf(cur) < KINDS.length - 1) { box.dataset.kind = KINDS[KINDS.indexOf(cur) + 1]; opts.onCallout && opts.onCallout(box.dataset.kind); return; }
        if (kind === "callout" && isQ) return reshape(() => { const d = document.createElement("div"); d.className = "callout"; d.dataset.kind = ck || "note"; d.append(...box.childNodes); box.replaceWith(d); opts.onCallout && opts.onCallout(d.dataset.kind); return [d, d]; });
        if (kind === "quote" && !isQ) return reshape(() => { const q = document.createElement("blockquote"); q.append(...box.childNodes); box.replaceWith(q); return [q, q]; });
        return reshape(() => { const kids = [...box.children]; box.replaceWith(...box.childNodes); return [kids[0], kids[kids.length - 1]]; });
      }
      const s = sel(), r = s.rangeCount && s.getRangeAt(0); if (!r) return;
      let a = top(spot(r.startContainer, r.startOffset)[0]), b = top(spot(r.endContainer, r.endOffset)[0]) || a; if (!a) return;
      if (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING) [a, b] = [b, a];
      const nodes = []; for (let n = a; n; n = n.nextElementSibling) { nodes.push(n); if (n === b) break; }
      if (nodes.some((n) => /^(TABLE|PRE|HR)$/.test(n.tagName) || isBox(n))) return refuse("Quotes and callouts hold text · tables, code and dividers stay outside");
      reshape(() => {
        const q = kind === "quote" ? document.createElement("blockquote") : document.createElement("div");
        if (kind !== "quote") { q.className = "callout"; q.dataset.kind = ck || "note"; }
        a.before(q);
        const para = (from) => { const p = document.createElement("p"); [...from.childNodes].filter((c) => !isList(c)).forEach((c) => p.append(c)); fill(p); q.append(p); };
        nodes.forEach((n) => { if (isList(n)) n.querySelectorAll("li").forEach(para); else if (/^H\d$/.test(n.tagName)) para(n); else q.append(n); if (n.parentNode !== q) n.remove(); });
        return [q, q];
      });
      if (kind === "callout") opts.onCallout && opts.onCallout(ck || "note");
    }
    function codeBlock(lang) {
      const pre = tagUp("PRE");
      if (pre) {
        return reshape(() => {
          const lines = pre.textContent.replace(/\n([\uE000\uE001]*)$/, "$1").split("\n"), ps = lines.map((l) => { const p = document.createElement("p"); p.textContent = l; fill(p); return p; });
          pre.replaceWith(...ps); return [ps[0], ps[ps.length - 1]];
        });
      }
      const s = sel(), r = s.rangeCount && s.getRangeAt(0); if (!r) return;
      let a = top(spot(r.startContainer, r.startOffset)[0]), b = top(spot(r.endContainer, r.endOffset)[0]) || a; if (!a) return;
      if (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING) [a, b] = [b, a];
      const nodes = []; for (let n = a; n; n = n.nextElementSibling) { nodes.push(n); if (n === b) break; }
      if (nodes.some((n) => /^(TABLE|HR)$/.test(n.tagName))) return refuse("Tables and dividers can't go in a code block");
      reshape(() => {
        const lines = []; nodes.forEach((n) => { if (isList(n)) n.querySelectorAll("li").forEach((li) => lines.push([...li.childNodes].filter((c) => !isList(c)).map((c) => c.textContent).join(""))); else lines.push(n.innerText != null ? n.innerText.replace(/\n$/, "") : n.textContent); });
        const p = document.createElement("pre"), c = document.createElement("code"); if (lang) p.dataset.lang = lang;
        c.textContent = lines.join("\n").replace(/[\u200b\uE002]/g, ""); if (!c.textContent) c.append(document.createElement("br"));
        p.append(c); a.before(p); nodes.forEach((n) => n.remove()); return [p, p];
      });
    }
    function insertTable(rows, cols) {
      rows = rows || 3; cols = cols || 3;
      const t = document.createElement("template"), row = (tag) => `<tr>${Array.from({ length: cols }, () => `<${tag}><br></${tag}>`).join("")}</tr>`;
      t.innerHTML = `<table><thead>${row("th")}</thead><tbody>${Array.from({ length: rows - 1 }, () => row("td")).join("")}</tbody></table>`;
      const table = t.content.firstChild, at = caretTop();
      if (at && at.tagName === "P" && bare(at)) at.before(table); else if (at) at.after(table); else el.append(table);
      if (!table.nextElementSibling) { const p = document.createElement("p"); p.innerHTML = "<br>"; table.after(p); }
      place(table.querySelector("th")); changed();
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
        if (tr.parentNode.tagName === "THEAD" || rows.length <= 1) return refuse("The header row stays; delete the table instead");
        const next = tr.nextElementSibling || tr.previousElementSibling; tr.remove(); if (next) place(next.children[Math.min(ci, next.children.length - 1)]);
      } else if (op === "colDel") {
        if (tr.children.length <= 1) return refuse("A table keeps one column; delete the table instead");
        rows.forEach((r) => r.children[ci] && r.children[ci].remove()); place(tr.children[Math.max(0, ci - 1)]);
      } else if (op === "tableDel") { const p = document.createElement("p"); p.innerHTML = "<br>"; table.replaceWith(p); place(p); }
      changed();
    }
    function link(url) {
      restore(); checkpoint("cmd");
      const a = tagUp("A");
      if (!url) { if (a) { selectNode(a); busy = true; exec("unlink"); busy = false; const t = caretTop(); if (t) tidyUp(t, t); } return after(); }
      if (!/^(https?:|mailto:|#)/i.test(url)) url = /^[\w.-]+@[\w.-]+$/.test(url) ? "mailto:" + url : "https://" + url;
      if (a) { a.setAttribute("href", url); return after(); }
      const s = sel();
      if (s.isCollapsed) { const n = document.createElement("a"); n.href = url; n.textContent = url.replace(/^mailto:/, ""); const r = s.getRangeAt(0); r.insertNode(n); caret(n.parentNode, [...n.parentNode.childNodes].indexOf(n) + 1); }
      else { const t0 = caretTop(); busy = true; exec("createLink", url); busy = false; tidyUp(t0, caretTop()); }
      after();
    }
    // the selection is lost when a toolbar field takes focus: keep it for the link box
    function keep() { const s = sel(); saved = s.rangeCount && inEd(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; return saved; }
    function restore() { if (!saved) return; el.focus(); const s = sel(); s.removeAllRanges(); s.addRange(saved); saved = null; }
    function toggleCheck(li) {
      li = li || tagUp("LI"); if (!li || !li.closest("ul.todo")) return false;
      checkpoint("cmd");
      if (li.dataset.done === "1") li.removeAttribute("data-done"); else li.dataset.done = "1";
      opts.onCheck && opts.onCheck(li, li.dataset.done === "1"); changed(); return true;
    }
    // a divider after the caret's block (in place of it when it's empty), then a line to write on
    function hr() {
      const at = caretTop(), h = document.createElement("hr");
      if (at && at.tagName === "P" && bare(at)) { at.before(h); return place(at); }
      if (at) at.after(h); else el.append(h);
      const p = document.createElement("p"); p.innerHTML = "<br>"; h.after(p); place(p);
    }
    function restoreLast() { el.focus(); const s = sel(); s.removeAllRanges(); if (lastRange && el.contains(lastRange.commonAncestorContainer)) s.addRange(lastRange); else place(el.lastElementChild || el, true); }
    const after = () => { tidy(); changed(); onSel(); };

    /* ── images: picking, placing, sizing, moving, drawings in and out ── */
    function pickSel() {
      const s = sel(); let img = null;
      if (s.rangeCount && !s.isCollapsed) {
        const r = s.getRangeAt(0), c = r.commonAncestorContainer, box = c.nodeType === 1 ? c : c.parentNode;
        if (box && !r.toString().replace(JUNK, "").trim()) { const imgs = [...box.querySelectorAll("img")].filter((i) => r.intersectsNode(i)); if (imgs.length === 1 && el.contains(imgs[0])) img = imgs[0]; }
      }
      if (img === picked) return;
      if (picked) picked.classList.remove("picked");
      picked = img; if (img) img.classList.add("picked");
    }
    const imgOf = (img) => ({ src: img.getAttribute("src"), alt: img.getAttribute("alt") || "", place: img.dataset.place || "", w: +img.dataset.w || 0 });
    const imgEl = (o) => { const t = document.createElement("template"); t.innerHTML = N().imgHTML(o); return t.content.firstChild; };
    const pickImg = (img) => { selectNode(img); pickSel(); after(); return img; };
    // a new drawing at the caret: in a list item or a table cell it goes in the line, else on a line of its own
    function insertDrawing(d) {
      restoreLast(); const s = sel(); if (s.rangeCount && !s.isCollapsed) s.collapseToEnd();
      checkpoint("cmd");
      const img = imgEl({ src: d.src, alt: "Drawing", place: d.place == null ? "center" : d.place, w: d.w || 0 }), b = block();
      if (b && /^(LI|TD|TH)$/.test(b.tagName)) s.getRangeAt(0).insertNode(img);
      else if (b && b.tagName === "P" && bare(b)) { b.textContent = ""; b.append(img); }
      else { const p = document.createElement("p"); p.append(img); const t = caretTop(); if (t) t.after(p); else el.append(p); }
      return pickImg(img);
    }
    // the same image with some attributes changed (a patch of imgOf), or gone (null)
    function replaceImg(img, patch) {
      if (!img || !el.contains(img)) return null;
      el.focus({ preventScroll: true }); checkpoint("cmd");
      if (!patch) { const p = img.parentNode; caret(p, [...p.childNodes].indexOf(img)); img.remove(); fill(p); picked = null; after(); return null; }
      const n = imgEl(Object.assign(imgOf(img), patch)); img.replaceWith(n); if (picked === img) picked = null;
      return pickImg(n);
    }
    // Drag an image anywhere: it moves with the pointer through the text, wrapping at the left or right edge
    function dragImg(img, e0) {
      const x0 = e0.clientX, y0 = e0.clientY, from = img.parentNode, place0 = img.dataset.place || "";
      let on = false, raf = 0, x = x0, y = y0;
      const move = (e) => {
        x = e.clientX; y = e.clientY;
        if (!on) { if (Math.hypot(x - x0, y - y0) < 5) return; on = true; checkpoint("cmd"); img.classList.add("moving"); el.classList.add("moving-img"); }
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; follow(img, x, y, place0); });
      };
      const end = () => {
        removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); cancelAnimationFrame(raf);
        if (!on) return;
        follow(img, x, y, place0); // where it was let go
        img.classList.remove("moving"); el.classList.remove("moving-img");
        // the line it left, if that was all it held
        if (from && from !== img.parentNode && from.isConnected && from.tagName === "P" && bare(from) && el.children.length > 1) from.remove();
        selectNode(img); const t = top(img); if (t) tidyUp(t, t);
        after();
      };
      addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end);
    }
    function follow(img, x, y, place0) {
      const box = el.getBoundingClientRect(), fx = (x - box.left) / Math.max(1, box.width);
      const where = fx < 0.25 ? "left" : fx > 0.75 ? "right" : place0 === "" ? "" : "center";
      const hit = document.caretRangeFromPoint && document.caretRangeFromPoint(Math.max(box.left + 6, Math.min(box.right - 6, x)), Math.max(box.top + 2, Math.min(box.bottom - 2, y)));
      if (!hit || !inEd(hit.startContainer)) return;
      let [n, off] = spot(hit.startContainer, hit.startOffset);
      if (n === img || img.contains(n) || !inEd(n) || up(n, (q) => q.tagName === "PRE" || q.tagName === "CODE") || n === el) return;
      // floats start their line's block
      if (where === "left" || where === "right") { const b = block(n); if (b) { n = b; off = 0; } }
      // already there: don't shuffle (a move reflows the text under the pointer)
      const near = (n === img.parentNode && (off === [...n.childNodes].indexOf(img) || off === [...n.childNodes].indexOf(img) + 1))
        || (n.nodeType === 3 && ((off === n.length && n.nextSibling === img) || (off === 0 && n.previousSibling === img)));
      if (where) img.dataset.place = where; else delete img.dataset.place;
      if (near) return;
      const r = document.createRange(); r.setStart(n, off); r.collapse(true); r.insertNode(img);
    }

    const RUN = {
      undo, redo, p: () => setKind("p"), h1: () => setKind("h1"), h2: () => setKind("h2"), h3: () => setKind("h3"),
      b: () => toggle("b"), i: () => toggle("i"), u: () => toggle("u"), s: () => toggle("s"), mark: () => toggle("mark"), code: () => toggle("code"),
      link: () => opts.onLink && opts.onLink(keep(), (tagUp("A") || {}).href || ""), ul: () => setKind("ul"), ol: () => setKind("ol"), todo: () => setKind("todo"),
      indent: () => shift(1), outdent: () => shift(-1), quote: () => wrapBlock("quote"), callout: () => wrapBlock("callout"), pre: () => codeBlock(),
      table: () => insertTable(3, 3), hr, clear, check: () => toggleCheck(),
      draw: () => opts.onDraw && opts.onDraw(null), imgEdit: () => picked && opts.onDraw && opts.onDraw(picked), imgDel: () => replaceImg(picked, null),
    };
    TABLE_TOOLS.forEach(([id]) => (RUN[id] = () => tableOp(id)));
    IMG_PLACES.forEach(([p]) => (RUN["img_" + (p || "inline")] = () => replaceImg(picked, { place: p })));
    // commands that save a step of their own (or none)
    const OWN_STEP = /^(undo|redo|link|draw|imgEdit|imgDel|img_|check)/;

    /* ── typing ── */
    // Markdown at the start of a line: the marker goes, the block takes its place (undo brings the marker back)
    function autoBlock() {
      const at = before(); if (!at) return false;
      const { b, r } = at, t = at.text.replace(/\u00a0/g, " ").replace(JUNK, "");
      const inBox = !!up(b, isBox), cut = () => { checkpoint("cmd"); r.deleteContents(); fill(b); place(b); };
      if (b.tagName === "LI") {
        const m = /^\[( |x)?\] $/i.exec(t); if (!m) return false;
        cut(); setKind("todo", !!m[1] && m[1].toLowerCase() === "x"); return true;
      }
      if (!/^(P|H[1-6])$/.test(b.tagName) || up(b, (x) => /^(TD|TH)$/.test(x.tagName))) return false;
      let m;
      if (inBox) return false;
      if ((m = /^(#{1,3}) $/.exec(t))) { cut(); setKind("h" + m[1].length); return true; }
      if (/^[-*+] $/.test(t)) { cut(); setKind("ul"); return true; }
      if (/^1[.)] $/.test(t)) { cut(); setKind("ol"); return true; }
      if ((m = /^(?:[-*+] )?\[( |x)?\] $/i.exec(t))) { cut(); setKind("todo", !!m[1] && m[1].toLowerCase() === "x"); return true; }
      if ((m = /^>\s?\[!(note|tip|important|warning)\] $/i.exec(t))) { cut(); wrapBlock("callout", m[1].toLowerCase()); return true; }
      if (/^> $/.test(t)) { cut(); wrapBlock("quote"); return true; }
      if ((m = /^```([\w+#.-]*) $/.exec(t))) { cut(); codeBlock(m[1]); return true; }
      return false;
    }
    // **bold** *italic* ~~strike~~ ==highlight== `code`, as the closing mark is typed, inside one run of text; what you
    // type next comes out plain
    const INLINE = [[/(^|[^*\\])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, "b"], [/(^|[^~\\])~~([^~\s](?:[^~]*[^~\s])?)~~$/, "s"], [/(^|[^=\\])==([^=\s](?:[^=]*[^=\s])?)==$/, "mark"],
      [/(^|[^*\\\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, "i"], [/(^|[^`\\])`([^`]+)`$/, "code"]];
    function autoInline() {
      const s = sel(), n = s.anchorNode; if (!n || n.nodeType !== 3 || tagUp("PRE") || tagUp("CODE")) return false;
      const end = s.anchorOffset, text = n.nodeValue.slice(0, end);
      for (const [re, k] of INLINE) {
        const m = re.exec(text); if (!m) continue;
        checkpoint("cmd");
        const mid = n.splitText(m.index + m[1].length); mid.splitText(end - m.index - m[1].length);
        const T = document.createElement(FMT[k][0]); T.textContent = m[2]; mid.replaceWith(T);
        caret(T.firstChild, T.firstChild.length); setPending({ [k]: false });
        return true;
      }
      return false;
    }
    // Enter at an empty last line leaves a code block, a quote or a callout, like it leaves a list
    function leaveBox(e) {
      const pre = tagUp("PRE"), s = sel();
      if (pre) {
        e.preventDefault(); checkpoint("cmd");
        const r = document.createRange(); r.selectNodeContents(pre); r.setStart(s.anchorNode, s.anchorOffset);
        const h = document.createRange(); h.selectNodeContents(pre); h.setEnd(s.anchorNode, s.anchorOffset);
        const rest = r.toString().replace(JUNK, ""), head = h.toString().replace(JUNK, "");
        if ((!rest || rest === "\n") && /\n$/.test(head) && head.trim()) {
          const code = pre.querySelector("code") || pre; code.textContent = head.replace(/\n+$/, "");
          const p = document.createElement("p"); p.innerHTML = "<br>"; pre.after(p); place(p); after(); return true;
        }
        busy = true; exec("insertText", "\n"); if (!rest) exec("insertText", "\n"); busy = false;
        if (!rest) { const s2 = sel(); s2.modify("move", "backward", "character"); }
        after(); return true;
      }
      const b = block(), box = b && up(b, isBox);
      if (box && b.parentNode === box && bare(b) && b === box.lastElementChild && box.children.length > 1) {
        e.preventDefault(); checkpoint("cmd"); box.after(b); place(b); after(); return true;
      }
      return false;
    }
    function onEnter(e) {
      if (leaveBox(e)) return true;
      const b = block();
      if (b && (b.tagName === "TD" || b.tagName === "TH")) { e.preventDefault(); checkpoint("cmd"); busy = true; exec("insertLineBreak"); busy = false; after(); return true; }
      if (b && b.tagName === "LI") {
        e.preventDefault(); checkpoint("cmd");
        const s = sel();
        if (!s.isCollapsed) { busy = true; exec("delete"); busy = false; }
        const li = block(); if (!li || li.tagName !== "LI") { after(); return true; }
        const own = [...li.childNodes].filter((c) => !isList(c)), empty = !own.some((c) => (c.nodeType === 3 ? c.nodeValue.replace(JUNK, "") : c.tagName === "IMG" || (c.nodeType === 1 && c.textContent.replace(JUNK, ""))));
        if (empty) unlist(); else splitItem(li);
        after(); return true;
      }
      return false;
    }
    // Backspace at the start of a block takes its kind away before it joins the line above
    function onBack(e) {
      const s = sel(); if (!s.rangeCount || !s.isCollapsed) return false;
      const b = block(); if (!b || !atStart(b)) return false;
      const T = b.tagName, stop = () => { e.preventDefault(); checkpoint("cmd"); };
      if (T === "LI") { stop(); unlist(); after(); return true; }
      if (/^H[1-6]$/.test(T)) { stop(); setKind("p"); after(); return true; }
      if (T === "TD" || T === "TH") { e.preventDefault(); return true; }
      const box = b.parentNode;
      if (T === "P" && isBox(box) && b === box.firstElementChild) { stop(); reshape(() => { box.before(b); if (!box.children.length) box.remove(); return [b, b]; }); after(); return true; }
      if (T === "PRE" && !b.textContent.replace(JUNK, "").trim()) { stop(); const p = document.createElement("p"); p.innerHTML = "<br>"; b.replaceWith(p); place(p); after(); return true; }
      const prev = b.parentNode === el && b.previousElementSibling;
      if (prev && prev.tagName === "HR") { stop(); prev.remove(); after(); return true; }
      if (prev && prev.tagName === "TABLE") { e.preventDefault(); if (bare(b)) { checkpoint("cmd"); b.remove(); const c = prev.querySelectorAll("th, td"); place(c[c.length - 1], true); after(); } else { const c = prev.querySelectorAll("th, td"); place(c[c.length - 1], true); } return true; }
      return false;
    }
    // Delete at the end of a block before a divider takes the divider
    function onDel(e) {
      const b = block(); if (!b || b.parentNode !== el || !atEnd(b)) return false;
      const next = b.nextElementSibling;
      if (next && next.tagName === "HR") { e.preventDefault(); checkpoint("cmd"); next.remove(); after(); return true; }
      if (next && next.tagName === "TABLE") { e.preventDefault(); return true; }
      return false;
    }
    function onBefore(e) {
      const t = e.inputType || "";
      if (t === "historyUndo" || t === "historyRedo") { e.preventDefault(); return t === "historyUndo" ? undo() : redo(); }
      if (/^format/.test(t)) { e.preventDefault(); const k = { formatBold: "b", formatItalic: "i", formatUnderline: "u", formatStrikeThrough: "s" }[t]; if (k) api.run(k); return; }
      if (busy) return;
      if (t === "insertText" && pending && e.data && !composing) { e.preventDefault(); return typePending(e.data); }
      const s = sel();
      pre = { b: block(), n: el.childElementCount, range: !!(s.rangeCount && !s.isCollapsed) };
      if (t === "insertText" || t === "insertCompositionText") { const sp = /^\s+$/.test(e.data || ""); checkpoint("type", (!sp && lastSpace) || pre.range); lastSpace = sp; }
      else if (/^delete(Content|Word|SoftLine|HardLine)/.test(t) && !pre.range) checkpoint(t);
      else checkpoint("cmd");
    }
    function onInput(e) {
      if (busy || composing) return;
      const t = e.inputType || "";
      if (t === "insertText" && e.data === " " && autoBlock()) return after();
      if (t === "insertText" && /[*~=`]/.test(e.data || "") && autoInline()) return after();
      if (t === "insertText" && e.data === "-") {
        const at = before();
        if (at && at.b.tagName === "P" && at.b.parentNode === el && at.text === "---" && at.b.textContent === "---") {
          checkpoint("cmd"); const h = document.createElement("hr"); at.b.before(h); at.b.innerHTML = "<br>"; place(at.b); return after();
        }
      }
      // a change that reshaped blocks (Enter, a merge, a paste, a cut across lines) draws them again from Markdown
      const shaped = !/^(insertText|insertCompositionText|insertLineBreak|deleteContentBackward|deleteContentForward|deleteWordBackward|deleteWordForward)$/.test(t)
        || (pre && (pre.range || pre.b !== block() || !(pre.b && pre.b.isConnected) || pre.n !== el.childElementCount));
      if (shaped) { const b = caretTop(); if (b) tidyUp(b.previousElementSibling || b, b); }
      after();
    }
    function moveCell(d) {
      const cell = up(anchor(), (x) => x.tagName === "TD" || x.tagName === "TH"); if (!cell) return false;
      const cells = [...cell.closest("table").querySelectorAll("th, td")], i = cells.indexOf(cell) + d;
      if (i >= cells.length) { checkpoint("cmd"); tableOp("rowBelow"); return true; }
      if (i >= 0) { const r = document.createRange(); r.selectNodeContents(cells[i]); const s = sel(); s.removeAllRanges(); s.addRange(r); }
      return true;
    }
    function onKey(e) {
      if (e.isComposing || composing) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key, lk = k.toLowerCase();
      const go = (id) => { e.preventDefault(); e.stopPropagation(); api.run(id); };
      if (mod && !e.altKey && (lk === "z" || lk === "y")) { e.preventDefault(); e.stopPropagation(); return lk === "y" || e.shiftKey ? redo() : undo(); }
      if (k === "Enter" && !e.shiftKey && !mod && onEnter(e)) return;
      if (k === "Backspace" && !mod && !e.shiftKey && !e.altKey && onBack(e)) return;
      if (k === "Delete" && !mod && !e.shiftKey && !e.altKey && onDel(e)) return;
      if (k === "Enter" && mod && !e.shiftKey && tagUp("LI")) { if (toggleCheck()) { e.preventDefault(); return; } }
      if (k === "Tab" && !mod && !e.altKey) {
        if (tagUp("TD") || tagUp("TH")) { e.preventDefault(); moveCell(e.shiftKey ? -1 : 1); return; }
        if (tagUp("LI")) return go(e.shiftKey ? "outdent" : "indent");
        if (tagUp("PRE")) { e.preventDefault(); checkpoint("type"); busy = true; exec("insertText", "  "); busy = false; return after(); }
        return; // Tab elsewhere moves focus, as it should
      }
      if (!mod) return;
      if (e.altKey && /^[0-3]$/.test(k)) return go(k === "0" ? "p" : "h" + k);
      if (e.altKey && (lk === "c" || e.code === "KeyC")) return go("pre");
      if (e.altKey) return;
      if (e.shiftKey && (e.code === "Digit8" || k === "*")) return go("ul");
      if (e.shiftKey && (e.code === "Digit7" || k === "&")) return go("ol");
      if (e.shiftKey && (e.code === "Digit9" || k === "(")) return go("todo");
      if (e.shiftKey && lk === "x") return go("s");
      if (e.shiftKey && lk === "h") return go("mark");
      if (e.shiftKey && lk === "c") return go("callout");
      if (e.shiftKey && (lk === "d" || e.code === "KeyD")) return go("draw");
      if (e.shiftKey && (k === ">" || e.code === "Period")) return go("quote");
      if (!e.shiftKey && (lk === "b" || lk === "i" || lk === "u")) return go(lk);
      if (!e.shiftKey && lk === "e") return go("code");
      if (!e.shiftKey && lk === "k") return go("link");
      if (!e.shiftKey && k === "\\") return go("clear");
    }
    // insert HTML the web view's way (it splits blocks well), then draw what it touched again from Markdown
    function insertHTML(html, asText) {
      const t0 = caretTop(), prev = t0 && t0.previousElementSibling;
      busy = true; exec(asText ? "insertText" : "insertHTML", html); busy = false;
      tidy(); const t1 = caretTop(), a = prev ? prev.nextElementSibling || prev : el.firstElementChild;
      if (a) tidyUp(a, t1 || a);
    }
    // paste: HTML (a web page, Word, Google Docs) and Markdown come in through Markdown, so only what a note can hold stays
    function onPaste(e) {
      const cd = e.clipboardData; if (!cd) return;
      e.preventDefault();
      if ([...cd.files || []].some((f) => /^image\//.test(f.type))) return refuse("Pictures aren't kept in notes yet · paste an image link, or make a drawing");
      const html = cd.getData("text/html"), text = cd.getData("text/plain");
      checkpoint("cmd");
      if (tagUp("PRE") || tagUp("CODE")) { busy = true; exec("insertText", text); busy = false; return after(); }
      let md = null;
      if (html && !/^\s*$/.test(html)) md = N().fromHTML(html);
      else if (text && /(^|\n)(#{1,3} |[-*+] |\d+[.)] |> |```|\|.*\|)|\*\*\S|\[[^\]]+\]\(/.test(text)) md = text;
      if (md == null) { if (text) insertHTML(text, true); return after(); }
      const out = N().toHTML(md), single = !/\n/.test(md.trim()) && !/^(#|[-*+] |\d+[.)] |>|```|\|)/.test(md.trim());
      insertHTML(single ? out.replace(/^<p>|<\/p>$/g, "") : out);
      after();
    }
    // files dropped on the page come in where they land (Markdown, text, HTML, Word)
    function onDrop(e) {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
      e.preventDefault();
      if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(e.clientX, e.clientY); if (r) { const s = sel(); s.removeAllRanges(); s.addRange(r); } }
      N().readFile(f).then((d) => { el.focus(); checkpoint("cmd"); insertHTML(N().toHTML((d.title && !/^#/.test(d.body) ? "## " + d.title + "\n\n" : "") + d.body)); after(); })
        .catch((err) => refuse("Couldn't read " + f.name + " · " + err.message));
    }
    function onDown(e) {
      // a click on a checklist item's box (its left padding) ticks it
      const li = e.target.closest && e.target.closest("ul.todo > li");
      if (li && e.target === li) {
        const pad = parseFloat(getComputedStyle(li).paddingLeft) || 0, x = e.clientX - li.getBoundingClientRect().left;
        if (x >= 0 && x < pad) { e.preventDefault(); toggleCheck(li); return; }
      }
      // a press on an image picks it, and dragging it moves it
      const img = e.target.closest && e.target.closest("img");
      if (img && el.contains(img) && e.button === 0) { e.preventDefault(); el.focus({ preventScroll: true }); selectNode(img); pickSel(); onSel(); dragImg(img, e); return; }
      // a press inside selected text starts a new selection rather than dragging the text away
      const s = sel();
      if (e.button === 0 && e.detail === 1 && !e.shiftKey && s.rangeCount && !s.isCollapsed && inEd(s.anchorNode) && document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (r && inEd(r.startContainer)) { s.removeAllRanges(); s.addRange(r); }
      }
    }
    // links open with Ctrl/⌘+click (a plain click puts the caret in them)
    function onClick(e) {
      const a = e.target.closest && e.target.closest("a[href]"); if (!a || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault(); opts.onOpen && opts.onOpen(a.getAttribute("href"));
    }
    // a double-click on a drawing opens it to draw on
    function onDbl(e) {
      const img = e.target.closest && e.target.closest("img"); if (!img || !el.contains(img)) return;
      e.preventDefault(); selectNode(img); pickSel();
      if (CA.draw && CA.draw.isDrawing(img.getAttribute("src"))) opts.onDraw && opts.onDraw(img);
    }
    function state() {
      const n = anchor(); if (!n) return null;
      const b = block(n), li = tagUp("LI", n), l = li && li.parentNode, on = (k) => (pending && k in pending.f ? pending.f[k] : fmtAt(n, k));
      return {
        block: b ? b.tagName.toLowerCase() : "p", b: on("b"), i: on("i"), u: on("u"), s: on("s"), mark: on("mark"), code: on("code") && !tagUp("PRE", n),
        link: !!tagUp("A", n), ul: !!l && l.tagName === "UL" && !l.classList.contains("todo"), ol: !!l && l.tagName === "OL", todo: !!l && l.classList.contains("todo"),
        quote: !!tagUp("BLOCKQUOTE", n), callout: (up(n, (x) => x.classList && x.classList.contains("callout")) || { dataset: {} }).dataset.kind || "", pre: !!tagUp("PRE", n),
        table: !!up(n, (x) => x.tagName === "TD" || x.tagName === "TH"),
        img: picked ? Object.assign(imgOf(picked), { drawing: !!(CA.draw && CA.draw.isDrawing(picked.getAttribute("src"))) }) : null,
      };
    }
    // the last place the caret was in the text, for tools that take focus away (the AI panel inserts there)
    const onSel = () => {
      const s = sel();
      if (pending && (s.anchorNode !== pending.at[0] || s.anchorOffset !== pending.at[1])) pending = null;
      if (!anchor()) return; pickSel(); lastRange = s.getRangeAt(0).cloneRange(); opts.onState && opts.onState(state());
    };
    el.addEventListener("beforeinput", onBefore); el.addEventListener("input", onInput); el.addEventListener("keydown", onKey); el.addEventListener("paste", onPaste);
    el.addEventListener("drop", onDrop); el.addEventListener("mousedown", onDown); el.addEventListener("click", onClick); el.addEventListener("dblclick", onDbl);
    // nothing is dragged out of the text: images move by the pointer (dragImg), and selected text never moves
    el.addEventListener("dragstart", (e) => e.preventDefault());
    el.addEventListener("compositionstart", () => { composing = true; });
    el.addEventListener("compositionend", () => { composing = false; const b = caretTop(); if (b) tidyUp(b, b); after(); });
    document.addEventListener("selectionchange", onSel);

    // a note's canonical Markdown, to tell whether it changed while it was closed
    const canon = (html) => { const d = document.createElement("div"); d.innerHTML = html; return N().fromDOM(d); };
    function load(md) { el.innerHTML = N().toHTML(md || ""); picked = null; pending = null; tidy(); last = N().fromDOM(el); }
    const api = {
      // the image and drawing tools work on the picked image wherever the caret has gone
      el, run(id) {
        if (!RUN[id]) return;
        if (!anchor() && !/^(link|draw|img|undo|redo)/.test(id)) { el.focus(); if (!anchor()) place(el.lastElementChild || el, true); }
        if (!OWN_STEP.test(id)) checkpoint("cmd");
        RUN[id](); after();
      },
      undo, redo,
      md: () => N().fromDOM(el),
      // the text from elsewhere (an assistant, another device): a step of its own, so undo brings yours back
      set(md) { checkpoint("cmd"); load(md); },
      flush: () => changed(true),
      focus(atEnd) {
        el.focus();
        if (resume) { const r = resume; resume = null; if (selectSnap(r)) return; }
        if (atEnd !== false) place(el.lastElementChild || el, true);
      },
      link, keep, restore, state, insertTable,
      selectionMD() { if (!lastRange || lastRange.collapsed || !el.contains(lastRange.commonAncestorContainer)) return ""; const d = document.createElement("div"); d.appendChild(lastRange.cloneContents()); return N().fromDOM(d); },
      restoreLast, insertDrawing, replaceImg, picked: () => picked,
      // the width slider shows its size as you drag; letting go sets it (imgSet), one undo step
      imgLive(w) { if (picked) picked.style.width = w + "%"; }, imgSet: (patch) => replaceImg(picked, patch),
      insertMD(md) { el.focus(); if (!anchor()) place(el.lastElementChild || el, true); checkpoint("cmd"); insertHTML(N().toHTML(md)); after(); },
      // headings as they stand, for the outline
      headings: () => [...el.querySelectorAll("h1, h2, h3")].map((h) => ({ level: +h.tagName[1], text: h.textContent.trim(), el: h })).filter((h) => h.text),
      // closing keeps the history (and how the note looked, blank lines and all) for the next time it opens
      destroy() {
        clearTimeout(timer); document.removeEventListener("selectionchange", onSel);
        if (opts.key == null) return;
        H.last = snapshot(); HISTORY.set(opts.key, H);
        while (HISTORY.size > KEEP_NOTES) HISTORY.delete(HISTORY.keys().next().value);
      },
    };
    // Opening a note it has a history for: as it was left when nothing changed it since, else a step back to that
    if (H.last && canon(H.last.html) === canon(N().toHTML(opts.md || ""))) { el.innerHTML = H.last.html; tidy(); last = N().fromDOM(el); resume = H.last; }
    else { if (H.last) { H.undo.push(H.last); H.redo.length = 0; } load(opts.md || ""); }
    H.last = null;
    return api;
  }

  CA.editor = { mount, TOOLS, TABLE_TOOLS, IMG_PLACES };
})();
