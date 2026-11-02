/* Collegiapp — AI (CA.ai). Your own chatbot subscription does the work, never a paid API key: inside the app a chat
   CLI you're signed in to (Claude Code; Codex CLI or Gemini CLI) runs headless on this computer with no tools
   (src-tauri/src/ai.rs); anywhere else the prompt goes on your clipboard for the chat website and you paste the reply
   back. This file is pure: the rules the AI is told (the app's own formatting), the prompt built from what you chose
   to share, and the reply read back into actions the app applies when you click Apply (docs/AI.md). */
(function () {
  const CA = (window.CA = window.CA || {});

  const TOOLS = [
    { id: "claude", name: "Claude Code", sub: "Claude Pro or Max", cli: true, site: "https://claude.ai/new", q: true,
      models: [["", "Default"], ["sonnet", "Sonnet"], ["opus", "Opus"], ["haiku", "Haiku (fastest)"]] },
    { id: "codex", name: "Codex CLI", sub: "ChatGPT Plus or Pro", cli: true, site: "https://chatgpt.com/", q: true, models: [["", "Default"]] },
    { id: "gemini", name: "Gemini CLI", sub: "Google account", cli: true, site: "https://gemini.google.com/app", q: false, models: [["", "Default"]] },
  ];
  const SITES = [["claude", "Claude", "https://claude.ai/new", true], ["chatgpt", "ChatGPT", "https://chatgpt.com/", true], ["gemini", "Gemini", "https://gemini.google.com/app", false]];

  // What the AI knows about the app. The Markdown rules are notes.js's (docs/NOTES.md); the grammar is quickadd.rs's.
  const RULES = `You are the assistant inside Collegiapp, a university student's planner and notes app. You only write text: you can't open files, browse or run tools. The app shows your reply and applies the blocks below when the user clicks Apply.

HOW TO REPLY
Say what you did or found in a few plain sentences. Put anything the app should change in blocks, each opened by a line starting with ::: and closed by a line that is only :::
:::replace
The whole new text of the note in context, in Collegiapp Markdown.
:::
:::insert
Markdown to put in the note: it replaces the selected text when there is a selection, otherwise it goes where the cursor is.
:::
:::note Title of a new note
The new note's text in Collegiapp Markdown.
:::
:::items
One task per line, in the quick-add grammar.
:::
- Use :::replace only when asked to change, format, organize, rewrite or fix the note. Keep every fact, link, number, date and checkbox state the user wrote unless they ask you to drop it. When formatting, don't add content.
- At most one :::replace, :::insert and :::items; any number of :::note blocks.
- Never wrap a block in code fences, never nest blocks, and never write a line that is only ::: inside a block.
- When the request is only a question, just answer; no blocks.

COLLEGIAPP MARKDOWN (the only formatting a note can hold)
- # Heading 1, ## Heading 2, ### Heading 3 (no deeper). The title is the note's own field, so the text doesn't start with a heading that repeats it.
- A blank line separates paragraphs; a single newline is a line break inside one.
- **bold**, *italic*, <u>underline</u>, ~~strikethrough~~, ==highlight==, \`inline code\`, [link text](https://example.com); a bare https:// link also works.
- "- " bullets, "1. " numbered items, "- [ ] " and "- [x] " checklist items. Nest any list by indenting two spaces.
- "> " quotes. A callout is a quote whose first line is [!NOTE], [!TIP], [!IMPORTANT] or [!WARNING]:
> [!TIP]
> Go to office hours before the midterm.
- Code blocks fenced with \`\`\` (a language after the opening fence is fine), a divider is ---, tables use | pipes | with a | --- | line under the header row.
- Nothing else: no HTML besides <u>, no images, footnotes, math markup or heading levels past ###. Write formulas in plain text or \`code\`.
- Headings in sentence case. Students skim: short paragraphs, lists where they help, ==highlight== only the few things to remember.

QUICK-ADD GRAMMAR (each line of :::items)
- The words left over are the title. A class like 130a or cs16 sets the course; dates like fri, tmr, 11/12, "in 3d"; times like 5pm or 11:59p; ~2h is an estimate; ! !! !!! is priority; #tag; @place; whenfree moves the time to the nearest slot clear of classes and events (it blocks the estimate, an hour without one).
- Words like hw, lab, quiz, midterm, final, read, project, apply or oh set the kind.
- Example: pa3 130a fri 11:59p ~4h !!
- A line starting with "note: " becomes a note instead of a task.`;

  // presets: with a note in context, and without
  const NOTE_PRESETS = [
    ["Format", "Format this note with clear headings, lists, checklists and emphasis, following my rules. Keep all of its content and wording."],
    ["Organize", "Organize my thoughts in this note: group related ideas under headings, merge duplicates, put them in a sensible order, and end with a checklist of next steps. Keep every idea."],
    ["Fix writing", "Fix spelling, grammar and unclear sentences in this note without changing its meaning, structure or tone."],
    ["Summarize", "Summarize this note for me in at most five bullets. Don't change the note."],
    ["Study guide", "Make a study guide from this note as a new note: a table of key terms, the main concepts in short sections, and practice questions with their answers."],
    ["Flashcards", "Make flashcards from this note as a new note: a table with Question and Answer columns."],
    ["Pull out tasks", "Find every action item in this note and give them to me as tasks, with the dates and classes the note mentions."],
    ["Continue", "Continue writing this note from where it ends, in the same style, and insert it."],
  ];
  const PRESETS = [
    ["Plan my day", "Look at my open items and today's schedule and plan the rest of my day realistically, as a new note titled \"Plan · <today's date>\" with a time-blocked checklist."],
    ["What first?", "Which three things should I do first, and why? Be brief."],
    ["Draft notes on…", "Draft study notes on: "],
    ["Brain dump → tasks", "Turn this into tasks: "],
    ["New note…", "Write a note about: "],
  ];

  // the user's standing instructions: notes tagged #ai (they edit them in the full editor and they sync like any note)
  const rulesNotes = (items) => items.filter((it) => it.kind === "note" && !it.deleted && (it.tags || []).some((t) => String(t).toLowerCase() === "ai"));
  function system(items) {
    const mine = rulesNotes(items).map((it) => `From "${it.title}":\n${it.notes.trim()}`).filter((x) => x.trim());
    return RULES + (mine.length ? `\n\nTHE USER'S OWN RULES (follow them unless the request says otherwise; Collegiapp Markdown still limits the formatting)\n${mine.join("\n\n")}` : "");
  }
  const fence = (name, body) => `<<<${name}\n${body}\n${name}>>>`;
  // ctx: { ask, now, quarter, note: { title, notes, course, tags }, selection, items: [lines], schedule: [lines], courses: [lines] }
  function prompt(ctx) {
    const parts = [`Now: ${ctx.now}.`];
    if (ctx.note) {
      parts.push(`THE NOTE IN CONTEXT\nTitle: ${ctx.note.title || "(untitled)"}${ctx.note.course ? "\nClass: " + ctx.note.course : ""}${ctx.note.tags && ctx.note.tags.length ? "\nTags: " + ctx.note.tags.map((t) => "#" + t).join(" ") : ""}\n${fence("NOTE", ctx.note.notes || "(empty)")}`);
      if (ctx.selection) parts.push(`SELECTED TEXT (an :::insert replaces it)\n${fence("SELECTION", ctx.selection)}`);
    }
    if (ctx.schedule && ctx.schedule.length) parts.push(`TODAY AND TOMORROW\n${ctx.schedule.join("\n")}`);
    if (ctx.items && ctx.items.length) parts.push(`OPEN ITEMS (most urgent first)\n${ctx.items.join("\n")}`);
    if (ctx.courses && ctx.courses.length) parts.push(`CLASSES\n${ctx.courses.join("\n")}`);
    parts.push(`REQUEST\n${ctx.ask}`);
    return parts.join("\n\n");
  }
  // one message for a chat website, which has no separate system prompt
  const forChat = (sys, p) => `${sys}\n\n=====\n\n${p}`;

  // The reply read into { message, actions, open }: text outside blocks is the message; `open` is a block still
  // streaming in. A block's body loses a code fence the model wrapped it in anyway.
  function parse(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n"), actions = [], msg = [];
    let cur = null;
    for (const line of lines) {
      const m = !cur && /^:::\s*(replace|insert|note|items)\b[ \t]*(.*)$/i.exec(line);
      if (m) { cur = { type: m[1].toLowerCase(), title: m[2].trim(), body: [] }; continue; }
      if (cur && /^:::\s*$/.test(line)) { actions.push(done(cur)); cur = null; continue; }
      if (cur) cur.body.push(line); else msg.push(line);
    }
    return { message: msg.join("\n").replace(/\n{3,}/g, "\n\n").trim(), actions, open: cur ? done(cur) : null };
  }
  function done(b) {
    let body = b.body.join("\n").replace(/^\n+|\s+$/g, "");
    const f = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(body); if (f) body = f[1];
    const a = { type: b.type, title: b.title.replace(/^["“]|["”]$/g, ""), body };
    if (b.type === "items") a.lines = body.split("\n").map((l) => l.replace(/^\s*(?:[-*+]\s+)?(?:\[[ xX]?\]\s*)?(?:\d+[.)]\s+)?/, "").trim()).filter(Boolean);
    if (b.type === "note" && !a.title) { const h = /^#{1,3}\s+(.+)\n?/.exec(body); a.title = h ? h[1].trim() : "AI note"; if (h) a.body = body.slice(h[0].length).replace(/^\n+/, ""); }
    return a;
  }
  // a chat site's address, with the prompt in it when the site takes one and it's short enough to travel in a link
  function siteUrl(id, text) {
    const s = SITES.find((x) => x[0] === id) || SITES[0], q = encodeURIComponent(text);
    return s[3] && q.length < 7000 ? s[2] + "?q=" + q : s[2];
  }

  CA.ai = { TOOLS, SITES, RULES, NOTE_PRESETS, PRESETS, system, prompt, forChat, parse, siteUrl, rulesNotes };
})();
