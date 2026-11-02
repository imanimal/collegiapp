/* Collegiapp — app shell. One state object, one item list, many lenses. Every nav control
   is a saved filter over the same items (see VIEWS); renditions only change how regions render. */
(function () {
  const CA = window.CA, E = CA.E;
  const { MIN, HR, DAY } = E;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const narrow = () => window.matchMedia("(max-width: 760px)").matches;

  const VIEWS = [
    { id: "now", k: "1", label: "Do First", icon: ">", page: 200, q: "is:open is:actionable", sort: "score", lens: "list" },
    { id: "today", k: "2", label: "Today", icon: "*", page: 210, q: "is:open due<=today", sort: "due", lens: "list" },
    { id: "inbox", k: "3", label: "Inbox", icon: "@", page: 220, q: "status:inbox", sort: "updated", lens: "list" },
    { id: "work", k: "4", label: "Assignments", short: "Work", icon: "#", page: 310, q: "is:open kind:assignment,lab,quiz,project,reading", sort: "due", lens: "list" },
    { id: "exams", k: "5", label: "Exams", icon: "!", page: 320, q: "kind:exam", sort: "due", lens: "list" },
    { id: "week", k: "6", label: "Week", icon: "=", page: 330, q: "is:open", sort: "due", lens: "week" },
    { id: "classes", k: "7", label: "Classes", icon: "o", page: 400, q: "", sort: "due", lens: "courses" },
    { id: "events", k: "8", label: "Events", icon: "+", page: 500, q: "is:open kind:event,ticket,office_hours", sort: "due", lens: "list" },
    { id: "links", k: "9", label: "Links", icon: "^", page: 700, q: "", sort: "due", lens: "links" },
    { id: "all", k: "0", label: "Everything", short: "All", icon: "%", page: 300, q: "is:open", sort: "due", lens: "list" },
    { id: "done", k: "", label: "Done", icon: "x", page: 390, q: "is:done", sort: "updated", lens: "list" },
  ];
  const EXTRA = [{ id: "index", label: "Index", page: 100, q: "", sort: "due", lens: "index" }];
  const PAGES = { 600: "focus", 888: "help" };
  [...VIEWS, ...EXTRA].forEach((v) => (PAGES[v.page] = v.id));
  const viewById = (id) => VIEWS.find((v) => v.id === id) || EXTRA.find((v) => v.id === id) || VIEWS[0];

  const KIND = { assignment: ["HW", "Assignment"], exam: ["EXAM", "Exam"], quiz: ["QUIZ", "Quiz"], lab: ["LAB", "Lab"], reading: ["READ", "Reading"],
    project: ["PROJ", "Project"], class: ["CLASS", "Class"], office_hours: ["OH", "Office hours"], event: ["EVENT", "Event"], ticket: ["TICKET", "Ticket"],
    errand: ["ERRAND", "Errand"], application: ["APPLY", "Application"], task: ["TASK", "Task"] };
  const kShort = (k) => (KIND[k] || KIND.task)[0];
  const kLabel = (k) => (KIND[k] || KIND.task)[1];
  const TIPS = [
    "Press <b>Q</b> anywhere to add. Try “pa3 130a fri ~4h !!”.",
    "<b>Esc</b> clears every filter. Nav buttons are only saved filters.",
    "Right-click anywhere for the radial menu.",
    "Hold <b>Alt</b> to see every shortcut on screen.",
    "<b>F</b> starts a 25-minute focus on the Do First item.",
    "<b>Ctrl+K</b> finds any command, item, class or link.",
    "Excluded Canvas courses stay hidden everywhere. Manage them in Classes (<b>7</b>).",
    "<b>S</b> snoozes. “After next class” is one click.",
  ];
  const GLOBAL_LINKS = [["GOLD", "https://my.sa.ucsb.edu/gold/"], ["Canvas", "https://www.canvas.ucsb.edu/"], ["Gradescope", "https://www.gradescope.com/"],
    ["Shoreline", "https://shoreline.ucsb.edu/"], ["UCSB Mail", "https://mail.google.com/"], ["Handshake", "https://ucsb.joinhandshake.com/"],
    ["Study rooms", "https://libcal.library.ucsb.edu/booking/groupstudy"], ["Dining menus", "https://apps.dining.ucsb.edu/menu"], ["MTD bus", "https://bustracker.sbmtd.gov/"],
    ["CLAS tutoring", "https://clas.ucsb.edu/"], ["Student Health", "https://studenthealth.sa.ucsb.edu/"], ["Registrar calendar", "https://registrar.sa.ucsb.edu/"]];
  const SOURCES = [["canvas", "Canvas", "API token + calendar feed", "3m"], ["gcal", "Google Calendar", "OAuth (or secret iCal URL)", "1m"], ["shoreline", "Shoreline", "CampusGroups iCal subscription", "12m"],
    ["gradescope", "Gradescope", "Firefox extension (page capture)", "live"], ["ucsbapi", "UCSB API", "Dining · quarter calendar · events", "1h"], ["piazza", "Piazza / Ed", "Firefox extension", "off"]];
  const PHRASE = "i choose distraction";

  const S = (CA.state = Object.assign(CA.sampleData(), {
    now: Date.now(), q: VIEWS[0].q, view: "now", lens: "list", sort: "score",
    sel: null, insp: false, skip: 0, focus: null, overlay: null, islandOpen: false, power: true,
    stats: { streak: 4, focusMin: 85, xp: 1240 }, page: 200, ttEntry: "", menu: null, winPos: {}, alerted: {},
    undo: null, animRows: true, coachI: 0, ticks: 0, listIds: [], flashId: null, refocus: null, palI: 0, palList: [], tickerHTML: "",
  }));
  const ui = () => CA.ui;
  const R = () => CA.ui.r;
  const ctx = () => ({ now: S.now, courses: S.courses });
  const find = (id) => S.items.find((x) => x.id === id);
  const cById = (id) => S.courses.find((c) => c.id === id);
  const courseOf = (it) => (it && it.course ? cById(it.course) : null);
  const kc = (c) => (c ? `--kc: var(--k${c.color});` : "");
  const cmpDue = (a, b) => (a.due == null) - (b.due == null) || (a.due || 0) - (b.due || 0);
  const busy = () => { const a = document.activeElement; return !!a && !!a.closest && !!a.closest("#screen, #island") && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable); };
  const motion = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--m")) || 0;
  const ranked = () => E.rank(S.items.filter((it) => E.matchItem(it, [], ctx())), S.now);
  const topItem = () => { const r = ranked(); return r.length ? r[S.skip % r.length].it : null; };
  const target = () => (S.sel && find(S.sel)) || topItem();
  function cdText(ms) { if (ms <= 0) return "NOW"; return ms >= DAY ? E.fmtDur(ms).toUpperCase() : E.fmtClock(ms); }
  function clockStr() { const d = new Date(S.now); return E.fmtTime24(S.now) + ":" + String(d.getSeconds()).padStart(2, "0"); }
  function weekInfo() {
    const q = CA.quarter, wk = Math.floor((E.startOfDay(S.now) - q.week1.getTime()) / (7 * DAY)) + 1;
    return { wk: Math.max(0, Math.min(11, wk)), toFinals: Math.ceil((q.finals.getTime() - E.startOfDay(S.now)) / DAY) };
  }
  function dueLine(it) {
    if (it.due == null) return "NO DUE DATE";
    const d = it.due - S.now;
    return d < 0 ? "OVERDUE " + E.fmtDur(d).toUpperCase() : E.fmtDue(it.due, S.now) + " · IN " + E.fmtDur(d).toUpperCase();
  }
  function scheduleItems() {
    return S.items.filter((it) => (E.SCHEDULED(it.kind) || it.kind === "exam") && E.matchItem(it, [], ctx()) && it.status !== "done" && (it.end || it.due) > S.now).sort(cmpDue);
  }
  function ctxCourse() {
    const c = S.items.find((it) => it.kind === "class" && it.due <= S.now + 15 * MIN && it.end >= S.now - 45 * MIN && cById(it.course) && cById(it.course).included);
    if (!c) return null;
    return { id: c.course, why: c.end < S.now ? "class just ended" : c.due > S.now ? "class starting" : "in class now" };
  }
  function nextAlertable() { return scheduleItems().find((it) => it.kind === "class" && it.due > S.now) || scheduleItems().find((it) => it.due > S.now); }
  function hostOf(u) { try { const x = new URL(u); return x.host + (x.pathname.length > 1 ? x.pathname : ""); } catch (e) { return u; } }

  /* ─────────── retro-modern family (L5–L7): sentence case, icons, one obvious primary action per region ─────────── */
  const isM = () => document.documentElement.dataset.fam === "modern";
  const horizNav = () => R() !== "signal" || narrow();
  const MOD = /Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘" : "Ctrl";
  const ICONS = {
    now: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
    work: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    exams: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    week: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    classes: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
    events: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2 1.2-6.8-5-4.9 6.9-1z"/>',
    links: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    all: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    done: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    focus: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    play: '<path d="M7 4.5v15l12.5-7.5z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    next: '<path d="m6 5 9 7-9 7zM18 5v14"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    go: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    lab: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    help: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 15h10"/>',
    filter: '<path d="M3 4h18l-7 9v6l-4 2v-8z"/>',
    ticket: '<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z"/><path d="M14 5v14" stroke-dasharray="2 2"/>',
    flag: '<path d="M4 22V4M4 4h13l-2.5 4.5L17 13H4"/>',
    flame: '<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 2-5 5-5 8 0 4 3 7 7 7z"/>',
  };
  const ic = (n, c) => `<svg class="i${c ? " " + c : ""}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ""}</svg>`;
  const LOGO = `<span class="brandmark"><span class="logo" aria-hidden="true">C</span><span>Collegiapp</span></span>`;
  const DNM = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], DNL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MNM = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const PRI = ["", "Priority", "High priority", "Urgent"];
  const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const srcName = (s) => (SOURCES.find((x) => x[0] === s) || [s, cap(s)])[1];
  const flap = () => (R() === "ledger" ? " data-flap" : "");
  function mTime(t) { const d = new Date(t); const h = d.getHours(); return (h % 12 || 12) + ":" + String(d.getMinutes()).padStart(2, "0") + (h >= 12 ? " PM" : " AM"); }
  function mDay(t) {
    const diff = Math.round((E.startOfDay(t) - E.startOfDay(S.now)) / DAY), d = new Date(t);
    if (diff === 0) return "Today"; if (diff === 1) return "Tomorrow"; if (diff === -1) return "Yesterday";
    return diff > 0 && diff < 7 ? DNM[d.getDay()] : `${DNM[d.getDay()]}, ${MNM[d.getMonth()]} ${d.getDate()}`;
  }
  function mDue(t) { return mDay(t) + " " + mTime(t); }
  const fDue = (t, now) => (isM() ? mDue(t) : E.fmtDue(t, now == null ? S.now : now));
  function sinceText(ms) { return ms >= DAY ? E.fmtDur(ms).toUpperCase() : E.fmtClock(ms); }
  function dueState(it) {
    if (it.due == null) return { t: "No date", c: "" };
    const d = it.due - S.now;
    if (E.SCHEDULED(it.kind) && d <= 0 && it.end > S.now) return { t: "Now", c: "live" };
    if (d < 0) return { t: E.fmtDur(d) + " overdue", c: "over" };
    if (d < 24 * HR) return { t: "in " + E.fmtDur(d), c: d < 3 * HR ? "hot" : "soon" };
    return { t: mDay(it.due), c: "" };
  }
  const cchip = (c) => (c ? `<span class="cchip" style="${kc(c)}">${esc(c.code)}</span>` : `<span class="cchip none">Personal</span>`);
  function viewTitle() {
    const v = viewById(S.view), m = S.q.match(/^is:open course:(\S+)$/);
    const c = m && S.courses.find((x) => x.tag.toLowerCase() === m[1]);
    return c ? c.code : v.label + (S.q !== v.q ? " · filtered" : "");
  }
  function setDisp(el, s) { // split-flap displays get one tile per character and flip the ones that changed
    if (!el.hasAttribute("data-flap")) { el.textContent = s; return; }
    const old = el.dataset.v; if (old === s) return; el.dataset.v = s;
    el.innerHTML = [...s].map((ch, i) => `<i class="${ch === ":" ? "sep" : ""}${old && old[i] !== ch ? " fl" : ""}">${ch === " " ? "&nbsp;" : esc(ch)}</i>`).join("");
  }

  function mTop(el) {
    const { wk, toFinals } = weekInfo(), d = new Date(S.now);
    const f = S.focus ? `<button class="fpill" data-act="focusTop" title="Back to the focus screen">${ic("focus")}Focus · <span class="num" data-cd data-f="clock" data-t="${S.focus.end}">${cdText(S.focus.end - S.now)}</span></button>` : "";
    el.innerHTML = `<div class="mtop">${LOGO}
      <div class="crumb"><span class="v"><span class="dl">${DNL[d.getDay()]}</span><span class="ds">${DNM[d.getDay()]}</span>, ${MNM[d.getMonth()]} ${d.getDate()}</span><span class="ctx">${esc(CA.quarter.name)} · Week ${wk} of 10 · Finals in ${toFinals} days</span></div>
      <button class="search" data-act="palette" data-hint="k" title="Search and commands (${MOD}+K)">${ic("search")}<span class="ph-t">Search items, classes, links, commands</span><kbd>${MOD} K</kbd></button>
      ${f}<button class="btn" data-act="focusTop" data-hint="f" title="Focus on Do first (F)">${ic("focus")}<span class="bl">Focus</span><kbd>F</kbd></button>
      <button class="btn primary" data-act="quick" data-hint="q">${ic("plus")}Add<kbd>Q</kbd></button>
      <div class="display clock" title="Local time"><span class="d-num num" data-clock${flap()}>${clockStr()}</span></div></div>`;
  }
  function mNav(el) {
    const h = horizNav(), v0 = viewById(S.view), custom = S.q !== v0.q;
    const count = (v) => (v.lens === "list" ? S.items.filter((it) => E.matchItem(it, E.parseFilter(v.q), ctx())).length : "");
    let out = `<div class="mnav${h ? " h" : ""}">${LOGO}<div class="nsec">Views</div>`;
    VIEWS.forEach((v) => {
      if (h && v.id === "done") return;
      const n = h && !["now", "today", "inbox", "exams"].includes(v.id) ? "" : count(v), on = S.view === v.id;
      out += `<button class="nv${on ? " on" : ""}${on && custom ? " mod" : ""}" data-act="go" data-v="${v.id}" ${v.k ? `data-hint="${v.k}"` : ""} title="${esc(v.label)}${v.k ? " · key " + v.k : ""}">${ic(v.id)}<span class="lb">${esc(h ? v.short || v.label : v.label)}</span>${n !== "" ? `<span class="ct">${n}</span>` : ""}${v.k ? `<kbd>${v.k}</kbd>` : ""}</button>`;
    });
    out += `<div class="nsec">Classes</div>`;
    S.courses.filter((c) => c.included).forEach((c) => {
      const q = "is:open course:" + c.tag.toLowerCase(), n = S.items.filter((it) => it.course === c.id && E.isOpen(it, S.now) && E.ACTIONABLE(it.kind)).length;
      out += `<button class="nv cls${S.q === q ? " on" : ""}" data-act="q" data-q="${q}" style="${kc(c)}" title="${esc(c.title)}"><span class="dot"></span><span class="lb">${esc(c.code)}</span><span class="ct">${n}</span></button>`;
    });
    out += `<div class="nsec">Sources</div><div class="srcs">${SOURCES.map(([, name, how, ago]) => `<span class="src${ago === "off" ? " off" : ""}" title="${esc(how)}"><i></i>${esc(name)}<span class="ago">${ago === "off" ? "off" : ago === "live" ? "live" : ago}</span></span>`).join("")}</div>`;
    el.innerHTML = out + `<div class="nfoot"><button class="nv" data-act="lab" title="Appearance · Design Lab (${MOD}+.)" aria-label="Appearance">${ic("lab")}<span class="lb">Appearance</span><kbd>${MOD} .</kbd></button><button class="nv" data-act="help" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">${ic("help")}<span class="lb">Shortcuts</span><kbd>?</kbd></button></div></div>`;
  }
  function mNow(el, r) {
    const head = (cnt, more) => `<div class="panel hero" data-win="now"><div class="ph"><span class="pt">${ic("now")}Do first</span><span class="sp"></span><span class="cnt">${cnt}</span>${more ? `<button class="btn ghost sm" data-act="skip" data-hint="n" title="Show the next candidate">Next${ic("next")}<kbd>N</kbd></button>` : ""}</div><div class="pb">`;
    if (!r.length) { el.innerHTML = head("All clear") + `<div class="hero-empty"><h2 class="hero-t">Nothing to do first.</h2><p>Everything open is scheduled or snoozed.</p><button class="btn primary" data-act="quick">${ic("plus")}Add something<kbd>Q</kbd></button></div></div></div>`; return; }
    const idx = S.skip % r.length, { it, sc } = r[idx], c = courseOf(it), overdue = it.due != null && it.due < S.now;
    const urg = Math.round(Math.min(1, sc.urgency) * 100), pulse = ui().guide === "g4" ? " pulse" : "";
    const disp = it.due == null ? `<div class="display"><span class="d-lbl">Due</span><span class="d-num">--:--</span><span class="d-sub">No due date</span></div>`
      : `<div class="display${overdue ? " bad" : sc.urgency > 0.7 ? " hot" : ""}"><span class="d-lbl">${overdue ? "Overdue by" : "Due in"}</span><span class="d-num num" data-cd data-f="${overdue ? "since" : "clock"}" data-t="${it.due}"${flap()}></span><span class="d-sub">${esc(mDue(it.due))}${it.est ? ` · ~${E.fmtDur(it.est * MIN)} of work` : ""}</span><span class="d-bar" title="Urgency ${urg}%"><i style="width:${urg}%"></i></span></div>`;
    el.innerHTML = head(`${idx + 1} of ${r.length}`, r.length > 1) + `<div class="hero-grid"><div class="hero-main">
        <div class="meta-row">${cchip(c)}<span>${kLabel(it.kind)}</span>${it.src !== "manual" ? `<span class="srcl">from ${esc(srcName(it.src))}</span>` : ""}${it.pri ? `<span class="prio p${it.pri}">${ic("flag")}${PRI[it.pri]}</span>` : ""}</div>
        <h2 class="hero-t">${esc(it.title)}</h2>
        <div class="why"><span class="why-l">Why first:</span>${sc.reasons.map((x) => `<span class="why-chip">${esc(cap(x))}</span>`).join("")}</div>
        <div class="actions">
          <button class="btn primary lg${pulse}" data-act="focus" data-id="${it.id}" data-min="25" data-hint="f">${ic("play", "fill")}Start focus · 25 min<kbd>F</kbd></button>
          <button class="btn" data-act="done" data-id="${it.id}" data-hint="x">${ic("check")}Done<kbd>X</kbd></button>
          <button class="btn" data-act="snooze" data-id="${it.id}" data-hint="s">${ic("clock")}Snooze<kbd>S</kbd></button>
          <button class="btn ghost" data-act="sel" data-id="${it.id}">Details</button>
        </div></div>${disp}</div></div></div>`;
  }
  function mSched(el, list) {
    const live = list.find((it) => it.due <= S.now && it.end > S.now), next = list.find((it) => it.due > S.now), d = new Date(S.now);
    let h = `<div class="panel" data-win="sched"><div class="ph"><span class="pt">${ic("clock")}Up next</span><span class="sp"></span><span class="cnt">${DNM[d.getDay()]}, ${MNM[d.getMonth()]} ${d.getDate()}</span></div><div class="pb">`;
    if (live) { const c = courseOf(live); h += `<div class="live"><span class="ldot"></span><span class="lt">Now: <b>${c ? esc(c.code) + " " : ""}${esc(live.title)}</b></span><span class="sp"></span><span class="num">ends in <b data-cd data-f="clock" data-t="${live.end}"></b></span></div>`; }
    if (next) {
      const c = courseOf(next), walk = 8;
      h += `<div class="next"><div class="display"><span class="d-lbl">${kLabel(next.kind)} starts in</span><span class="d-num num" data-cd data-f="clock" data-t="${next.due}"${flap()}></span></div>
        <div class="meta-row">${cchip(c)}<span>${kLabel(next.kind)}</span></div><div class="nx-t">${esc(next.title)}</div>
        <div class="facts"><span>${ic("clock")}${esc(mDue(next.due))}${next.end ? " – " + esc(mTime(next.end)) : ""}</span>${next.location ? `<span>${ic("pin")}${esc(next.location)}</span><span class="leave">${ic("go")}Leave by ${esc(mTime(next.due - (walk + 2) * MIN))} · ${walk} min walk</span>` : ""}</div>
        <div class="actions sm">${(next.links || []).slice(0, 3).map((l) => `<button class="btn" data-act="open" data-url="${esc(l[1])}">${esc(l[0])}${ic("ext")}</button>`).join("")}<button class="btn ghost" data-act="sel" data-id="${next.id}">Details</button></div></div>`;
    } else h += `<div class="m-empty">Nothing scheduled in the next few days.</div>`;
    const t0 = E.startOfDay(S.now) + 7 * HR, t1 = E.startOfDay(S.now) + 24 * HR, pos = (t) => Math.max(0, Math.min(100, ((t - t0) / (t1 - t0)) * 100));
    const today = list.concat(S.items.filter((it) => E.SCHEDULED(it.kind) && it.end && it.end <= S.now && it.due >= t0 && E.matchItem(it, [], ctx()))).filter((it) => it.due < t1 && (it.end || it.due + HR) > t0);
    h += `<div class="timeline" title="Today, 7 AM to midnight">${today.map((it) => `<span class="blk ${it.kind === "class" ? "" : "ev"}" style="left:${pos(it.due)}%;width:${Math.max(0.8, pos(it.end || it.due + HR) - pos(it.due))}%" title="${esc(it.title)}"></span>`).join("")}<span class="nowln" style="left:${pos(S.now)}%"></span></div><div class="tl-scale"><span>7a</span><span>11a</span><span>3p</span><span>7p</span><span>11p</span></div>`;
    const rest = list.filter((it) => it !== next && it !== live).slice(0, 6);
    if (rest.length) h += `<div class="sub-h">Coming up</div><div class="agenda">${rest.map((it) => { const c = courseOf(it); return `<div class="ag" data-act="sel" data-id="${it.id}" style="${kc(c)}"><span class="ag-when"><b>${esc(mDay(it.due).split(",")[0])}</b>${esc(mTime(it.due))}</span><span class="ag-bar"></span><span class="ag-main"><span class="ag-t">${esc(it.title)}</span><span class="ag-s">${c ? esc(c.code) : kLabel(it.kind)}${it.location ? " · " + esc(it.location) : ""}</span></span></div>`; }).join("")}</div>`;
    el.innerHTML = h + `</div></div>`;
  }
  function mFbar() {
    const terms = E.parseFilter(S.q), raws = terms.map((t) => t.raw);
    const quick = [...S.courses.filter((c) => c.included).map((c) => [`course:${c.tag.toLowerCase()}`, c.code, c]),
      ["due<=today", "Due today"], ["due:week", "This week"], ["is:overdue", "Overdue"], ["!2", "High priority"], ["#exam", "#exam"], ["src:canvas", "From Canvas"], ["src:manual", "Added by me"], ["status:doing", "In progress"]];
    return `<div class="fbar m"><div class="fbox">${ic("filter")}${terms.map((t, i) => `<button class="chip on" data-act="rmTerm" data-i="${i}" title="Remove this filter">${esc(t.raw)}<span class="x">×</span></button>`).join("")}<input id="fq" class="finput" placeholder="${terms.length ? "Add a filter…" : "Filter, e.g. course:130a  due<fri  #exam  !2"}" autocomplete="off" spellcheck="false" aria-label="Filter"></div><button class="btn ghost" data-act="clearQ" data-hint="esc">Clear<kbd>Esc</kbd></button></div>
      <div class="qstrip">${quick.map(([raw, label, c]) => `<button class="chip ${c ? "course" : ""} ${raws.includes(raw) ? "on" : ""}" data-act="toggleTerm" data-t="${esc(raw)}" style="${kc(c)}">${esc(label)}</button>`).join("")}</div>`;
  }
  function mRowHTML(it, i) {
    const c = courseOf(it), sched = E.SCHEDULED(it.kind), open = E.isOpen(it, S.now), st = dueState(it);
    const cls = ["row", "mrow"]; if (S.sel === it.id) cls.push("sel"); if (it.status === "done") cls.push("done"); if (it.status === "doing") cls.push("doing");
    if (sched) cls.push("cls"); if (st.c === "live") cls.push("live"); if (open && !sched && st.c === "over") cls.push("overdue"); if (S.flashId === it.id) cls.push("new");
    const chk = sched ? `<span class="chk sched" title="Scheduled">${ic(it.kind === "ticket" ? "ticket" : "clock")}</span>`
      : `<button class="chk" data-act="toggle" data-id="${it.id}" title="${it.status === "done" ? "Mark as not done" : "Mark done (X)"}" aria-label="Toggle done">${ic("check")}</button>`;
    const meta = [c ? `<span class="cdot" style="${kc(c)}"></span>${esc(c.code)}` : it.tags[0] ? "#" + esc(it.tags[0]) : "Personal", kLabel(it.kind)];
    if (it.est && !sched) meta.push("~" + E.fmtDur(it.est * MIN));
    if (sched && it.location) meta.push(esc(it.location));
    if (it.src !== "manual") meta.push(esc(srcName(it.src)));
    return `<div class="${cls.join(" ")}" data-act="sel" data-id="${it.id}" style="--i:${i};${kc(c)}">${chk}
      <span class="m-main"><span class="m-t">${it.status === "doing" ? '<span class="doing-tag">In progress</span>' : ""}${esc(it.title)}</span><span class="m-meta">${meta.map((m) => `<span>${m}</span>`).join("")}</span></span>
      <span class="m-pri p${it.pri}" title="${PRI[it.pri]}">${it.pri ? "!".repeat(it.pri) : ""}</span>
      <span class="m-due"><span class="duepill ${st.c}">${esc(st.t)}</span>${it.due != null ? `<span class="m-abs">${esc(st.c === "live" ? "until " + mTime(it.end) : mDue(it.due))}</span>` : ""}</span></div>`;
  }
  function mCoach() { return ui().guide === "g4" ? `<span class="coach" id="coach">Tip: ${TIPS[S.coachI % TIPS.length]}</span>` : ui().guide === "g2" ? `<span class="coach">Hold <b>Alt</b> to show every shortcut</span>` : ""; }
  function mBottom(el) {
    if (R() === "pocket") {
      const key = (cls, act, hint, label, k, extra) => `<button class="btn ${cls}" data-act="${act}" data-hint="${hint}" ${extra || ""}><span class="kl">${label}</span><kbd>${k}</kbd></button>`;
      el.innerHTML = `<div class="deck">${key("primary", "quick", "q", "Add", "Q")}${key("dark", "focusTop", "f", "Focus 25", "F")}${key("", "fast", "x", "Done", "X", 'data-a="done" title="Done: the selected item, or Do first"')}${key("", "fast", "s", "Snooze", "S", 'data-a="snooze"')}${key("", "skip", "n", "Next", "N")}${key("", "palette", "k", "Search", MOD + " K")}<span class="deck-sp"></span><span class="speaker" aria-hidden="true"></span></div>${mCoach()}`;
      return;
    }
    el.innerHTML = `<div class="mstatus"><span class="sync"><i></i>Synced · Windows ⇄ Mac · 2m ago</span><span class="stat">${ic("flame")}${S.stats.streak}-day streak · ${S.stats.focusMin} min focused today</span>${mCoach()}<span class="sp"></span>
      <span class="keys"><span><kbd>Q</kbd>Add</span><span><kbd>F</kbd>Focus</span><span><kbd>X</kbd>Done</span><span><kbd>J</kbd><kbd>K</kbd>Move</span><span><kbd>Alt</kbd>All keys</span></span><button class="lnk" data-act="lab" title="Appearance · Design Lab (${MOD}+.)" aria-label="Appearance">${ic("lab")}<span class="bl">Appearance</span></button></div>`;
  }

  /* ─────────── list computation ─────────── */
  function listItems() {
    const terms = E.parseFilter(S.q);
    const list = S.items.filter((it) => E.matchItem(it, terms, ctx()));
    if (S.sort === "score") {
      const sc = new Map(list.map((it) => [it.id, E.score(it, S.now)]));
      return list.sort((a, b) => ((sc.get(b.id) || { total: -1 }).total - (sc.get(a.id) || { total: -1 }).total) || cmpDue(a, b));
    }
    if (S.sort === "updated") return list.sort((a, b) => b.updated - a.updated);
    return list.sort(cmpDue);
  }
  function hiddenCount() {
    const ex = S.courses.filter((c) => !c.included).map((c) => c.id);
    return { n: S.items.filter((it) => ex.includes(it.course) && E.isOpen(it, S.now)).length, m: ex.length };
  }

  /* ─────────── navigation + filters ─────────── */
  function go(id) {
    const v = viewById(id);
    S.view = v.id; S.q = v.q; S.lens = v.lens; S.sort = v.sort; S.page = v.page; S.skip = 0; S.animRows = true; S.menu = null;
    CA.sound.click(); renderAll();
  }
  function setQ(q, keepFocus) {
    S.q = q.replace(/\s+/g, " ").trim(); S.animRows = true;
    if (S.lens !== "list" && S.lens !== "week") { S.lens = "list"; S.sort = "due"; }
    if (keepFocus) S.refocus = "fq";
    renderAll();
  }
  function toggleTerm(raw) {
    const terms = E.parseFilter(S.q).map((t) => t.raw);
    const i = terms.indexOf(raw);
    if (i >= 0) terms.splice(i, 1); else terms.push(raw);
    CA.sound.click(); setQ(terms.join(" "));
  }
  function clearQ() { S.view = "all"; S.page = 300; S.sort = "due"; S.lens = "list"; toast("Filters cleared · showing everything open"); setQ("is:open"); }

  /* ─────────── render: top ─────────── */
  function renderTop() {
    if (isM()) return mTop($("#top"));
    const el = $("#top"), v = viewById(S.view), { wk, toFinals } = weekInfo(), q = CA.quarter;
    const custom = S.q !== v.q;
    const focusTag = S.focus ? ` · <span class="hi">FOCUS <span data-cd data-f="clock" data-t="${S.focus.end}">${cdText(S.focus.end - S.now)}</span></span>` : "";
    if (R() === "phosphor") {
      el.innerHTML = `<div class="tline"><b>COLLEGIAPP</b><span>v0.1</span><span>~/views/<span class="hi">${v.id}${custom ? "*" : ""}</span></span><span>${q.code} · WK ${wk}/10 · FINALS IN ${toFinals}D</span>${focusTag}<span class="sp"></span><span>SYNC <b>●</b> WIN⇄MAC</span><span>STREAK <b>${S.stats.streak}D</b></span><span class="hi num" data-clock>${clockStr()}</span></div>`;
    } else if (R() === "teletext") {
      const d = new Date(S.now), pg = S.ttEntry ? (S.ttEntry + "--").slice(0, 3) : S.page;
      const n = S.lens === "list" ? listItems().length : "";
      el.innerHTML = `<div class="tthdr"><span class="pg">P${pg}</span><span class="svc">COLLEGIAPP</span><span class="pgc num" id="ttCounter">${S.page}</span><span>${q.code} WK${wk}</span>${focusTag}<span class="clk num" data-clock-tt>${E.DN[d.getDay()]} ${d.getDate()} ${E.MN[d.getMonth()]} ${clockStr()}</span></div>
        <div class="ttbanner"><div class="mosaic"></div><div class="dh">${esc(v.label.toUpperCase())}${custom ? " +" : ""}</div><div class="sub">${n !== "" ? n + " ITEMS · " : ""}FINALS IN ${toFinals} DAYS</div><div class="mosaic r"></div></div>`;
    } else if (R() === "mainframe") {
      const m = (id, label, hk) => `<button data-menu="${id}" class="${S.menu === id ? "on" : ""}">${label.replace(hk, `<span class="hk">${hk}</span>`)}</button>`;
      el.innerHTML = `<div class="mbar">${m("sys", "≡", "≡")}${m("file", "File", "F")}${m("view", "View", "V")}${m("item", "Item", "I")}${m("class", "Class", "C")}${m("focus", "Focus", "o")}${m("help", "Help", "H")}<span class="clk num">${S.focus ? "FOCUS " + cdText(S.focus.end - S.now) + " · " : ""}<span data-clock>${clockStr()}</span></span></div>`;
    } else {
      const lvl = Math.floor(S.stats.xp / 250) + 1, pct = ((S.stats.xp % 250) / 250) * 100;
      el.innerHTML = `<div class="hud"><span><span class="lbl">STREAK</span><span class="val">${S.stats.streak}D</span></span><span><span class="lbl">FOCUS TODAY</span><span class="val">${S.stats.focusMin}M</span></span><span><span class="lbl">LV</span><span class="val">${lvl}</span></span><div class="xp" title="${S.stats.xp % 250}/250 XP to next level"><i style="width:${pct}%"></i></div><span><span class="lbl">XP</span><span class="val">${S.stats.xp}</span></span><span><span class="lbl">${q.code} WK</span><span class="val">${wk}</span></span>${focusTag}<span class="clk" data-clock>${clockStr()}</span></div>`;
    }
  }

  /* ─────────── render: nav (phosphor tree) ─────────── */
  function renderNav() {
    const el = $("#nav");
    if (isM()) return mNav(el);
    if (R() !== "phosphor") { el.innerHTML = ""; return; }
    const count = (v) => (v.lens === "list" ? S.items.filter((it) => E.matchItem(it, E.parseFilter(v.q), ctx())).length : "");
    let h = `<div class="tree"><div class="th">~/views</div>`;
    VIEWS.forEach((v, i) => {
      const n = count(v);
      h += `<button class="${S.view === v.id ? "on" : ""}" data-act="go" data-v="${v.id}" ${v.k ? `data-hint="${v.k}"` : ""}><span class="br">${i === VIEWS.length - 1 ? "└" : "├"}</span>${v.label.toLowerCase()}${n !== "" ? ` <span class="br">${n}</span>` : ""}<span class="tk">${v.k ? "[" + v.k + "]" : ""}</span></button>`;
    });
    h += `<div class="th">~/classes</div>`;
    const inc = S.courses.filter((c) => c.included);
    inc.forEach((c, i) => {
      const n = S.items.filter((it) => it.course === c.id && E.isOpen(it, S.now) && E.ACTIONABLE(it.kind)).length;
      h += `<button data-act="q" data-q="is:open course:${c.tag.toLowerCase()}" style="${kc(c)}"><span class="br">${i === inc.length - 1 ? "└" : "├"}</span><span style="color:var(--kc)">${c.tag.toLowerCase()}</span> <span class="br">${n}</span></button>`;
    });
    h += `<div class="th">~/sources</div>`;
    SOURCES.forEach(([id, name, , ago], i) => { h += `<div class="src">${i === SOURCES.length - 1 ? "└" : "├"} ${id} <span class="${ago === "off" ? "" : "ok"}">${ago === "off" ? "○ off" : ago === "live" ? "● live" : "✓ " + ago}</span></div>`; });
    el.innerHTML = h + `</div>`;
  }

  /* ─────────── render: do first ─────────── */
  function renderNow() {
    const el = $("#now"), r = ranked();
    if (isM()) return mNow(el, r);
    const head = (extra) => `<div class="panel ${S.animRows && R() === "mainframe" ? "zoom" : ""}" data-win="now"><div class="ph"><span class="wbtn">[■]</span><span class="pt">Do first</span><span class="sp"></span><span class="cnt">${extra}</span></div><div class="pb">`;
    if (!r.length) { el.innerHTML = head("ALL CLEAR") + `<div class="empty"><b>NOTHING TO DO FIRST.</b>Everything open is scheduled or snoozed.<br><button class="btn" data-act="quick">ADD SOMETHING<kbd>Q</kbd></button></div></div></div>`; return; }
    const idx = S.skip % r.length, { it, sc } = r[idx], c = courseOf(it), overdue = it.due != null && it.due < S.now;
    const on = Math.round(Math.min(1, sc.urgency) * 10);
    const meter = Array.from({ length: 10 }, (_, i) => `<i class="${i < on ? "on" + (overdue || i >= 7 ? " hot" : "") : ""}"></i>`).join("");
    const pulse = ui().guide === "g4" ? " pulse" : "";
    const top3 = `<div class="nk"><span style="${kc(c)}color:var(--kc, var(--fg))">${c ? esc(c.code) : "PERSONAL"}</span><span>${kLabel(it.kind)}</span>${it.src !== "manual" ? `<span>VIA ${it.src.toUpperCase()}</span>` : ""}</div>
      <div class="nt">${esc(it.title)}</div>
      <div class="nm"><span class="${overdue ? "badc" : "warnc"} num" data-cd data-f="due" data-id="${it.id}">${dueLine(it)}</span>${it.est ? `<span class="dim">~${E.fmtDur(it.est * MIN)}</span>` : ""}${it.pri ? `<span class="warnc">${"!".repeat(it.pri)}</span>` : ""}${it.weight ? `<span class="dim">${it.weight}%</span>` : ""}</div>`;
    const rest = `<div class="meter" title="urgency">${meter}</div>
      <div class="why">WHY FIRST: ${sc.reasons.map((x) => `<b>${esc(x)}</b>`).join(" · ")}</div>
      <div class="nb">
        <button class="btn primary${pulse}" data-act="focus" data-id="${it.id}" data-min="25" data-hint="f">▶ Focus 25<kbd>F</kbd></button>
        <button class="btn" data-act="focus" data-id="${it.id}" data-min="50">50</button>
        <button class="btn" data-act="done" data-id="${it.id}" data-hint="x">✓ Done<kbd>X</kbd></button>
        <button class="btn" data-act="snooze" data-id="${it.id}" data-hint="s">Snooze<kbd>S</kbd></button>
        <button class="btn" data-act="skip" data-hint="n">Next<kbd>N</kbd></button>
      </div>`;
    if (R() === "vector") {
      // ring = time pressure over the last 72h; only the identity + due line sit inside it
      const p = overdue ? 1 : it.due == null ? 0.08 : Math.max(0.04, 1 - (it.due - S.now) / (72 * HR));
      el.innerHTML = head(`#${idx + 1} OF ${r.length}`) + `<div class="core nowcard"><div class="rk-wrap"><svg class="reactor" viewBox="0 0 200 200" aria-hidden="true"><circle class="rk-ticks" cx="100" cy="100" r="96"/><circle class="rk-ticks2" cx="100" cy="100" r="82"/><circle class="rk-track" cx="100" cy="100" r="89"/><circle class="rk-prog" cx="100" cy="100" r="89" stroke-dasharray="559.2" stroke-dashoffset="${(559.2 * (1 - p)).toFixed(1)}"/></svg><div class="rk-in">${top3}</div></div>${rest}</div></div></div>`;
    } else el.innerHTML = head(`#${idx + 1} OF ${r.length}`) + `<div class="nowcard">${top3}${rest}</div></div></div>`;
  }

  /* ─────────── render: up next / schedule ─────────── */
  function renderSched() {
    const el = $("#sched"), list = scheduleItems();
    if (isM()) return mSched(el, list);
    const live = list.find((it) => it.due <= S.now && it.end > S.now), next = list.find((it) => it.due > S.now);
    let h = `<div class="panel ${S.animRows && R() === "mainframe" ? "zoom" : ""}" data-win="sched"><div class="ph"><span class="wbtn">[■]</span><span class="pt">Up next</span><span class="sp"></span><span class="cnt">${E.DN[new Date(S.now).getDay()]} ${new Date(S.now).getMonth() + 1}/${new Date(S.now).getDate()}</span></div><div class="pb"><div class="upnext">`;
    if (live) { const c = courseOf(live); h += `<div class="un-sub">IN ${kLabel(live.kind).toUpperCase()} · <span style="${kc(c)}color:var(--kc,var(--fg))">${c ? c.tag : ""}</span> ${esc(live.title)} · ENDS IN <span class="hi num" data-cd data-f="clock" data-t="${live.end}">${cdText(live.end - S.now)}</span></div>`; }
    if (next) {
      const c = courseOf(next), walk = 8;
      h += `<div class="un-big"><span style="${kc(c)}color:var(--kc,var(--fg))">${c ? c.tag : kShort(next.kind)}</span><span>${esc(next.title)}</span><span class="cd" data-cd data-f="clock" data-t="${next.due}">${cdText(next.due - S.now)}</span></div>
        <div class="un-sub">${next.location ? esc(next.location) + " · " : ""}${E.fmtDue(next.due, S.now)}${next.location ? ` · LEAVE BY ${E.fmtTime(next.due - (walk + 2) * MIN)} (${walk} MIN WALK)` : ""}</div>
        <div class="nb">${(next.links || []).slice(0, 3).map((l) => `<button class="btn" data-act="open" data-url="${esc(l[1])}">${esc(l[0])}</button>`).join("")}<button class="btn" data-act="sel" data-id="${next.id}">Details</button></div>`;
    } else h += `<div class="empty">NOTHING SCHEDULED IN THE NEXT FEW DAYS.</div>`;
    const t0 = E.startOfDay(S.now) + 7 * HR, t1 = E.startOfDay(S.now) + 24 * HR, pos = (t) => Math.max(0, Math.min(100, ((t - t0) / (t1 - t0)) * 100));
    const today = list.concat(S.items.filter((it) => E.SCHEDULED(it.kind) && it.end && it.end <= S.now && it.due >= t0 && E.matchItem(it, [], ctx())))
      .filter((it) => it.due < t1 && (it.end || it.due + HR) > t0);
    h += `<div class="timeline" title="Today 07:00–24:00">${today.map((it) => `<span class="blk ${it.kind === "class" ? "" : "ev"}" style="left:${pos(it.due)}%;width:${Math.max(0.8, pos(it.end || it.due + HR) - pos(it.due))}%" title="${esc(it.title)}"></span>`).join("")}<span class="nowln" style="left:${pos(S.now)}%"></span></div><div class="tl-scale"><span>07</span><span>11</span><span>15</span><span>19</span><span>23</span></div>`;
    const rest = list.filter((it) => it !== next && it !== live).slice(0, R() === "phosphor" ? 3 : 5);
    h += `<div class="un-list">${rest.map((it) => { const c = courseOf(it); return `<div class="un-row" data-act="sel" data-id="${it.id}" style="${kc(c)}"><span style="color:var(--kc,var(--fg))">${c ? c.tag : kShort(it.kind)}</span><span class="t">${esc(it.title)}</span><span class="dim">${E.fmtDay(it.due, S.now)} ${E.fmtTime(it.due)}</span></div>`; }).join("")}</div>`;
    el.innerHTML = h + `</div></div></div>`;
  }

  /* ─────────── render: list + lenses ─────────── */
  function fbar() {
    if (isM()) return mFbar();
    const terms = E.parseFilter(S.q), raws = terms.map((t) => t.raw);
    const quick = [...S.courses.filter((c) => c.included).map((c) => [`course:${c.tag.toLowerCase()}`, c.tag, c]),
      ["due<=today", "due today"], ["due:week", "this week"], ["is:overdue", "overdue"], ["!2", "!! +"], ["#exam", "#exam"], ["src:canvas", "canvas"], ["src:manual", "mine"], ["status:doing", "in progress"]];
    return `<div class="fbar"><span class="fprompt">FILTER&gt;</span>${terms.map((t, i) => `<button class="chip on" data-act="rmTerm" data-i="${i}" title="Remove filter">${esc(t.raw)}<span class="x">×</span></button>`).join("")}<input id="fq" class="finput" placeholder="${terms.length ? "+ filter" : "course:130a  due<fri  #exam  !2  src:canvas"}" autocomplete="off" spellcheck="false" aria-label="Filter"><button class="btn ghost" data-act="clearQ" data-hint="esc">Clear<kbd>Esc</kbd></button></div>
      <div class="qstrip">${quick.map(([raw, label, c]) => `<button class="chip ${c ? "course" : ""} ${raws.includes(raw) ? "on" : ""}" data-act="toggleTerm" data-t="${esc(raw)}" style="${kc(c)}">${esc(label)}</button>`).join("")}</div>`;
  }
  function rowHTML(it, i) {
    if (isM()) return mRowHTML(it, i);
    const c = courseOf(it), sched = E.SCHEDULED(it.kind), open = E.isOpen(it, S.now), sc = E.score(it, S.now);
    const live = sched && it.due <= S.now && it.end > S.now, overdue = open && !sched && it.due != null && it.due < S.now;
    const cls = ["row"]; if (S.sel === it.id) cls.push("sel"); if (it.status === "done") cls.push("done"); if (it.status === "doing") cls.push("doing");
    if (sched) cls.push("cls"); if (live) cls.push("live"); if (overdue) cls.push("overdue"); if (S.flashId === it.id) cls.push("new");
    const chk = sched ? (it.kind === "ticket" ? "[$]" : "[:]") : it.status === "done" ? "[x]" : it.status === "doing" ? "[>]" : "[ ]";
    let due = '<span class="dim">—</span>';
    if (it.due != null) {
      if (live) due = "NOW · ENDS " + E.fmtTime(it.end);
      else { const d = it.due - S.now; due = fDue(it.due) + (Math.abs(d) < 48 * HR ? ` <span class="dim">${d < 0 ? E.fmtDur(d) + " ago" : E.fmtDur(d)}</span>` : ""); }
    }
    const cells = sc ? E.scoreCells(sc.total) : 0;
    return `<div class="${cls.join(" ")}" data-act="sel" data-id="${it.id}" style="--i:${i};${kc(c)}">
      <button class="chk" data-act="${sched ? "sel" : "toggle"}" data-id="${it.id}" title="${sched ? "Scheduled" : "Mark done (X)"}" aria-label="${sched ? "Scheduled" : "Toggle done"}">${chk}</button>
      <span class="cc">${c ? c.tag : it.tags[0] ? "#" + esc(it.tags[0]) : "—"}</span>
      <span class="t"><span class="kd">${kShort(it.kind)}</span>${esc(it.title)}${sched && it.location ? ` <span class="dim">@${esc(it.location)}</span>` : ""}${it.src !== "manual" ? `<span class="src">${it.src}</span>` : ""}</span>
      <span class="due num">${due}</span><span class="est">${it.est && !sched ? "~" + E.fmtDur(it.est * MIN) : ""}</span>
      <span class="pri p${it.pri}">${it.pri ? "!".repeat(it.pri) : ""}</span><span class="bar" title="${sc ? "do-first score " + sc.total.toFixed(2) : ""}">${sc ? "▮".repeat(cells) + "▯".repeat(5 - cells) : ""}</span></div>`;
  }
  function listLens() {
    const list = listItems(); S.listIds = list.map((x) => x.id);
    let h = "", i = 0, last = null;
    const counts = {}; if (S.sort === "due") list.forEach((it) => { const b = E.bucket(it, S.now); counts[b] = (counts[b] || 0) + 1; });
    for (const it of list) {
      if (S.sort === "due") { const b = E.bucket(it, S.now); if (b !== last) { h += `<div class="grp" style="--i:${i++}">${b}<span>${counts[b]}</span></div>`; last = b; } }
      h += rowHTML(it, i++);
    }
    if (!list.length) h = `<div class="empty"><b>Nothing here.</b>No items match <span class="hi">${esc(S.q || "(no filter)")}</span>.<br><br><button class="btn" data-act="clearQ">Clear filter<kbd>Esc</kbd></button> <button class="btn" data-act="quick">Quick add<kbd>Q</kbd></button></div>`;
    const hc = hiddenCount();
    if (hc.n) h += `<div class="hidden-note">${hc.n} open items hidden from ${hc.m} excluded Canvas courses · <button class="chip" data-act="go" data-v="classes">manage</button></div>`;
    return { h, n: list.length };
  }
  function weekLens() {
    const list = listItems(); S.listIds = list.map((x) => x.id);
    let h = `<div class="week">`;
    for (let d = 0; d < 7; d++) {
      const day = E.addDays(E.startOfDay(S.now), d), dt = new Date(day);
      const its = list.filter((it) => it.due != null && it.due >= day && it.due < day + DAY);
      h += `<div class="wcol ${d === 0 ? "today" : ""}"><div class="wh">${E.DN[dt.getDay()]} <span class="dim">${dt.getMonth() + 1}/${dt.getDate()}</span></div>${its.map((it) => { const c = courseOf(it); return `<div class="wi ${E.SCHEDULED(it.kind) ? "cls" : ""} ${it.kind === "exam" ? "exam" : ""}" data-act="sel" data-id="${it.id}" style="${kc(c)}" title="${esc(it.title)}">${E.fmtTime(it.due)} ${c ? c.tag : ""} ${esc(it.title)}</div>`; }).join("") || '<div class="dim" style="font-size:.8em">—</div>'}</div>`;
    }
    return { h: h + `</div>`, n: list.length };
  }
  function coursesLens() {
    const card = (c) => {
      const open = S.items.filter((it) => it.course === c.id && E.isOpen(it, S.now) && E.ACTIONABLE(it.kind));
      const wkEnd = E.addDays(E.startOfDay(S.now), 7), dueWk = open.filter((it) => it.due != null && it.due < wkEnd).length;
      const nx = S.items.filter((it) => it.course === c.id && it.kind === "class" && it.due > S.now).sort(cmpDue)[0];
      const ex = open.filter((it) => it.kind === "exam").sort(cmpDue)[0];
      const meet = c.meet.map((m) => `${m.days} ${m.h}:${String(m.m).padStart(2, "0")} ${m.loc}`).join(" · ") || "no meetings synced";
      return `<div class="ccard ${c.included ? "" : "excluded"}" style="${kc(c)}"><h4>${esc(c.code)} <span class="dim">${c.tag}</span></h4><div class="meta">${esc(c.title)}</div><div class="meta">${esc(meet)}</div>
        ${c.included ? `<div class="meta">Next: ${nx ? mDue(nx.due) + " · " + E.fmtRel(nx.due, S.now) : "—"}</div><div class="meta">${open.length} open · ${dueWk} due this week${ex ? " · " + esc(ex.title) + " " + mDay(ex.due) : ""}</div>` : `<div class="meta">Excluded · items hidden everywhere</div>`}
        <div class="row2">${c.links.map((l) => `<button class="btn" data-act="open" data-url="${esc(l[1])}">${esc(l[0])}</button>`).join("")}</div>
        <div class="row2">${c.included ? `<button class="btn primary" data-act="q" data-q="is:open course:${c.tag.toLowerCase()}">Items →</button>` : ""}<button class="btn" data-act="incl" data-c="${c.id}">${c.included ? "Exclude" : "Include"}</button></div></div>`;
    };
    let h = `<div class="cgrid">${S.courses.filter((c) => c.included).map(card).join("")}</div>`;
    h += `<div class="sect">Excluded from Canvas sync (${S.courses.filter((c) => !c.included).length})</div><div class="cgrid">${S.courses.filter((c) => !c.included).map(card).join("")}</div>`;
    h += `<div class="sect">Google Calendar · which series are classes?</div><div class="calmap">${S.calendarSeries.map((s) => `<span>${esc(s.name)} <span class="dim">${esc(s.rule)}</span></span><button class="chip ${s.isClass ? "on" : ""}" data-act="calmap" data-s="${s.id}">${s.isClass ? "Class ✓" : "Not a class"}</button>`).join("")}</div>`;
    h += `<div class="sect">Sources</div><div class="calmap">${SOURCES.map(([id, name, how, ago]) => `<span>${esc(name)} <span class="dim">${esc(how)}</span></span><button class="chip ${ago === "off" ? "" : "on"}" data-act="source" data-s="${id}">${ago === "off" ? "Connect" : ago === "live" ? "Live" : "Synced " + ago + " ago"}</button>`).join("")}</div>`;
    return { h, n: S.courses.length };
  }
  function linksLens() {
    const btn = (l) => `<button class="btn" data-act="open" data-url="${esc(l[1])}">${esc(l[0])} ↗</button>`;
    let h = `<div class="sect" style="margin-top:0">UCSB</div><div class="lgroup"><div class="row2">${GLOBAL_LINKS.map(btn).join("")}</div></div><div class="sect">Classes</div><div class="lgrid">`;
    h += S.courses.filter((c) => c.included).map((c) => `<div class="lgroup" style="${kc(c)}"><h4>${esc(c.code)}</h4><div class="row2">${c.links.map(btn).join("")}</div></div>`).join("");
    const withLinks = ranked().map((x) => x.it).filter((it) => it.links.length).slice(0, 8);
    h += `</div><div class="sect">From your open items</div><div class="lgrid">${withLinks.map((it) => { const c = courseOf(it); return `<div class="lgroup" style="${kc(c)}"><h4>${c ? c.tag + " · " : ""}${esc(it.title)}</h4><div class="row2">${it.links.map(btn).join("")}</div></div>`; }).join("")}</div>`;
    return { h, n: GLOBAL_LINKS.length };
  }
  function indexLens() {
    const pages = [...VIEWS, ...EXTRA].sort((a, b) => a.page - b.page);
    const h = `<div class="tt-index">${pages.map((v) => `<button data-act="go" data-v="${v.id}"><span class="pg">${v.page}</span>${esc(v.label.toUpperCase())}</button>`).join("")}<button data-act="focusSetup"><span class="pg">600</span>FOCUS SESSION</button><button data-act="help"><span class="pg">888</span>KEYS &amp; HELP</button></div>
      <div class="sect">Type three digits to jump · R G Y B are the Fastext keys</div>`;
    return { h, n: pages.length };
  }
  function renderList() {
    const el = $("#list"), v = viewById(S.view), custom = S.q !== v.q;
    const lens = { list: listLens, week: weekLens, courses: coursesLens, links: linksLens, index: indexLens }[S.lens] || listLens;
    const out = lens();
    const showBar = S.lens === "list" || S.lens === "week";
    el.innerHTML = `<div class="panel ${S.animRows && R() === "mainframe" ? "zoom" : ""}" data-win="list"><div class="ph"><span class="wbtn">[■]</span><span class="pt">${isM() ? esc(viewTitle()) : esc(v.label) + (custom ? " · custom filter" : "")}</span><span class="sp"></span><span class="cnt">${S.lens === "list" ? out.n + " items" + (isM() ? `<span class="cnt-x"> · ${{ score: "ranked by do-first score", due: "by due date", updated: "recently changed" }[S.sort]}</span>` : "") : isM() ? "" : S.lens}</span></div>
      ${showBar ? fbar() : ""}<div class="pb rows ${S.animRows ? "anim" : ""}">${out.h}</div></div>`;
  }

  /* ─────────── render: inspector ─────────── */
  function renderInsp() {
    const el = $("#insp"), dock = R() === "phosphor" && S.lens === "list" && !narrow();
    el.className = "region insp" + (dock ? "" : " float");
    const it = S.sel && find(S.sel);
    if (!dock && !(S.insp && it)) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    const head = (t) => `<div class="panel" data-win="insp"><div class="ph"><span class="wbtn" data-act="closeInsp">[■]</span><span class="pt">${t}</span><span class="sp"></span>${dock ? "" : `<button class="btn ghost" data-act="closeInsp">Close<kbd>Esc</kbd></button>`}</div><div class="pb">`;
    if (!it) {
      el.innerHTML = head("Inspect") + `<div class="insp-empty">NO SELECTION. CLICK A ROW OR USE J/K.<table>${[["q", "quick add"], ["ctrl+k  /", "command palette"], ["1–0", "views (saved filters)"], ["esc", "clear filters"], ["j k ↑ ↓", "move"], ["enter", "inspect"], ["x  space", "done"], ["f", "focus 25"], ["s", "snooze"], ["n", "next do-first"], ["[  ]", "switch rendition"], ["hold alt", "show shortcuts"], ["right-click", "radial menu"], ["?", "all keys"]].map(([k, d]) => `<tr><td>${k}</td><td>${d}</td></tr>`).join("")}</table></div></div></div>`;
      return;
    }
    const c = courseOf(it), sched = E.SCHEDULED(it.kind);
    const pad = (n) => String(n).padStart(2, "0");
    const dl = (t) => { if (t == null) return ""; const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const seg = (field, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button class="chip ${String(cur) === String(v) ? "on" : ""}" data-act="setf" data-f="${field}" data-v="${v}">${l}</button>`).join("")}</div>`;
    const syncedAgo = Math.max(1, Math.round((S.now - it.updated) / MIN));
    el.innerHTML = head(sched ? kLabel(it.kind) : "Inspect") + `
      <div class="f-title" contenteditable="true" spellcheck="false" data-field="title">${esc(it.title)}</div>
      <div class="fgrid">
        <label>Kind</label><select data-field="kind">${Object.keys(KIND).map((k) => `<option value="${k}" ${k === it.kind ? "selected" : ""}>${kLabel(k)}</option>`).join("")}</select>
        <label>Course</label><select data-field="course"><option value="">— personal —</option>${S.courses.filter((x) => x.included || x.id === it.course).map((x) => `<option value="${x.id}" ${x.id === it.course ? "selected" : ""}>${esc(x.code)}</option>`).join("")}</select>
        <label>${sched ? "Starts" : "Due"}</label><input type="datetime-local" data-field="due" value="${dl(it.due)}">
        ${sched ? "" : `<label>Estimate</label>${seg("est", [[15, "15m"], [30, "30m"], [60, "1h"], [120, "2h"], [240, "4h"]], it.est)}`}
        ${sched ? "" : `<label>Priority</label>${seg("pri", [[0, "–"], [1, "!"], [2, "!!"], [3, "!!!"]], it.pri)}`}
        ${sched ? "" : `<label>Status</label>${seg("status", [["inbox", "inbox"], ["todo", "todo"], ["doing", "doing"], ["done", "done"]], it.status)}`}
        <label>Alert</label>${seg("interrupt", [["none", "none"], ["nudge", "nudge"], ["alert", "alert"], ["takeover", "takeover"]], it.interrupt)}
        ${it.location ? `<label>Where</label><span>${esc(it.location)}</span>` : ""}
      </div>
      <div class="links">${it.links.map((l) => `<button class="btn" data-act="open" data-url="${esc(l[1])}">${esc(l[0])} ↗</button>`).join("")}${c ? `<button class="btn ghost" data-act="open" data-url="${esc(c.links[0] ? c.links[0][1] : "")}">${esc(c.tag)} Canvas ↗</button>` : ""}</div>
      <textarea class="notes" data-field="notes" placeholder="Notes… (saved on blur)">${esc(it.notes)}</textarea>
      <div class="srcinfo">${it.src === "manual" ? "Added by you" : `Source: ${esc(srcName(it.src))} · synced ${syncedAgo}m ago · your edits are kept as overrides on re-sync`}</div>
      <div class="acts">${sched ? "" : `<button class="btn primary" data-act="focus" data-id="${it.id}" data-min="25">▶ Focus 25</button><button class="btn" data-act="done" data-id="${it.id}">${it.status === "done" ? "Undo done" : "✓ Done"}</button><button class="btn" data-act="snooze" data-id="${it.id}">Snooze</button>`}<button class="btn" data-act="del" data-id="${it.id}">Delete</button></div></div></div>`;
  }

  /* ─────────── render: bottom bar per rendition ─────────── */
  function coachHTML() { return ui().guide === "g4" ? `<div class="coach" id="coach">TIP: ${TIPS[S.coachI % TIPS.length]}</div>` : ui().guide === "g2" ? `<div class="coach">HOLD <b>ALT</b> TO REVEAL EVERY SHORTCUT</div>` : ""; }
  function fastextSet() {
    if (S.view === "now") return [["r", "✓ Done", "done"], ["g", "Next ▶", "skip"], ["y", "Snooze", "snooze"], ["b", "Focus 25", "focusTop"]];
    if (S.lens !== "list") return [["r", "Do first 200", "go:now"], ["g", "Today 210", "go:today"], ["y", "Index 100", "go:index"], ["b", "Quick add", "quick"]];
    return [["r", "Do first 200", "go:now"], ["g", "Today 210", "go:today"], ["y", "Work 310", "go:work"], ["b", "Focus 600", "focusSetup"]];
  }
  function renderBottom() {
    const el = $("#bottom"), key = [R(), ui().guide, S.view, S.lens, !!S.focus, S.q === viewById(S.view).q].join("|");
    if (el.dataset.key === key && el.innerHTML) { const lb = $("#cmdLabel"); if (lb) lb.textContent = `gaucho@collegiapp:~/${S.view}$`; return; }
    el.dataset.key = key;
    if (isM()) return mBottom(el);
    if (R() === "phosphor") {
      el.innerHTML = `<div class="cmd"><div class="cmd-prev" id="cmdPrev">TYPE TO QUICK-ADD · <span class="hi">/</span> OR <span class="hi">CD</span> FOR COMMANDS · <span class="hi">?</span> HELP</div><div class="cmd-line"><label for="cmdIn" id="cmdLabel">gaucho@collegiapp:~/${S.view}$</label><input id="cmdIn" autocomplete="off" spellcheck="false" placeholder="hw4 130a fri 11:59p ~2h !!" data-hint="q"></div>${coachHTML()}</div>`;
    } else if (R() === "teletext") {
      el.innerHTML = `<div class="fastext">${fastextSet().map(([t, l, a]) => `<button class="btn" data-tone="${t}" data-act="fast" data-a="${a}" data-hint="${t}">${esc(l)}<kbd>${t.toUpperCase()}</kbd></button>`).join("")}</div><div class="ttfoot"><span>TYPE A PAGE NUMBER · 100 INDEX · 888 KEYS</span><span class="sp"></span>${ui().guide === "g4" ? `<span class="coach" id="coach">${TIPS[S.coachI % TIPS.length]}</span>` : ""}</div>`;
    } else if (R() === "mainframe") {
      const f = (k, l, a) => `<button data-act="${a}"><span class="hk">${k}</span> ${l}</button><span class="sep">│</span>`;
      el.innerHTML = `<div class="fkeys">${f("F1", "Help", "help")}${f("F2", "Add", "quick")}${f("F3", "Find", "palette")}${f("F4", "Filter", "focusQ")}${f("F6", "Next win", "nextWin")}${f("F8", "Focus", "focusSetup")}${f("F9", "Lab", "lab")}${f("F10", "Menu", "menuKey")}<span class="rt num" id="fkNext"></span></div>${coachHTML()}`;
    } else {
      el.innerHTML = `<div class="dock">${VIEWS.filter((v) => v.k).map((v) => `<button class="btn ${S.view === v.id ? "on" : ""}" data-act="go" data-v="${v.id}" data-hint="${v.k}"><span class="ic">${v.icon}</span><span class="lb">${esc((v.short || v.label).toUpperCase())}</span><kbd>${v.k}</kbd></button>`).join("")}<span class="gapx"></span><button class="btn primary" data-act="quick" data-hint="q"><span class="ic">+</span><span class="lb">ADD</span><kbd>Q</kbd></button><button class="btn primary" data-act="focusTop" data-hint="f"><span class="ic">◉</span><span class="lb">FOCUS</span><kbd>F</kbd></button></div>${coachHTML()}`;
    }
  }
  function renderTicker() {
    const el = $("#ticker"); if (R() !== "teletext") { el.innerHTML = ""; S.tickerHTML = ""; return; }
    const top = topItem(), nx = nextAlertable(), ex = S.items.filter((it) => it.kind === "exam" && E.isOpen(it, S.now) && E.matchItem(it, [], ctx())).sort(cmpDue);
    const parts = [];
    if (top) parts.push(`<b>DO FIRST</b> ${esc(top.title)} · ${courseOf(top) ? courseOf(top).tag : ""} · ${top.due ? E.fmtDue(top.due, S.now) : "ANY TIME"}`);
    if (nx) parts.push(`<b>NEXT</b> ${courseOf(nx) ? courseOf(nx).tag : ""} ${esc(nx.title)} · ${E.fmtDue(nx.due, S.now)}${nx.location ? " · " + esc(nx.location) : ""}`);
    ex.forEach((x) => parts.push(`<b>EXAM</b> ${courseOf(x).tag} ${esc(x.title)} IN ${Math.ceil((x.due - S.now) / DAY)} DAYS`));
    parts.push(`<b>FINALS</b> BEGIN SAT DEC 5 · ${weekInfo().toFinals} DAYS`, `<b>SHORELINE</b> ACM RUST WORKSHOP · CAREER FAIR AT CORWIN`, `<b>TIP</b> PRESS Q TO ADD ANYTHING`);
    const html = `<div class="tk-in">${parts.map((p) => `<span>${p}</span>`).join("")}</div>`;
    if (html !== S.tickerHTML) { el.innerHTML = html; S.tickerHTML = html; }
  }

  /* ─────────── island + shell mocks (desk preview) ─────────── */
  function presence() {
    const list = scheduleItems(), live = list.find((it) => it.kind === "class" && it.due <= S.now && it.end > S.now), next = list.find((it) => it.due > S.now && it.due - S.now < 12 * HR);
    if (S.focus) { const it = find(S.focus.id); return { label: "Focus · " + (it ? it.title : "session"), t: S.focus.end, p0: S.focus.start, p1: S.focus.end, short: "FOCUS" }; }
    if (live) { const c = courseOf(live); return { label: "In class · " + (c ? c.tag : "") + " " + live.title, t: live.end, p0: live.due, p1: live.end, short: c ? c.tag : "CLASS" }; }
    if (next) { const c = courseOf(next); return { label: (c ? c.tag + " " : "") + next.title, t: next.due, p0: next.due - HR, p1: next.due, short: c ? c.tag : kShort(next.kind), it: next }; }
    const top = topItem(); return top ? { label: "Due · " + top.title, t: top.due || S.now, p0: S.now - HR, p1: top.due || S.now, short: "DUE" } : { label: "All clear", t: S.now, p0: 0, p1: 1, short: "OK" };
  }
  function dueTodayCount() { return S.items.filter((it) => E.matchItem(it, E.parseFilter("is:open is:actionable due<=today"), ctx())).length; }
  function renderIsland() {
    const el = $("#island");
    if (!ui().island || ui().desk !== "desk" || narrow()) { el.hidden = true; return; }
    if (busy() && el.contains(document.activeElement)) return;
    el.hidden = false; el.className = "island bset-" + ui().btn + (S.islandOpen ? " open" : ""); el.dataset.guide = ui().guide;
    const p = presence(), top = topItem(), urgent = p.t - S.now < 10 * MIN && p.t > S.now;
    el.innerHTML = `<div class="is-pill" data-act="island"><svg class="is-ring" viewBox="0 0 30 30" aria-hidden="true"><circle class="tr" cx="15" cy="15" r="12"/><circle class="pr" cx="15" cy="15" r="12" stroke-dasharray="75.4" data-ring data-p0="${p.p0}" data-p1="${p.p1}"/></svg><span class="is-lbl">${esc(p.label)}</span>${urgent ? '<span class="is-dot"></span>' : ""}<span class="is-cd num" data-cd data-f="clock" data-t="${p.t}">${cdText(p.t - S.now)}</span></div>
      <div class="is-more">
        ${p.it ? `<div class="is-row"><span class="dim">Next</span><span class="t">${esc(p.it.location || "")} · leave by ${E.fmtTime(p.it.due - 10 * MIN)}</span>${(p.it.links || []).slice(0, 1).map((l) => `<button class="btn" data-act="open" data-url="${esc(l[1])}">${esc(l[0])}</button>`).join("")}</div>` : ""}
        ${top ? `<div class="is-row"><span class="dim">Do first</span><span class="t">${esc(top.title)}</span><button class="btn" data-act="done" data-id="${top.id}">✓</button><button class="btn" data-act="focus" data-id="${top.id}" data-min="25">▶ 25</button></div>` : ""}
        <div class="is-row"><span class="dim">${dueTodayCount()} due today</span><input id="isIn" placeholder="quick add… (enter)" autocomplete="off" spellcheck="false" aria-label="Quick add"></div>
      </div>`;
    updateRings();
  }
  function renderShell() {
    const desk = $("#desk"), tb = $("#taskbar"), sb = $("#shellbar");
    desk.dataset.mode = ui().desk; desk.dataset.shell = ui().shell;
    if (ui().desk !== "desk") { tb.hidden = sb.hidden = true; return; }
    const p = presence(), n = dueTodayCount(), d = new Date(S.now);
    const cd = `<span data-cd data-f="clock" data-t="${p.t}">${cdText(p.t - S.now)}</span>`;
    if (ui().shell === "win") {
      sb.hidden = true; tb.hidden = false;
      tb.innerHTML = `<span class="tb-hint">PREVIEW · STOCK WINDOWS TASKBAR (progress + overlay badge)</span><div class="tb-ic"><span class="g">::</span></div><div class="tb-ic"><span class="g">◎</span></div><div class="tb-ic"><span class="g">▤</span></div><div class="tb-ic"><span class="g">&gt;_</span></div>
        <div class="tb-ic tb-app" data-act="island" title="Collegiapp · ${esc(p.label)}"><span class="g">C</span><span class="tb-prog"><i data-ring data-p0="${p.p0}" data-p1="${p.p1}"></i></span>${n ? `<span class="tb-badge">${n}</span>` : ""}</div>
        <div class="tb-tray"><span title="Tray: tooltip shows ${esc(p.label)}">▴ C</span><span class="clock num">${E.fmtTime24(S.now)}<br>${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}</span></div>`;
    } else if (ui().shell === "zebar") {
      tb.hidden = true; sb.hidden = false; sb.className = "shellbar";
      sb.innerHTML = `<div class="ws"><span class="on">1</span><span>2</span><span>3</span></div><span style="opacity:.55">ZEBAR WIDGET · reads localhost:4747/presence</span><div class="wid" data-act="island">◉ ${esc(p.short)} ${cd}<span class="sep">│</span>${n} DUE TODAY<span class="sep">│</span>${esc((topItem() || { title: "—" }).title)}</div><span class="num">${E.fmtTime24(S.now)}</span>`;
    } else {
      tb.hidden = true; sb.hidden = false; sb.className = "shellbar mac";
      sb.innerHTML = `<div class="menus"><b>Collegiapp</b><span>File</span><span>Edit</span><span>View</span><span>Window</span></div><div class="stat"><span class="mi" data-act="island" title="Menu bar extra (tray title)">◉ ${esc(p.short)} ${cd}</span><span>${E.DN[d.getDay()].slice(0, 1) + E.DN[d.getDay()].slice(1).toLowerCase()} ${E.MN[d.getMonth()].slice(0, 1) + E.MN[d.getMonth()].slice(1).toLowerCase()} ${d.getDate()} ${E.fmtTime(S.now)}M</span></div>`;
    }
    updateRings();
  }
  function updateRings() {
    $$("[data-ring]").forEach((el) => {
      const p0 = +el.dataset.p0, p1 = +el.dataset.p1, p = Math.max(0, Math.min(1, (S.now - p0) / Math.max(1, p1 - p0)));
      if (el.tagName === "circle") el.setAttribute("stroke-dashoffset", (75.4 * (1 - p)).toFixed(1)); else el.style.width = (p * 100).toFixed(1) + "%";
    });
  }

  /* ─────────── render all ─────────── */
  function renderAll() {
    S.now = Date.now();
    const content = $("#content"); content.dataset.wide = S.lens === "list" ? "0" : "1";
    renderTop(); renderNav(); renderNow(); renderSched(); renderList(); renderInsp(); renderTicker(); renderBottom(); renderIsland(); renderShell();
    applyWinPos(); updateCountdowns();
    S.animRows = false; S.flashId = null;
    if (S.refocus) { const f = document.getElementById(S.refocus); if (f) f.focus(); S.refocus = null; }
    const bz = $("#bzModel"); if (bz) bz.textContent = CA.lab ? CA.lab.modelLabel() : "";
  }
  function updateCountdowns() {
    $$("[data-cd]").forEach((el) => {
      if (el.dataset.f === "due") { const it = find(el.dataset.id); if (it) el.textContent = dueLine(it); }
      else setDisp(el, el.dataset.f === "since" ? sinceText(S.now - +el.dataset.t) : cdText(+el.dataset.t - S.now));
    });
    $$("[data-clock]").forEach((el) => setDisp(el, clockStr()));
    $$("[data-clock-tt]").forEach((el) => { const d = new Date(S.now); el.textContent = `${E.DN[d.getDay()]} ${d.getDate()} ${E.MN[d.getMonth()]} ${clockStr()}`; });
    const fk = $("#fkNext"); if (fk) { const p = presence(); fk.textContent = `${p.short} ${cdText(p.t - S.now)}`; }
    updateRings();
  }

  /* ─────────── mainframe windows: drag, raise, cycle ─────────── */
  const WINS = ["now", "sched", "list", "insp"];
  function applyWinPos() {
    WINS.forEach((id) => { const r = document.getElementById(id); if (!r) return; const p = R() === "mainframe" && S.winPos[id]; r.style.translate = p ? `${p.x}px ${p.y}px` : ""; });
    $$(".region > .panel").forEach((p) => p.classList.toggle("active", R() === "mainframe" && p.parentElement.id === (S.activeWin || "list")));
  }
  function raise(id) { S.activeWin = id; $$(".region").forEach((r) => r.classList.toggle("raised", r.id === id)); applyWinPos(); }
  function startDrag(e, region) {
    const base = S.winPos[region.id] || { x: 0, y: 0 }, sx = e.clientX, sy = e.clientY;
    region.classList.add("dragging"); raise(region.id);
    const mv = (ev) => { S.winPos[region.id] = { x: base.x + ev.clientX - sx, y: base.y + ev.clientY - sy }; region.style.translate = `${S.winPos[region.id].x}px ${S.winPos[region.id].y}px`; };
    const up = () => { region.classList.remove("dragging"); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  }

  /* ─────────── mainframe menus ─────────── */
  function menus() {
    return {
      sys: [["About Collegiapp", "", () => toast("Collegiapp v0.1 · prototype UI · Rust core + Tauri 2")], ["Design Lab…", "F9", openLab], ["Replay boot", "", () => boot(true)]],
      file: [["Quick add…", "F2", () => openQuick()], ["Sync now", "", syncNow], ["Import calendar feed…", "", () => toast("Paste a Canvas or Shoreline .ics URL under Classes › Sources")], "-", ["Power off", "", power]],
      view: [...VIEWS.map((v) => [v.label, v.k, () => go(v.id)]), "-", ["Desk preview", "", () => CA.lab.set({ desk: ui().desk === "desk" ? "full" : "desk" })], ["Island", "", () => CA.lab.set({ island: !ui().island })]],
      item: [["Done", "X", () => target() && toggleDone(target().id)], ["Focus 25", "F", focusTop], ["Snooze…", "S", () => target() && openSnooze(target().id)], ["Inspect", "Enter", () => target() && select(target().id, true)], ["Priority +", "+", () => target() && bumpPri(target().id)], ["Delete", "Del", () => S.sel && del(S.sel)]],
      class: [...S.courses.filter((c) => c.included).map((c) => [c.code, "", () => setQ("is:open course:" + c.tag.toLowerCase())]), "-", ["Manage classes…", "7", () => go("classes")]],
      focus: [["Focus 25 on Do First", "F", focusTop], ["Focus 50", "", () => topItem() && startFocus(topItem().id, 50)], ["Lockdown 90", "", () => topItem() && startFocus(topItem().id, 90, "lockdown")], ["Setup…", "F8", openFocusSetup]],
      help: [["Keyboard shortcuts", "?", openHelp], ["Command palette", "Ctrl+K", () => openPalette()]],
    };
  }
  function openMenu(id) {
    const layer = $("#menuHost"); S.menu = id; renderTop();
    const btn = $(`.mbar [data-menu="${id}"]`), cr = $("#content").getBoundingClientRect();
    if (!btn) return;
    const br = btn.getBoundingClientRect();
    layer.innerHTML = `<div class="menu" style="left:${br.left - cr.left}px;top:${br.bottom - cr.top}px">${menus()[id].map((m, i) => (m === "-" ? "<hr>" : `<button data-act="menuItem" data-m="${id}" data-i="${i}">${esc(m[0])}<span class="k">${esc(m[1])}</span></button>`)).join("")}</div>`;
    layer.hidden = false; CA.sound.click();
  }
  function closeMenu() { if (!S.menu) return; S.menu = null; $("#menuHost").hidden = true; $("#menuHost").innerHTML = ""; renderTop(); }

  /* ─────────── overlays ─────────── */
  function openOv(name, html, cls) { const ov = $("#ov"); ov.className = "ov " + (cls || ""); ov.innerHTML = html; ov.hidden = false; S.overlay = name; }
  function closeOv() { const ov = $("#ov"); ov.hidden = true; ov.innerHTML = ""; S.overlay = null; }
  function dialog(title, hint, body, cls) { return `<div class="dialog panel ${cls || ""}"><div class="ph"><span class="wbtn" data-act="closeOv">[■]</span><span class="pt">${title}</span><span class="sp"></span><span class="cnt">${hint}</span></div><div class="pb">${body}</div></div>`; }

  // quick add
  const TPL = [["Homework", "hw  fri ~2h"], ["Lab", "lab  tmr ~3h"], ["Reading", "read ch  tmr ~45m"], ["Exam prep", "study for midterm ~2h #exam"], ["Email TA", "email TA about  !!"], ["Errand", "buy  "], ["Apply", "apply  #career"], ["Office hours", "oh  "]];
  function openQuick(prefill) {
    closeMenu();
    openOv("quick", dialog("Quick add", "Enter add · Shift+Enter add + open · Ctrl+Enter add + focus", `<div class="qa-wrap"><span class="qa-prompt">+</span><input id="qaIn" autocomplete="off" spellcheck="false" aria-label="Quick add" placeholder="pa3 130a fri 11:59p ~4h !!"></div>
      <div class="qa-parse" id="qaParse"></div><div class="qa-hl" id="qaHl"></div>
      <div class="tpl"><span class="dim">Templates</span>${TPL.map(([l, t], i) => `<button class="btn" data-act="tpl" data-i="${i}">${l}</button>`).join("")}</div>
      <div class="qa-hl">Grammar: course <span class="tk-course">130a</span> · date <span class="tk-date">fri / tmr / 11/12 / in 3d</span> · time <span class="tk-time">5pm</span> · estimate <span class="tk-estimate">~2h</span> · priority <span class="tk-priority">!!</span> · <span class="tk-tag">#tag</span> · <span class="tk-location">@place</span> · words like <span class="tk-kindhint">hw lab quiz midterm read</span> set the kind. Title only is fine; it lands in the Inbox.</div>`));
    const inp = $("#qaIn"); inp.value = prefill || ""; inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); updateQuick(); CA.sound.whoosh();
  }
  function draftFrom(text) {
    const d = E.parseQuick(text, Date.now(), S.courses), auto = !d.course ? ctxCourse() : null;
    return { d, auto };
  }
  function updateQuick() {
    const inp = $("#qaIn"); if (!inp) return;
    const { d, auto } = draftFrom(inp.value), c = cById(d.course || (auto && auto.id));
    const chips = [`<span class="pc">Title <b>${esc(d.title || "…")}</b></span>`, `<span class="pc">Kind <b>${kLabel(d.kind)}</b></span>`];
    if (c) chips.push(`<span class="pc course" style="${kc(c)}">Course <b>${esc(c.code)}</b>${!d.course && auto ? ` <i>auto · ${auto.why}</i>` : ""}</span>`);
    chips.push(`<span class="pc">Due <b>${d.due ? mDue(d.due) + " · " + E.fmtRel(d.due, Date.now()) : "none"}</b>${!d.due && !c ? " <i>→ Inbox</i>" : ""}</span>`);
    if (d.est) chips.push(`<span class="pc">Estimate <b>${E.fmtDur(d.est * MIN)}</b></span>`);
    if (d.pri) chips.push(`<span class="pc">Priority <b>${"!".repeat(d.pri)}</b></span>`);
    d.tags.forEach((t) => chips.push(`<span class="pc">Tag <b>#${esc(t)}</b></span>`));
    if (d.location) chips.push(`<span class="pc">Where <b>${esc(d.location)}</b></span>`);
    $("#qaParse").innerHTML = chips.join("");
    $("#qaHl").innerHTML = d.tokens.length ? d.tokens.map((t) => `<span class="tk tk-${t.type}">${esc(t.t)}</span>`).join(" ") : "";
  }
  function addFromText(text, mode) {
    if (!text.trim()) return null;
    const { d, auto } = draftFrom(text), now = Date.now(), course = d.course || (auto && auto.id) || null;
    const it = { id: "n" + now, title: d.title || "(untitled)", kind: d.kind, status: d.due || course ? "todo" : "inbox", course, due: d.due, end: null, est: d.est, pri: d.pri, weight: null,
      tags: d.tags, links: d.links.map((u) => [hostOf(u).split("/")[0], u]), location: d.location, notes: "", interrupt: "none", src: "manual", snoozed: null, created: now, updated: now };
    S.items.push(it); S.flashId = it.id; S.sel = it.id; S.stats.xp += 2;
    S.undo = { label: "ADD", fn: () => { S.items = S.items.filter((x) => x !== it); } };
    toast(`Added · ${esc(it.title)}${course ? " · " + cById(course).tag : ""}${it.due ? " · " + mDue(it.due) : " · Inbox"}`, { undo: true });
    CA.sound.ok();
    if (mode === "open") S.insp = true;
    if (mode === "focus") startFocus(it.id, 25);
    return it;
  }

  // command palette
  function palEntries() {
    const out = [], cmd = (label, hint, run, sub) => out.push({ sec: "Commands", label, hint, run, sub });
    cmd("Quick add…", "Q", () => openQuick());
    cmd("Focus 25 min on Do First", "F", focusTop);
    cmd("Focus 50 min on Do First", "", () => topItem() && startFocus(topItem().id, 50));
    cmd("Lockdown 90 min (kill games, block sites)", "", () => topItem() && startFocus(topItem().id, 90, "lockdown"));
    cmd("Focus setup…", "Shift+F", openFocusSetup);
    cmd("Clear filters", "Esc", clearQ);
    cmd("Sync now", "", syncNow);
    cmd("Open Design Lab", "Ctrl+.", openLab);
    cmd("Next rendition", "]", () => CA.lab.cycle(1));
    (CA.lab ? CA.lab.renditions() : []).forEach((r) => cmd("Rendition: " + r.name, r.id, () => CA.lab.setRendition(r.key)));
    cmd("Toggle desk preview", "", () => CA.lab.set({ desk: ui().desk === "desk" ? "full" : "desk" }));
    cmd("Toggle island", "", () => CA.lab.set({ island: !ui().island }));
    cmd("Simulate: class in 10 min (nudge)", "", () => simulate("nudge"));
    cmd("Simulate: class in 10 min (alert)", "", () => simulate("alert"));
    cmd("Simulate: class in 5 min (takeover)", "", () => simulate("takeover"));
    cmd("Replay boot sequence", "", () => boot(true));
    cmd("Keyboard shortcuts", "?", openHelp);
    VIEWS.forEach((v) => out.push({ sec: "Views", label: "Go to " + v.label, hint: v.k, sub: v.q, run: () => go(v.id) }));
    S.courses.filter((c) => c.included).forEach((c) => out.push({ sec: "Classes", label: c.code + " " + c.title, hint: "", sub: c.tag, run: () => setQ("is:open course:" + c.tag.toLowerCase()) }));
    S.items.filter((it) => E.matchItem(it, [], ctx()) && E.isOpen(it, S.now)).forEach((it) => { const c = courseOf(it); out.push({ sec: "Items", label: it.title, sub: (c ? c.tag + " · " : "") + (it.due ? fDue(it.due) : kLabel(it.kind)), hint: "", run: () => select(it.id, true) }); });
    S.courses.filter((c) => c.included).forEach((c) => c.links.forEach((l) => out.push({ sec: "Links", label: c.tag + " " + l[0], sub: hostOf(l[1]), hint: "↗", run: () => openLink(l[1]) })));
    GLOBAL_LINKS.forEach((l) => out.push({ sec: "Links", label: l[0], sub: hostOf(l[1]), hint: "↗", run: () => openLink(l[1]) }));
    return out;
  }
  function openPalette(initial) {
    closeMenu();
    openOv("palette", dialog("Search · commands", "↑↓ Enter · Esc", `<div class="qa-wrap"><span class="qa-prompt">&gt;</span><input id="palIn" autocomplete="off" spellcheck="false" aria-label="Search commands" placeholder="commands, items, classes, links…"></div><div class="pal-res" id="palRes"></div>`));
    const inp = $("#palIn"); inp.value = initial || ""; inp.focus(); S.palI = 0; updatePalette(); CA.sound.whoosh();
  }
  function updatePalette() {
    const q = ($("#palIn") || {}).value || "";
    let list = palEntries();
    if (q) list = list.map((e) => ({ e, s: E.fuzzy(q, e.label + " " + (e.sub || "")) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 30).map((x) => x.e);
    else list = list.filter((e) => e.sec === "Commands" || e.sec === "Views").slice(0, 26);
    S.palList = list; S.palI = Math.min(S.palI, Math.max(0, list.length - 1));
    let h = "", sec = null;
    const order = q ? list : list;
    order.forEach((e, i) => { if (!q && e.sec !== sec) { h += `<div class="pal-sec">${e.sec}</div>`; sec = e.sec; } h += `<div class="pal-it ${i === S.palI ? "on" : ""}" data-act="palRun" data-i="${i}"><span>${esc(e.label)}</span><span class="dim">${[q ? e.sec.toLowerCase() : "", esc(e.sub || "")].filter(Boolean).join(" · ")}</span><span class="sp"></span>${e.hint ? `<kbd>${esc(e.hint)}</kbd>` : ""}</div>`; });
    $("#palRes").innerHTML = h || `<div class="empty">No match. Enter adds “${esc(q)}” as a new item.</div>`;
    const on = $(".pal-it.on"); if (on) on.scrollIntoView({ block: "nearest" });
  }
  function runPalette(i) {
    const e = S.palList[i]; const q = ($("#palIn") || {}).value || "";
    closeOv();
    if (e) e.run(); else if (q.trim()) addFromText(q), renderAll();
  }

  function openHelp() {
    const keys = [["Q", "quick add (Ctrl+Shift+Space system-wide in the app)"], ["Ctrl+K  /", "command palette"], ["1 – 9, 0", "views: saved filters"], ["Esc", "close · clear filters"], ["J K ↑ ↓", "move selection"], ["Enter", "inspect selection"],
      ["X  Space", "toggle done"], ["F", "focus 25 on selection / Do First"], ["Shift+F", "focus setup"], ["S", "snooze"], ["N", "next Do First"], ["+", "priority up"], ["Del", "delete (undo)"], ["Ctrl+Z", "undo"],
      ["[  ]", "previous / next rendition"], ["Ctrl+.", "Design Lab"], ["Hold Alt", "show every shortcut"], ["Right-click", "radial menu (row = item actions)"], ["Teletext", "type 3-digit pages, R G Y B fastext"], ["Mainframe", "Alt+letter menus, F-keys, drag windows, F6 cycles"]];
    openOv("help", dialog("Keys & help", "Esc", `<div class="helpgrid">${keys.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join("")}</div>`));
  }

  // snooze
  function openSnooze(id) {
    const it = find(id); if (!it) return;
    const now = Date.now(), t = (dOff, h, m) => { const d = new Date(E.addDays(E.startOfDay(now), dOff)); d.setHours(h, m || 0, 0, 0); return d.getTime(); };
    const nc = S.items.filter((x) => x.kind === "class" && x.due > now).sort(cmpDue)[0];
    const sat = (6 - new Date(now).getDay() + 7) % 7 || 7, mon = (8 - new Date(now).getDay()) % 7 || 7;
    const opts = [["In 1 hour", now + HR], ...(new Date(now).getHours() < 20 ? [["Tonight 9 PM", t(0, 21)]] : []), ...(nc ? [["After next class (" + (courseOf(nc) ? courseOf(nc).tag : "") + ")", nc.end + 10 * MIN]] : []),
      ["Tomorrow 9 AM", t(1, 9)], ["This weekend (Sat 10 AM)", t(sat, 10)], ["Next week (Mon 9 AM)", t(mon, 9)]];
    S.snoozeOpts = opts; S.snoozeId = id;
    openOv("snooze", dialog("Snooze · " + esc(it.title), "1–" + opts.length + " · Esc", `<div class="pal-res">${opts.map(([l, ts], i) => `<div class="pal-it" data-act="snoozePick" data-i="${i}"><kbd>${i + 1}</kbd><span>${esc(l)}</span><span class="sp"></span><span class="dim">${fDue(ts, now)}</span></div>`).join("")}</div>`, "sm"));
  }
  function snoozePick(i) {
    const it = find(S.snoozeId), o = S.snoozeOpts[i]; closeOv(); if (!it || !o) return;
    const prev = it.snoozed; it.snoozed = o[1]; it.updated = Date.now();
    S.undo = { label: "SNOOZE", fn: () => { it.snoozed = prev; } };
    toast(`Snoozed · ${esc(it.title)} → ${mDue(o[1])}`, { undo: true }); CA.sound.click(); renderAll();
  }

  /* ─────────── focus sessions ─────────── */
  const BLOCK_APPS = ["steam.exe", "discord.exe", "riotclientservices.exe", "epicgameslauncher.exe", "battle.net.exe", "robloxplayerbeta.exe"];
  const BLOCK_SITES = ["youtube.com", "reddit.com", "twitch.tv", "x.com", "instagram.com", "tiktok.com", "netflix.com"];
  function openFocusSetup(id) {
    const it = (id && find(id)) || target();
    S.fsetup = { id: it && it.id, min: 25, level: ui().focusLevel || "hard" };
    const body = () => `<div class="fo-setup"><span class="dim">Task</span><span>${it ? esc(it.title) : "—"}</span>
      <span class="dim">Length</span><div class="seg">${[15, 25, 50, 90].map((m) => `<button class="chip ${S.fsetup.min === m ? "on" : ""}" data-act="fsMin" data-v="${m}">${m} min</button>`).join("")}</div>
      <span class="dim">Level</span><div class="seg">${[["soft", "Soft · reminders"], ["hard", "Hard · kill + block"], ["lockdown", "Lockdown · kiosk"]].map(([v, l]) => `<button class="chip ${S.fsetup.level === v ? "on" : ""}" data-act="fsLvl" data-v="${v}">${l}</button>`).join("")}</div>
      <span class="dim">Blocks</span><span class="dim">${S.fsetup.level === "soft" ? "nothing — nudges only" : BLOCK_APPS.join(" · ") + " · " + BLOCK_SITES.length + " sites"}</span></div>
      <div class="nb" style="justify-content:center;margin-top:.8em"><button class="btn primary" data-act="fsGo">▶ Start<kbd>Enter</kbd></button><button class="btn" data-act="closeOv">Cancel<kbd>Esc</kbd></button></div>`;
    S.fsetupBody = body;
    openOv("fsetup", dialog("Focus setup", "Enter start · Esc", `<div id="fsBody">${body()}</div>`, "sm"));
  }
  function startFocus(id, min, level) {
    closeMenu(); closeOv();
    level = level || ui().focusLevel || "hard";
    const now = Date.now(); S.focus = { id, start: now, end: now + min * MIN, min, level };
    const it = find(id); if (it && it.status !== "done") it.status = "doing";
    CA.sound.ok(); showFocus(true); renderAll();
  }
  function showFocus(fresh) {
    const f = S.focus; if (!f) return;
    const it = find(f.id), c = courseOf(it);
    openOv("focus", `<div class="focus"><div class="fo-top">Focus · ${cap(f.level)} level · ends ${mTime(f.end)} · simulated in the prototype</div>
      <div class="fo-task">${c ? `<span style="${kc(c)}color:var(--kc)">${c.tag}</span> ` : ""}${esc(it ? it.title : "Focus")}</div>
      ${isM() ? `<div class="display big"><span class="d-lbl">Time left</span><span class="d-num fo-time num" data-cd data-f="clock" data-t="${f.end}"${flap()}></span></div>` : `<div class="fo-time num" data-cd data-f="clock" data-t="${f.end}">${cdText(f.end - Date.now())}</div>`}
      <div class="fo-bar meter" id="foBar">${Array.from({ length: 24 }, () => "<i></i>").join("")}</div>
      <div class="fo-log" id="foLog"></div>
      <div class="nb" style="justify-content:center"><button class="btn" data-act="foAdd">+5 min</button>${f.level !== "lockdown" ? `<button class="btn" data-act="foMin">Minimize to island<kbd>Esc</kbd></button>` : ""}<button class="btn primary" data-act="foDone">✓ Task done</button><button class="btn" data-act="foEnd">End early…</button><button class="btn ghost" data-act="foSkip">Demo: finish now</button></div>
      <div class="fo-exit" id="foExit" hidden><span class="dim">Type “${PHRASE}” to quit early:</span><input id="foPhrase" autocomplete="off" spellcheck="false" aria-label="Exit phrase"></div></div>`, "full");
    focusBar();
    if (fresh) {
      const lines = f.level === "soft" ? ["> FOCUS ARMED · SOFT · " + f.min + ":00", "> NOTHING BLOCKED · YOU'LL GET NUDGES IF YOU WANDER", "> NOTIFICATIONS: DO NOT DISTURB ON"]
        : ["> FOCUS ARMED · " + f.level.toUpperCase() + " · " + f.min + ":00", "> SCANNING PROCESSES …", ...BLOCK_APPS.slice(0, 4).map((a, i) => `> ${a.padEnd(24, ".")} ${i < 2 ? "TERMINATED" : "NOT RUNNING"}`),
          "> FIREFOX POLICY · " + BLOCK_SITES.slice(0, 4).join(" ") + " … BLOCKED", "> ALLOWED: code.exe · firefox (canvas, gradescope, docs) · terminal",
          ...(f.level === "lockdown" ? ["> LOCKDOWN · FULLSCREEN KIOSK · OTHER WINDOWS MINIMIZED", "> EXIT ONLY WHEN THE TIMER ENDS OR WITH THE PHRASE"] : ["> ESC MINIMIZES · IT DOES NOT END THE SESSION"])];
      typeLines($("#foLog"), lines);
    } else $("#foLog").innerHTML = `<span class="ok">> SESSION RUNNING · ${f.level.toUpperCase()}</span>`;
  }
  function typeLines(el, lines) {
    let i = 0; const m = motion();
    const step = () => { if (!el.isConnected || i >= lines.length) return; el.innerHTML += `<span class="${/TERMINATED|BLOCKED|ARMED/.test(lines[i]) ? "ok" : ""}">${esc(lines[i])}</span>\n`; i++; CA.sound.key(); setTimeout(step, m ? 170 * m : 0); };
    step();
  }
  function focusBar() {
    const f = S.focus, bar = $("#foBar"); if (!f || !bar) return;
    const p = Math.max(0, Math.min(1, (Date.now() - f.start) / (f.end - f.start))), n = Math.round(p * 24);
    $$("i", bar).forEach((x, i) => (x.className = i < n ? "on" : ""));
  }
  function finishFocus(completed) {
    const f = S.focus; if (!f) return;
    const mins = Math.max(1, Math.round((Math.min(Date.now(), f.end) - f.start) / MIN)), full = completed ? f.min : mins;
    S.stats.focusMin += full; S.stats.xp += full * 2; S.focus = null;
    const it = find(f.id);
    openOv("focusdone", `<div class="focus"><div class="fo-top">Session ${completed ? "complete" : "ended"}</div><div class="fo-time">+${full} min</div><div class="fo-task">+${full * 2} XP · ${S.stats.focusMin} min focused today · ${S.stats.streak}-day streak</div>
      <div class="nb" style="justify-content:center">${it && it.status !== "done" ? `<button class="btn primary" data-act="done" data-id="${it.id}">✓ Mark “${esc(it.title)}” done</button>` : ""}<button class="btn" data-act="focus" data-id="${f.id}" data-min="25">Keep going +25</button><button class="btn" data-act="closeOv">Close<kbd>Esc</kbd></button></div></div>`, "full");
    CA.sound.done(); renderAll();
  }
  function focusTop() {
    if (S.focus) return showFocus(false);
    const t = target(), pick = t && E.ACTIONABLE(t.kind) ? t : topItem(); // a selected class can't be focused on; fall back to Do First
    if (pick) startFocus(pick.id, 25);
  }

  /* ─────────── interruptions ─────────── */
  function fireAlert(it, level) {
    const c = courseOf(it), lbl = `${c ? c.tag + " " : ""}${it.title}`, leave = it.location ? ` · leave by ${mTime(it.due - 10 * MIN)}` : "";
    const zoom = (it.links || []).find((l) => /zoom/i.test(l[0]));
    if (level === "nudge") {
      toast(`◷ ${esc(lbl)} in ${cdText(it.due - Date.now())}${it.location ? " · " + esc(it.location) : ""}`, { ms: 9000, actions: [...(zoom ? [["Zoom", () => openLink(zoom[1])]] : []), ["Snooze 5m", () => { S.alerted[it.id] = false; toast("I'll remind you again in 5 min"); }]] });
      CA.sound.beep(); return;
    }
    CA.sound.alarm();
    const acts = `<button class="btn primary" data-act="alertGo">On my way</button>${zoom ? `<button class="btn" data-act="open" data-url="${esc(zoom[1])}">Join Zoom</button>` : ""}<button class="btn" data-act="alertSkip" data-id="${it.id}">Skipping…</button>`;
    if (level === "takeover") {
      openOv("takeover", `<div class="takeover"><div class="fo-top">Interrupt · takeover</div><div class="big">GET UP.</div><div class="fo-task">${esc(lbl)}${it.location ? " · " + esc(it.location) : ""}</div>${isM() ? `<div class="display big bad"><span class="d-lbl">Starts in</span><span class="d-num num" data-cd data-f="clock" data-t="${it.due}"${flap()}></span></div>` : `<div class="cd num" data-cd data-f="clock" data-t="${it.due}">${cdText(it.due - Date.now())}</div>`}<div class="dim">${cap([leave.slice(3), "this screen stays until you answer"].filter(Boolean).join(" · "))}</div><div class="nb" style="justify-content:center">${acts}</div><div id="skipWhy"></div></div>`, "full");
    } else {
      openOv("alert", `<div class="dialog panel alertbox sm"><div class="ph"><span class="pt">◷ Class soon</span><span class="sp"></span><span class="cnt">Alert</span></div><div class="pb"><div class="un-big"><span>${esc(lbl)}</span><span class="cd" data-cd data-f="clock" data-t="${it.due}">${cdText(it.due - Date.now())}</span></div><div class="un-sub">${esc(it.location || "")}${leave}</div><div class="nb" style="margin-top:.6em">${acts}</div><div id="skipWhy"></div></div></div>`);
    }
  }
  function simulate(level) {
    const it = nextAlertable(); if (!it) return toast("No upcoming class to simulate");
    const fake = Object.assign({}, it, { due: Date.now() + (level === "takeover" ? 5 : 10) * MIN });
    fireAlert(fake, level);
  }
  function checkAlerts() {
    for (const it of S.items) {
      if (!E.SCHEDULED(it.kind) || it.interrupt === "none" || S.alerted[it.id] || !E.matchItem(it, [], ctx())) continue;
      const d = it.due - S.now;
      if (d > 0 && d <= 10 * MIN) { S.alerted[it.id] = true; if (!S.overlay) fireAlert(it, it.interrupt); else toast(`◷ ${esc(it.title)} in ${cdText(d)}`); }
    }
  }

  /* ─────────── boot / power ─────────── */
  function boot(force) {
    let seen = false; try { seen = sessionStorage.getItem("capp.booted") === "1"; } catch (e) {}
    if ((seen || isM()) && !force) { CA.fx.powerOn(); return; }
    try { sessionStorage.setItem("capp.booted", "1"); } catch (e) {}
    const canvas = S.items.filter((it) => it.src === "canvas").length, cls = S.items.filter((it) => it.kind === "class").length, shore = S.items.filter((it) => it.src === "shoreline").length;
    const { wk, toFinals } = weekInfo(), top = topItem();
    const lines = ["COLLEGIAPP BIOS v0.1.0 · UCSB EDITION", "(C) 2026 · RUST CORE / TAURI 2 SHELL", "", "MEMORY CHECK ......... 3 CUPS OF COFFEE OK", "DETECTING SOURCES",
      `  CANVAS .............. ${canvas} ITEMS · ${S.courses.filter((c) => c.included).length} COURSES · ${S.courses.filter((c) => !c.included).length} EXCLUDED`, `  GOOGLE CALENDAR ..... ${cls} CLASS SESSIONS`, `  SHORELINE ........... ${shore} EVENTS · 1 TICKET`,
      "  FIREFOX EXTENSION ... CONNECTED · GRADESCOPE +2", "SYNC · WINDOWS ⇄ MACBOOK ⇄ IPHONE (LATER) ... OK", `${CA.quarter.name.toUpperCase()} · WEEK ${wk} OF 10 · FINALS IN ${toFinals} DAYS`,
      top ? `DO FIRST: ${top.title.toUpperCase()} · ${dueLine(top)}` : "DO FIRST: NOTHING. ENJOY IT.", "", "PRESS ANY KEY"];
    openOv("boot", `<div class="boot" id="bootTxt"></div>`, "full");
    CA.fx.powerOn();
    const el = $("#bootTxt"), m = motion(); let i = 0;
    const step = () => { if (S.overlay !== "boot") return; if (i < lines.length) { el.innerHTML += esc(lines[i++]) + "\n"; CA.sound.key(); S.bootT = setTimeout(step, m ? 95 * m : 0); } else { el.innerHTML += '<span class="cur">█</span>'; S.bootT = setTimeout(endBoot, 1600 * Math.max(m, .3)); } };
    step();
  }
  function endBoot() { if (S.overlay !== "boot") return; clearTimeout(S.bootT); closeOv(); renderAll(); CA.fx.degauss(); }
  function power() {
    const led = $("#led");
    if (S.power) { S.power = false; closeOv(); CA.fx.powerOff(); led && led.classList.add("off"); }
    else { S.power = true; led && led.classList.remove("off"); CA.fx.powerOn(); }
  }
  function syncNow() {
    const led = $("#led"); led && led.classList.add("busy");
    setTimeout(() => { led && led.classList.remove("busy"); toast("Synced · Windows ⇄ Mac · 0 conflicts · 6 Firestore writes"); CA.sound.ok(); }, 900);
  }

  /* ─────────── item actions ─────────── */
  function select(id, open) {
    if (S.sel === id && S.insp && open !== true && R() !== "phosphor") { S.insp = false; } else { S.sel = id; S.insp = true; }
    CA.sound.click(); renderAll();
  }
  function toggleDone(id) {
    const it = find(id); if (!it || E.SCHEDULED(it.kind)) return;
    const prev = it.status, row = $(`.row[data-id="${id}"]`), m = motion();
    const finish = () => {
      it.status = prev === "done" ? "todo" : "done"; it.updated = Date.now();
      if (it.status === "done") { const xp = 10 + it.pri * 10 + (it.weight || 0) * 5; S.stats.xp += xp; xpFloat(row || $("#now"), "+" + xp + " XP"); CA.sound.done(); if (S.focus && S.focus.id === id) finishFocus(true); }
      S.undo = { label: "DONE", fn: () => { it.status = prev; } };
      toast(it.status === "done" ? `Done · ${esc(it.title)}` : `Reopened · ${esc(it.title)}`, { undo: true });
      if (S.sel === id && it.status === "done" && S.view === "now") S.sel = null;
      renderAll();
    };
    if (row && prev !== "done" && m > 0) { row.classList.add("completing"); setTimeout(finish, 420 * m); } else finish();
  }
  function del(id) {
    const it = find(id); if (!it) return;
    it.deleted = true; if (S.sel === id) { S.sel = null; S.insp = false; }
    S.undo = { label: "DELETE", fn: () => { it.deleted = false; } };
    toast(`Deleted · ${esc(it.title)}`, { undo: true }); renderAll();
  }
  function bumpPri(id) { const it = find(id); if (!it) return; it.pri = (it.pri + 1) % 4; it.updated = Date.now(); toast(`Priority ${it.pri ? "!".repeat(it.pri) : "none"} · ${esc(it.title)}`); renderAll(); }
  function doUndo() { if (!S.undo) return; S.undo.fn(); toast("Undid " + S.undo.label.toLowerCase()); S.undo = null; renderAll(); }
  function moveSel(d) {
    if (!S.listIds.length) return;
    let i = S.listIds.indexOf(S.sel); i = i < 0 ? (d > 0 ? 0 : S.listIds.length - 1) : Math.max(0, Math.min(S.listIds.length - 1, i + d));
    S.sel = S.listIds[i]; CA.sound.key(); renderAll();
    const sel = $("#list .row.sel"), pb = sel && sel.closest(".pb");
    if (sel && pb) { const r = sel.getBoundingClientRect(), b = pb.getBoundingClientRect(); if (r.top < b.top) pb.scrollTop -= b.top - r.top; else if (r.bottom > b.bottom) pb.scrollTop += r.bottom - b.bottom; }
  }
  function openLink(url) {
    if (!url) return;
    try { if (window.__TAURI__ && window.__TAURI__.opener) { window.__TAURI__.opener.openUrl(url); return; } } catch (e) {}
    toast(`Opening in Firefox → ${esc(hostOf(url))}`); CA.sound.click();
  }
  function xpFloat(anchor, text) {
    if (!anchor) return;
    const cr = $("#content").getBoundingClientRect(), r = anchor.getBoundingClientRect(), x = document.createElement("div");
    x.className = "xpf"; x.textContent = text; x.style.left = (r.left - cr.left + r.width * 0.6) + "px"; x.style.top = (r.top - cr.top) + "px";
    $("#layer").appendChild(x); setTimeout(() => x.remove(), 1300);
  }
  function toast(msg, opts) {
    opts = opts || {};
    const host = $("#toasts"), t = document.createElement("div");
    t.className = "toast"; t._actions = opts.actions || [];
    t.innerHTML = `<span class="msg">${msg}</span>${opts.undo ? `<button class="btn" data-act="undo">Undo<kbd>Ctrl+Z</kbd></button>` : ""}${t._actions.map((a, i) => `<button class="btn" data-act="toastAct" data-i="${i}">${esc(a[0])}</button>`).join("")}`;
    host.appendChild(t); while (host.children.length > 4) host.firstChild.remove();
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, opts.ms || 4200);
  }

  /* ─────────── teletext page entry ─────────── */
  function ttDigit(d) {
    S.ttEntry += d; renderTop(); CA.sound.key();
    if (S.ttEntry.length === 3) { const p = +S.ttEntry; S.ttEntry = ""; ttSeek(p); }
  }
  function ttSeek(p) {
    const dest = PAGES[p], ctr = $("#ttCounter"), m = motion(); let n = 0;
    if (ctr) ctr.classList.add("seek");
    const spin = () => {
      const c = $("#ttCounter");
      if (n++ < (m ? 14 : 0)) { if (c) c.textContent = 100 + Math.floor(Math.random() * 800); setTimeout(spin, 32 * m); return; }
      if (!dest) { renderTop(); toast(`PAGE ${p} NOT IN SERVICE · TRY 100`); return; }
      if (dest === "focus") { renderTop(); return openFocusSetup(); }
      if (dest === "help") { renderTop(); return openHelp(); }
      go(dest); S.page = p; renderTop();
    };
    spin();
  }
  function fastext(a) {
    if (a.startsWith("go:")) return go(a.slice(3));
    const t = target();
    if (a === "done") return t && toggleDone(t.id);
    if (a === "skip") { S.skip++; renderAll(); return; }
    if (a === "snooze") return t && openSnooze(t.id);
    if (a === "focusTop") return focusTop();
    if (a === "focusSetup") return openFocusSetup();
    if (a === "quick") return openQuick();
  }

  /* ─────────── radial menu + key tips ─────────── */
  function openRadial(x, y, it) {
    const el = $("#radial");
    const opts = !it ? [["+", "Quick add", () => openQuick()], ["▶", "Focus", focusTop], ["*", "Today", () => go("today")], ["#", "Work", () => go("work")], [">", "Command", () => openPalette()], ["o", "Classes", () => go("classes")]]
      : E.SCHEDULED(it.kind) ? [["i", "Inspect", () => select(it.id, true)], ["◷", "Takeover alert", () => { it.interrupt = "takeover"; toast("Takeover alert set · " + esc(it.title)); }], ["↗", "Links", () => it.links[0] && openLink(it.links[0][1])], ["×", "Delete", () => del(it.id)]]
      : [["✓", "Done", () => toggleDone(it.id)], ["▶", "Focus", () => startFocus(it.id, 25)], ["◷", "Snooze", () => openSnooze(it.id)], ["i", "Inspect", () => select(it.id, true)], ["!", "Priority +", () => bumpPri(it.id)], ["×", "Delete", () => del(it.id)]];
    S.radialOpts = opts;
    const cr = $("#content").getBoundingClientRect(), fs = parseFloat(getComputedStyle($("#content")).fontSize), pad = 8 * fs;
    x = Math.max(pad, Math.min(cr.width - pad, x)); y = Math.max(pad, Math.min(cr.height - pad, y));
    el.style.left = x + "px"; el.style.top = y + "px";
    el.innerHTML = `<div class="ring"></div><div class="hub">${it ? "ITEM" : "MENU"}</div>${opts.map((o, i) => { const a = (i / opts.length) * Math.PI * 2 - Math.PI / 2; return `<button class="btn rb" data-act="radial" data-i="${i}" style="left:${(Math.cos(a) * 5.4).toFixed(2)}em;top:${(Math.sin(a) * 5.4).toFixed(2)}em;animation-delay:${i * 25}ms">${o[0]} ${o[1]}</button>`; }).join("")}`;
    el.hidden = false; CA.sound.whoosh();
  }
  function closeRadial() { const el = $("#radial"); if (!el.hidden) { el.hidden = true; el.innerHTML = ""; return true; } return false; }
  function showTips() {
    if (ui().guide === "g3") return;
    const tips = $("#tips"), cr = $("#content").getBoundingClientRect();
    tips.innerHTML = $$("[data-hint]", $("#screen")).filter((el) => el.offsetParent && el.getBoundingClientRect().width).map((el) => { const r = el.getBoundingClientRect(); return `<span class="tip" style="left:${r.left - cr.left}px;top:${r.top - cr.top}px">${esc(el.dataset.hint)}</span>`; }).join("");
    tips.hidden = false;
  }
  function hideTips() { const t = $("#tips"); if (t && !t.hidden) { t.hidden = true; t.innerHTML = ""; return true; } return false; }

  /* ─────────── phosphor command line ─────────── */
  function cmdLine(v) {
    const s = v.trim(); if (!s) return;
    if (s === "?" || s === "help") return openHelp();
    if (s === "clear" || s === "cls") return clearQ();
    if (s === "ls") return toast(VIEWS.map((x) => x.id).join("  "));
    const cd = s.match(/^cd\s+(.+)$/i);
    if (cd) { const w = cd[1].replace(/^~?\/?(views\/)?/, "").toLowerCase(); const v2 = VIEWS.find((x) => x.id === w || x.label.toLowerCase().startsWith(w)); return v2 ? go(v2.id) : toast("cd: no such view: " + esc(w)); }
    if (s[0] === "/" || s[0] === ":") { const q = s.slice(1); const best = palEntries().map((e) => ({ e, s: E.fuzzy(q, e.label) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0]; return best ? best.e.run() : toast("NO COMMAND MATCHES “" + esc(q) + "”"); }
    addFromText(s); renderAll();
  }

  /* ─────────── lab bridge ─────────── */
  function openLab() { CA.lab && CA.lab.open(); }

  /* ─────────── events ─────────── */
  const ACTIONS = {
    go: (el) => go(el.dataset.v), q: (el) => { S.view = "all"; setQ(el.dataset.q); }, sel: (el) => select(el.dataset.id),
    toggle: (el) => toggleDone(el.dataset.id), done: (el) => { if (S.overlay === "focusdone") closeOv(); toggleDone(el.dataset.id); },
    focus: (el) => startFocus(el.dataset.id, +el.dataset.min || 25), snooze: (el) => openSnooze(el.dataset.id), skip: () => { S.skip++; CA.sound.click(); renderAll(); },
    del: (el) => del(el.dataset.id), quick: () => openQuick(), palette: () => openPalette(), help: () => openHelp(), lab: openLab,
    clearQ, rmTerm: (el) => { const t = E.parseFilter(S.q); t.splice(+el.dataset.i, 1); setQ(t.map((x) => x.raw).join(" ")); },
    toggleTerm: (el) => toggleTerm(el.dataset.t), closeInsp: () => { S.insp = false; if (R() === "phosphor") S.sel = null; renderAll(); }, closeOv,
    open: (el) => openLink(el.dataset.url), undo: doUndo, toastAct: (el) => { const t = el.closest(".toast"); const a = t && t._actions[+el.dataset.i]; if (a) a[1](); if (t) t.remove(); },
    setf: (el) => { const it = find(S.sel); if (!it) return; const f = el.dataset.f, v = el.dataset.v; it[f] = f === "est" || f === "pri" ? +v : v; it.updated = Date.now(); CA.sound.click(); renderAll(); },
    incl: (el) => { const c = cById(el.dataset.c); c.included = !c.included; toast(`${c.code} ${c.included ? "included" : "excluded · its items are hidden everywhere"}`); renderAll(); },
    calmap: (el) => { const s = S.calendarSeries.find((x) => x.id === el.dataset.s); s.isClass = !s.isClass; toast(`${esc(s.name)} → ${s.isClass ? "class (gets alerts + countdown)" : "not a class"}`); renderAll(); },
    source: (el) => toast(`Source setup · ${esc(srcName(el.dataset.s))} · see docs/SPEC.md § Integrations`),
    tpl: (el) => { const inp = $("#qaIn"); inp.value = TPL[+el.dataset.i][1]; inp.focus(); const k = inp.value.indexOf("  "); inp.setSelectionRange(k + 1, k + 1); updateQuick(); },
    palRun: (el) => runPalette(+el.dataset.i), snoozePick: (el) => snoozePick(+el.dataset.i),
    fsMin: (el) => { S.fsetup.min = +el.dataset.v; $("#fsBody").innerHTML = S.fsetupBody(); }, fsLvl: (el) => { S.fsetup.level = el.dataset.v; $("#fsBody").innerHTML = S.fsetupBody(); },
    fsGo: () => S.fsetup.id && startFocus(S.fsetup.id, S.fsetup.min, S.fsetup.level), focusSetup: () => openFocusSetup(), focusTop,
    foAdd: () => { S.focus.end += 5 * MIN; showFocus(false); }, foMin: () => { closeOv(); renderAll(); toast("Focus continues · the timer is in the island and the top bar"); },
    foDone: () => { const it = find(S.focus.id); if (it && it.status !== "done") { it.status = "done"; it.updated = Date.now(); S.stats.xp += 10 + it.pri * 10 + (it.weight || 0) * 5; } finishFocus(true); },
    foEnd: () => { if (S.focus.level === "soft") return finishFocus(false); const x = $("#foExit"); x.hidden = false; $("#foPhrase").focus(); },
    foSkip: () => { S.focus.end = Date.now(); finishFocus(true); },
    alertGo: () => { closeOv(); toast("Go. The island keeps the countdown."); CA.sound.ok(); },
    alertSkip: (el) => { $("#skipWhy").innerHTML = `<div class="nb" style="justify-content:center;margin-top:.5em"><span class="dim">WHY?</span>${["sick", "watching recording", "exam prep", "other"].map((w) => `<button class="chip" data-act="skipWhy" data-w="${w}">${w}</button>`).join("")}</div>`; },
    skipWhy: (el) => { closeOv(); toast(`Skip logged · “${esc(el.dataset.w)}” · shows in your weekly review`); },
    island: () => { S.islandOpen = !S.islandOpen; renderIsland(); CA.sound.click(); },
    fast: (el) => fastext(el.dataset.a), radial: (el) => { const o = S.radialOpts[+el.dataset.i]; closeRadial(); o && o[2](); },
    menuItem: (el) => { const m = menus()[el.dataset.m][+el.dataset.i]; closeMenu(); m && m[2](); }, menuKey: () => openMenu("file"),
    focusQ: () => { const f = $("#fq"); if (f) f.focus(); }, nextWin: () => cycleWin(),
  };
  function cycleWin() { const vis = WINS.filter((id) => { const r = document.getElementById(id); return r && !r.hidden && r.offsetParent; }); const i = vis.indexOf(S.activeWin || "list"); raise(vis[(i + 1) % vis.length]); }

  function bind() {
    document.addEventListener("click", (e) => {
      if (S.overlay === "boot") return endBoot();
      const radial = $("#radial"); if (!radial.hidden && !e.target.closest("#radial")) closeRadial();
      const mb = e.target.closest("[data-menu]"); if (mb) { S.menu === mb.dataset.menu ? closeMenu() : openMenu(mb.dataset.menu); return; }
      if (S.menu && !e.target.closest(".menu")) closeMenu();
      const a = e.target.closest("[data-act]"); if (!a || !ACTIONS[a.dataset.act]) return;
      if (a.closest("#lab")) return;
      if (a.dataset.act === "island" && e.target.closest(".is-more")) return;
      e.preventDefault(); ACTIONS[a.dataset.act](a, e);
    });
    document.addEventListener("dblclick", (e) => { const r = e.target.closest(".row"); if (r && !E.SCHEDULED((find(r.dataset.id) || {}).kind)) startFocus(r.dataset.id, 25); });
    document.addEventListener("contextmenu", (e) => {
      const content = $("#content"); if (!content.contains(e.target) || e.target.closest("input, textarea, select")) return;
      e.preventDefault(); const cr = content.getBoundingClientRect(), row = e.target.closest(".row, .un-row, .wi, .ag");
      openRadial(e.clientX - cr.left, e.clientY - cr.top, row ? find(row.dataset.id) : null);
    });
    document.addEventListener("pointerdown", (e) => {
      if (R() !== "mainframe") return;
      const region = e.target.closest(".region"); if (!region || !WINS.includes(region.id)) return;
      raise(region.id);
      if (e.target.closest(".ph") && !e.target.closest("button, input, select, [data-act]")) { e.preventDefault(); startDrag(e, region); }
    });
    document.addEventListener("input", (e) => {
      const t = e.target;
      if (t.id === "qaIn") updateQuick();
      else if (t.id === "palIn") { S.palI = 0; updatePalette(); }
      else if (t.id === "cmdIn") {
        const v = t.value, prev = $("#cmdPrev"); if (!prev) return;
        if (!v.trim()) { prev.innerHTML = `TYPE TO QUICK-ADD · <span class="hi">/</span> OR <span class="hi">CD</span> FOR COMMANDS · <span class="hi">?</span> HELP`; return; }
        if (/^(\/|:|cd\s|\?|help$|clear$|ls$)/i.test(v)) { prev.innerHTML = `COMMAND → <span class="hi">${esc(v)}</span>`; return; }
        const { d, auto } = draftFrom(v), c = cById(d.course || (auto && auto.id));
        prev.innerHTML = `ADD → <span class="hi">${esc(d.title || "…")}</span> · ${kLabel(d.kind).toUpperCase()}${c ? " · " + c.tag + (!d.course ? " (auto)" : "") : ""}${d.due ? " · " + E.fmtDue(d.due, Date.now()) : " · INBOX"}${d.est ? " · ~" + E.fmtDur(d.est * MIN) : ""}${d.pri ? " · " + "!".repeat(d.pri) : ""}`;
      } else if (t.id === "foPhrase" && t.value.trim().toLowerCase() === PHRASE) finishFocus(false);
    });
    document.addEventListener("change", (e) => {
      const t = e.target, f = t.dataset && t.dataset.field; if (!f || !t.closest("#insp")) return;
      const it = find(S.sel); if (!it) return;
      if (f === "due") it.due = t.value ? new Date(t.value).getTime() : null;
      else if (f === "course") it.course = t.value || null;
      else it[f] = t.value;
      it.updated = Date.now(); renderAll();
    });
    document.addEventListener("focusout", (e) => {
      const t = e.target; if (!t.dataset || t.dataset.field !== "title" || !t.closest("#insp")) return;
      const it = find(S.sel); const v = t.textContent.trim(); if (it && v && v !== it.title) { it.title = v; it.updated = Date.now(); setTimeout(renderAll, 0); }
    });
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", (e) => { if (e.key === "Alt") hideTips(); });
    window.addEventListener("blur", hideTips);
    window.addEventListener("resize", () => renderAll());
  }

  function onKey(e) {
    const k = e.key, t = e.target, inField = /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable;
    if (t.closest && t.closest("#lab")) { if (k === "Escape") CA.lab.close(); return; }
    if (S.overlay === "boot") { e.preventDefault(); return endBoot(); }
    if (!S.power) { if (k === "Enter" || k === " ") power(); return; }
    if (k === "Alt") { e.preventDefault(); showTips(); return; }
    if (e.altKey && !e.ctrlKey) {
      const mk = { f: "file", v: "view", i: "item", c: "class", o: "focus", h: "help" }[k.toLowerCase()];
      if (R() === "mainframe" && mk) { e.preventDefault(); hideTips(); return openMenu(mk); }
      const hit = $$(`[data-hint]`, $("#screen")).find((el) => el.dataset.hint.toLowerCase() === k.toLowerCase() && el.offsetParent);
      if (hit) { e.preventDefault(); hideTips(); hit.click(); hit.focus && hit.tagName === "INPUT" && hit.focus(); }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k.toLowerCase() === "k") { e.preventDefault(); return openPalette(); }
    if (mod && k === ".") { e.preventDefault(); return CA.lab.toggle(); }
    if (mod && e.shiftKey && k === " ") { e.preventDefault(); return openQuick(); }
    if (mod && k.toLowerCase() === "z" && !inField) { e.preventDefault(); return doUndo(); }
    const FK = { F1: openHelp, F2: () => openQuick(), F3: () => openPalette(), F4: ACTIONS.focusQ, F6: cycleWin, F8: () => openFocusSetup(), F9: () => CA.lab.toggle(), F10: () => openMenu("file") };
    if (FK[k]) { e.preventDefault(); return FK[k](); }
    if (k === "Escape") return onEsc(e);

    // inputs with their own key handling
    if (t.id === "qaIn" && k === "Enter") { e.preventDefault(); const v = t.value; closeOv(); addFromText(v, e.shiftKey ? "open" : mod ? "focus" : null); if (!(mod && v.trim())) renderAll(); return; }
    if (t.id === "palIn") {
      if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); S.palI = Math.max(0, Math.min(S.palList.length - 1, S.palI + (k === "ArrowDown" ? 1 : -1))); updatePalette(); }
      else if (k === "Enter") { e.preventDefault(); runPalette(S.palI); }
      return;
    }
    if (t.id === "cmdIn" && k === "Enter") { e.preventDefault(); const v = t.value; t.value = ""; cmdLine(v); const p = $("#cmdPrev"); if (p) p.textContent = "OK"; setTimeout(() => { const c = $("#cmdIn"); if (c) c.focus(); }, 0); return; }
    if (t.id === "isIn" && k === "Enter") { e.preventDefault(); const v = t.value; t.value = ""; t.blur(); addFromText(v); renderAll(); return; }
    if (t.id === "fq") {
      if (k === "Enter" && t.value.trim()) { e.preventDefault(); setQ(S.q + " " + t.value, true); }
      else if (k === "Backspace" && !t.value) { const ts = E.parseFilter(S.q); if (ts.length) { e.preventDefault(); ts.pop(); setQ(ts.map((x) => x.raw).join(" "), true); } }
      return;
    }
    if (S.overlay === "snooze" && /^[1-9]$/.test(k)) { e.preventDefault(); return snoozePick(+k - 1); }
    if (S.overlay === "fsetup" && k === "Enter") { e.preventDefault(); return ACTIONS.fsGo(); }
    if (inField) return;
    if (S.overlay) return;
    if (mod) return;

    if (R() === "teletext" && /^[0-9]$/.test(k)) { e.preventDefault(); return ttDigit(k); }
    if (R() === "teletext" && /^[rgyb]$/i.test(k)) { e.preventDefault(); const set = fastextSet().find((x) => x[0] === k.toLowerCase()); return set && fastext(set[2]); }
    const view = VIEWS.find((v) => v.k && v.k === k);
    if (view) { e.preventDefault(); return go(view.id); }
    const tg = target();
    switch (k) {
      case "/": e.preventDefault(); return openPalette();
      case "q": case "Q": case "+": e.preventDefault(); if (k === "+" && S.sel) return bumpPri(S.sel); return openQuick();
      case "?": e.preventDefault(); return openHelp();
      case "j": case "ArrowDown": e.preventDefault(); return moveSel(1);
      case "k": case "ArrowUp": e.preventDefault(); return moveSel(-1);
      case "Enter": if (S.sel) { e.preventDefault(); select(S.sel, true); } return;
      case "x": case " ": e.preventDefault(); return tg && toggleDone(tg.id);
      case "f": e.preventDefault(); return focusTop();
      case "F": e.preventDefault(); return openFocusSetup();
      case "s": e.preventDefault(); return tg && openSnooze(tg.id);
      case "n": e.preventDefault(); S.skip++; CA.sound.click(); return renderAll();
      case "Delete": return S.sel && del(S.sel);
      case "[": return CA.lab.cycle(-1);
      case "]": return CA.lab.cycle(1);
    }
  }
  function onEsc(e) {
    if (closeRadial()) return;
    if (S.menu) return closeMenu();
    if (hideTips()) return;
    if (S.ttEntry) { S.ttEntry = ""; return renderTop(); }
    if (S.overlay) {
      if (S.overlay === "focus") { if (S.focus && S.focus.level !== "lockdown") { closeOv(); renderAll(); toast("Focus continues · the timer is in the island and the top bar"); } else toast("Lockdown · Esc does nothing here"); return; }
      if (S.overlay === "takeover") return toast("Answer the takeover first");
      return closeOv();
    }
    const t = e.target;
    if (/INPUT|TEXTAREA/.test(t.tagName)) { if (t.value) { t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); } else t.blur(); return; }
    if (S.insp && R() !== "phosphor") { S.insp = false; return renderAll(); }
    if (S.q !== "is:open" || S.view !== "all") return clearQ();
    S.sel = null; renderAll();
  }

  function tick() {
    S.now = Date.now(); S.ticks++;
    updateCountdowns(); focusBar(); checkAlerts();
    if (S.focus && S.now >= S.focus.end) finishFocus(true);
    if (S.ticks % 8 === 0) { S.coachI++; const c = $("#coach"); if (c) c.innerHTML = (R() === "teletext" ? "" : isM() ? "Tip: " : "TIP: ") + TIPS[S.coachI % TIPS.length]; }
    if (S.ticks % 30 === 0 && !busy() && !S.overlay && S.power) renderAll();
  }

  CA.app = { init() { bind(); renderAll(); boot(false); setInterval(tick, 1000); }, renderAll, toast, openQuick, openPalette, startFocus, simulate, boot, go, VIEWS, focusTop, power };
})();
