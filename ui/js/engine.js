/* Collegiapp — JS mirror of crates/collegiapp-core: quick-add grammar, filter DSL, do-first
   score, time formatting. In the Tauri build these calls go to the Rust core; keep both in sync. */
(function () {
  const CA = (window.CA = window.CA || {});
  const MIN = 60e3, HR = 36e5, DAY = 864e5;

  const WD = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
  const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
    jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
  const KIND_RULES = [
    [/^(hw\d*|homework\d*|pset\d*|assignment|essay|paper|writeup|pa\d*)$/, "assignment"],
    [/^(exam|midterm|final|finals|mt\d)$/, "exam"],
    [/^quiz\d*$/, "quiz"],
    [/^lab\d*$/, "lab"],
    [/^(read|reading|ch|chapter)$/, "reading"],
    [/^(project|proj)$/, "project"],
    [/^oh$/, "office_hours"],
    [/^(buy|pick|return|renew|call|email|print)$/, "errand"],
    [/^(apply|application|internship)$/, "application"],
  ];
  const KINDS = ["task", "assignment", "exam", "quiz", "lab", "reading", "project", "class", "office_hours", "event", "ticket", "errand", "application", "note", "info"];
  const WORK = ["assignment", "lab", "quiz", "project", "reading"];
  // kind: values beyond the names (filter.rs parse_kind): aliases, the work group, and the two kinds of class
  const KIND_ALIASES = { hw: ["assignment"], homework: ["assignment"], oh: ["office_hours"], officehours: ["office_hours"], "office-hours": ["office_hours"],
    work: WORK, section: ["section"], lecture: ["lecture"], quizzes: ["quiz"], idea: ["note"], jot: ["note"], fyi: ["info"] };
  const kindOne = (v) => KIND_ALIASES[v] || (KINDS.includes(v) ? [v] : null);
  const parseKind = (v) => kindOne(v) || (/s$/.test(v) && kindOne(v.slice(0, -1))) || (/es$/.test(v) && kindOne(v.slice(0, -2))) || null;
  // notes are kept and info read, not done or attended (model.rs is_actionable / is_scheduled)
  const ACTIONABLE = (k) => !["class", "event", "ticket", "office_hours", "note", "info"].includes(k);
  const SCHEDULED = (k) => ["class", "event", "ticket", "office_hours"].includes(k);
  const isSection = (it) => it.kind === "class" && (it.tags || []).some((t) => String(t).toLowerCase() === "section");
  // the words a bare search term also looks in (filter.rs kind_words), so "assignments", "work" or "section" find them
  const KIND_WORDS = { task: "task tasks todo", assignment: "assignment assignments homework hw work", exam: "exam exams test tests",
    quiz: "quiz quizzes work", lab: "lab labs work", reading: "reading readings work", project: "project projects work",
    office_hours: "office hours oh", event: "event events", ticket: "ticket tickets", errand: "errand errands", application: "application applications apply",
    note: "note notes idea ideas", info: "info fyi" };
  const kindWords = (it) => (it.kind === "class" ? (isSection(it) ? "class classes section sections" : "class classes lecture lectures") : KIND_WORDS[it.kind] || "");

  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const endOfDay = (t) => { const d = new Date(t); d.setHours(23, 59, 59, 999); return d.getTime(); };
  const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
  function nextWeekday(now, wd, skipWeek) {
    const d = new Date(startOfDay(now)); let diff = (wd - d.getDay() + 7) % 7; if (skipWeek) diff += 7;
    d.setDate(d.getDate() + diff); return d.getTime();
  }
  function courseKeys(c) {
    const num = ((c.code.match(/\d+[a-z]*/i) || [""])[0]).toLowerCase();
    const keys = new Set([norm(c.code), norm(c.tag), ...c.aliases.map(norm)]);
    if (num) { keys.add(num); keys.add("cs" + num); }
    return keys;
  }
  function findCourse(word, courses, includeExcluded) {
    const w = norm(word); if (!w) return null;
    for (const c of courses) if ((includeExcluded || c.included !== false) && courseKeys(c).has(w)) return c;
    return null;
  }
  function parseTime(w) {
    if (w === "noon") return { h: 12, m: 0 };
    if (w === "midnight") return { h: 23, m: 59 };
    let m = w.match(/^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)$/);
    if (m && +m[1] >= 1 && +m[1] <= 12) { let h = +m[1] % 12; if (m[3][0] === "p") h += 12; return { h, m: +(m[2] || 0) }; }
    m = w.match(/^(\d{1,2}):(\d{2})$/);
    if (m && +m[1] < 24 && +m[2] < 60) return { h: +m[1], m: +m[2] };
    return null;
  }
  function parseEst(s) {
    let m = s.match(/^(\d+(?:\.\d+)?)h(?:(\d+)m?)?$/); if (m) return Math.round(+m[1] * 60 + +(m[2] || 0));
    m = s.match(/^(\d+)m(?:in)?$/); if (m) return +m[1];
    return null;
  }
  function kindFromWord(w) { const c = w.replace(/[^a-z0-9]/g, ""); for (const [re, k] of KIND_RULES) if (re.test(c)) return k; return null; }

  /* links ─ rule 1 (quickadd.rs link_in) and the name a link shows (model.rs link_label) */
  const WEB_ENDINGS = /^(com|org|net|edu|gov|io|dev|app|ai|co|me|us|uk|ca|gle|be|so|site|ly|gg|xyz|info|tv|sh|page|to)$/;
  const SITES = [["zoom.us", "Zoom"], ["drive.google.com", "Google Drive"], ["meet.google.com", "Google Meet"], ["forms.gle", "Google Forms"], ["colab.research.google.com", "Colab"],
    ["instructure.com", "Canvas"], ["gradescope.com", "Gradescope"], ["piazza.com", "Piazza"], ["edstem.org", "Ed"], ["prairielearn.com", "PrairieLearn"], ["github.com", "GitHub"],
    ["youtube.com", "YouTube"], ["youtu.be", "YouTube"], ["overleaf.com", "Overleaf"], ["notion.so", "Notion"], ["notion.site", "Notion"]];
  function trimLinkEnd(s) {
    for (;;) {
      const c = s.slice(-1), cut = /[.,;:!?"'>\]}]/.test(c) || (c === ")" && (s.match(/\)/g) || []).length > (s.match(/\(/g) || []).length);
      if (!c || !cut) return s;
      s = s.slice(0, -1);
    }
  }
  // the link a word holds, or null; loose (a field that only takes links) also takes a bare host like example.com
  function linkIn(w, loose) {
    const at = w.search(/https?:\/\//i);
    if (at >= 0) { const s = trimLinkEnd(w.slice(at)); return /^https?:\/\/[\p{L}\p{N}]/iu.test(s) ? s : null; }
    const s = trimLinkEnd(w.replace(/^[(<[{"']+/, "")), end = s.search(/[/?#]|$/), host = s.slice(0, end), labels = host.split("."), tld = labels[labels.length - 1].toLowerCase();
    const ok = labels.length >= 2 && labels.every((l) => /^[a-z0-9-]+$/i.test(l)) && /^[a-z]{2,}$/.test(tld)
      && (/^www\./i.test(host) || loose || (WEB_ENDINGS.test(tld) && s[end] === "/"));
    return ok ? "https://" + s : null;
  }
  const linksIn = (text, loose) => [...new Set((String(text).match(/\S+/g) || []).map((w) => linkIn(w, loose)).filter(Boolean))];
  function linkLabel(url) {
    const i = url.indexOf("://"), rest = i >= 0 ? url.slice(i + 3) : url, end = rest.search(/[/?#]|$/);
    const host = rest.slice(0, end).split("@").pop().split(":")[0].toLowerCase().replace(/^www\./, ""), path = rest.slice(end).toLowerCase();
    const on = (d) => host === d || host.endsWith("." + d), site = SITES.find(([d]) => on(d));
    if (host === "docs.google.com") return path.startsWith("/spreadsheets") ? "Google Sheets" : path.startsWith("/presentation") ? "Google Slides" : path.startsWith("/forms") ? "Google Forms" : "Google Docs";
    if (path.includes("/webwork2/")) return "WeBWorK";
    if (host.startsWith("canvas.")) return "Canvas";
    return site ? site[1] : host || url;
  }

  /* quick add ─ returns a Draft with typed token spans for highlighting */
  function parseQuick(input, now, courses) {
    const toks = []; const re = /\S+/g; let m;
    while ((m = re.exec(input))) toks.push({ t: m[0], s: m.index, e: m.index + m[0].length, type: "text" });
    const d = { title: "", kind: null, course: null, due: null, end: null, est: null, pri: 0, tags: [], location: null, links: [], tokens: toks, whenFree: false, moved: 0 };
    let date = null, time = null, tonight = false;
    const today = startOfDay(now);
    const mark = (i, n, type) => { for (let k = i; k < i + n; k++) toks[k].type = type; };
    // rule 0: "note:" "idea:" "jot:" first makes a note, which keeps every word but links, priority, tags and the course
    const note = !!toks[0] && /^(note|idea|jot):$/i.test(toks[0].t);
    if (note) { d.kind = "note"; toks[0].type = "note"; }
    for (let i = note ? 1 : 0; i < toks.length; i++) {
      const tk = toks[i], w = tk.t.toLowerCase(), nx = toks[i + 1] && toks[i + 1].t.toLowerCase(), nx2 = toks[i + 2] && toks[i + 2].t.toLowerCase();
      const url = linkIn(tk.t); if (url) { d.links.push(url); tk.type = "url"; continue; }
      if (/^!{1,3}$/.test(w)) { d.pri = w.length; tk.type = "priority"; continue; }
      if (!note && w === "whenfree") { d.whenFree = true; tk.type = "whenfree"; continue; }
      if (note) {
        const c = !d.course && findCourse(w, courses);
        if (c) { d.course = c.id; tk.type = "course"; } else if (/^#[\w-]+$/.test(tk.t)) { if (!d.tags.some((x) => x.toLowerCase() === tk.t.slice(1).toLowerCase())) d.tags.push(tk.t.slice(1)); tk.type = "tag"; }
        continue;
      }
      if (w[0] === "~") { const e = parseEst(w.slice(1)); if (e != null) { d.est = e; tk.type = "estimate"; continue; } }
      if (/^#[\w-]+$/.test(tk.t)) { d.tags.push(tk.t.slice(1)); tk.type = "tag"; continue; }
      if (/^@\S+$/.test(tk.t)) { d.location = tk.t.slice(1); tk.type = "location"; continue; }
      if (w === "next" && nx && WD[nx] != null) { date = nextWeekday(now, WD[nx], true); mark(i, 2, "date"); i++; continue; }
      if (w === "in" && nx) {
        const mm = nx.match(/^(\d+)(d|w|days?|weeks?)?$/);
        if (mm) {
          let unit = mm[2], used = 2;
          if (!unit && nx2 && /^(d|days?|w|weeks?)$/.test(nx2)) { unit = nx2; used = 3; }
          if (unit) { date = addDays(today, unit[0] === "w" ? +mm[1] * 7 : +mm[1]); mark(i, used, "date"); i += used - 1; continue; }
        }
      }
      if (MONTHS[w] != null && nx && /^\d{1,2}(st|nd|rd|th)?$/.test(nx)) { date = monthDay(MONTHS[w], parseInt(nx, 10), now); mark(i, 2, "date"); i++; continue; }
      if (/^\d{1,2}(st|nd|rd|th)?$/.test(w) && nx && MONTHS[nx] != null) { date = monthDay(MONTHS[nx], parseInt(w, 10), now); mark(i, 2, "date"); i++; continue; }
      if (w === "at" && nx && parseTime(nx)) { time = parseTime(nx); mark(i, 2, "time"); i++; continue; }
      let dt = null;
      if (w === "today" || w === "tod") dt = today;
      else if (w === "tonight") { dt = today; tonight = true; }
      else if (w === "tomorrow" || w === "tmr" || w === "tmrw") dt = addDays(today, 1);
      else if (WD[w] != null) dt = nextWeekday(now, WD[w], false);
      else if (w === "eod") { dt = today; time = time || { h: 23, m: 59 }; }
      else if (w === "eow") { dt = nextWeekday(now, 5, false); time = time || { h: 23, m: 59 }; }
      else if (/^\d{1,2}\/\d{1,2}$/.test(w)) { const [mo, da] = w.split("/").map(Number); if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) dt = monthDay(mo - 1, da, now); }
      if (dt != null) { date = dt; tk.type = "date"; continue; }
      const tm = parseTime(w); if (tm) { time = tm; tk.type = "time"; continue; }
      const c = !d.course && findCourse(w, courses); if (c) { d.course = c.id; tk.type = "course"; continue; }
      const k = kindFromWord(w); if (k && !d.kind) { d.kind = k; tk.type = "kindhint"; }
    }
    if (date != null) {
      const x = new Date(date);
      if (time) x.setHours(time.h, time.m, 0, 0); else if (tonight) x.setHours(21, 0, 0, 0); else if (d.whenFree) x.setHours(9, 0, 0, 0); else x.setHours(23, 59, 0, 0);
      d.due = x.getTime();
    } else if (time) {
      const x = new Date(now); x.setHours(time.h, time.m, 0, 0); if (x.getTime() <= now) x.setDate(x.getDate() + 1); d.due = x.getTime();
    }
    d.title = toks.filter((t) => t.type === "text" || t.type === "kindhint").map((t) => t.t).join(" ").trim();
    d.kind = d.kind || "task";
    return d;
  }
  // whenfree: the nearest slot clear of what holds time (quickadd.rs fit_free / free_slot have the rules)
  const FIVE = 5 * MIN;
  const round5 = (t, up) => (up ? Math.ceil(t / FIVE) : Math.floor(t / FIVE)) * FIVE;
  function busyBlocks(items) {
    return items.filter((it) => !it.deleted && it.status !== "done" && it.status !== "dropped" && it.due != null).map((it) => {
      if (it.end && it.end > it.due) return { s: it.due, e: it.end, it };
      if (SCHEDULED(it.kind) || it.kind === "exam") return { s: it.due, e: it.due + Math.max(5, it.est || 60) * MIN, it };
      return null;
    }).filter(Boolean);
  }
  const dayAt = (t, days, h) => { const x = new Date(t); x.setDate(x.getDate() + days); x.setHours(h, 0, 0, 0); return x.getTime(); };
  function freeSlot(target, len, busy, now) {
    const clashes = (s) => busy.filter((b) => b.s < s + len && b.e > s);
    if (!clashes(target).length) return { start: target, moved: 0 };
    let later = null, t = round5(target, true);
    for (let n = 0; n < 400 && t - target <= 14 * DAY; n++) {
      if (t < dayAt(t, 0, 8)) t = dayAt(t, 0, 8);
      if (t + len > dayAt(t, 0, 23)) { t = dayAt(t, 1, 8); continue; }
      const c = clashes(t); if (!c.length) { later = t; break; }
      t = round5(Math.max(...c.map((b) => b.e)), true);
    }
    let earlier = null; t = round5(target, false);
    for (let n = 0; n < 400; n++) {
      if (t + len > dayAt(t, 0, 23)) t = round5(dayAt(t, 0, 23) - len, false);
      if (t < dayAt(t, 0, 8)) { t = round5(dayAt(t, -1, 23) - len, false); continue; }
      if (t < now) break;
      const c = clashes(t); if (!c.length) { earlier = t; break; }
      t = round5(Math.min(...c.map((b) => b.s)) - len, false);
    }
    if (earlier != null && (later == null || target - earlier <= later - target)) return { start: earlier, moved: -1 };
    if (later != null) return { start: later, moved: 1 };
    return { start: target, moved: 0 };
  }
  // a parsed draft with whenfree, placed: due = the slot's start, end = its end, moved -1 / 0 / 1, and what was in the way
  function fitFree(d, items, now) {
    if (!d.whenFree) return d;
    const len = Math.min(720, Math.max(5, d.est || 60)) * MIN, target = d.due != null && d.due > now ? d.due : round5(now, true);
    const busy = busyBlocks(items), r = freeSlot(target, len, busy, now);
    return Object.assign(d, { due: r.start, end: r.start + len, moved: r.moved, target, clash: r.moved ? busy.filter((b) => b.s < target + len && b.e > target).map((b) => b.it) : [] });
  }
  function monthDay(mo, da, now) {
    const y = new Date(now).getFullYear(); let t = new Date(y, mo, da).getTime();
    if (t < startOfDay(now) - 7 * DAY) t = new Date(y + 1, mo, da).getTime();
    return t;
  }

  /* lifecycle */
  function isOpen(it, now) {
    if (it.deleted || it.status === "done" || it.status === "dropped") return false;
    if (SCHEDULED(it.kind) && (it.end || it.due) && (it.end || it.due) < now) return false;
    return true;
  }

  /* do-first score — identical formula to collegiapp-core::score */
  const KIND_BONUS = { exam: 0.75, project: 0.5, assignment: 0.3, quiz: 0.3, lab: 0.3, reading: 0.1 };
  function score(it, now) {
    if (!isOpen(it, now) || !ACTIONABLE(it.kind)) return null;
    if (it.snoozed && it.snoozed > now) return null;
    const reasons = [];
    let urgency, hoursLeft = null;
    if (it.due == null) { urgency = 0.15; reasons.push("no due date"); }
    else {
      hoursLeft = (it.due - now) / HR;
      if (hoursLeft <= 0) { urgency = 1.5; reasons.push("overdue " + fmtDur(-hoursLeft * HR)); }
      else { urgency = 1 / (1 + hoursLeft / 24); reasons.push("due in " + fmtDur(hoursLeft * HR)); }
    }
    const importance = 1 + 0.5 * (it.pri || 0) + (KIND_BONUS[it.kind] || 0) + (it.weight || 0) / 20;
    if (it.pri) reasons.push("!".repeat(it.pri) + " priority");
    if (it.weight) reasons.push("worth " + it.weight + "% of grade");
    if (it.kind === "exam") reasons.push("exam");
    let crunch = 1;
    if (it.est && hoursLeft != null && hoursLeft > 0) {
      const r = it.est / 60 / hoursLeft;
      crunch = r >= 0.25 ? 1.5 : r >= 0.1 ? 1.2 : 1;
      if (crunch > 1) reasons.push(fmtDur(it.est * MIN) + " of work vs " + fmtDur(hoursLeft * HR) + " left");
    }
    const momentum = it.status === "doing" ? 1.15 : 1;
    if (momentum > 1) reasons.push("already in progress");
    return { total: urgency * importance * crunch * momentum, urgency, importance, crunch, momentum, reasons, hoursLeft };
  }
  function rank(items, now) {
    return items.map((it) => ({ it, sc: score(it, now) })).filter((x) => x.sc).sort((a, b) => b.sc.total - a.sc.total);
  }
  function scoreCells(total) { if (!total) return 0; return Math.max(1, Math.min(5, Math.ceil(Math.log2(total * 8)))); }

  /* filter DSL — AND of terms; "-" negates; key:a,b is OR; due ops : < <= > >=. A known key with a value it can't read
     is kept with valid: false and ignored (matches everything), as filter.rs does; the filter bar marks its chip. */
  const KEYS = { kind: "kind", course: "course", status: "status", src: "src", source: "src", tag: "tag", pri: "pri", priority: "pri", is: "is", due: "due" };
  const STATUSES = ["inbox", "todo", "doing", "done", "dropped"];
  const IS_FLAGS = ["open", "done", "actionable", "scheduled", "overdue", "snoozed", "excluded"];
  const okPri = (v) => /^[0-3]$/.test(v);
  const okDue = (v) => v === "overdue" || v === "none" || ["today", "tomorrow", "tmr", "week"].includes(v) || WD[v] != null || /^\d{1,4}d$/.test(v);
  function parseFilter(q) {
    const terms = []; const re = /(-?)(?:"([^"]*)"|(\S+))/g; let m;
    while ((m = re.exec(q || ""))) {
      const neg = !!m[1], raw = (m[1] || "") + (m[2] != null ? '"' + m[2] + '"' : m[3]);
      if (m[2] != null) { terms.push({ neg, key: "text", op: ":", vals: [m[2].toLowerCase()], raw, valid: !!m[2] }); continue; }
      const s = m[3];
      if (/^#[\w-]+$/.test(s)) { terms.push({ neg, key: "tag", op: ":", vals: [s.slice(1).toLowerCase()], raw, valid: true }); continue; }
      if (/^!{1,3}$/.test(s)) { terms.push({ neg, key: "pri", op: ">=", vals: [String(s.length)], raw, valid: true }); continue; }
      if (/^!\d$/.test(s) && okPri(s.slice(1))) { terms.push({ neg, key: "pri", op: ">=", vals: [s.slice(1)], raw, valid: true }); continue; }
      const km = s.match(/^([a-z]+)(:|=|<=|>=|<|>)(.*)$/i), key = km && KEYS[km[1].toLowerCase()];
      if (key) {
        const op = km[2] === "=" ? ":" : km[2], vals = km[3].toLowerCase().split(",").map((v) => (key === "tag" ? v.replace(/^#/, "") : v)).filter(Boolean);
        const ok = { kind: (v) => !!parseKind(v), status: (v) => STATUSES.includes(v), is: (v) => IS_FLAGS.includes(v), pri: okPri, due: okDue }[key] || (() => true);
        const ranged = key === "pri" || key === "due";
        const valid = vals.length > 0 && vals.every(ok) && (ranged ? op === ":" || vals.length === 1 : op === ":");
        terms.push({ neg, key, op, vals, raw, valid }); continue;
      }
      terms.push({ neg, key: "text", op: ":", vals: [s.toLowerCase()], raw, valid: true });
    }
    return terms;
  }
  // the local day a due value names (filter.rs due_matches): weekday = next one (today counts), week = the coming Sunday
  function dueDay(v, now) {
    if (v === "today") return startOfDay(now);
    if (v === "tomorrow" || v === "tmr") return startOfDay(addDays(now, 1));
    if (v === "week") return startOfDay(addDays(now, (7 - new Date(now).getDay()) % 7));
    if (WD[v] != null) return nextWeekday(now, WD[v], false);
    const m = v.match(/^(\d+)d$/); if (m) return startOfDay(addDays(now, +m[1]));
    return null;
  }
  const isOverdue = (it, now) => ACTIONABLE(it.kind) && isOpen(it, now) && it.due != null && it.due < now;
  function termMatch(it, t, ctx) {
    if (t.valid === false) return null;
    const { now, courses } = ctx, course = it.course && courses.find((c) => c.id === it.course);
    const any = (f) => t.vals.some(f);
    switch (t.key) {
      case "kind": return any((v) => parseKind(v).some((k) => k === "section" ? isSection(it) : k === "lecture" ? it.kind === "class" && !isSection(it) : k === it.kind));
      case "course": return any((v) => v === "none" ? !it.course : !!course && (!!findCourse(v, [course], true) || norm(course.code).includes(norm(v))));
      case "status": return any((v) => v === it.status);
      case "src": return any((v) => v === String(it.src).toLowerCase());
      case "tag": return any((v) => it.tags.map((x) => x.toLowerCase()).includes(v));
      case "pri": { const n = +t.vals[0]; return t.op === "<" ? it.pri < n : t.op === "<=" ? it.pri <= n : t.op === ">" ? it.pri > n : t.op === ":" ? t.vals.some((v) => it.pri === +v) : it.pri >= n; }
      case "is": return any((v) => v === "open" ? isOpen(it, now) : v === "done" ? it.status === "done" : v === "actionable" ? ACTIONABLE(it.kind)
        : v === "overdue" ? isOverdue(it, now) : v === "snoozed" ? !!(it.snoozed && it.snoozed > now)
        : v === "excluded" ? !!course && course.included === false : v === "scheduled" ? SCHEDULED(it.kind) : false);
      case "due": return any((v) => {
        if (v === "none") return it.due == null;
        if (v === "overdue") return isOverdue(it, now);
        if (it.due == null) return false;
        const day = dueDay(v, now); if (day == null) return false;
        const next = addDays(day, 1);
        if (t.op === ":") return v === "week" || /d$/.test(v) ? it.due >= startOfDay(now) && it.due < next : it.due >= day && it.due < next;
        return t.op === "<" ? it.due < day : t.op === "<=" ? it.due < next : t.op === ">" ? it.due >= next : it.due >= day;
      });
      case "text": {
        const hay = [it.title, it.notes, it.location || "", it.tags.join(" "), kindWords(it), course ? course.code + " " + course.tag + " " + (course.title || "") : ""].join(" ").toLowerCase();
        return any((v) => hay.includes(v) || (!!course && !!findCourse(v, [course], true)));
      }
    }
    return true;
  }
  function matchItem(it, terms, ctx) {
    const course = it.course && ctx.courses.find((c) => c.id === it.course);
    const wantsExcluded = terms.some((t) => t.key === "is" && t.valid !== false && t.vals.includes("excluded") && !t.neg);
    if (course && course.included === false && !wantsExcluded) return false;
    if (it.deleted) return false;
    for (const t of terms) { const m = termMatch(it, t, ctx); if (m != null && m === t.neg) return false; }
    return true;
  }

  /* formatting */
  function fmtDur(ms) {
    ms = Math.abs(ms); const m = Math.round(ms / MIN);
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60), mm = m % 60;
    if (h < 24) return mm && h < 10 ? h + "h " + mm + "m" : h + "h";
    const d = Math.floor(h / 24), hh = h % 24;
    return hh && d < 4 ? d + "d " + hh + "h" : d + "d";
  }
  function fmtClock(ms) {
    ms = Math.max(0, ms); const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, "0");
    return h ? h + ":" + p(m) + ":" + p(ss) : p(m) + ":" + p(ss);
  }
  function fmtTime(t) { const d = new Date(t); let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? "P" : "A"; h = h % 12 || 12; return h + ":" + String(m).padStart(2, "0") + ap; }
  function fmtTime24(t) { const d = new Date(t); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  const DN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"], MN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  function fmtDay(t, now) {
    const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
    if (diff === 0) return "TODAY"; if (diff === 1) return "TMRW"; if (diff === -1) return "YDAY";
    const d = new Date(t); return diff > 0 && diff < 7 ? DN[d.getDay()] : DN[d.getDay()] + " " + (d.getMonth() + 1) + "/" + d.getDate();
  }
  function fmtDue(t, now) { return fmtDay(t, now) + " " + fmtTime(t); }
  function fmtRel(t, now) { const d = t - now; return d >= 0 ? "in " + fmtDur(d) : fmtDur(d) + " ago"; }
  // The list's due-date groups, in this order (BUCKETS). Overdue is open work only; finished work and classes or events
  // that are over go to Past, at the end, so a filter without is:open never calls a class overdue.
  const BUCKETS = ["Overdue", "Today", "Tomorrow", "This week", "Later", "No date", "Past"];
  function bucket(it, now) {
    if (!isOpen(it, now) && it.due != null && (SCHEDULED(it.kind) ? (it.end || it.due) : it.due) < now) return "Past";
    if (it.due == null) return "No date";
    if (it.due < now && ACTIONABLE(it.kind)) return "Overdue";
    const diff = Math.round((startOfDay(it.due) - startOfDay(now)) / DAY);
    if (diff <= 0) return "Today"; if (diff === 1) return "Tomorrow"; if (diff < 7) return "This week"; return "Later";
  }

  /* palette fuzzy match */
  function fuzzy(q, s) {
    q = q.toLowerCase(); s = s.toLowerCase(); if (!q) return 1;
    const direct = s.indexOf(q); if (direct >= 0) return 100 - direct + (direct === 0 || s[direct - 1] === " " ? 20 : 0);
    let i = 0, sc = 0, last = -2;
    for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) { sc += j === last + 1 ? 3 : 1; if (j === 0 || s[j - 1] === " ") sc += 2; last = j; i++; }
    return i === q.length ? sc : 0;
  }

  CA.E = { MIN, HR, DAY, parseQuick, linkIn, linksIn, linkLabel, fitFree, freeSlot, busyBlocks, parseFilter, matchItem, score, rank, scoreCells, isOpen, isOverdue, isSection, ACTIONABLE, SCHEDULED, findCourse,
    fmtDur, fmtClock, fmtTime, fmtTime24, fmtDay, fmtDue, fmtRel, bucket, BUCKETS, fuzzy, startOfDay, endOfDay, addDays, DN, MN };
})();
