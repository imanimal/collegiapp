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
  const KIND_ALIASES = { hw: "assignment", homework: "assignment", assignments: "assignment", class: "class", lecture: "class", oh: "office_hours", event: "event", events: "event", tickets: "ticket" };
  const ACTIONABLE = (k) => !["class", "event", "ticket", "office_hours"].includes(k);
  const SCHEDULED = (k) => ["class", "event", "ticket", "office_hours"].includes(k);

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

  /* quick add ─ returns a Draft with typed token spans for highlighting */
  function parseQuick(input, now, courses) {
    const toks = []; const re = /\S+/g; let m;
    while ((m = re.exec(input))) toks.push({ t: m[0], s: m.index, e: m.index + m[0].length, type: "text" });
    const d = { title: "", kind: null, course: null, due: null, est: null, pri: 0, tags: [], location: null, links: [], tokens: toks };
    let date = null, time = null, tonight = false;
    const today = startOfDay(now);
    const mark = (i, n, type) => { for (let k = i; k < i + n; k++) toks[k].type = type; };
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i], w = tk.t.toLowerCase(), nx = toks[i + 1] && toks[i + 1].t.toLowerCase(), nx2 = toks[i + 2] && toks[i + 2].t.toLowerCase();
      if (/^!{1,3}$/.test(w)) { d.pri = w.length; tk.type = "priority"; continue; }
      if (w[0] === "~") { const e = parseEst(w.slice(1)); if (e != null) { d.est = e; tk.type = "estimate"; continue; } }
      if (/^#[\w-]+$/.test(tk.t)) { d.tags.push(tk.t.slice(1)); tk.type = "tag"; continue; }
      if (/^@\S+$/.test(tk.t)) { d.location = tk.t.slice(1); tk.type = "location"; continue; }
      if (/^https?:\/\//i.test(tk.t)) { d.links.push(tk.t); tk.type = "url"; continue; }
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
      if (time) x.setHours(time.h, time.m, 0, 0); else if (tonight) x.setHours(21, 0, 0, 0); else x.setHours(23, 59, 0, 0);
      d.due = x.getTime();
    } else if (time) {
      const x = new Date(now); x.setHours(time.h, time.m, 0, 0); if (x.getTime() <= now) x.setDate(x.getDate() + 1); d.due = x.getTime();
    }
    d.title = toks.filter((t) => t.type === "text" || t.type === "kindhint").map((t) => t.t).join(" ").trim();
    d.kind = d.kind || "task";
    return d;
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

  /* filter DSL — AND of terms; "-" negates; key:a,b is OR; due ops : < <= > >= */
  function parseFilter(q) {
    const terms = []; const re = /(-?)(?:"([^"]*)"|(\S+))/g; let m;
    while ((m = re.exec(q || ""))) {
      const neg = !!m[1], raw = (m[1] || "") + (m[2] != null ? '"' + m[2] + '"' : m[3]);
      if (m[2] != null) { terms.push({ neg, key: "text", op: ":", vals: [m[2].toLowerCase()], raw }); continue; }
      const s = m[3];
      if (/^#[\w-]+$/.test(s)) { terms.push({ neg, key: "tag", op: ":", vals: [s.slice(1).toLowerCase()], raw }); continue; }
      if (/^!{1,3}$/.test(s)) { terms.push({ neg, key: "pri", op: ">=", vals: [String(s.length)], raw }); continue; }
      if (/^!\d$/.test(s)) { terms.push({ neg, key: "pri", op: ">=", vals: [s.slice(1)], raw }); continue; }
      const km = s.match(/^([a-z]+)(:|<=|>=|<|>)(.+)$/i);
      if (km && ["kind", "course", "status", "src", "tag", "pri", "is", "due"].includes(km[1].toLowerCase())) {
        terms.push({ neg, key: km[1].toLowerCase(), op: km[2], vals: km[3].toLowerCase().split(",").filter(Boolean), raw }); continue;
      }
      terms.push({ neg, key: "text", op: ":", vals: [s.toLowerCase()], raw });
    }
    return terms;
  }
  function dueBound(v, now) {
    if (v === "today") return endOfDay(now);
    if (v === "tomorrow" || v === "tmr") return endOfDay(addDays(now, 1));
    if (v === "week") return endOfDay(addDays(now, (7 - new Date(now).getDay()) % 7));
    if (WD[v] != null) return endOfDay(nextWeekday(now, WD[v], false));
    const m = v.match(/^(\d+)d$/); if (m) return now + +m[1] * DAY;
    return null;
  }
  function termMatch(it, t, ctx) {
    const { now, courses } = ctx, course = it.course && courses.find((c) => c.id === it.course);
    const any = (f) => t.vals.some(f);
    switch (t.key) {
      case "kind": return any((v) => (KIND_ALIASES[v] || v) === it.kind);
      case "course": return !!course && any((v) => { const c = findCourse(v, [course], true); return !!c || norm(course.code).includes(norm(v)); });
      case "status": return any((v) => v === it.status);
      case "src": return any((v) => v === it.src);
      case "tag": return any((v) => it.tags.map((x) => x.toLowerCase()).includes(v));
      case "pri": { const n = +t.vals[0]; return t.op === "<" ? it.pri < n : t.op === "<=" ? it.pri <= n : t.op === ">" ? it.pri > n : t.op === ":" ? it.pri === n : it.pri >= n; }
      case "is": return any((v) => v === "open" ? isOpen(it, now) : v === "done" ? it.status === "done" : v === "actionable" ? ACTIONABLE(it.kind)
        : v === "overdue" ? isOpen(it, now) && it.due != null && it.due < now && ACTIONABLE(it.kind) : v === "snoozed" ? !!(it.snoozed && it.snoozed > now)
        : v === "excluded" ? !!course && course.included === false : v === "scheduled" ? SCHEDULED(it.kind) : false);
      case "due": return any((v) => {
        if (v === "none") return it.due == null;
        if (it.due == null) return false;
        if (v === "overdue") return it.due < now;
        const b = dueBound(v, now); if (b == null) return false;
        if (t.op === ":") return v === "week" || /d$/.test(v) ? it.due >= startOfDay(now) && it.due <= b : it.due >= startOfDay(b) && it.due <= b;
        if (t.op === "<" || t.op === "<=") return it.due <= b;
        return it.due > b;
      });
      case "text": { const hay = (it.title + " " + it.notes + " " + (course ? course.code + " " + course.tag : "") + " " + (it.location || "")).toLowerCase(); return any((v) => hay.includes(v)); }
    }
    return true;
  }
  function matchItem(it, terms, ctx) {
    const course = it.course && ctx.courses.find((c) => c.id === it.course);
    const wantsExcluded = terms.some((t) => t.key === "is" && t.vals.includes("excluded") && !t.neg);
    if (course && course.included === false && !wantsExcluded) return false;
    if (it.deleted) return false;
    for (const t of terms) if (termMatch(it, t, ctx) === t.neg) return false;
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
  function bucket(it, now) {
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

  CA.E = { MIN, HR, DAY, parseQuick, parseFilter, matchItem, score, rank, scoreCells, isOpen, ACTIONABLE, SCHEDULED, findCourse,
    fmtDur, fmtClock, fmtTime, fmtTime24, fmtDay, fmtDue, fmtRel, bucket, fuzzy, startOfDay, endOfDay, addDays, DN, MN };
})();
