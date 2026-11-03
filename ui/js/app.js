/* Collegiapp — app shell for the Pocket design. One state object, one item list, many lenses.
   Every nav key is a saved filter over the same items (see VIEWS). Archived looks: archive/looks-2026-10. */
(function () {
  const CA = window.CA, E = CA.E;
  const { MIN, HR, DAY } = E;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const narrow = () => window.matchMedia("(max-width: 760px)").matches;
  const TAURI = window.__TAURI__ || null; // set inside the Tauri app (withGlobalTauri); null in a plain page
  const MAC = /Mac|iPhone|iPad/.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "");
  const WINOS = /Win/.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "");
  const MOD = MAC ? "⌘" : "Ctrl", ALT = MAC ? "⌥ Option" : "Alt";
  // The window frame is ours. Windows and Linux have no native title bar (tauri.conf.json): the top bar is the
  // title bar, with Pocket window keys. macOS keeps its traffic lights over a transparent title bar
  // (tauri.macos.conf.json). Phones and tablets (an iPad reports itself as a Mac with touch) have no frame.
  const MOBILE = /iPhone|iPad|Android/i.test(navigator.userAgent) || (MAC && navigator.maxTouchPoints > 1);
  const WIN = TAURI && TAURI.window && !MOBILE ? TAURI.window.getCurrentWindow() : null;
  const FRAME = WIN ? (MAC ? "mac" : "own") : "";

  const VIEWS = [
    { id: "now", k: "1", label: "Do first", q: "is:open is:actionable", sort: "score", lens: "list" },
    { id: "today", k: "2", label: "Today", q: "is:open due<=today", sort: "due", lens: "list" },
    { id: "week", k: "3", label: "Calendar", short: "Cal", q: "is:open", sort: "due", lens: "week" },
    { id: "inbox", k: "4", label: "Inbox", q: "status:inbox", sort: "updated", lens: "list" },
    { id: "work", k: "5", label: "Assignments", short: "Work", q: "is:open kind:work", sort: "due", lens: "list" },
    { id: "exams", k: "6", label: "Exams", q: "kind:exam", sort: "due", lens: "list" },
    { id: "classes", k: "7", label: "Classes", q: "", sort: "due", lens: "courses" },
    { id: "notes", k: "8", label: "Notes", q: "is:open kind:note", sort: "updated", lens: "notes" },
    { id: "events", k: "9", label: "Events", q: "is:open kind:event,ticket,office_hours", sort: "due", lens: "list" },
    { id: "links", k: "0", label: "Links", q: "", sort: "due", lens: "links" },
    { id: "all", k: "-", label: "Everything", short: "All", q: "is:open", sort: "due", lens: "list" },
    { id: "done", k: "", label: "Done", q: "is:done", sort: "updated", lens: "list" },
  ];
  const viewById = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];
  // The views in your order, each numbered by its place: the first is key 1, the tenth 0, the eleventh −. With the
  // sidebar that's its order (sideOrder); with the key row along the top, CA.ui.tabs. Both sync with the look (lab.js).
  // Views the order doesn't name (a new one) go at the end.
  const TAB_KEYS = "1234567890-", TAB_IDS = VIEWS.filter((v) => v.id !== "done").map((v) => v.id);
  function tabs() {
    const mine = (navMode() === "side" ? sideOrder(sideLayout()) : (CA.ui && CA.ui.tabs) || []).filter((id) => TAB_IDS.includes(id));
    return [...new Set(mine.concat(TAB_IDS))].map((id, i) => Object.assign({}, viewById(id), { k: TAB_KEYS[i] || "" }));
  }

  const KIND = { assignment: ["HW", "Assignment"], exam: ["EXAM", "Exam"], quiz: ["QUIZ", "Quiz"], lab: ["LAB", "Lab"], reading: ["READ", "Reading"],
    project: ["PROJ", "Project"], class: ["CLASS", "Class"], office_hours: ["OH", "Office hours"], event: ["EVENT", "Event"], ticket: ["TICKET", "Ticket"],
    errand: ["ERRAND", "Errand"], application: ["APPLY", "Application"], task: ["TASK", "Task"], note: ["NOTE", "Note"], info: ["INFO", "Info"] };
  const kShort = (k) => (KIND[k] || KIND.task)[0];
  const kLabel = (k) => (KIND[k] || KIND.task)[1];
  // A section (discussion, lab) is a class meeting tagged "section" by the Google import: same course, own label.
  const isSection = (it) => it.kind === "class" && (it.tags || []).some((t) => String(t).toLowerCase() === "section");
  const iLabel = (it) => (isSection(it) ? "Section" : kLabel(it.kind));
  // Canvas work a reader wasn't sure of comes in as Info in the Inbox (model.rs canvas_kind) for you to sort; the row
  // offers homework, exam, the kind its title hints at, or just info
  const unsorted = (it) => it.kind === "info" && it.status === "inbox" && it.src !== "manual";
  function sortKinds(it) {
    const hint = E.parseQuick(it.title, S.now, []).kind, ks = ["assignment", "exam"];
    if (["quiz", "lab", "project", "reading"].includes(hint)) ks.splice(1, 0, hint);
    return ks.map((k) => [k, k === "assignment" ? "Homework" : kLabel(k)]).concat([["info", "Just info"]]);
  }
  const TIPS = [
    "Press <b>Q</b> anywhere to add. Try “pa3 130a fri ~4h !!”.",
    "<b>Esc</b> clears every filter. Nav buttons are only saved filters.",
    "Right-click, or long-press on a touch screen, for the radial menu.",
    `Hold <b>${ALT}</b> to see every shortcut on screen.`,
    "<b>F</b> starts a 25-minute focus on the Do first item.",
    `<b>${MOD}+K</b> finds any command, item, class or link.`,
    `Paste a link with <b>${MOD}+V</b>: it goes on the open item, or starts a new one.`,
    "Excluded Canvas courses stay hidden everywhere. Manage them in Classes (<b>7</b>).",
    "<b>S</b> snoozes. “After next class” is one click.",
  ];
  const GLOBAL_LINKS = [["GOLD", "https://my.sa.ucsb.edu/gold/"], ["Canvas", "https://www.canvas.ucsb.edu/"], ["Gradescope", "https://www.gradescope.com/"],
    ["WeBWorK", "https://webwork.math.ucsb.edu/webwork2/"], ["Shoreline", "https://shoreline.ucsb.edu/"], ["UCSB Mail", "https://mail.google.com/"], ["Handshake", "https://ucsb.joinhandshake.com/"],
    ["Study rooms", "https://libcal.library.ucsb.edu/booking/groupstudy"], ["Dining menus", "https://apps.dining.ucsb.edu/menu"], ["MTD bus", "https://bustracker.sbmtd.gov/"],
    ["CLAS tutoring", "https://clas.ucsb.edu/"], ["Student Health", "https://studenthealth.sa.ucsb.edu/"], ["Registrar calendar", "https://registrar.sa.ucsb.edu/"]];
  const SOURCES = [["canvas", "Canvas", "API token + calendar feed", "3m"], ["gcal", "Google Calendar", "OAuth (or secret iCal URL)", "1m"], ["shoreline", "Shoreline", "CampusGroups iCal subscription", "12m"],
    ["gradescope", "Gradescope", "sign in once in the app", "live"], ["webwork", "WeBWorK", "sign in to each course in the app", "live"], ["ucsbapi", "UCSB API", "Dining · quarter calendar · events", "1h"], ["piazza", "Piazza / Ed", "Firefox extension", "off"]];
  const PHRASE = "i choose distraction";

  // Inside the app the data lives in the Rust store (store.js loads and saves it). The web app signed in to your Firebase
  // project (CLOUD, cloud.js) keeps it in Firestore; without a project the page is the web demo, on sample data.
  const LIVE = CA.store.live, CLOUD = !!CA.store.cloud, OWN = LIVE || CLOUD;
  const S = (CA.state = Object.assign(OWN ? CA.store.empty() : CA.sampleData(), {
    now: Date.now(), q: VIEWS[0].q, view: "now", lens: "list", sort: "score", cal: { mode: "day", at: null },
    sel: null, insp: false, skip: 0, focus: null, brk: null, overlay: null, islandOpen: false, update: null,
    stats: OWN ? loadStats() : { streak: 4, focusMin: 85 }, alerted: {}, settings: null, feeds: null, blocklist: [],
    hist: [], redo: [], trash: null, animRows: true, coachI: 0, ticks: 0, listIds: [], flashId: null, refocus: null, palI: 0, palList: [], noClickUntil: 0,
  }));
  const ui = () => CA.ui;
  const ctx = () => ({ now: S.now, courses: S.courses });
  const find = (id) => S.items.find((x) => x.id === id);
  // History. Each step is a list of [before, after] item snapshots: Ctrl+Z puts the befores back, Ctrl+Shift+Z or Ctrl+Y
  // the afters, only the fields that step changed and looked up by id, because a reload from the store may have
  // replaced the objects since. An undo's saves say why, so the store trashes the versions they throw away (trash.rs).
  // A step with its own undo/redo (a course delete) runs those instead.
  const HIST = 100, snap = (x) => JSON.parse(JSON.stringify(x));
  // Change an item and save it (store.js batches the save). Returns the step's [before, after] for remember().
  function edit(it, patch) {
    const before = snap(it); Object.assign(it, patch, { updated: Date.now() }); CA.store.save(it);
    return [before, snap(it)];
  }
  function put(from, to, why) {
    let cur = find(to.id); if (!cur) { cur = snap(from); S.items.push(cur); }
    for (const k of new Set(Object.keys(from).concat(Object.keys(to)))) {
      if (k !== "updated" && JSON.stringify(from[k]) !== JSON.stringify(to[k])) cur[k] = to[k] === undefined ? undefined : snap(to[k]);
    }
    cur.updated = Date.now(); CA.store.save(cur, why);
  }
  // u: { label (lowercase: "Undid rename"), pairs, id (flashes on undo) } or { label, undo, redo }
  function remember(u) { S.hist.push(u); if (S.hist.length > HIST) S.hist.shift(); S.redo = []; }
  const FIELD_STEP = { title: "rename", kind: "kind change", course: "course change", due: "date change", est: "estimate change", pri: "priority change",
    notes: "notes edit", status: "status change", location: "location change", interrupt: "alert change", links: "link change" };
  const editStep = (it, patch, label) => remember({ label: label || FIELD_STEP[Object.keys(patch)[0]] || "edit", pairs: [edit(it, patch)], id: it.id });
  // Focus stats are per device for now (localStorage); minutes and streaks are not part of the synced item list.
  function dayKey(t) { const d = new Date(t); return d.getFullYear() * 1e4 + (d.getMonth() + 1) * 100 + d.getDate(); }
  function loadStats() {
    let st = null; try { st = JSON.parse(localStorage.getItem("ca.stats") || "null"); } catch (e) { st = null; }
    st = Object.assign({ streak: 0, focusMin: 0, sessions: 0, day: 0, last: 0 }, st); delete st.xp; // older saves still carry XP
    const today = dayKey(Date.now()), yest = dayKey(Date.now() - DAY);
    if (st.day !== today) { st.focusMin = 0; st.sessions = 0; st.day = today; }
    if (st.last !== today && st.last !== yest) st.streak = 0;
    return st;
  }
  function saveStats() { if (!OWN) return; try { localStorage.setItem("ca.stats", JSON.stringify(S.stats)); } catch (e) { /* storage off: stats reset next launch */ } }
  function addFocusStats(min, completed) {
    const st = S.stats, today = dayKey(Date.now());
    if (OWN && st.last !== today) { st.streak = (st.last === dayKey(Date.now() - DAY) ? st.streak : 0) + 1; st.last = today; }
    st.focusMin += min; if (completed) st.sessions = (st.sessions || 0) + 1; saveStats();
  }
  const cById = (id) => S.courses.find((c) => c.id === id);
  const courseOf = (it) => (it && it.course ? cById(it.course) : null);
  const kc = (c) => (c ? `--kc: var(--k${c.color});` : "");
  const cmpDue = (a, b) => (a.due == null) - (b.due == null) || (a.due || 0) - (b.due || 0);
  const busy = () => { const a = document.activeElement; return !!a && !!a.closest && !!a.closest("#screen, #island") && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable); };
  const MO = CA.motion, motion = () => MO.m();
  const shown = (el) => !!el.offsetParent && el.getBoundingClientRect().width > 0;
  // the on-screen keys for a keyboard key (data-hint), and the press a keyboard key gives them once its action has rendered
  const hinted = (h) => $$(`[data-hint="${h}"]`, $("#screen")).filter(shown);
  const mirror = (h) => setTimeout(() => MO.after(() => MO.press(() => hinted(h))), 0);
  // Refused (nothing to act on, or not allowed here): the parts shake a pixel at a time and the speaker buzzes.
  function refuse(els) { [].concat(els || []).forEach((el) => MO.ack(el, "nope")); CA.sound.nope(); return false; }
  const ranked = () => E.rank(S.items.filter((it) => E.matchItem(it, [], ctx())), S.now);
  const topItem = () => { const r = ranked(); return r.length ? r[S.skip % r.length].it : null; };
  const target = () => (S.sel && find(S.sel)) || topItem();
  function cdText(ms) { if (ms <= 0) return "NOW"; return ms >= DAY ? E.fmtDur(ms).toUpperCase() : E.fmtClock(ms); }
  function clockStr() { const d = new Date(S.now); return E.fmtTime24(S.now) + ":" + String(d.getSeconds()).padStart(2, "0"); }
  function weekInfo() {
    const q = CA.quarter, wk = Math.floor((E.startOfDay(S.now) - q.week1.getTime()) / (7 * DAY)) + 1;
    return { wk: Math.max(0, Math.min(11, wk)), toFinals: Math.ceil((q.finals.getTime() - E.startOfDay(S.now)) / DAY) };
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

  /* ─────────── Pocket vocabulary: sentence case, pixel icons, one obvious primary action per region ─────────── */
  // Pixel icons: 9×9 bitmaps ("#" = lit pixel) drawn as crisp SVG rects. CSS sizes them in 9 px steps,
  // so every pixel lands on whole screen pixels at 18, 27 and 36 px.
  const PIX = {
    now: ".....###.|....###..|...###...|..######.|.....##..|....##...|...##....|..##.....|.##......",
    today: "....#....|.#.....#.|...###...|..#####..|#.#####.#|..#####..|...###...|.#.....#.|....#....",
    inbox: "....#....|....#....|..#.#.#..|...###...|#...#...#|#.......#|###...###|#.......#|#########",
    work: ".#####...|.#...##..|.#...###.|.#.....#.|.#.###.#.|.#.....#.|.#.###.#.|.#.....#.|.#######.",
    exams: "....#....|...#.#...|...#.#...|..#.#.#..|..#.#.#..|.#..#..#.|.#.....#.|#...#...#|#########",
    week: "..#...#..|#########|#########|#.......#|#.#.#.#.#|#.......#|#.#.#...#|#.......#|#########",
    classes: "....#....|..##.##..|##.....##|..##.##.#|..#.#.#.#|..#...#.#|..#...#..|..#####..|.........",
    events: "....#....|....#....|...###...|#########|.#######.|..#####..|..##.##..|.##...##.|.#.....#.",
    links: "...###...|.##.#.##.|.#..#..#.|#########|#...#...#|#########|.#..#..#.|.##.#.##.|...###...",
    all: ".........|##.######|.........|##.######|.........|##.######|.........|##.######|.........",
    done: "#########|#.......#|#......##|#.....#.#|##...#..#|#.#.#...#|#..#....#|#.......#|#########",
    search: "..###....|.#...#...|#.....#..|#.....#..|#.....#..|.#...#...|..####...|......##.|.......##",
    plus: ".........|....#....|....#....|....#....|.#######.|....#....|....#....|....#....|.........",
    focus: "..#####..|.#.....#.|#..###..#|#.#...#.#|#.#.#.#.#|#.#...#.#|#..###..#|.#.....#.|..#####..",
    play: "..#......|..##.....|..###....|..####...|..#####..|..####...|..###....|..##.....|..#......",
    pause: ".........|.##...##.|.##...##.|.##...##.|.##...##.|.##...##.|.##...##.|.##...##.|.........",
    check: ".........|........#|.......##|......##.|#....##..|##..##...|.####....|..##.....|.........",
    clock: "..#####..|.#..#..#.|#...#...#|#...#...#|#...###.#|#.......#|#.......#|.#.....#.|..#####..",
    next: ".#.....#.|.##....#.|.###...#.|.####..#.|.#####.#.|.####..#.|.###...#.|.##....#.|.#.....#.",
    prev: ".#.....#.|.#....##.|.#...###.|.#..####.|.#.#####.|.#..####.|.#...###.|.#....##.|.#.....#.",
    pin: "..#####..|.#.....#.|#..###..#|#..#.#..#|#..###..#|.#.....#.|..#...#..|...#.#...|....#....",
    go: ".........|.....#...|......#..|.......#.|#########|.......#.|......#..|.....#...|.........",
    ext: "....#####|.......##|......#.#|.....#..#|....#...#|...#.....|..#......|.#.......|#........",
    lab: ".#..#..#.|###.#..#.|.#..#..#.|.#..#.###|.#..#..#.|.#.###.#.|.#..#..#.|.#..#..#.|.#..#..#.",
    help: ".........|#########|#.......#|#.#.#.#.#|#.......#|#.#####.#|#.......#|#########|.........",
    filter: "#########|#.......#|.#.....#.|..#...#..|...#.#...|...#.#...|...#.#...|...#.#...|...###...",
    ticket: ".........|#########|#...#...#|.#.....#.|.#..#..#.|#.......#|#...#...#|#########|.........",
    flag: "########.|#######..|######...|#######..|########.|#........|#........|#........|#........",
    flame: "....#....|...##....|..###.#..|..#####..|.###.###.|.##...##.|.##...##.|..##.##..|...###...",
    building: "....#....|..#####..|#########|.#.#.#.#.|.#.#.#.#.|.#.#.#.#.|.#.#.#.#.|#########|#########",
    walk: "....##...|....##...|...###...|..#.###..|....#....|...#.#...|...#..#..|..#...#..|..#....#.",
    bell: "....#....|...###...|..#####..|..#####..|..#####..|.#######.|#########|.........|....#....",
    close: ".........|.#.....#.|..#...#..|...#.#...|....#....|...#.#...|..#...#..|.#.....#.|.........",
    video: ".........|.........|#####..#.|#...#.##.|#...####.|#...#.##.|#####..#.|.........|.........",
    trash: "...###...|#########|.#.....#.|.#.#.#.#.|.#.#.#.#.|.#.#.#.#.|.#.#.#.#.|.#.....#.|..#####..",
    wmin: ".........|.........|.........|.........|.........|.........|.#######.|.#######.|.........",
    wmax: ".........|.#######.|.#######.|.#.....#.|.#.....#.|.#.....#.|.#.....#.|.#######.|.........",
    wrest: "...######|...######|...#....#|#######.#|#######.#|#.....###|#.....#..|#######..|.........",
    sun: "....#....|.#.....#.|...###...|..#####..|#.#####.#|..#####..|...###...|.#.....#.|....#....",
    moon: "..###....|.##......|##.......|##.......|##.......|###.....#|.###...##|..######.|...###...",
    cloud: ".........|.........|...###...|..#...#..|.##...###|#.......#|#.......#|.#######.|.........",
    // the note editor's tools
    notes: ".#.#.#.#.|#########|#.......#|#.#####.#|#.......#|#.#####.#|#.......#|#.###...#|#########",
    jot: "......##.|.....#..#|....#..#.|...#..#..|..#..#...|.#..#....|#..#.....|##.......|#........",
    ul: ".........|#..#####.|.........|.........|#..#####.|.........|.........|#..#####.|.........",
    ol: ".#.......|##..#####|.#.......|.#.......|###......|.........|##..#####|..#......|.##......",
    quote: ".........|.##...##.|.##...##.|..#....#.|.#....#..|.........|.#######.|.........|.#####...",
    code: ".........|.....#...|..#..##..|.#..#..#.|#...#...#|.#..#..#.|..##..#..|...#.....|.........",
    codeblock: "#########|#.......#|#.#.....#|#..#....#|#.#..##.#|#.......#|#.......#|#.......#|#########",
    table: "#########|#...#...#|#########|#...#...#|#...#...#|#########|#...#...#|#...#...#|#########",
    hr: ".........|.........|.........|.........|#########|.........|.........|.........|.........",
    callout: "#########|#...#...#|#.......#|#...#...#|#...#...#|#...#...#|#########|.##......|.#.......",
    mark: "......##.|.....#..#|....#..#.|...#..#..|..#..#...|.####....|.###.....|#........|#########",
    clearf: "#######..|...#.....|...#.....|...#.#..#|...#..##.|...#..##.|...#.#..#|.........|.........",
    indent: "#########|.........|#...#####|.#.......|..#.#####|.#.......|#...#####|.........|#########",
    outdent: "#########|.........|..#.#####|.#.......|#...#####|.#.......|..#.#####|.........|#########",
    outline: "#######..|.........|..#######|.........|..#######|.........|#######..|.........|..#######",
    undo: "..#......|.##......|#######..|.##....#.|..#.....#|........#|........#|.......#.|..#####..",
    redo: "......#..|......##.|..#######|.#....##.|#.....#..|#........|#........|.#.......|..#####..",
    ai: "...#.....|...#.....|..###....|#######..|..###....|...#...#.|...#..###|.......#.|.........",
    print: "..#####..|..#...#..|#########|#.......#|#.....#.#|#########|..#...#..|..#...#..|..#####..",
    export: "....#....|....#....|....#....|..#.#.#..|...###...|....#....|#.......#|#.......#|#########",
    import: "....#....|...###...|..#.#.#..|....#....|....#....|....#....|#.......#|#.......#|#########",
    draw: "#########|#.......#|#.......#|#.#...#.#|##.#.#.##|#...#...#|#.......#|#.......#|#########",
    pick: "#........|##.......|###......|####.....|#####....|######...|###......|...##....|....##...",
    erase: ".........|.#######.|.#.....#.|.#.....#.|.#######.|.#######.|.#######.|.........|#########",
    line: "........#|.......#.|......#..|.....#...|....#....|...#.....|..#......|.#.......|#........",
    arrow: "....#####|.......##|......#.#|.....#..#|....#...#|...#.....|..#......|.#.......|#........",
    box: "#########|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#########",
    oval: "..#####..|.#.....#.|#.......#|#.......#|#.......#|#.......#|#.......#|.#.....#.|..#####..",
    side: "#########|#..#....#|#..#....#|#..#....#|#..#....#|#..#....#|#..#....#|#..#....#|#########",
    folder: ".........|####.....|#...#####|#.......#|#.......#|#.......#|#.......#|#########|.........",
    file: ".#####...|.#...##..|.#....##.|.#.....#.|.#.....#.|.#.....#.|.#.....#.|.#######.|.........",
    tw: ".........|..#......|..##.....|..###....|..####...|..###....|..##.....|..#......|.........",
    eye: ".........|.........|..#####..|.#..#..#.|#..###..#|.#..#..#.|..#####..|.........|.........",
    eyeoff: "........#|.......#.|..#####..|.#...#.#.|#...#...#|.#.#...#.|..#####..|.#.......|#........",
    grip: ".........|...#.#...|.........|...#.#...|.........|...#.#...|.........|...#.#...|.........",
    edit: "......##.|.....#..#|....#..#.|...#..#..|..#..#...|.#..#....|.#.#.....|.##......|.........",
  };
  const ICONS = {};
  for (const n in PIX) ICONS[n] = PIX[n].split("|").map((row, y) => row.replace(/#+/g, (run, x) => `M${x} ${y}h${run.length}v1h-${run.length}z`).replace(/\./g, "")).join("");
  // The Standard look (L8, html[data-look="standard"]) draws the same names as plain 24 px line icons (standard.css .i.ln),
  // shared with PocketCanvas (src/lib/icons.js LINE). `as` forces one set ("pocket" or "standard").
  const LINE = {
    now: "M13 2 4 14h7l-1 8 9-12h-7l1-8z", today: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    inbox: "M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6l2-8z", work: "M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4zM14 3v4h4M9 12h6M9 16h6",
    exams: "M9 4h6v3H9zM7 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1M9 14l2 2 4-4", week: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
    classes: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM4 19a2 2 0 0 1 2-2h13", events: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3z",
    links: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1", all: "M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1",
    done: "M4 4h16v16H4zM8 12l3 3 5-6", search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4", plus: "M12 5v14M5 12h14",
    focus: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", play: "M8 5l11 7-11 7V5z", pause: "M9 5v14M15 5v14", check: "M5 12l5 5 9-10",
    clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2", next: "M6 5l9 7-9 7V5zM18 5v14", prev: "M18 5l-9 7 9 7V5zM6 5v14", pin: "M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10zM12 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
    go: "M5 12h14M13 6l6 6-6 6", ext: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5", lab: "M6 4v16M12 4v16M18 4v16M4 8h4M10 15h4M16 10h4",
    help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01", filter: "M4 5h16l-6 7v6l-4 2v-8L4 5z",
    ticket: "M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7zM14 7v2M14 11.5v1M14 15v2", flag: "M5 21V4M5 4h11l-2 4 2 4H5",
    flame: "M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z", building: "M4 21h16M6 21V5h8v16M14 9h4v12M9 8h2M9 12h2M9 16h2",
    walk: "M13 2.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM12 8l-1.5 6L8 21M10.5 14l3 2.5 1 4.5M7.5 11.5 12 8l2.5 3.5H17", bell: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 20a2 2 0 0 0 4 0",
    close: "M6 6l12 12M18 6L6 18", video: "M3 7h12v10H3zM15 10l6-3v10l-6-3", trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
    wmin: "M6 12h12", wmax: "M6.5 6.5h11v11h-11z", wrest: "M6.5 9.5h8v8h-8zM9.5 9.5v-3h8v8h-3",
    sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4", moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
    cloud: "M7 19a4.5 4.5 0 0 1-.9-8.9 6 6 0 0 1 11.6 1.4A3.8 3.8 0 0 1 17 19H7z",
    notes: "M6 4h12a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 2v4M15 2v4M8 10h8M8 14h8M8 18h5", jot: "M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4",
    ul: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01", ol: "M10 6h10M10 12h10M10 18h10M4 4h1v4M4 8h2M4 14.5a1 1 0 0 1 2 0c0 1-2 1.5-2 3.5h2",
    quote: "M5 17h3l2-4V7H4v6h3zM14 17h3l2-4V7h-6v6h3z", code: "M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16", codeblock: "M4 4h16v16H4zM8 9l-2 3 2 3M16 9l2 3-2 3M13 8l-2 8",
    table: "M4 4h16v16H4zM4 10h16M4 15h16M10 4v16", hr: "M3 12h18M7 7h.01M12 7h.01M17 7h.01M7 17h.01M12 17h.01M17 17h.01", callout: "M4 4h16v12H9l-5 4V4zM12 8v.01M12 11v3",
    mark: "M9 11l-4 4v3h3l4-4M9 11l6-6 4 4-6 6M9 11l4 4M4 21h16", clearf: "M4 5h11M9.5 5 7 19M14 13l6 6M20 13l-6 6",
    indent: "M3 5h18M11 10h10M11 14h10M3 19h18M3 9l4 3-4 3", outdent: "M3 5h18M11 10h10M11 14h10M3 19h18M7 9l-4 3 4 3", outline: "M4 6h12M8 12h12M8 18h12M4 12h.01M4 18h.01",
    undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3", redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
    ai: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z",
    print: "M7 8V3h10v5M7 17H4v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-3M7 14h10v7H7z", export: "M12 3v12M7 10l5 5 5-5M4 17v3h16v-3", import: "M12 15V3M7 8l5-5 5 5M4 17v3h16v-3",
    draw: "M3 4h18v16H3zM6 14c1.5-3 3-3 4 0s2.5 3 4 0 2.5-3 4 0", pick: "M5 3l13 7.5-5.5 1.5L10 17.5 5 3zM13 12l5 6",
    erase: "M7 21l-4.3-4.3a1.7 1.7 0 0 1 0-2.4l9.6-9.6a1.7 1.7 0 0 1 2.4 0l5.6 5.6a1.7 1.7 0 0 1 0 2.4L13 21zM22 21H7M5 11l9 9",
    line: "M5 19L19 5", arrow: "M5 19L19 5M10 5h9v9", box: "M4 5h16v14H4z", oval: "M12 5c5 0 9 3.1 9 7s-4 7-9 7-9-3.1-9-7 4-7 9-7z",
    side: "M4 5h16v14H4zM9 5v14", folder: "M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z", file: "M6 3h8l4 4v14H6zM14 3v4h4", tw: "M10 7l5 5-5 5",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z",
    eyeoff: "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
    grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01", edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  };
  const ic = (n, c, as) => ((as || document.documentElement.dataset.look) === "standard"
    ? `<svg class="i ln${c ? " " + c : ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="${LINE[n] || ""}"/></svg>`
    : `<svg class="i${c ? " " + c : ""}" viewBox="0 0 9 9" aria-hidden="true"><path d="${ICONS[n] || ""}"/></svg>`);
  const LOGO = `<span class="brandmark"><span class="logo" aria-hidden="true">C</span><span>Collegiapp</span></span>`;
  const DNM = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], DNL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MNM = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MNL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const PRI = ["", "Priority", "High priority", "Urgent"];
  const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const srcName = (s) => (SOURCES.find((x) => x[0] === s) || [s, cap(s)])[1];
  function mTime(t) { const d = new Date(t); const h = d.getHours(); return (h % 12 || 12) + ":" + String(d.getMinutes()).padStart(2, "0") + (h >= 12 ? " PM" : " AM"); }
  function mDay(t) {
    const diff = Math.round((E.startOfDay(t) - E.startOfDay(S.now)) / DAY), d = new Date(t);
    if (diff === 0) return "Today"; if (diff === 1) return "Tomorrow"; if (diff === -1) return "Yesterday";
    return diff > 0 && diff < 7 ? DNM[d.getDay()] : `${DNM[d.getDay()]}, ${MNM[d.getMonth()]} ${d.getDate()}`;
  }
  function mDue(t) { return mDay(t) + " " + mTime(t); }
  const fDue = (t) => mDue(t);
  function sinceText(ms) { return ms >= DAY ? E.fmtDur(ms).toUpperCase() : E.fmtClock(ms); }
  function dueState(it) {
    if (it.due == null) return { t: "No date", c: "" };
    const d = it.due - S.now;
    if (E.SCHEDULED(it.kind) && d <= 0 && it.end > S.now) return { t: "Now", c: "live" };
    // only open work can be overdue: a class or event that's over ended, finished work shows its date
    if (d < 0 && E.SCHEDULED(it.kind)) return { t: E.startOfDay(it.due) === E.startOfDay(S.now) ? "Ended" : mDay(it.due), c: "" };
    if (d < 0 && !E.isOpen(it, S.now)) return { t: mDay(it.due), c: "" };
    if (d < 0) return { t: E.fmtDur(d) + " overdue", c: "over" };
    if (d < 24 * HR) return { t: "in " + E.fmtDur(d), c: d < 3 * HR ? "hot" : "soon" };
    return { t: mDay(it.due), c: "" };
  }
  // a class's name opens its folder (goClass); `notes` opens its notes folder instead
  const cgo = (c, notes) => `data-act="goClass" data-c="${esc(c.id)}"${notes ? ' data-v="notes"' : ""} title="Open ${esc(c.code)}${notes ? " notes" : ""}"`;
  const cchip = (c, notes) => (c ? `<button type="button" class="cchip" style="${kc(c)}" ${cgo(c, notes)}>${esc(c.code)}</button>` : `<span class="cchip none">Personal</span>`);
  const clink = (c, html) => `<button type="button" class="clink" ${cgo(c)}>${html}</button>`;
  function viewTitle() {
    // with the sidebar, a folder's list is titled by its path: "CS 16 · Assignments", "Notes · CS 16", "#lab"
    const loc = S.side && sideLoc(S.side);
    if (loc && !loc.filtered && !loc.cur.view) return loc.path.filter((n) => !n.sec || n.id === "s:notes").map((n) => n.label).join(" · ");
    const v = viewById(S.view), m = S.q.match(/^is:open course:(\S+)$/);
    const c = m && S.courses.find((x) => x.tag.toLowerCase() === m[1]);
    return c ? c.code : v.label + (S.q !== v.q ? " · filtered" : "");
  }
  function setDisp(el, s) { if (el.textContent !== s) el.textContent = s; }

  /* ─────────── places: location banners, walking time, leave-by ─────────── */
  // "PHELP 1160" or "CSIL · or Zoom" resolves against CA.places (data.js): building code, room and a rough position.
  const placeKeys = () => Object.keys(CA.places || {}).sort((a, b) => b.length - a.length);
  function place(loc) {
    if (!loc) return null;
    const s = String(loc), key = placeKeys().find((k) => s.toUpperCase().startsWith(k.toUpperCase()));
    const p = key ? CA.places[key] : null, rest = key ? s.slice(key.length).trim() : "";
    return { code: p && !p.named ? key : "", name: p ? p.name : s.split("·")[0].trim(), note: p && p.note, room: /^[A-Z]?\d/i.test(rest) ? rest.split("·")[0].trim() : "", xy: p && p.xy, zoom: /zoom/i.test(s) };
  }
  const placeShort = (p) => (p.code ? p.code + (p.room ? " " + p.room : "") : p.name);
  // walking minutes: city-block metres at ~75 m/min, never under 1
  function walkMin(a, b) { const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]); return Math.max(1, Math.round((d * 0.85) / 75)); }
  // You leave from the last scheduled thing that ends within 90 min before this one starts; otherwise from home.
  function tripTo(it) {
    const to = place(it && it.location); if (!to || !to.xy || it.due == null) return null;
    const prev = S.items.filter((x) => x.id !== it.id && E.SCHEDULED(x.kind) && x.location && x.end && x.end <= it.due && x.end >= it.due - 90 * MIN && E.matchItem(x, [], ctx())).sort((a, b) => b.end - a.end)[0];
    const fp = prev && place(prev.location), from = fp && fp.xy ? fp : CA.home, same = from !== CA.home && from.name === to.name;
    const min = walkMin(from.xy, to.xy);
    return { min, same, from: from === CA.home ? CA.home.short : from.name, leave: it.due - (min + 3) * MIN };
  }
  function locBanner(it, trip) {
    const p = place(it.location); if (!p) return "";
    const late = trip && trip.leave <= S.now && it.due > S.now, room = [p.code && placeShort(p), p.note, p.zoom && "or Zoom"].filter(Boolean).join(" · ");
    const go = trip ? `<span class="lb-trip">${ic("walk")}<span>${trip.same ? "Same building" : `${trip.min} min walk from ${esc(trip.from)}`}</span></span>
      <span class="lb-leave${late ? " late" : ""}"><span class="lb-k">${late ? "Leave" : "Leave by"}</span><b class="num">${late ? "now" : esc(mTime(trip.leave))}</b></span>` : "";
    return `<div class="locban" style="${kc(courseOf(it))}">${ic(p.xy || !p.zoom ? "building" : "video", "lb-ic")}<span class="lb-main"><span class="lb-name">${esc(p.name)}</span>${room ? `<span class="lb-room">${esc(room)}</span>` : ""}</span>${go}</div>`;
  }

  function mTop(el) {
    const { wk, toFinals } = weekInfo(), d = new Date(S.now);
    const f = S.focus ? `<button class="fpill" data-act="focusTop" title="Back to the focus screen">${ic("focus")}Focus · <span class="num" data-cd data-f="clock" data-t="${S.focus.end}">${cdText(S.focus.end - S.now)}</span></button>`
      : S.brk ? `<button class="fpill" data-act="brkShow" title="Back to the break screen">${ic("pause")}Break · <span class="num" data-cd data-f="clock" data-t="${S.brk.end}">${cdText(S.brk.end - S.now)}</span></button>` : "";
    el.innerHTML = `<div class="mtop">${LOGO}
      <div class="crumb"><span class="v"><span class="dl">${DNL[d.getDay()]}</span><span class="ds">${DNM[d.getDay()]}</span>, ${MNM[d.getMonth()]} ${d.getDate()}</span><span class="ctx">${esc(CA.quarter.name)} · Week ${wk} of 10 · Finals in ${toFinals} days</span></div>
      <button class="search" data-act="palette" data-hint="k" title="Search and commands (${MOD}+K)">${ic("search")}<span class="ph-t">Search items, classes, links, commands</span><kbd>${MOD} K</kbd></button>
      ${cloudKey()}${f}<button class="btn" data-act="focusTop" data-hint="f" title="Focus on Do first (F)">${ic("focus")}<span class="bl">Focus</span><kbd>F</kbd></button>
      <button class="btn primary" data-act="quick" data-hint="q">${ic("plus")}Add<kbd>Q</kbd></button>
      <div class="display clock" title="Local time"><span class="d-num num" data-clock>${clockStr()}</span></div>${FRAME === "own" ? winKeys() : ""}</div>`;
  }
  function winKeys() {
    return `<span class="winkeys" role="group" aria-label="Window"><button class="wk" data-act="winMin" title="Minimize">${ic("wmin")}</button>`
      + `<button class="wk" data-act="winMax" title="${S.winMax ? "Restore" : "Maximize"}">${ic(S.winMax ? "wrest" : "wmax")}</button>`
      + `<button class="wk wk-x" data-act="winClose" title="Close (Collegiapp keeps running in the tray)">${ic("close")}</button></span>`;
  }
  // The top bar's empty space moves the window (after a few pixels, so a double-click still lands) and
  // double-click maximizes. Dragging uses the system move loop, so Snap and Aero Shake still work. The whole band
  // the top bar sits in counts, from the window's top edge (the content's padding included) to the bar's bottom.
  function bindFrame() {
    if (!WIN) return;
    const root = document.documentElement, content = $("#content"); root.dataset.frame = FRAME;
    // the sidebar's band (and the space above it) drags the window too, down to the band's bottom
    const grip = (e) => {
      if (e.button !== 0 || e.target.closest("button, a, input, textarea, select, [data-act], .sd-grip")) return false;
      const side = e.target.closest("#side"), band = side ? $("#side .ph") : $("#top");
      return !!band && (side ? !e.target.closest(".sd-tree, .sd-tip, .sd-foot, .sd-edfoot") : e.target === content || e.target.id === "page" || !!e.target.closest("#top"))
        && e.clientY <= band.getBoundingClientRect().bottom;
    };
    let down = null;
    content.addEventListener("mousedown", (e) => {
      if (!grip(e)) return;
      if (e.detail === 2) { down = null; WIN.toggleMaximize().catch(() => {}); return; }
      down = [e.screenX, e.screenY];
    });
    window.addEventListener("mousemove", (e) => {
      if (!down) return;
      if (!(e.buttons & 1)) { down = null; return; }
      if (Math.abs(e.screenX - down[0]) + Math.abs(e.screenY - down[1]) < 4) return;
      down = null; WIN.startDragging().catch(() => {});
    });
    window.addEventListener("mouseup", () => { down = null; });
    const sync = () => WIN.isMaximized().then((m) => {
      if (m === !!S.winMax) return;
      S.winMax = m; root.dataset.max = m ? "1" : ""; mTop($("#top"));
    }).catch(() => {});
    WIN.onResized(sync).catch(() => {}); sync();
    // shaking a tube magnetizes it, so a quick back and forth by the top bar (four turns of 30+ px within 0.9 s)
    // degausses the screen (fx.js); a drag or a snap never turns that often
    let px = null, dir = 0, run = 0, turns = [], calm = 0;
    WIN.onMoved(({ payload: p }) => {
      const t = performance.now(), dx = px == null ? 0 : p.x - px; px = p.x;
      if (!dx) return;
      if (Math.sign(dx) === dir) { run += Math.abs(dx); return; }
      if (dir && run >= 30 * (window.devicePixelRatio || 1)) {
        turns = turns.filter((x) => t - x < 900).concat(t);
        if (turns.length >= 4 && t > calm) { turns = []; calm = t + 2500; CA.fx.degauss(); }
      }
      dir = Math.sign(dx); run = Math.abs(dx);
    }).catch(() => {});
    // the one-column layout keeps the top bar pinned (it's the title bar); the key row sticks under it
    if (window.ResizeObserver) new ResizeObserver(() => root.style.setProperty("--top-h", $("#top").offsetHeight + "px")).observe($("#top"));
  }
  /* ─────────── the sidebar: every place in the app as folders (docs/NAVIGATION.md) ───────────
     Sections in your order: groups of views (Plan, Coursework and More at first; the views are numbered 1–0 − in the
     order they show), Classes (a folder per class with its assignments, exams, calendar and notes; the work and the
     notes are files in them), Notes (by class, pinned ones first) and Tags. Clicking a folder opens its list in the page
     and unfolds it; its arrow only folds. A file opens: an item's details, a note's editor. The path bar (#nav) spells
     out where you are, and the place you're in unfolds to show itself. It docks beside the page when the screen has
     room (900 px), else it's a drawer over it. Synced with the look: CA.ui.nav ("side" or "top", the old key row),
     CA.ui.side ("left" or "right") and CA.ui.sideLayout (how you arranged it, null for the usual way: sideLayout()).
     The width, whether it's hidden and which folders are open stay on this device (localStorage capp.side). */
  const SIDE_KEY = "capp.side", SIDE_MIN = 180, SIDE_MAX = 440, SIDE_DOCK = 900, SIDE_FILES = 12;
  const sideP = Object.assign({ w: 0, hidden: false, open: {} }, (() => { try { return JSON.parse(localStorage.getItem(SIDE_KEY)) || {}; } catch (e) { return {}; } })());
  function sideSave() { try { localStorage.setItem(SIDE_KEY, JSON.stringify(sideP)); } catch (e) { /* a private window: it forgets */ } }
  const navMode = () => (CA.ui && CA.ui.nav === "top" ? "top" : "side");
  const sideAt = () => (CA.ui && CA.ui.side === "right" ? "right" : "left");
  const sideW = () => Math.max(SIDE_MIN, Math.min(SIDE_MAX, sideP.w || Math.round(15 * (parseFloat(getComputedStyle($("#content")).fontSize) || 15))));
  // The usual arrangement, what you open most first. Classes, Notes and Tags are built in: they hold folders, and the
  // Classes and Notes views are their first rows. The others are groups of views to rename, refill, delete or add to.
  const SIDE_DEF = [
    { id: "plan", label: "Plan", views: ["now", "today", "week", "inbox"] },
    { id: "work", label: "Coursework", views: ["work", "exams"] },
    { id: "classes", label: "Classes" },
    { id: "notes", label: "Notes" },
    { id: "more", label: "More", views: ["events", "links", "all", "done"] },
    { id: "tags", label: "Tags" },
  ];
  const SIDE_BUILT = { classes: "classes", notes: "notes", tags: "" }; // a built-in section, and the view that's its first row
  const SIDE_SHUT = ["more", "tags"]; // folded until you open them
  // An arrangement made whole: every section once, every view in one group (a new view joins the first), the hidden
  // views in `off`, and the classes' order in `classes` (course ids; a class it doesn't name goes after).
  function sideLayout(raw) {
    raw = raw === undefined ? CA.ui && CA.ui.sideLayout : raw;
    raw = raw && typeof raw === "object" ? raw : {};
    const VID = VIEWS.map((v) => v.id).filter((id) => !(id in SIDE_BUILT)), seen = new Set(), secs = [];
    (Array.isArray(raw.secs) && raw.secs.length ? raw.secs : SIDE_DEF).forEach((s) => {
      if (!s || typeof s.id !== "string" || !s.id || secs.some((x) => x.id === s.id)) return;
      const d = SIDE_DEF.find((x) => x.id === s.id), sec = { id: s.id, label: String(s.label || (d && d.label) || "Group").slice(0, 40) };
      if (s.hide) sec.hide = true;
      if (!(s.id in SIDE_BUILT)) sec.views = (Array.isArray(s.views) ? s.views : []).filter((v) => VID.includes(v) && !seen.has(v) && seen.add(v));
      secs.push(sec);
    });
    Object.keys(SIDE_BUILT).forEach((id) => { if (!secs.some((s) => s.id === id)) secs.push(Object.assign({}, SIDE_DEF.find((x) => x.id === id))); });
    const left = VID.filter((v) => !seen.has(v));
    if (left.length) { let g = secs.find((s) => s.views); if (!g) secs.unshift((g = { id: "views", label: "Views", views: [] })); g.views.push(...left); }
    return {
      secs,
      off: [...new Set((Array.isArray(raw.off) ? raw.off : []).filter((v) => VIEWS.some((x) => x.id === v)))],
      classes: [...new Set((Array.isArray(raw.classes) ? raw.classes : []).filter((c) => typeof c === "string"))],
    };
  }
  // the views in the order the sidebar shows them, the hidden ones after: that numbers them 1–0 −
  function sideOrder(L) {
    const vis = [], hid = [];
    L.secs.forEach((s) => (s.views || (SIDE_BUILT[s.id] ? [SIDE_BUILT[s.id]] : [])).forEach((v) => (s.hide || L.off.includes(v) ? hid : vis).push(v)));
    return vis.concat(hid);
  }
  // the included classes in your order
  function classOrder(L) {
    const rank = (c) => { const i = L.classes.indexOf(c.id); return i < 0 ? 1e6 + S.courses.indexOf(c) : i; };
    return S.courses.filter((c) => c.included).sort((a, b) => rank(a) - rank(b));
  }
  // Keep an arrangement (the usual one keeps as null, so it syncs as the default). sideStore only saves (a rename, whose
  // field is still on screen); sideSaveLayout redraws too, with a toast that can take it back.
  function sideStore(L) {
    if (!CA.lab) return;
    const n = L && sideLayout(L);
    CA.lab.set({ sideLayout: !n || JSON.stringify(n) === JSON.stringify(sideLayout(null)) ? null : n }, { light: true });
  }
  function sideSaveLayout(L, msg, was) {
    sideStore(L); renderAll();
    if (msg) toast(esc(msg), was !== undefined ? { actions: [["Undo", () => { sideSaveLayout(was); CA.sound.tick(); }]] } : {});
  }
  // none (the key row instead), dock (beside the page), over (a drawer, open), off (hidden, or a drawer that's shut)
  function sideState() {
    if (navMode() !== "side") return "none";
    if ($("#screen").clientWidth < SIDE_DOCK) return S.sideOver ? "over" : "off";
    return sideP.hidden ? "off" : "dock";
  }
  function sideApply() {
    const c = $("#content"), st = sideState();
    if (c.dataset.sd !== st) c.dataset.sd = st;
    if (c.dataset.side !== sideAt()) c.dataset.side = sideAt();
    c.style.setProperty("--side-w", sideW() + "px");
    // on a Mac a sidebar on the left starts level with the path bar, under the traffic lights (pocket.css, standard.css)
    if (FRAME === "mac") c.style.setProperty("--nav-top", $("#nav").offsetTop + "px");
    $("#side").hidden = st === "none" || st === "off";
    $("#sdScrim").hidden = st !== "over";
    return st;
  }
  const qn = (q) => String(q || "").replace(/\s+/g, " ").trim();
  const dueShort = (t) => {
    const diff = Math.round((E.startOfDay(t) - E.startOfDay(S.now)) / DAY), d = new Date(t);
    return diff === 0 ? "Today" : diff === 1 ? "Tmr" : diff > 1 && diff < 7 ? DNM[d.getDay()] : `${MNM[d.getMonth()]} ${d.getDate()}`;
  };
  // The tree. A node: { id, label, to: { view, q, lens, sort } (what it opens), kids, n (a count), icon or course,
  // item or note (a file), sec (a section's id), views (a group of views), def (open by default), off (hidden: it shows
  // only while you edit), drag (what moving it moves: view, class), up (its folder) }. Hidden parts stay in the tree, so
  // the path bar can still say where you are.
  function sideTree() {
    const c0 = ctx(), all = (q) => { const t = E.parseFilter(q); return S.items.filter((it) => E.matchItem(it, t, c0)); };
    const Lay = sideLayout(), keys = new Map(tabs().map((v) => [v.id, v.k]));
    const L = (q) => ({ view: "all", q, lens: "list", sort: "due" }), NL = (q) => ({ view: "notes", q, lens: "notes", sort: "updated" });
    const byDue = (a, b) => (a.due == null) - (b.due == null) || (a.due || 0) - (b.due || 0) || a.title.localeCompare(b.title);
    const byNote = (a, b) => isPinned(b) - isPinned(a) || b.updated - a.updated;
    const fileIcon = (it) => (it.kind === "exam" ? "exams" : E.SCHEDULED(it.kind) ? "events" : "file");
    const item = (it) => ({ id: "i:" + it.id, label: it.title || "Untitled", item: it.id, icon: fileIcon(it), due: it.due, done: it.status === "done" });
    const note = (it) => ({ id: "n:" + it.id, label: it.title || "Untitled note", note: it.id, icon: "notes", pin: isPinned(it) });
    // a folder's files: the first SIDE_FILES, then a key that opens the folder for the rest
    const files = (id, list, to) => (list.length > SIDE_FILES ? list.slice(0, SIDE_FILES).concat({ id: id + ":more", label: `${list.length - SIDE_FILES} more`, more: true, to }) : list);
    const view = (id) => {
      const v = viewById(id), own = id in SIDE_BUILT;
      return { id: "v:" + v.id, label: own ? "All " + v.label.toLowerCase() : v.label, icon: v.id, view: v.id, k: keys.get(v.id) || "", off: Lay.off.includes(v.id), drag: own ? "" : "view",
        to: { view: v.id, q: v.q, lens: v.lens, sort: v.sort }, n: ["now", "today", "inbox", "work", "exams"].includes(v.id) ? all(v.q).length : null };
    };
    const notes = all("is:open kind:note").sort(byNote);
    const classes = classOrder(Lay).map((c) => {
      const t = c.tag.toLowerCase(), q = (s) => s + " course:" + t, id = "c:" + c.id;
      const work = all(q("is:open kind:work")).sort(byDue), exams = all(q("kind:exam")).sort(byDue), mine = notes.filter((it) => it.course === c.id);
      return { id, label: c.code, title: c.title, course: c, drag: "class", to: L(q("is:open")), n: work.length || null, kids: [
        { id: id + ":work", label: "Assignments", icon: "work", to: L(q("is:open kind:work")), n: work.length || null, kids: files(id + ":work", work.map(item), L(q("is:open kind:work"))) },
        { id: id + ":exams", label: "Exams", icon: "exams", to: L(q("kind:exam")), n: exams.filter((it) => it.status !== "done").length || null, kids: files(id + ":exams", exams.map(item), L(q("kind:exam"))) },
        { id: id + ":cal", label: "Calendar", icon: "week", to: { view: "week", q: q("is:open"), lens: "week", sort: "due" } },
        { id: id + ":notes", label: "Notes", icon: "notes", to: NL(q("is:open kind:note")), n: mine.length || null, kids: files(id + ":notes", mine.map(note), NL(q("is:open kind:note"))) },
      ] };
    });
    const own = all("is:open course:none").filter((it) => !isNote(it)).sort(byDue);
    classes.push({ id: "c:none", label: "Personal", icon: "folder", to: L("is:open course:none"), n: own.length || null, kids: files("c:none", own.map(item), L("is:open course:none")) });
    const folders = S.courses.filter((c) => notes.some((it) => it.course === c.id)).map((c) => {
      const mine = notes.filter((it) => it.course === c.id), to = NL("is:open kind:note course:" + c.tag.toLowerCase());
      return { id: "nc:" + c.id, label: c.code, course: c, to, n: mine.length, kids: files("nc:" + c.id, mine.map(note), to) };
    });
    const loose = notes.filter((it) => !it.course || !cById(it.course));
    if (loose.length) folders.push({ id: "nc:none", label: "No class", icon: "folder", to: NL("is:open kind:note course:none"), n: loose.length, kids: files("nc:none", loose.map(note), NL("is:open kind:note course:none")) });
    const tagN = new Map();
    all("is:open").forEach((it) => (it.tags || []).forEach((g) => { const k = String(g).toLowerCase(); if (k !== "pinned" && k !== "section") tagN.set(k, (tagN.get(k) || 0) + 1); }));
    const tags = [...tagN].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g, n]) => ({ id: "t:" + g, label: "#" + g, icon: "filter", to: L("is:open tag:" + g), n }));
    const tree = Lay.secs.map((s) => ({
      id: "s:" + s.id, label: s.label, sec: s.id, views: !!s.views, def: !SIDE_SHUT.includes(s.id), off: !!s.hide, add: s.id === "notes",
      to: s.id === "classes" || s.id === "notes" ? Object.assign({ view: s.id }, viewById(s.id)) : null,
      kids: s.views ? s.views.map(view) : s.id === "classes" ? [view("classes")].concat(classes) : s.id === "notes" ? [view("notes")].concat(notes.filter(isPinned).map(note), folders) : tags,
    }));
    const map = new Map(), link = (list, up) => list.forEach((n) => { n.up = up; map.set(n.id, n); if (n.kids) link(n.kids, n); });
    link(tree, null);
    return { tree, map };
  }
  const sideOpenQ = (n) => (n.id in sideP.open ? !!sideP.open[n.id] : !!n.def);
  const pathTo = (n) => { const p = []; for (let x = n; x; x = x.up) p.unshift(x); return p; };
  // Where you are: the folder whose list is on screen (the one you clicked, when two show the same list), else the
  // folder you opened last or your view, "filtered" once chips or a search narrowed it.
  function sideLoc(T) {
    const q = qn(S.q), hits = [], hit = (n) => n.to && !n.more && !n.sec && n.to.lens === S.lens && qn(n.to.q) === q;
    T.map.forEach((n) => { if (hit(n)) hits.push(n); });
    const at = T.map.get(S.sideAt), exact = (at && hits.includes(at) && at) || hits.find((n) => !n.off) || hits[0];
    if (exact) return { cur: exact, path: pathTo(exact), filtered: false };
    const base = at && at.to && at.to.lens === S.lens && at.to.view === S.view ? at : T.map.get("v:" + S.view) || T.map.get("v:now");
    return { cur: base, path: pathTo(base), filtered: true };
  }
  function mSide(el) {
    const st = sideApply(); if (st === "none" || st === "off") { if (el.firstChild) el.innerHTML = ""; return; }
    const T = S.side || sideTree(), loc = sideLoc(T), side = sideAt(), ed = !!S.sideEdit;
    // the place you went to unfolds the folders it's in, once per arrival, so you can still fold them after
    if (!ed && S.sideShown !== loc.cur.id) { S.sideShown = loc.cur.id; S.sideReveal = true; loc.path.slice(0, -1).forEach((n) => { if (n.kids && !sideOpenQ(n)) sideP.open[n.id] = true; }); sideSave(); }
    const lead = (n) => (n.course ? `<span class="sd-dot" style="${kc(n.course)}"></span>` : ic(n.icon || "folder"));
    const hd = `<span class="sd-hd" title="Drag to move">${ic("grip")}</span>`;
    const eye = (attr, off, what) => `<button class="sd-tg" data-act="sdHide" ${attr} tabindex="-1" aria-pressed="${off}" title="${off ? "Show" : "Hide"} ${esc(what)}" aria-label="${off ? "Show" : "Hide"} ${esc(what)}">${ic(off ? "eyeoff" : "eye")}</button>`;
    // what shows under a node: everything not hidden; while you edit, the parts you can arrange (no files)
    const under = (n, lvl) => (n.kids || []).filter((k) => (ed ? lvl === 1 && !!(k.view || k.drag || k.id === "c:none") : !k.off));
    let gi = 0;
    const node = (n, lvl) => {
      const kids = under(n, lvl), has = kids.length > 0, open = (has && (ed || sideOpenQ(n))) || (ed && n.views), gid = open ? "sdg" + ++gi : "";
      const aria = `role="treeitem" aria-level="${lvl}"${has || (ed && n.views) ? ` aria-expanded="${open}"` : ""}${gid ? ` aria-owns="${gid}"` : ""} tabindex="-1" data-node="${esc(n.id)}"`;
      const on = !ed && n === loc.cur, tail = n.due != null ? `<span class="sd-d${!n.done && n.due < S.now ? " late" : ""}">${esc(dueShort(n.due))}</span>` : n.n ? `<span class="sd-n">${n.n}</span>` : "";
      let r;
      if (n.sec && ed) r = `<div class="sd-row sd-sec ed" ${aria}>${hd}<input class="sd-name" value="${esc(n.label)}" maxlength="40" spellcheck="false" autocomplete="off" tabindex="-1" aria-label="Section name" data-sec="${esc(n.sec)}">`
        + eye(`data-sec="${esc(n.sec)}"`, n.off, "this section")
        + (n.views ? `<button class="sd-tg" data-act="sdDelSec" data-sec="${esc(n.sec)}" tabindex="-1" title="Delete this group (its views move to the one above)" aria-label="Delete this group">${ic("trash")}</button>` : "") + `</div>`;
      else if (n.sec) r = `<div class="sd-row sd-sec" ${aria}${has ? ` data-act="sdFold"` : ""}><span class="sd-tw">${has ? ic("tw") : ""}</span><span class="sd-l">${esc(n.label)}</span>${n.add ? `<button class="sd-add" data-act="noteNew" tabindex="-1" title="New note (W)" aria-label="New note">${ic("plus")}</button>` : ""}</div>`;
      else if (ed) r = `<div class="sd-row ed" ${aria} style="--lvl:${lvl - 2}" title="${esc(n.label)}">${n.drag ? hd : `<span class="sd-tw"></span>`}${lead(n)}<span class="sd-l">${esc(n.label)}</span>${n.view ? eye(`data-v="${n.view}"`, n.off, n.label) : ""}</div>`;
      else r = `<div class="sd-row${on ? " on" : ""}${n.done ? " done" : ""}${n.more ? " more" : ""}" ${aria} aria-selected="${on}" style="--lvl:${lvl - 2}" data-act="sdGo"${n.view && n.k ? ` data-hint="${n.k}"` : ""}${n.item ? ` data-id="${esc(n.item)}"` : ""} title="${esc(n.title ? n.label + " · " + n.title : n.label)}">`
        + `<span class="sd-tw"${has ? ` data-act="sdFold" data-node="${esc(n.id)}"` : ""}>${has ? ic("tw") : ""}</span>${n.more ? "" : lead(n)}<span class="sd-l">${esc(n.label)}</span>${n.pin ? `<span class="sd-pin" title="Pinned">${ic("pin")}</span>` : ""}${tail}${n.view && n.k ? `<kbd>${n.k}</kbd>` : ""}</div>`;
      const drag = n.sec ? "sec" : n.drag;
      const wrap = `class="sd-it${n.sec ? " sd-secw" : ""}${ed && n.off ? " off" : ""}" role="none" data-node="${esc(n.id)}"${drag ? ` data-drag="${drag}"` : ""}${n.sec ? ` data-sec="${esc(n.sec)}"` : ""}${n.view ? ` data-v="${n.view}"` : ""}${n.drag === "class" ? ` data-course="${esc(n.course.id)}"` : ""}`;
      const grp = open ? `<div role="group" id="${gid}" class="sd-grp"${n.views ? ` data-sec="${esc(n.sec)}"` : ""}>${kids.map((k) => node(k, lvl + 1)).join("")}${ed && n.views ? `<div class="sd-drop" aria-hidden="true">Drag views here</div>` : ""}</div>` : "";
      return `<div ${wrap}>${r}${grp}</div>`;
    };
    // a section shows while it has something to show (Notes always, for its + key); every one shows while you edit
    const secs = T.tree.filter((n) => ed || (!n.off && (n.add || under(n, 1).length)));
    const key = (act, icon, label, k) => `<button class="btn ghost sm" data-act="${act}" title="${esc(label)}${k ? " (" + esc(k) + ")" : ""}" aria-label="${esc(label)}">${ic(icon)}</button>`;
    el.innerHTML = `<div class="panel sd">` + (ed
      ? `<div class="ph"><span class="pt">${ic("edit")}Edit the sidebar</span><span class="sp"></span><button class="btn sm" data-act="sideEdit" title="Done (Esc)">Done</button></div>`
        + `<div class="sd-tip">Drag ${ic("grip")} to move views, sections and classes, from one group to another too. Type over a section's name to rename it; the eye hides.</div>`
      : `<div class="ph"><span class="pt">${ic("folder")}Folders</span><span class="sp"></span>${key("sideEdit", "edit", "Edit the sidebar")}`
        + key("sideSwap", side === "left" ? "next" : "prev", side === "left" ? "Move the sidebar to the right" : "Move the sidebar to the left")
        + key("sideToggle", "side", st === "over" ? "Close the sidebar" : "Hide the sidebar", MOD + "+\\") + `</div>`)
      + `<div class="sd-tree" role="tree" aria-label="Folders">${secs.map((n) => node(n, 1)).join("")}</div>`
      + (ed
        ? `<div class="sd-edfoot"><button class="btn sm" data-act="sdNewSec">${ic("plus")}New group</button><span class="sp"></span><button class="btn ghost sm" data-act="sdReset" title="Put back the usual sections, order and names">Reset</button></div></div>`
        : `<div class="sd-foot">${key("feedsOpen", "week", "Calendars and sources")}${key("trash", "trash", "Trash")}<span class="sp"></span>${key("lab", "lab", "Appearance", MOD + "+.")}${key("help", "help", "Keyboard shortcuts", "?")}</div></div>`)
      + `<div class="sd-grip" role="separator" aria-orientation="vertical" aria-label="Sidebar width" tabindex="0" aria-valuemin="${SIDE_MIN}" aria-valuemax="${SIDE_MAX}" aria-valuenow="${sideW()}" title="Drag to resize · double-click for the usual width"></div>`;
    // one row takes Tab (the place you're in); the arrows move between the rest
    const rows = $$(".sd-tree .sd-row", el), on = $(".sd-tree .sd-row.on", el);
    const name = S.sideFocus && S.sideFocus.startsWith("name:") && $(`.sd-name[data-sec="${CSS.escape(S.sideFocus.slice(5))}"]`, el);
    const want = S.sideFocus === "@on" ? on : S.sideFocus && rows.find((r) => r.dataset.node === S.sideFocus);
    if (rows.length) (want || on || rows[0]).tabIndex = 0;
    if (name) { name.focus(); name.select(); } else if (want) want.focus({ preventScroll: true });
    S.sideFocus = null;
    if (on && S.sideReveal) { S.sideReveal = false; MO.after(() => on.isConnected && on.scrollIntoView({ block: "nearest" })); }
  }
  // the path bar, where the key row was: the sidebar's key while it's hidden, then the path, each step a way back up
  function mPath(el) {
    const T = S.side || sideTree(), loc = sideLoc(T), st = sideState();
    const step = (n, last) => last
      ? `<span class="pb-cur" aria-current="page">${n.course ? `<span class="sd-dot" style="${kc(n.course)}"></span>` : ic(n.icon || "folder")}${esc(n.label)}</span>`
      : n.to ? `<button class="pb-b" data-act="sdGo" data-node="${esc(n.id)}">${esc(n.label)}</button>` : `<span class="pb-s">${esc(n.label)}</span>`;
    const narrowed = loc.filtered && qn(S.q) !== qn(loc.cur.to.q);
    el.innerHTML = `<div class="pathbar">${st === "dock" ? "" : `<button class="btn sm sd-show" data-act="sideToggle" title="Show the sidebar (${MOD}+\\)" aria-label="Show the sidebar">${ic("side")}<span class="bl">Folders</span></button>`}`
      + `<nav class="pb-path" aria-label="You are here">${loc.path.map((n, i) => step(n, i === loc.path.length - 1)).join(`<span class="pb-sep" aria-hidden="true">›</span>`)}</nav>`
      + `${narrowed ? `<span class="pb-f">filtered</span><button class="btn ghost sm" data-act="sdGo" data-node="${esc(loc.cur.id)}" title="Show the whole folder again">Clear</button>` : ""}</div>`;
  }
  // open a place: a view, a folder (and unfold it), a file (its folder, then the item's details or the note)
  function sideGo(id) {
    const T = S.side || sideTree();
    let n = T.map.get(id); if (!n) return;
    const file = n.item || n.note ? n : null, more = !!n.more, loc = sideLoc(T), cur = loc.filtered ? null : loc.cur;
    if (more) n = n.up;
    else if (file) n = file.up && file.up.to ? file.up : null;
    const folder = !file && !more && !!(n.kids && n.kids.length);
    // the folder you're in: a click folds it (in the drawer, it shuts the drawer on it instead)
    if (folder && n === cur && sideOpenQ(n)) { if (S.sideOver) { S.sideOver = false; return renderAll(); } return sideFold(n.id); }
    if (folder) { sideP.open[n.id] = true; sideSave(); }
    if ($("#side").contains(document.activeElement)) S.sideFocus = (file || n).id;
    // the drawer stays open on a folder you unfolded, so you can go further in; anything else shuts it
    if (S.sideOver && !folder) S.sideOver = false;
    if (n && n.to) {
      const t = n.to, lens = S.lens;
      S.sideAt = n.id;
      if (t.view !== S.view || t.lens !== S.lens) { S.insp = false; S.cal.at = null; }
      S.view = t.view; S.q = t.q; S.lens = t.lens; S.sort = t.sort; S.skip = 0; S.animRows = true;
      if (file && file.item) { S.sel = file.item; S.insp = true; }
      CA.sound.click(); paint(lens);
    } else if (file && file.item) select(file.item, true);
    if (file && file.note) openNote(file.note);
  }
  // a class's name, clicked: its folder (from a note, its notes folder), or with the key row its open items
  function goClass(id, notes) {
    const c = cById(id); if (!c) return;
    const T = S.side, n = T && T.map.get((notes ? "nc:" : "c:") + c.id);
    // already there: a second click would fold the folder, so it stays put
    if (n) { const loc = sideLoc(T); if (loc.cur !== n || loc.filtered) sideGo(n.id); return; }
    setQ((notes ? "is:open kind:note course:" : "is:open course:") + c.tag.toLowerCase());
  }
  function sideFold(id) {
    const T = S.side || sideTree(), n = T.map.get(id); if (!n || !n.kids) return;
    sideP.open[id] = !sideOpenQ(n); sideSave();
    if ($("#side").contains(document.activeElement)) S.sideFocus = id;
    mSide($("#side"));
  }
  // show or hide it (a drawer on a narrow screen); showing it puts the keyboard in it, on the place you're in
  function sideToggle(show) {
    if (navMode() !== "side") return setNavMode("side");
    if ($("#screen").clientWidth < SIDE_DOCK) S.sideOver = show != null ? show : !S.sideOver;
    else { sideP.hidden = show != null ? !show : !sideP.hidden; sideSave(); }
    const st = sideState(), shown = st === "dock" || st === "over";
    if (shown) { S.sideFocus = "@on"; S.sideReveal = true; } else S.sideEdit = false;
    CA.sound.click(); renderAll();
    if (!shown) { const b = $("#nav .sd-show"); if (b) b.focus({ preventScroll: true }); }
  }
  function sideSwap() {
    if (!CA.lab) return;
    CA.lab.set({ side: sideAt() === "left" ? "right" : "left" }, { light: true });
    renderAll(); toast(`Sidebar on the ${sideAt()}`);
  }
  function setNavMode(m) {
    if (!CA.lab) return;
    CA.lab.set({ nav: m }, { light: true });
    if (m === "side") { sideP.hidden = false; sideSave(); } else S.sideEdit = false;
    renderAll(); toast(m === "side" ? "Folders are in the sidebar" : `The view keys are back along the top · ${esc(MOD)}+K, “Use the sidebar” brings it back`);
  }
  // Editing: the sidebar shows its shape (sections, views, classes) to drag, rename, hide, add to and delete from.
  // Turning it on shows the sidebar first (from the key row too).
  function sideEdit(on) {
    const want = on != null ? !!on : !S.sideEdit, inside = $("#side").contains(document.activeElement);
    if (want) {
      if (navMode() !== "side" && CA.lab) CA.lab.set({ nav: "side" }, { light: true });
      if ($("#screen").clientWidth < SIDE_DOCK) S.sideOver = true; else if (sideP.hidden) { sideP.hidden = false; sideSave(); }
    }
    S.sideEdit = want; S.sideFocus = want ? null : inside ? "@on" : null;
    CA.sound.click(); renderAll();
    if (want) { const t = $("#side .sd-tree"), r = $("#side .sd-tree .sd-row"); if (t) t.scrollTop = 0; if (r) { r.tabIndex = 0; r.focus({ preventScroll: true }); } }
  }
  function sdHide(el) {
    const L = sideLayout(), sec = el.dataset.sec, v = el.dataset.v;
    if (sec) { const s = L.secs.find((x) => x.id === sec); if (!s) return; if (s.hide) delete s.hide; else s.hide = true; }
    else if (v) L.off = L.off.includes(v) ? L.off.filter((x) => x !== v) : L.off.concat(v);
    S.sideFocus = sec ? "s:" + sec : "v:" + v;
    CA.sound.tick(); sideSaveLayout(L);
  }
  // delete a group of views; its views go to the group above it (or the first, if it was the first)
  function sdDelSec(el) {
    const L = sideLayout(), i = L.secs.findIndex((x) => x.id === el.dataset.sec), s = L.secs[i];
    if (!s || !s.views) return;
    const to = L.secs.slice(0, i).reverse().find((x) => x.views) || L.secs.slice(i + 1).find((x) => x.views);
    if (!to) { CA.sound.nope(); return toast("Keep one group for your views"); }
    to.views.push(...s.views); L.secs.splice(i, 1);
    sideSaveLayout(L, s.views.length ? `Deleted “${s.label}” · its views moved to ${to.label}` : `Deleted “${s.label}”`, CA.ui.sideLayout);
  }
  // a new group goes after the last group of views, its name ready to type over
  function sdNewSec() {
    const L = sideLayout(), id = "g" + Date.now().toString(36), at = L.secs.map((s) => !!s.views).lastIndexOf(true);
    L.secs.splice(at + 1, 0, { id, label: "New group", views: [] });
    S.sideFocus = "name:" + id; CA.sound.tick(); sideSaveLayout(L);
  }
  function sdReset() {
    const was = CA.ui.sideLayout;
    if (!was) return toast("The sidebar already has its usual layout");
    sideSaveLayout(null, "The sidebar is back to its usual layout", was);
  }
  // Alt+Shift+↑ ↓ moves a view, a section or a class one place (a view at a group's edge goes into the next group)
  function sideMove(kind, id, d) {
    const L = sideLayout(), ed = !!S.sideEdit, nope = () => CA.sound.nope();
    if (kind === "view") {
      const list = [];
      L.secs.forEach((s) => s.views && (ed || !s.hide) && s.views.forEach((v) => (ed || !L.off.includes(v)) && list.push([v, s])));
      const i = list.findIndex((x) => x[0] === id), j = i + d; if (i < 0 || j < 0 || j >= list.length) return nope();
      const from = list[i][1], [nb, to] = list[j];
      from.views.splice(from.views.indexOf(id), 1);
      const at = to.views.indexOf(nb);
      to.views.splice(from === to ? (d > 0 ? at + 1 : at) : d > 0 ? at : at + 1, 0, id);
    } else if (kind === "sec") {
      const vis = L.secs.filter((s) => ed || !s.hide), i = vis.findIndex((s) => s.id === id), j = i + d;
      if (i < 0 || j < 0 || j >= vis.length) return nope();
      const a = L.secs.indexOf(vis[i]), b = L.secs.indexOf(vis[j]); [L.secs[a], L.secs[b]] = [L.secs[b], L.secs[a]];
    } else {
      const ids = classOrder(L).map((c) => c.id), i = ids.indexOf(id), j = i + d;
      if (i < 0 || j < 0 || j >= ids.length) return nope();
      [ids[i], ids[j]] = [ids[j], ids[i]]; L.classes = ids.concat(L.classes.filter((c) => !ids.includes(c)));
    }
    const nid = (kind === "view" ? "v:" : kind === "sec" ? "s:" : "c:") + id;
    if ($("#side").contains(document.activeElement)) S.sideFocus = nid;
    CA.sound.tick(); sideSaveLayout(L);
    MO.after(() => { const r = $(`#side .sd-it[data-node="${CSS.escape(nid)}"] > .sd-row`); if (r) { MO.ack(r); r.scrollIntoView({ block: "nearest" }); } });
  }
  // where a dragged part landed (by its neighbours in the sidebar), into your arrangement
  function sidePlace(kind, el) {
    const L = sideLayout(), sib = (dir) => { let x = el; while ((x = x[dir]) && x.dataset.drag !== kind); return x; };
    const prev = sib("previousElementSibling"), next = sib("nextElementSibling");
    if (kind === "view") {
      const v = el.dataset.v, to = L.secs.find((x) => x.id === el.parentElement.dataset.sec); if (!to) return renderAll();
      L.secs.forEach((x) => { if (x.views) x.views = x.views.filter((y) => y !== v); });
      const at = prev ? to.views.indexOf(prev.dataset.v) + 1 : next ? to.views.indexOf(next.dataset.v) : to.views.length;
      to.views.splice(Math.max(0, at), 0, v);
    } else if (kind === "sec") {
      const me = L.secs.find((x) => x.id === el.dataset.sec); if (!me) return renderAll();
      L.secs = L.secs.filter((x) => x !== me);
      const at = prev ? L.secs.findIndex((x) => x.id === prev.dataset.sec) + 1 : next ? L.secs.findIndex((x) => x.id === next.dataset.sec) : L.secs.length;
      L.secs.splice(Math.max(0, at), 0, me);
    } else {
      // the classes as they now stand, then the ones the sidebar isn't showing
      const ids = $$(':scope > .sd-it[data-drag="class"]', el.parentElement).map((x) => x.dataset.course);
      L.classes = ids.concat(L.classes.filter((c) => !ids.includes(c)));
    }
    CA.sound.tick(); sideSaveLayout(L);
  }
  // The tree's keys (the WAI-ARIA tree pattern): ↑ ↓ move, → unfolds or steps in, ← folds or steps out, Home and End,
  // Enter or Space opens, Esc goes back to the page (or shuts the drawer). Letters stay the app's shortcuts. While you
  // edit, Enter renames a section, Space hides or shows the row, and Esc is done.
  function sideKey(e) {
    const k = e.key;
    if (e.target.matches && e.target.matches(".sd-grip")) {
      const d = (k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0) * (sideAt() === "left" ? 1 : -1);
      if (d || k === "Home" || k === "End") { e.preventDefault(); e.stopPropagation(); sideP.w = k === "Home" ? SIDE_MIN : k === "End" ? SIDE_MAX : sideW() + d * 16; sideSave(); sideApply(); e.target.setAttribute("aria-valuenow", sideW()); }
      else if (k === "Enter") { e.preventDefault(); e.stopPropagation(); sideToggle(false); }
      return;
    }
    // a section's name: Enter keeps it (the change event saves it), Esc puts the old one back
    if (e.target.matches && e.target.matches(".sd-name")) {
      if (k !== "Enter" && k !== "Escape") return;
      e.preventDefault(); e.stopPropagation();
      if (k === "Escape") e.target.value = e.target.defaultValue;
      e.target.closest(".sd-row").focus();
      return;
    }
    const row = e.target.closest && e.target.closest(".sd-tree .sd-row"); if (!row || e.ctrlKey || e.metaKey || e.altKey) return;
    const rows = $$(".sd-tree .sd-row", $("#side")), i = rows.indexOf(row), exp = row.getAttribute("aria-expanded"), ed = !!S.sideEdit;
    const to = (r) => { if (!r) return; rows.forEach((x) => (x.tabIndex = -1)); r.tabIndex = 0; r.focus(); };
    const parent = () => { const g = row.parentElement.closest('[role="group"]'); return g && g.previousElementSibling; };
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === "ArrowDown") { stop(); to(rows[i + 1]); }
    else if (k === "ArrowUp") { stop(); to(rows[i - 1]); }
    else if (k === "Home") { stop(); to(rows[0]); }
    else if (k === "End") { stop(); to(rows[rows.length - 1]); }
    else if (k === "ArrowRight") { stop(); if (!ed && exp === "false") sideFold(row.dataset.node); else if (exp === "true") to(rows[i + 1]); }
    else if (k === "ArrowLeft") { stop(); if (!ed && exp === "true") sideFold(row.dataset.node); else to(parent()); }
    else if (ed && (k === "Enter" || k === " ")) {
      stop(); const name = $(".sd-name", row), tg = $('.sd-tg[data-act="sdHide"]', row);
      if (k === "Enter" && name) { name.focus(); name.select(); } else if (tg) sdHide(tg); else CA.sound.nope();
    }
    else if (k === "Enter" || k === " ") { stop(); if (row.classList.contains("sd-sec")) sideFold(row.dataset.node); else sideGo(row.dataset.node); }
    else if (k === "Escape") { stop(); if (ed) sideEdit(false); else if (S.sideOver) sideToggle(false); else row.blur(); }
  }
  // the edge drags the width (well past the narrowest, it hides); a double-click puts back the usual width
  function bindSide() {
    let g = null;
    const c = () => $("#content");
    document.addEventListener("pointerdown", (e) => {
      const grip = e.target.closest && e.target.closest(".sd-grip"); if (!grip || e.button !== 0) return;
      e.preventDefault(); const r = $("#side").getBoundingClientRect(), left = sideAt() === "left";
      // the width follows the pointer from where it took hold, a few pixels out in the gap
      g = { id: e.pointerId, edge: left ? r.left : r.right, w: r.width, d: (left ? e.clientX - r.left : r.right - e.clientX) - r.width, shut: false };
      try { grip.setPointerCapture(e.pointerId); } catch (x) { /* already gone */ }
      c().classList.add("sd-sizing");
    });
    document.addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id) return;
      const raw = (sideAt() === "left" ? e.clientX - g.edge : g.edge - e.clientX) - g.d;
      g.shut = raw < SIDE_MIN - 60; g.w = Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.round(raw)));
      c().style.setProperty("--side-w", g.w + "px"); c().classList.toggle("sd-shut", g.shut);
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const t = g; g = null; c().classList.remove("sd-sizing", "sd-shut");
      if (t.shut && e.type === "pointerup") { sideP.hidden = true; S.sideEdit = false; sideSave(); renderAll(); return toast(`Sidebar hidden · ${esc(MOD)}+\\ brings it back`); }
      sideP.w = t.w; sideSave(); sideApply(); const gr = $("#side .sd-grip"); if (gr) gr.setAttribute("aria-valuenow", sideW());
    };
    document.addEventListener("pointerup", end); document.addEventListener("pointercancel", end);
    document.addEventListener("dblclick", (e) => { if (e.target.closest && e.target.closest(".sd-grip")) { sideP.w = 0; sideSave(); sideApply(); } });
    $("#side").addEventListener("keydown", sideKey);
    // a renamed section keeps its new name without a redraw: the field you typed in stays where it is
    $("#side").addEventListener("change", (e) => {
      const inp = e.target.closest && e.target.closest(".sd-name"); if (!inp) return;
      const L = sideLayout(), s = L.secs.find((x) => x.id === inp.dataset.sec), v = inp.value.replace(/\s+/g, " ").trim().slice(0, 40);
      if (!s) return;
      if (!v || v === s.label) { inp.value = s.label; return; }
      s.label = v; inp.value = inp.defaultValue = v; sideStore(L);
    });
    // a screen that grows or shrinks past the docking width (the window, the Appearance drawer) docks or undocks it
    if (window.ResizeObserver) new ResizeObserver(() => { if (sideState() !== $("#content").dataset.sd) { S.sideOver = false; renderAll(); } }).observe($("#screen"));
    bindSideSort();
  }
  // Drag a part of the sidebar to put it somewhere else: a view (into any open group of views), a section, or a class
  // (Personal stays last). A mouse lifts it once it moves; touch lifts it with a long-press, or at once from an edit
  // handle. The others slide aside, and Esc puts it back. Alt+Shift+↑ ↓ does the same from the keyboard (sideMove).
  function bindSideSort() {
    let s = null;
    const tree = () => $("#side .sd-tree");
    const peers = (box) => $$(`:scope > .sd-it[data-drag="${s.kind}"]`, box).filter((x) => x !== s.it);
    const top = (x) => x.firstElementChild.getBoundingClientRect();
    function lift() {
      if (!s || s.on) return;
      const t = tree(); if (!t) { s = null; return; }
      s.on = true; S.sorting = true; t.dataset.kind = s.kind; t.classList.add("sorting"); s.it.classList.add("lift");
      CA.sound.tick(); if (navigator.vibrate) navigator.vibrate(8);
      follow(s.y);
    }
    // the lifted part under the pointer, in the group it's over (views) or among its own; it trades places with a
    // neighbour once the pointer passes that one's middle
    function follow(y) {
      const t = tree(), a = t.getBoundingClientRect();
      if (y < a.top + 24) t.scrollTop -= 8; else if (y > a.bottom - 24) t.scrollTop += 8;
      let box = s.it.parentElement;
      if (s.kind === "view") {
        const boxes = $$(".sd-grp[data-sec]", t), dist = (b) => { const r = b.getBoundingClientRect(); return y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; };
        box = boxes.reduce((best, b) => (dist(b) < dist(best) ? b : best), boxes[0] || box);
      }
      const others = peers(box), mid = (x) => { const r = top(x); return r.top + r.height / 2; };
      const end = s.kind === "class" ? $(':scope > .sd-it[data-node="c:none"]', box) : s.kind === "view" ? $(":scope > .sd-drop", box) : null;
      const before = others.find((x) => y < mid(x)) || end;
      if (s.it.parentElement !== box || s.it.nextElementSibling !== before) {
        const rows = $$(".sd-row", t).filter((r) => !s.it.contains(r)), was = new Map(rows.map((r) => [r, r.getBoundingClientRect().top]));
        box.insertBefore(s.it, before);
        if (motion()) rows.forEach((r) => { const d = was.get(r) - r.getBoundingClientRect().top; if (d) r.animate([{ translate: `0 ${d}px` }, { translate: "0 0" }], { duration: 160 * CA.motion.level + 1, easing: "cubic-bezier(.2, .9, .3, 1)" }); });
      }
      s.it.style.translate = "";
      s.it.style.translate = `0 ${Math.round(y - s.g - top(s.it).top)}px`;
    }
    function finish(keep) {
      const t = s; s = null; S.sorting = false; clearTimeout(t.t);
      if (!t.on) return;
      const tr = tree(); if (tr) { tr.classList.remove("sorting"); delete tr.dataset.kind; }
      t.it.classList.remove("lift"); t.it.style.translate = "";
      const moved = t.it.parentElement !== t.box || t.it.nextElementSibling !== t.next;
      if (moved || t.far) S.noClickUntil = Date.now() + 250; // the click that ends a drag isn't a press
      if (!moved) return; // back where it was: a slow or shaky click is still a click
      if (!keep) return renderAll();
      if ($("#side").contains(document.activeElement)) S.sideFocus = t.it.dataset.node;
      sidePlace(t.kind, t.it);
    }
    document.addEventListener("pointerdown", (e) => {
      if (s || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      const row = e.target.closest && e.target.closest("#side .sd-tree .sd-row"), it = row && row.parentElement;
      if (!it || !it.dataset.drag || e.target.closest(".sd-tw[data-act], .sd-tg, .sd-add, .sd-name")) return;
      const mouse = e.pointerType === "mouse";
      s = { it, kind: it.dataset.drag, pid: e.pointerId, x: e.clientX, y: e.clientY, g: e.clientY - row.getBoundingClientRect().top, box: it.parentElement, next: it.nextElementSibling, on: false, far: false, mouse };
      // a finger on an edit handle lifts at once; elsewhere it's a long-press, so a swipe still scrolls the tree
      if (!mouse && e.target.closest(".sd-hd")) { e.preventDefault(); lift(); } else if (!mouse) s.t = setTimeout(lift, 420);
    });
    document.addEventListener("pointermove", (e) => {
      if (!s || e.pointerId !== s.pid) return;
      const d = Math.hypot(e.clientX - s.x, e.clientY - s.y);
      if (!s.on) { if (d <= 6) return; if (s.mouse) lift(); else { clearTimeout(s.t); s = null; return; } }
      e.preventDefault(); s.far = s.far || d > 12;
      follow(e.clientY);
    });
    document.addEventListener("pointerup", (e) => { if (s && e.pointerId === s.pid) finish(true); });
    document.addEventListener("pointercancel", (e) => { if (s && e.pointerId === s.pid) finish(false); });
    // a lifted part keeps the finger: the tree doesn't scroll under it
    document.addEventListener("touchmove", (e) => { if (s && s.on) e.preventDefault(); }, { passive: false });
    document.addEventListener("keydown", (e) => { if (s && s.on && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } }, true);
  }
  function mNav(el) {
    if (navMode() === "side") return mPath(el);
    const v0 = viewById(S.view), custom = S.q !== v0.q;
    const count = (v) => S.items.filter((it) => E.matchItem(it, E.parseFilter(v.q), ctx())).length;
    let out = `<div class="mnav h"><div class="nkeys" role="tablist" aria-label="Views">`;
    tabs().forEach((v) => {
      const n = ["now", "today", "inbox", "exams"].includes(v.id) ? count(v) : "", on = S.view === v.id;
      out += `<button class="nv${on ? " on" : ""}${on && custom ? " mod" : ""}" role="tab" aria-selected="${on}" data-act="go" data-v="${v.id}" data-hint="${v.k}" title="${esc(v.label)} · key ${v.k}">${ic(v.id)}<span class="lb">${esc(v.short || v.label)}</span>${n !== "" ? `<span class="ct" data-n="ct:${v.id}">${n}</span>` : ""}<kbd>${v.k}</kbd></button>`;
    });
    el.innerHTML = out + `</div><div class="nfoot"><button class="nv" data-act="lab" title="Appearance (${MOD}+.)" aria-label="Appearance">${ic("lab")}<span class="lb">Appearance</span><kbd>${MOD} .</kbd></button><button class="nv" data-act="help" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">${ic("help")}<span class="lb">Shortcuts</span><kbd>?</kbd></button></div></div>`;
  }
  function mNow(el, r) {
    const head = (cnt, more) => `<div class="panel hero" data-win="now"><div class="ph"><span class="pt">${ic("now")}Do first</span><span class="sp"></span>${more ? `<button class="btn ghost sm" data-act="back" data-hint="⇧N" title="Show the previous candidate">${ic("prev")}<span class="bl">Back</span><kbd>${MAC ? "⇧" : "Shift"} N</kbd></button>` : ""}<span class="cnt" data-n="now:n">${cnt}</span>${more ? `<button class="btn ghost sm" data-act="skip" data-hint="n" title="Show the next candidate"><span class="bl">Next</span>${ic("next")}<kbd>N</kbd></button>` : ""}</div><div class="pb">`;
    if (!r.length) { el.innerHTML = head("All clear") + `<div class="hero-empty" data-k="hero:none"><h2 class="hero-t">Nothing to do first.</h2><p>Everything open is scheduled or snoozed.</p><button class="btn primary" data-act="quick">${ic("plus")}Add something<kbd>Q</kbd></button></div></div></div>`; return; }
    const idx = S.skip % r.length, { it, sc } = r[idx], c = courseOf(it), overdue = it.due != null && it.due < S.now;
    const urg = Math.round(Math.min(1, sc.urgency) * 100), pulse = ui().guide === "g4" ? " pulse" : "";
    const disp = it.due == null ? `<div class="display"><span class="d-lbl">Due</span><span class="d-num">--:--</span><span class="d-sub">No due date</span></div>`
      : `<div class="display${overdue ? " bad" : sc.urgency > 0.7 ? " hot" : ""}"><span class="d-lbl">${overdue ? "Overdue by" : "Due in"}</span><span class="d-num num" data-cd data-f="${overdue ? "since" : "clock"}" data-t="${it.due}"></span><span class="d-sub">${esc(mDue(it.due))}${it.est ? ` · ~${E.fmtDur(it.est * MIN)} of work` : ""}</span><span class="d-bar" title="Urgency ${urg}%"><i style="width:${urg}%"></i></span></div>`;
    el.innerHTML = head(`${idx + 1} of ${r.length}`, r.length > 1) + `<div class="hero-grid" data-k="hero:${it.id}"><div class="hero-main">
        <div class="meta-row">${cchip(c)}<span>${iLabel(it)}</span>${it.src !== "manual" ? `<span class="srcl">from ${esc(srcName(it.src))}</span>` : ""}${it.pri ? `<span class="prio p${it.pri}">${ic("flag")}${PRI[it.pri]}</span>` : ""}</div>
        <h2 class="hero-t" data-act="sel" data-id="${it.id}" title="Details"><span class="tt">${esc(it.title)}</span></h2>
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
    if (live) { const c = courseOf(live); h += `<div class="live" data-act="sel" data-id="${live.id}" data-k="live:${live.id}"><span class="ldot"></span><span class="lt">Now: <b>${c ? clink(c, esc(c.code)) + " " : ""}${esc(live.title)}</b></span><span class="sp"></span><span class="num">ends in <b data-cd data-f="clock" data-t="${live.end}"></b></span></div>`; }
    if (next) {
      const c = courseOf(next);
      h += `<div class="next" data-k="next:${next.id}"><div class="nx-head"><div class="nx-id"><div class="meta-row">${cchip(c)}<span>${iLabel(next)}</span></div><div class="nx-t">${esc(next.title)}</div>
        <div class="facts"><span>${ic("clock")}${esc(mDue(next.due))}${next.end ? " – " + esc(mTime(next.end)) : ""}</span></div></div>
        <div class="display"><span class="d-lbl">Starts in</span><span class="d-num num" data-cd data-f="clock" data-t="${next.due}"></span></div></div>
        ${locBanner(next, tripTo(next))}
        <div class="actions sm">${(next.links || []).slice(0, 3).map((l) => `<button class="btn" data-act="open" data-url="${esc(l[1])}">${esc(l[0])}${ic("ext")}</button>`).join("")}<button class="btn ghost" data-act="sel" data-id="${next.id}">Details</button></div></div>`;
    } else h += `<div class="m-empty" data-k="next:none">${ic("today", "big")}<b>Nothing scheduled</b><span>in the next few days.</span></div>`;
    const t0 = E.startOfDay(S.now) + 7 * HR, t1 = E.startOfDay(S.now) + 24 * HR, pos = (t) => Math.max(0, Math.min(100, ((t - t0) / (t1 - t0)) * 100));
    const today = list.concat(S.items.filter((it) => E.SCHEDULED(it.kind) && it.end && it.end <= S.now && it.due >= t0 && E.matchItem(it, [], ctx()))).filter((it) => it.due < t1 && (it.end || it.due + HR) > t0);
    h += `<div class="timeline" title="Today, 7 AM to midnight">${today.map((it) => `<span class="blk ${it.kind === "class" ? "" : "ev"}" style="left:${pos(it.due)}%;width:${Math.max(0.8, pos(it.end || it.due + HR) - pos(it.due))}%" title="${esc(it.title)}"></span>`).join("")}<span class="nowln" style="left:${pos(S.now)}%"></span></div><div class="tl-scale"><span>7a</span><span>11a</span><span>3p</span><span>7p</span><span>11p</span></div>`;
    const rest = list.filter((it) => it !== next && it !== live).slice(0, 6);
    if (rest.length) h += `<div class="sub-h">Coming up</div><div class="agenda">${rest.map((it) => { const c = courseOf(it), pl = place(it.location); return `<div class="ag" data-act="sel" data-id="${it.id}" style="${kc(c)}"><span class="ag-when"><b>${esc(mDay(it.due).split(",")[0])}</b>${esc(mTime(it.due))}</span><span class="ag-bar"></span><span class="ag-main"><span class="ag-t">${esc(it.title)}</span><span class="ag-s">${c ? clink(c, esc(c.code)) + (isSection(it) ? " · Section" : "") : iLabel(it)}${pl ? `<span class="ag-loc">${ic("pin")}${esc(placeShort(pl))}</span>` : ""}</span></span></div>`; }).join("")}</div>`;
    el.innerHTML = h + `</div></div>`;
  }
  function mFbar() {
    const terms = E.parseFilter(S.q), raws = terms.map((t) => t.raw);
    // the Notes lens has its own: classes, the tags notes use, the archive
    const ntags = () => { const n = new Map(); S.items.forEach((it) => isNote(it) && !it.deleted && it.tags.forEach((g) => { const k = g.toLowerCase(); n.set(k, (n.get(k) || 0) + 1); })); return [...n].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([g]) => ["#" + g, "#" + g]); };
    const quick = S.lens === "notes" ? [...S.courses.filter((c) => c.included).map((c) => [`course:${c.tag.toLowerCase()}`, c.code, c]), ...ntags(), ["is:done", "Archived"]] : [...S.courses.filter((c) => c.included).map((c) => [`course:${c.tag.toLowerCase()}`, c.code, c]),
      ["kind:work", "Assignments"], ["kind:exam", "Exams"], ["kind:lecture", "Lectures"], ["kind:section", "Sections"],
      ["due<=today", "Due today"], ["due:week", "This week"], ["is:overdue", "Overdue"], ["!2", "High priority"], ["src:canvas", "From Canvas"], ["src:gradescope", "From Gradescope"], ["src:webwork", "From WeBWorK"], ["src:manual", "Added by me"], ["status:doing", "In progress"]];
    return `<div class="fbar m"><div class="fbox">${ic("filter")}${terms.map((t, i) => `<button class="chip on${t.valid === false ? " bad" : ""}" data-act="rmTerm" data-i="${i}" title="${t.valid === false ? "Not a filter this app knows, so it's ignored. Click to remove it." : "Remove this filter"}">${esc(t.raw)}<span class="x">×</span></button>`).join("")}<input id="fq" class="finput" placeholder="${terms.length ? "Add a filter…" : "Filter, e.g. course:130a  due<fri  #exam  !2"}" autocomplete="off" spellcheck="false" aria-label="Filter"></div><button class="btn ghost" data-act="clearQ" data-hint="esc">Clear<kbd>Esc</kbd></button></div>
      <div class="qstrip">${quick.map(([raw, label, c]) => `<button class="chip ${c ? "course" : ""} ${raws.includes(raw) ? "on" : ""}" data-act="toggleTerm" data-t="${esc(raw)}" style="${kc(c)}">${esc(label)}</button>`).join("")}</div>`;
  }
  function mRowHTML(it, i) {
    const c = courseOf(it), sched = E.SCHEDULED(it.kind), open = E.isOpen(it, S.now), st = dueState(it);
    const cls = ["row", "mrow"]; if (S.sel === it.id) cls.push("sel"); if (it.status === "done") cls.push("done"); if (it.status === "doing") cls.push("doing");
    if (sched) cls.push("cls"); if (st.c === "live") cls.push("live"); if (open && !sched && st.c === "over") cls.push("overdue"); if (S.flashId === it.id) cls.push("new");
    const chk = sched ? `<span class="chk sched" title="Scheduled">${ic(it.kind === "ticket" ? "ticket" : "clock")}</span>`
      : isNote(it) ? `<span class="chk sched" title="Note">${ic("notes")}</span>`
      : `<button class="chk" data-act="toggle" data-id="${it.id}" title="${it.status === "done" ? "Mark as not done" : "Mark done (X)"}" aria-label="Toggle done">${ic("check")}</button>`;
    const meta = [c ? clink(c, `<span class="cdot" style="${kc(c)}"></span>${esc(c.code)}`) : it.tags[0] ? "#" + esc(it.tags[0]) : "Personal", iLabel(it)];
    if (it.est && !sched) meta.push("~" + E.fmtDur(it.est * MIN));
    if (isNote(it)) { const ck = NT().checklist(it.notes); if (ck.total) meta.push(ck.done + "/" + ck.total + " done"); }
    if (sched && it.location) meta.push(`<span class="m-loc">${ic("pin")}${esc(placeShort(place(it.location)))}</span>`);
    if (it.src !== "manual") meta.push(esc(srcName(it.src)));
    const sortRow = unsorted(it) ? `<span class="m-sort" role="group" aria-label="What is it?"><span>Is it</span>${sortKinds(it).map(([k, l]) => `<button class="chip" data-act="sortAs" data-id="${it.id}" data-v="${k}">${l}</button>`).join("")}</span>` : "";
    return `<div class="${cls.join(" ")}" data-act="sel" data-id="${it.id}" data-k="${it.id}" style="--i:${i};${kc(c)}">${chk}
      <span class="m-main"><span class="m-t">${it.status === "doing" ? '<span class="doing-tag">In progress</span>' : ""}<span class="tt">${esc(it.title)}</span></span><span class="m-meta">${meta.map((m) => `<span>${m}</span>`).join("")}</span>${sortRow}</span>
      <span class="m-pri p${it.pri}" title="${PRI[it.pri]}">${it.pri ? "!".repeat(it.pri) : ""}</span>
      <span class="m-due">${isNote(it) && it.due == null ? `<span class="duepill">Edited</span><span class="m-abs">${esc(agoText(it.updated))}</span>` : `<span class="duepill ${st.c}">${esc(st.t)}</span>${it.due != null ? `<span class="m-abs">${esc(st.c === "live" ? "until " + mTime(it.end) : mDue(it.due))}</span>` : ""}`}</span></div>`;
  }
  function mCoach() { return ui().guide === "g4" ? `<span class="coach" id="coach">Tip: ${TIPS[S.coachI % TIPS.length]}</span>` : ui().guide === "g2" ? `<span class="coach">Hold <b>${ALT}</b> to show every shortcut</span>` : ""; }
  function mBottom(el) {
    const key = (cls, act, hint, icon, label, k, extra) => `<button class="btn ${cls}" data-act="${act}" data-hint="${hint}" ${extra || ""}>${ic(icon)}<span class="kl">${label}</span><kbd>${k}</kbd></button>`;
    el.innerHTML = `<div class="deck" role="toolbar" aria-label="Actions">${key("primary", "quick", "q", "plus", "Add", "Q")}${key("dark", "focusTop", "f", "focus", "Focus 25", "F")}${key("", "tdone", "x", "check", "Done", "X", 'title="Done: the selected item, or Do first"')}${key("", "tsnooze", "s", "clock", "Snooze", "S")}${key("k-next", "skip", "n", "next", "Next", "N")}${key("", "palette", "k", "search", "Search", MOD + " K")}<span class="deck-sp"></span><span class="speaker" aria-hidden="true"></span></div>${mCoach()}`;
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
    const g = new Map(list.map((it) => [it.id, E.BUCKETS.indexOf(E.bucket(it, S.now))]));
    return list.sort((a, b) => g.get(a.id) - g.get(b.id) || cmpDue(a, b));
  }
  function hiddenCount() {
    const ex = S.courses.filter((c) => !c.included).map((c) => c.id);
    return { n: S.items.filter((it) => ex.includes(it.course) && E.isOpen(it, S.now)).length, m: ex.length };
  }

  /* ─────────── navigation + filters ─────────── */
  // Switching lens (list, week, classes, links, notes) changes the channel: the list retunes, coming in soft and grey
  // under fine static and settling as its colour locks, with the channel on the set's OSD (fx.js; Standard crossfades
  // the whole screen). A channel is a lens, so every list tab (Do first, Today … Done) is the one Tasks channel, CH 1,
  // and the rest follow in tab order: Calendar, Classes, Links, Notes. Within a lens the rows deal in.
  const CHANNELS = [...new Set(VIEWS.map((v) => v.lens))];
  const channelName = (lens) => (lens === "list" ? "Tasks" : VIEWS.find((v) => v.lens === lens).label);
  const paint = (lens) => {
    if (lens === S.lens) return renderAll();
    if (!CA.fx.channel(CHANNELS.indexOf(S.lens) + 1, channelName(S.lens), $("#list"))) return MO.swap("lens", renderAll);
    renderAll();
  };
  function go(id) {
    const v = viewById(id), lens = S.lens;
    if (v.id !== S.view) { S.insp = false; S.cal.at = null; } // the details belong to the tab they were opened on; Calendar opens on today
    S.sideAt = null; S.view = v.id; S.q = v.q; S.lens = v.lens; S.sort = v.sort; S.skip = 0; S.animRows = true;
    CA.sound.click(); paint(lens);
  }
  function setQ(q, keepFocus, from) {
    const lens = from || S.lens;
    S.q = q.replace(/\s+/g, " ").trim(); S.animRows = true;
    if (S.lens !== "list" && S.lens !== "week" && S.lens !== "notes") { S.lens = "list"; S.sort = "due"; }
    if (keepFocus) S.refocus = "fq";
    paint(lens);
  }
  function toggleTerm(raw) {
    const terms = E.parseFilter(S.q).map((t) => t.raw);
    const i = terms.indexOf(raw);
    // a kind chip swaps the kind (Assignments → Sections keeps the rest of the filter) instead of narrowing to nothing
    if (i >= 0) terms.splice(i, 1); else terms.splice(0, terms.length, ...terms.filter((t) => !(/^kind:/.test(raw) && /^kind:/.test(t))), raw);
    CA.sound.click(); setQ(terms.join(" "));
  }
  function clearQ() { const lens = S.lens; S.view = "all"; S.sort = "due"; S.lens = "list"; toast("Filters cleared · showing everything open"); setQ("is:open", false, lens); }

  // Back and forward (the mouse's side buttons, Alt+← →, ⌘[ ⌘] on a Mac, a keyboard's Browser keys) walk the places
  // visited: the tab, its filter, the calendar page and the item whose details are open. renderAll records each new
  // place, so every way of getting somewhere counts; opening another item's details replaces the last place instead
  // of piling up steps. Back first closes what floats over the screen (radial, dialog, Appearance), like Esc.
  const H = { list: [], i: -1 };
  const here = () => ({ view: S.view, q: S.q, lens: S.lens, sort: S.sort, cal: S.cal.mode, at: S.cal.at, sel: S.insp ? S.sel : null });
  const pkey = (p) => JSON.stringify(p);
  const fit = (p) => (p.sel && !find(p.sel) ? Object.assign({}, p, { sel: null }) : p); // a deleted item's details stay closed
  function record() {
    const p = here(), cur = H.list[H.i];
    if (cur && pkey(cur) === pkey(p)) return;
    if (cur && cur.sel && p.sel && pkey(Object.assign({}, cur, { sel: p.sel })) === pkey(p)) { H.list[H.i] = p; return; }
    H.list.splice(H.i + 1, H.list.length, p);
    if (H.list.length > 100) H.list.shift();
    H.i = H.list.length - 1;
  }
  function walk(d) {
    hideTips();
    if (d < 0) {
      if (closeRadial()) return;
      if (CA.lab.isOpen()) return CA.lab.close();
      if (S.overlay === "focus" || S.overlay === "takeover") return onEsc({ target: document.body });
      if (S.overlay) return closeOv();
    } else if (S.overlay || CA.lab.isOpen()) return;
    const now = pkey(here());
    let j = H.i + d;
    while (H.list[j] && pkey(fit(H.list[j])) === now) j += d;
    if (!H.list[j]) return;
    const p = (H.list[j] = fit(H.list[j])), lens = S.lens;
    H.i = j;
    S.view = p.view; S.q = p.q; S.lens = p.lens; S.sort = p.sort; S.cal.mode = p.cal; S.cal.at = p.at;
    S.insp = !!p.sel; if (p.sel) S.sel = p.sel;
    S.skip = 0; S.animRows = true;
    CA.sound.click(); paint(lens);
  }

  /* ─────────── render: list + lenses ─────────── */
  function listLens() {
    const list = listItems(); S.listIds = list.map((x) => x.id);
    let h = "", i = 0, last = null;
    const counts = {}; if (S.sort === "due") list.forEach((it) => { const b = E.bucket(it, S.now); counts[b] = (counts[b] || 0) + 1; });
    for (const it of list) {
      if (S.sort === "due") { const b = E.bucket(it, S.now); if (b !== last) { h += `<div class="grp" data-k="g:${b}" style="--i:${i++}">${b}<span>${counts[b]}</span></div>`; last = b; } }
      h += mRowHTML(it, i++);
    }
    if (!list.length) h = `<div class="m-empty">${ic("done", "big")}<b>Nothing here.</b><span>No items match <code>${esc(S.q || "(no filter)")}</code>.</span><span class="actions sm"><button class="btn" data-act="clearQ">Clear filter<kbd>Esc</kbd></button><button class="btn primary" data-act="quick">${ic("plus")}Add<kbd>Q</kbd></button></span></div>`;
    const hc = hiddenCount();
    if (hc.n) h += `<div class="hidden-note" data-k="hidden">${hc.n} open items hidden from ${hc.m} excluded Canvas courses · <button class="chip" data-act="go" data-v="classes">manage</button></div>`;
    const un = ["work", "exams", "all"].includes(S.view) ? S.items.filter((it) => unsorted(it) && E.matchItem(it, [], ctx())).length : 0;
    if (un) h += `<div class="hidden-note" data-k="unsorted">${un} Canvas ${un === 1 ? "item waits" : "items wait"} in the Inbox for you to say what ${un === 1 ? "it is" : "they are"}: homework, an exam or just info · <button class="chip" data-act="go" data-v="inbox">sort</button></div>`;
    return { h, n: list.length };
  }
  // Calendar: Day is one day hour by hour (dayLens), Week seven days from today (or the day you paged to), Month the whole
  // month on a Sunday-first grid. All show the list's items, so the filter bar narrows them; [ and ] page, and a day's
  // number in Month or its header in Week opens that day.
  function calBar() {
    const at = S.cal.at != null ? S.cal.at : E.startOfDay(S.now), d = new Date(at), month = S.cal.mode === "month", dayM = S.cal.mode === "day";
    const e = new Date(E.addDays(at, 6));
    const label = month ? `${MNL[d.getMonth()]} ${d.getFullYear()}` : dayM ? `${DNM[d.getDay()]} ${MNM[d.getMonth()]} ${d.getDate()}` : `${MNM[d.getMonth()]} ${d.getDate()} – ${e.getMonth() !== d.getMonth() ? MNM[e.getMonth()] + " " : ""}${e.getDate()}`;
    const seg = [["day", "Day"], ["week", "Week"], ["month", "Month"]].map(([v, l]) => `<button class="chip ${S.cal.mode === v ? "on" : ""}" data-act="calMode" data-v="${v}" aria-pressed="${S.cal.mode === v}">${l}</button>`).join("");
    const pg = (dir, sym, k) => `<button class="btn sm" data-act="calStep" data-d="${dir}" data-hint="${k}" aria-label="${dir < 0 ? "Previous" : "Next"} ${month ? "month" : dayM ? "day" : "week"}">${sym}<kbd>${k}</kbd></button>`;
    return `<div class="calbar"><span class="seg">${seg}</span><span class="cal-pg">${pg(-1, "‹", "[")}<span class="cal-t" data-n="cal:t" data-fx="print">${label}</span>${pg(1, "›", "]")}</span>${S.cal.at != null ? `<button class="btn ghost sm" data-act="calToday">Today</button>` : ""}</div>`;
  }
  function calStep(dir) {
    const at = S.cal.at != null ? S.cal.at : E.startOfDay(S.now), d = new Date(at);
    S.cal.at = S.cal.mode === "month" ? new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime() : E.addDays(at, (S.cal.mode === "day" ? 1 : 7) * dir);
    S.animRows = true; CA.sound.click(); renderAll();
  }
  const dayItems = (list, day) => list.filter((it) => it.due != null && it.due >= day && it.due < E.addDays(day, 1));
  function weekLens() {
    const list = listItems(); S.listIds = list.map((x) => x.id);
    if (S.cal.mode === "month") return monthLens(list);
    if (S.cal.mode === "day") return dayLens(list);
    const start = S.cal.at != null ? S.cal.at : E.startOfDay(S.now), today = E.startOfDay(S.now);
    let h = calBar() + `<div class="week">`;
    for (let d = 0; d < 7; d++) {
      const day = E.addDays(start, d), dt = new Date(day);
      const its = dayItems(list, day);
      h += `<div class="wcol ${day === today ? "today" : ""}" style="--i:${d}"><div class="wh" data-act="calDay" data-t="${day}" title="Open this day hour by hour"><b>${day === today ? "Today" : DNM[dt.getDay()]}</b><span>${MNM[dt.getMonth()]} ${dt.getDate()}</span></div>${its.map((it) => {
        const c = courseOf(it), pl = E.SCHEDULED(it.kind) && place(it.location);
        return `<div class="wi ${E.SCHEDULED(it.kind) ? "cls" : ""} ${it.kind === "exam" ? "exam" : ""}" data-act="sel" data-id="${it.id}" data-k="w:${it.id}" style="${kc(c)}" title="${esc(it.title)}"><span class="wt">${esc(mTime(it.due))}${c ? " · " + clink(c, esc(c.tag)) : ""}</span><span class="wn">${esc(it.title)}</span>${pl ? `<span class="wl">${ic("pin")}${esc(placeShort(pl))}</span>` : ""}</div>`;
      }).join("") || '<div class="wnone">Free</div>'}</div>`;
    }
    return { h: h + `</div>`, n: list.length };
  }
  // Day: one day hour by hour, like a phone's calendar. Classes, events, exams and when-free plans are blocks at their
  // times (side by side where they overlap); deadlines are flags at theirs, with the work left and when to start; the now
  // line crosses today with the time to whatever's next. A click on an empty hour starts quick add at that hour.
  const blockEnd = (it) => (it.end && it.end > it.due ? it.end : E.SCHEDULED(it.kind) || it.kind === "exam" ? it.due + Math.max(15, it.est || 60) * MIN : null);
  function dayParts(list, day) {
    const end = E.addDays(day, 1), blocks = [], flags = [];
    list.forEach((it) => {
      if (it.due == null || isNote(it)) return;
      const e = blockEnd(it);
      if (e != null) { if (it.due < end && e > day) blocks.push({ it, s: it.due, e }); }
      else if (it.due >= day && it.due < end) flags.push(it);
    });
    blocks.sort((a, b) => a.s - b.s || b.e - a.e);
    // overlapping blocks share the width: a lane each within a cluster that overlaps
    let cl = [], cEnd = -Infinity;
    const close = () => { const n = cl.reduce((m, b) => Math.max(m, b.lane + 1), 1); cl.forEach((b) => (b.lanes = n)); cl = []; };
    blocks.forEach((b) => {
      if (cl.length && b.s >= cEnd) { close(); cEnd = -Infinity; }
      const used = cl.filter((x) => x.e > b.s).map((x) => x.lane);
      let l = 0; while (used.includes(l)) l++;
      b.lane = l; cl.push(b); cEnd = Math.max(cEnd, b.e);
    });
    if (cl.length) close();
    flags.sort((a, b) => a.due - b.due);
    return { blocks, flags };
  }
  const hrs = (t, day) => ((t - day) / HR).toFixed(3);
  const hourLabel = (h) => (h === 0 ? "12 AM" : h === 12 ? "Noon" : (h % 12) + (h < 12 ? " AM" : " PM"));
  // "in 1h 20m" before, "ends in 25m" during, "ended 2h ago" after (updateCountdowns keeps them current)
  function relWhen(s, e) { const n = S.now; return s > n ? "in " + E.fmtDur(s - n) : e && e > n ? "ends in " + E.fmtDur(e - n) : (e ? "ended " : "") + E.fmtDur(n - (e || s)) + " ago"; }
  function dayLens(list) {
    const day = S.cal.at != null ? E.startOfDay(S.cal.at) : E.startOfDay(S.now), today = E.startOfDay(S.now), isToday = day === today, now = S.now;
    const { blocks, flags } = dayParts(list, day), dt = new Date(day);
    const nextB = blocks.find((b) => b.s > now), cur = blocks.filter((b) => b.s <= now && b.e > now), nextF = flags.find((it) => it.due > now);
    const next = [nextB && { it: nextB.it, t: nextB.s }, nextF && { it: nextF, t: nextF.due }].filter(Boolean).sort((a, b) => a.t - b.t)[0];
    // the head: the day, what's on, and an LCD counting down to the next thing
    const away = Math.round((day - today) / DAY), when = isToday ? "Today" : away === 1 ? "Tomorrow" : away === -1 ? "Yesterday" : away > 0 ? `In ${away} days` : `${-away} days ago`;
    const lcd = isToday && cur[0] ? `<div class="display dv-lcd"><span class="d-lbl">Ends in</span><span class="d-num num" data-cd data-f="clock" data-t="${cur[0].e}"></span><span class="d-sub">${esc(cur[0].it.title)}</span></div>`
      : next && next.t - now < DAY ? `<div class="display dv-lcd${next.t - now < 30 * MIN ? " hot" : ""}"><span class="d-lbl">${blockEnd(next.it) ? "Starts in" : "Due in"}</span><span class="d-num num" data-cd data-f="clock" data-t="${next.t}"></span><span class="d-sub">${esc(next.it.title)}</span></div>` : "";
    const busyMin = blocks.reduce((m, b) => m + (Math.min(b.e, E.addDays(day, 1)) - Math.max(b.s, day)) / MIN, 0);
    const head = `<div class="dv-head"><div class="dv-day"><b>${when}</b><span>${DNL[dt.getDay()]}, ${MNL[dt.getMonth()]} ${dt.getDate()}</span>
      <span class="dim">${blocks.length ? `${blocks.length} on the calendar · ${E.fmtDur(busyMin * MIN)} booked` : "Nothing booked"}${flags.length ? ` · ${flags.length} due` : ""}</span></div>${lcd}</div>`;
    // the grid: 24 rows, each a button that adds at that hour
    const word = isToday ? "today" : away === 1 ? "tmr" : `${dt.getMonth() + 1}/${dt.getDate()}`;
    let g = "";
    for (let h = 0; h < 24; h++) g += `<button class="dv-hr${isToday && h === new Date(now).getHours() ? " cur" : ""}" style="--t:${h}" data-act="dvAdd" data-v="${word} ${h % 12 || 12}${h < 12 ? "am" : "pm"}" aria-label="Add something at ${hourLabel(h)}" title="Add at ${hourLabel(h)}"><span>${hourLabel(h)}</span></button>`;
    const ev = blocks.map((b, i) => {
      const it = b.it, c = courseOf(it), s = Math.max(b.s, day), e = Math.min(b.e, E.addDays(day, 1)), past = b.e <= now, live = b.s <= now && b.e > now;
      const pl = it.location && place(it.location);
      const cls = ["dv-ev", E.SCHEDULED(it.kind) ? "cls" : "plan", it.kind === "exam" ? "exam" : "", past ? "past" : "", live ? "live" : "", S.sel === it.id ? "sel" : ""].filter(Boolean).join(" ");
      // the lines' layout follows the block's height (pocket.css .dv-eb)
      return `<div class="${cls}" data-act="sel" data-id="${it.id}" data-k="dv:${it.id}" style="--t:${hrs(s, day)};--d:${((e - s) / HR).toFixed(3)};--lane:${b.lane};--lanes:${b.lanes};--i:${i};${kc(c)}" title="${esc(mTime(b.s) + "–" + mTime(b.e) + " · " + it.title)}"><div class="dv-eb">
        <span class="dv-et">${esc(mTime(b.s))}–${esc(mTime(b.e))}${c ? " · " + clink(c, esc(c.tag)) : ""}</span><span class="dv-en">${esc(it.title)}</span>
        ${pl ? `<span class="dv-el">${ic("pin")}${esc(placeShort(pl))}</span>` : ""}${isToday && !past ? `<span class="dv-rel" data-rel data-t="${b.s}" data-e="${b.e}">${esc(relWhen(b.s, b.e))}</span>` : ""}</div></div>`;
    }).join("");
    // deadlines at the same minute share one flag
    const groups = []; flags.forEach((it) => { const g0 = groups[groups.length - 1]; if (g0 && Math.abs(g0.t - it.due) < 10 * MIN) g0.its.push(it); else groups.push({ t: it.due, its: [it] }); });
    const fl = groups.map((gr) => `<div class="dv-flag${gr.t <= now ? " past" : ""}${(gr.t - day) / HR > 22.5 ? " up" : ""}${gr.its.some((x) => E.isOverdue && E.isOverdue(x, now)) ? " late" : ""}" style="--t:${hrs(gr.t, day)}">${gr.its.map((it) => {
      const c = courseOf(it), start = it.est ? it.due - it.est * MIN : null;
      return `<button class="dv-fi${S.sel === it.id ? " sel" : ""}" data-act="sel" data-id="${it.id}" data-k="dvf:${it.id}" style="${kc(c)}"><b>${esc(mTime(it.due))}</b> due · ${esc(it.title)}${c ? ` <span class="dim">${esc(c.tag)}</span>` : ""}${it.due > now ? ` · <span data-rel data-t="${it.due}">${esc(relWhen(it.due))}</span>` : ""}${start && it.due > now ? ` <span class="dim">· ~${E.fmtDur(it.est * MIN)} of work, start by ${esc(mTime(start))}</span>` : ""}</button>`;
    }).join("")}</div>`).join("");
    // now: the line, and the stretch of time before the next thing
    let nowL = "";
    if (isToday) {
      const gapTo = nextB && !cur.length ? nextB : null;
      nowL = `<div class="dv-past" style="--t:${hrs(now, day)}"></div><div class="dv-now" data-d="${day}" style="--t:${hrs(now, day)}"><span class="dv-nt">${esc(mTime(now))}</span></div>`;
      if (gapTo) nowL += `<div class="dv-gap" data-d="${day}" data-e="${gapTo.s}" style="--t:${hrs(now, day)};--d:${((gapTo.s - now) / HR).toFixed(3)}"><span><b data-dur data-t="${gapTo.s}">${esc(E.fmtDur(gapTo.s - now))}</b> free until ${esc(gapTo.it.title)}</span></div>`;
    }
    const empty = !blocks.length && !flags.length ? `<div class="dv-empty dim">A clear day. Click an hour to add something, or type <code>whenfree</code> in quick add to drop a task into the first open slot.</div>` : "";
    return { h: calBar() + head + empty + `<div class="dayv" style="--hrs:24"><div class="dv-grid">${g}<div class="dv-col">${ev}${fl}</div>${nowL}</div></div>`, n: list.length };
  }
  // the day opens scrolled to now (today), or its first thing, or 8 AM; once per day shown, so a re-render keeps your place
  function dayScroll() {
    const v = $("#list .dayv"), pb = $("#list .pb"); if (!v || !pb) return;
    const key = [S.cal.at, S.view, S.q].join("|"); if (S.cal.scrolled === key) return; S.cal.scrolled = key;
    const day = S.cal.at != null ? E.startOfDay(S.cal.at) : E.startOfDay(S.now), first = $("#list .dv-ev:not(.past), #list .dv-flag:not(.past)");
    const t = day === E.startOfDay(S.now) ? (S.now - day) / HR - 1.5 : first ? +getComputedStyle(first).getPropertyValue("--t") - 1 : 8;
    const hh = $("#list .dv-hr"), y = hh ? hh.offsetHeight * Math.max(0, t) : 0;
    pb.scrollTop = Math.max(0, v.offsetTop + y - 8);
  }
  // A month cell lists exams, then other deadlines, then class meetings, three at most; the rest is "+n more" (opens
  // that week). Narrow, the cells show course dots instead.
  function monthLens(list) {
    const at = new Date(S.cal.at != null ? S.cal.at : S.now), y = at.getFullYear(), mo = at.getMonth();
    const first = new Date(y, mo, 1).getTime(), lead = new Date(first).getDay(), start = E.addDays(first, -lead), today = E.startOfDay(S.now);
    const weeks = Math.ceil((lead + new Date(y, mo + 1, 0).getDate()) / 7), rank = (it) => (it.kind === "exam" ? 0 : E.SCHEDULED(it.kind) ? 2 : 1);
    const hm = (t) => { const d = new Date(t), h = d.getHours(), m = d.getMinutes(); return (h % 12 || 12) + (m ? ":" + String(m).padStart(2, "0") : "") + (h >= 12 ? "p" : "a"); };
    let h = calBar() + `<div class="month">${DNM.map((n) => `<div class="mhd">${n}</div>`).join("")}`;
    for (let i = 0; i < weeks * 7; i++) {
      const day = E.addDays(start, i), dt = new Date(day), its = dayItems(list, day).sort((a, b) => rank(a) - rank(b) || a.due - b.due), fit = its.length > 3 ? 2 : 3;
      const cls = ["mday"]; if (dt.getMonth() !== mo) cls.push("out"); if (day === today) cls.push("today"); else if (day < today) cls.push("past");
      h += `<div class="${cls.join(" ")}" style="--i:${i}"><button class="md-n" data-act="calDay" data-t="${day}" title="Open ${MNM[dt.getMonth()]} ${dt.getDate()} hour by hour">${dt.getDate()}</button>${its.slice(0, fit).map((it) => {
        const c = courseOf(it);
        return `<div class="mi ${E.SCHEDULED(it.kind) ? "cls" : ""} ${it.kind === "exam" ? "exam" : ""}" data-act="sel" data-id="${it.id}" data-k="m:${it.id}" style="${kc(c)}" title="${esc(mTime(it.due) + " · " + it.title)}"><span class="mt">${hm(it.due)}</span><span class="mn">${esc(it.title)}</span></div>`;
      }).join("")}${its.length > fit ? `<button class="mmore" data-act="calDay" data-t="${day}">+${its.length - fit} more</button>` : ""}${its.length ? `<span class="mdots" aria-hidden="true">${its.slice(0, 4).map((it) => `<i style="${kc(courseOf(it))}"></i>`).join("")}</span>` : ""}</div>`;
    }
    return { h: h + `</div>`, n: list.length };
  }
  function coursesLens() {
    const card = (c, i) => {
      const open = S.items.filter((it) => it.course === c.id && E.isOpen(it, S.now) && E.ACTIONABLE(it.kind));
      const wkEnd = E.addDays(E.startOfDay(S.now), 7), dueWk = open.filter((it) => it.due != null && it.due < wkEnd).length;
      const nx = S.items.filter((it) => it.course === c.id && it.kind === "class" && it.due > S.now).sort(cmpDue)[0];
      const ex = open.filter((it) => it.kind === "exam").sort(cmpDue)[0];
      const meet = c.meet.map((m) => `${m.sec ? "Section " : ""}${m.days} ${m.h}:${String(m.m).padStart(2, "0")} ${m.loc}`).join(" · ") || "no meetings synced";
      return `<div class="ccard ${c.included ? "" : "excluded"}" data-k="c:${c.id}" style="--i:${i};${kc(c)}"><h4>${c.included ? clink(c, esc(c.code)) : esc(c.code)} <span class="dim">${c.tag}</span></h4><div class="meta">${esc(c.title)}</div><div class="meta">${esc(meet)}</div>
        ${c.included ? `<div class="meta">Next: ${nx ? mDue(nx.due) + " · " + E.fmtRel(nx.due, S.now) : "—"}</div><div class="meta">${open.length} open · ${dueWk} due this week${ex ? " · " + esc(ex.title) + " " + mDay(ex.due) : ""}</div>` : `<div class="meta">Excluded · items hidden everywhere</div>`}
        <div class="row2">${c.links.map((l) => `<button class="btn" data-act="open" data-url="${esc(l[1])}">${esc(l[0])}</button>`).join("")}</div>
        <div class="row2">${c.included ? `<button class="btn primary" data-act="q" data-q="is:open course:${c.tag.toLowerCase()}">Items${ic("go")}</button>` : ""}<button class="btn" data-act="courseEdit" data-c="${c.id}">Edit</button><button class="btn" data-act="incl" data-c="${c.id}">${c.included ? "Exclude" : "Include"}</button><button class="btn" data-act="courseDel" data-c="${c.id}" title="Delete or merge ${esc(c.code)}">${ic("trash")}Delete</button></div></div>`;
    };
    let h = dupPairs().map(([a, b]) => { const k = keeperOf(a, b), x = k === a ? b : a;
      return `<div class="hidden-note" data-k="dup:${x.id}">${esc(x.code)} and ${esc(k.code)} look like the same class · <button class="chip" data-act="courseDel" data-c="${x.id}" data-v="${k.id}">merge into ${esc(k.code)}</button></div>`; }).join("");
    h += `<div class="cgrid">${S.courses.filter((c) => c.included).map(card).join("")}</div>`;
    h += `<div class="row2 cadd"><button class="btn" data-act="courseNew">${ic("plus")}Add a course</button>${S.courses.length ? "" : `<span class="dim">Canvas, Gradescope and WeBWorK add theirs; add any other class here.</span>`}</div>`;
    h += `<div class="sect">Excluded from Canvas sync (${S.courses.filter((c) => !c.included).length})</div><div class="cgrid">${S.courses.filter((c) => !c.included).map(card).join("")}</div>`;
    const hid = S.calendarSeries.filter((s) => s.hidden);
    h += `<div class="sect">Google Calendar · lectures, sections and the rest</div><div class="calmap">${S.calendarSeries.filter((s) => S.showHidden || !s.hidden).map(seriesRow).join("")}</div>`;
    if (hid.length) h += `<div class="hidden-note">${hid.length} hidden · <button class="chip" data-act="serShowHidden">${S.showHidden ? "hide them again" : "show"}</button></div>`;
    if (LIVE && !S.calendarSeries.length) h += `<div class="calmap"><span class="dim">Connect Google Calendar below to pick which series are classes.</span></div>`;
    h += `<div class="sect">Sources</div><div class="calmap">${LIVE ? liveSources() : CLOUD ? '<span class="dim">The desktop app reads your sources; what it finds syncs here.</span><span></span>' : SOURCES.map(([id, name, how, ago]) => `<span>${esc(name)} <span class="dim">${esc(how)}</span></span><button class="chip ${ago === "off" ? "" : "on"}" data-act="source" data-s="${id}">${ago === "off" ? "Connect" : ago === "live" ? "Live" : "Synced " + ago + " ago"}</button>`).join("")}</div>`;
    return { h, n: S.courses.length };
  }
  // One Google series in the picker: its times, its role and, once it's a class, its course. Lectures and sections
  // are both classes of the course (alerts, countdown, course card); sections are labelled as such.
  function seriesRow(s) {
    if (s.hidden) return `<span data-ser="${esc(s.id)}" class="dim">${esc(s.name)} <span class="dim">${esc(s.rule)}</span></span><span class="cal-pick" data-ser="${esc(s.id)}"><button class="chip" data-act="serHide" data-s="${esc(s.id)}">Unhide</button></span>`;
    const role = !s.isClass ? "skip" : s.isSection ? "section" : "lecture";
    const seg = [["lecture", "Lecture"], ["section", "Section"], ["skip", "Not a class"]].map(([v, l]) =>
      `<button class="chip ${role === v ? "on" : ""}" data-act="calmap" data-s="${esc(s.id)}" data-v="${v}" aria-pressed="${role === v}">${l}</button>`).join("");
    const opts = S.courses.filter((c) => c.included || c.id === s.course).map((c) => `<option value="${c.id}" ${c.id === s.course ? "selected" : ""}>${esc(c.code)}</option>`).join("");
    const sel = s.isClass ? `<select class="cal-course" data-s="${esc(s.id)}" aria-label="Course of ${esc(s.name)}">${s.course ? "" : '<option value="" selected>Pick its course…</option>'}${opts}</select>` : "";
    return `<span data-ser="${esc(s.id)}" title="Right-click for more">${esc(s.name)} <span class="dim">${esc(s.rule)}</span></span><span class="cal-pick" data-ser="${esc(s.id)}"><span class="seg">${seg}</span>${sel}</span>`;
  }
  // Hide takes a series out of the list and out of your classes (its meetings go); Unhide brings the row back.
  function serHide(id) {
    const s = S.calendarSeries.find((x) => x.id === id); if (!s) return;
    s.hidden = !s.hidden; if (s.hidden) s.isClass = false;
    saveClassPicks(); S.fx = { flip: true };
    toast(s.hidden ? `Hidden · ${esc(s.name)} · its meetings are off your list` : `Back in the list · ${esc(s.name)} · pick Lecture or Section to make it a class again`, { ms: 6000 });
    CA.sound.click(); renderAll();
  }
  function saveClassPicks() {
    if (!LIVE) return;
    const cs = S.calendarSeries;
    CA.store.invoke("set_class_series", {
      uids: cs.filter((x) => x.isClass).map((x) => x.id), sections: cs.filter((x) => x.isClass && x.isSection).map((x) => x.id),
      courses: Object.fromEntries(cs.filter((x) => x.courseSet && x.course).map((x) => [x.id, x.course])), hidden: cs.filter((x) => x.hidden).map((x) => x.id),
    }).catch((e) => toast("Classes not updated · " + esc(String(e))));
  }
  // Sources as they really stand: the two calendar feeds can be connected now; the rest arrive in M2/M3 (docs/SPEC.md).
  function liveSources() {
    const st = S.settings || {}, fd = S.feeds || {};
    const feed = (id, name, how, url) => {
      const log = fd[id] || {}, on = !!url;
      const label = !on ? "Connect" : !log.checked_at ? "Connected" : log.ok ? "Checked " + agoText(Date.parse(log.checked_at)) : "Problem · fix";
      return `<span>${esc(name)} <span class="dim">${esc(on ? hostOf(url).split("/")[0] : how)}</span></span><button class="chip ${on && log.ok !== false ? "on" : ""}" data-act="source" data-s="${id}">${label}</button>`;
    };
    const gs = fd.gradescope || {}, gsOn = !!st.gradescope, gsCourses = (fd.gradescope_courses || []).map((c) => c.short_name).join(", ");
    const gsLabel = !gsOn ? "Connect" : !gs.checked_at ? "Connected" : gs.ok ? "Checked " + agoText(Date.parse(gs.checked_at)) : "Problem · fix";
    const ww = fd.webwork || {}, wwCourses = (st.webwork_courses || []).map((c) => c.code), wwOn = wwCourses.length > 0;
    const wwLabel = !wwOn ? "Connect" : !ww.checked_at ? "Connected" : ww.ok ? "Checked " + agoText(Date.parse(ww.checked_at)) : "Problem · fix";
    return feed("canvas", "Canvas", "calendar feed link", st.canvas_feed_url) + feed("gcal", "Google Calendar", "secret iCal address", st.gcal_feed_url) +
      `<span>Gradescope <span class="dim">${esc(gsOn && gsCourses ? gsCourses : "sign in once in the app")}</span></span><button class="chip ${gsOn && gs.ok !== false ? "on" : ""}" data-act="source" data-s="gradescope">${gsLabel}</button>` +
      `<span>WeBWorK <span class="dim">${esc(wwOn ? wwCourses.join(", ") : "sign in to each course in the app")}</span></span><button class="chip ${wwOn && ww.ok !== false ? "on" : ""}" data-act="source" data-s="webwork">${wwLabel}</button>` +
      SOURCES.filter(([id]) => !["canvas", "gcal", "gradescope", "webwork"].includes(id)).map(([, name, how]) => `<span>${esc(name)} <span class="dim">${esc(how)}</span></span><button class="chip" data-act="source" data-s="later">Later</button>`).join("");
  }
  function agoText(t) { const m = Math.round((Date.now() - t) / MIN); return m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago"; }
  function linksLens() {
    const btn = (l) => `<button class="btn" data-act="open" data-url="${esc(l[1])}">${esc(l[0])}${ic("ext")}</button>`;
    let h = `<div class="sect" style="margin-top:0">UCSB</div><div class="lgroup"><div class="row2">${GLOBAL_LINKS.map(btn).join("")}</div></div><div class="sect">Classes</div><div class="lgrid">`;
    h += S.courses.filter((c) => c.included).map((c) => `<div class="lgroup" style="${kc(c)}"><h4>${clink(c, esc(c.code))}</h4><div class="row2">${c.links.map(btn).join("")}</div></div>`).join("");
    const withLinks = ranked().map((x) => x.it).filter((it) => it.links.length).slice(0, 8);
    h += `</div><div class="sect">From your open items</div><div class="lgrid">${withLinks.map((it) => { const c = courseOf(it); return `<div class="lgroup" style="${kc(c)}"><h4>${c ? clink(c, esc(c.tag)) + " · " : ""}${esc(it.title)}</h4><div class="row2">${it.links.map(btn).join("")}</div></div>`; }).join("")}</div>`;
    return { h, n: GLOBAL_LINKS.length };
  }
  function renderList() {
    const el = $("#list"), v = viewById(S.view);
    const out = ({ list: listLens, week: weekLens, courses: coursesLens, links: linksLens, notes: notesLens }[S.lens] || listLens)();
    const showBar = S.lens === "list" || S.lens === "week" || S.lens === "notes", by = { score: "ranked by do-first score", due: "by due date", updated: "recently changed" }[S.sort];
    el.innerHTML = `<div class="panel" data-win="list"><div class="ph"><span class="pt" data-n="list:t" data-fx="print">${ic(v.id)}${esc(viewTitle())}</span><span class="sp"></span><span class="cnt" data-n="list:n">${S.lens === "list" ? `${out.n} items<span class="cnt-x"> · ${by}</span>` : S.lens === "notes" ? `${out.n} notes<span class="cnt-x"> · pinned, then recently edited</span>` : ""}</span></div>
      ${showBar ? mFbar() : ""}<div class="pb rows ${S.animRows ? "anim" : ""}">${out.h}</div></div>`;
  }

  /* ─────────── render: inspector ─────────── */
  function renderInsp() {
    const el = $("#insp"), it = S.sel && find(S.sel);
    el.className = "region insp float";
    if (!(S.insp && it)) { MO.leave(el); el.hidden = true; el.innerHTML = ""; delete el.dataset.for; return; }
    const swap = !el.hidden && el.dataset.for && el.dataset.for !== it.id;
    el.hidden = false;
    const head = (t) => `<div class="panel" data-win="insp" role="dialog" aria-label="${t}"><div class="ph"><span class="pt">${t}</span><span class="sp"></span><button class="btn ghost sm" data-act="closeInsp" aria-label="Close details">${ic("close")}<span class="bl">Close</span><kbd>Esc</kbd></button></div><div class="pb">`;
    const c = courseOf(it), sched = E.SCHEDULED(it.kind);
    const pad = (n) => String(n).padStart(2, "0");
    const dl = (t) => { if (t == null) return ""; const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const seg = (field, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button class="chip ${String(cur) === String(v) ? "on" : ""}" data-act="setf" data-f="${field}" data-v="${v}">${l}</button>`).join("")}</div>`;
    const fl = LIVE && S.feeds && S.feeds[it.src], checked = fl && fl.checked_at ? Date.parse(fl.checked_at) : it.updated;
    const syncedAgo = Math.max(1, Math.round((S.now - checked) / MIN));
    el.innerHTML = head(sched ? iLabel(it) : "Inspect") + `
      <div class="f-title" contenteditable="true" spellcheck="false" data-field="title">${esc(it.title)}</div>
      <div class="fgrid">
        <label>Kind</label><select data-field="kind">${Object.keys(KIND).map((k) => `<option value="${k}" ${k === it.kind ? "selected" : ""}>${kLabel(k)}</option>`).join("")}</select>
        <label>Course</label><select data-field="course"><option value="">— personal —</option>${S.courses.filter((x) => x.included || x.id === it.course).map((x) => `<option value="${x.id}" ${x.id === it.course ? "selected" : ""}>${esc(x.code)}</option>`).join("")}</select>
        <label>${sched ? "Starts" : "Due"}</label><input type="datetime-local" data-field="due" value="${dl(it.due)}">
        ${sched ? "" : `<label>Estimate</label>${seg("est", [[15, "15m"], [30, "30m"], [60, "1h"], [120, "2h"], [240, "4h"]], it.est)}`}
        ${sched ? "" : `<label>Priority</label>${seg("pri", [[0, "–"], [1, "!"], [2, "!!"], [3, "!!!"]], it.pri)}`}
        ${sched ? "" : `<label>Status</label>${seg("status", [["inbox", "inbox"], ["todo", "todo"], ["doing", "doing"], ["done", "done"]], it.status)}`}
        <label>Alert</label>${seg("interrupt", [["none", "none"], ["nudge", "nudge"], ["alert", "alert"], ["takeover", "takeover"]], it.interrupt)}
      </div>
      ${it.location ? locBanner(it, sched && it.due > S.now ? tripTo(it) : null) : ""}
      <div class="links">${it.links.map((l, i) => `<span class="lk"><button class="btn" data-act="open" data-url="${esc(l[1])}" title="${esc(l[1])}">${esc(l[0])}${ic("ext")}</button><button class="btn ghost lk-x" data-act="linkDel" data-i="${i}" aria-label="Remove the ${esc(l[0])} link" title="Remove this link">${ic("close")}</button></span>`).join("")}${c && c.links[0] ? `<button class="btn ghost" data-act="open" data-url="${esc(c.links[0][1])}">${esc(c.tag)} ${esc(c.links[0][0])}${ic("ext")}</button>` : ""}</div>
      <label class="fbox lnk">${ic("links")}<input id="lnkIn" class="finput" placeholder="Paste a link · Enter adds it" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" aria-label="Add a link"></label>
      <textarea class="notes" data-field="notes" placeholder="Notes… (saved on blur)">${esc(it.notes)}</textarea>
      <div class="srcinfo">${it.src === "manual" ? "Added by you" : `Source: ${esc(srcName(it.src))} · ${LIVE ? "checked" : "synced"} ${syncedAgo}m ago · your edits are kept as overrides on re-sync`}</div>
      <div class="acts">${sched ? "" : `<button class="btn primary" data-act="focus" data-id="${it.id}" data-min="25">${ic("play")}Focus 25</button><button class="btn" data-act="done" data-id="${it.id}">${ic("check")}${it.status === "done" ? "Undo done" : "Done"}</button><button class="btn" data-act="snooze" data-id="${it.id}">${ic("clock")}Snooze</button>`}<button class="btn ghost" data-act="del" data-id="${it.id}">${ic("trash")}Delete</button></div></div></div>`;
    el.dataset.for = it.id;
    if (swap) MO.ack(el.querySelector(".pb"), "swap");
  }

  /* ─────────── render: key deck ─────────── */
  function renderBottom() {
    const el = $("#bottom"), key = ui().guide;
    if (el.dataset.key === key && el.innerHTML) return;
    el.dataset.key = key; mBottom(el);
  }

  /* ─────────── island + shell mocks (desk preview) ─────────── */
  function presence() {
    const list = scheduleItems(), live = list.find((it) => it.kind === "class" && it.due <= S.now && it.end > S.now), next = list.find((it) => it.due > S.now && it.due - S.now < 12 * HR);
    if (S.focus) { const it = find(S.focus.id); return { label: "Focus · " + (it ? it.title : "session"), t: S.focus.end, p0: S.focus.start, p1: S.focus.end, short: "FOCUS" }; }
    if (S.brk) return { label: "Break", t: S.brk.end, p0: S.brk.start, p1: S.brk.end, short: "BREAK" };
    if (live) { const c = courseOf(live); return { label: "In class · " + (c ? c.tag : "") + " " + live.title, t: live.end, p0: live.due, p1: live.end, short: c ? c.tag : "CLASS" }; }
    if (next) { const c = courseOf(next); return { label: (c ? c.tag + " " : "") + next.title, t: next.due, p0: next.due - HR, p1: next.due, short: c ? c.tag : kShort(next.kind), it: next, trip: tripTo(next) }; }
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
        ${p.it ? `<div class="is-row"><span class="dim">Next</span><span class="t">${esc(p.it.location || "")}${p.trip ? " · leave by " + mTime(p.trip.leave) : ""}</span>${(p.it.links || []).slice(0, 1).map((l) => `<button class="btn" data-act="open" data-url="${esc(l[1])}">${esc(l[0])}</button>`).join("")}</div>` : ""}
        ${top ? `<div class="is-row"><span class="dim">Do first</span><span class="t">${esc(top.title)}</span><button class="btn" data-act="done" data-id="${top.id}" aria-label="Done">${ic("check")}</button><button class="btn" data-act="focus" data-id="${top.id}" data-min="25">${ic("play")}25</button></div>` : ""}
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
  // Every render replaces the markup, so motion.js carries the continuity. S.fx, set by the action that changed the
  // data, says what happened ({ flip, exit: { id: "done" | "swipe" | "snooze" | "del" | "out" }, skip }): list parts
  // that moved glide (FLIP), parts that left play their exit, and the Do first and Up next cards swap. A render for a
  // resize or a tick has no S.fx, so nothing moves; the cards still swap when their item changed.
  function renderAll() {
    S.now = Date.now();
    const fx = S.fx || {}; S.fx = null;
    const content = $("#content"); content.dataset.wide = S.lens === "list" ? "0" : "1";
    const view = [S.view, S.q, S.lens, S.sort].join("|"), same = view === S.shownView && !S.animRows;
    const listEl = $("#list"), lpb = $("#list .pb"), ltop = lpb ? lpb.scrollTop : 0, insp = $("#insp"), ipb = $("#insp .pb");
    const itop = ipb && !insp.hidden && insp.dataset.for === S.sel ? ipb.scrollTop : 0;
    const kept = fx.flip && same ? MO.keep(listEl) : null, hero = MO.keep($("#now")), next = MO.keep($("#sched")), texts = MO.texts(content);
    const sx = stripScroll();
    S.side = navMode() === "side" ? sideTree() : null;
    mTop($("#top")); mSide($("#side")); mNav($("#nav")); mNow($("#now"), ranked()); mSched($("#sched"), scheduleItems()); renderList(); renderInsp(); renderBottom(); renderIsland(); renderShell();
    updateCountdowns();
    // keep the list and the details where they were scrolled to (a different list starts at the top)
    if (same && ltop) { const n = $("#list .pb"); if (n) n.scrollTop = ltop; }
    if (itop) { const n = $("#insp .pb"); if (n) n.scrollTop = itop; }
    if (S.lens === "week" && S.cal.mode === "day") dayScroll();
    stripScroll(sx);
    const added = S.flashId && $(`#list .row[data-k="${S.flashId}"]`);
    if (added) added.scrollIntoView({ block: "nearest" });
    const exit = fx.exit || {}, hx = {};
    for (const id in exit) hx["hero:" + id] = exit[id] === "swipe" ? "done" : exit[id];
    if (fx.skip) hero.forEach((b, k) => { hx[k] = hx[k] || (fx.skip < 0 ? "back" : "skip"); });
    MO.settle(listEl, kept, { exit });
    MO.settle($("#now"), hero, { move: false, exit: hx, enter: fx.skip ? (fx.skip < 0 ? "l" : "r") : "up" });
    MO.settle($("#sched"), next, { move: false, enter: "up" });
    MO.counts(content, texts);
    // a done item that stays in this list (Exams shows done ones) gets its check stamped where it is
    for (const id in exit) {
      const row = exit[id] !== "out" && exit[id] !== "del" && listEl.querySelector(`.row.done[data-k="${id}"]`);
      if (row) { MO.ack(row.querySelector(".chk"), "stamp"); MO.ack(row.querySelector(".tt"), "strike"); }
    }
    S.animRows = false; S.flashId = null; S.shownView = view; record();
    if (S.refocus) { const f = document.getElementById(S.refocus); if (f) f.focus(); S.refocus = null; }
  }
  function updateCountdowns() {
    $$("[data-cd]").forEach((el) => {
      const s = el.dataset.f === "since" ? sinceText(S.now - +el.dataset.t) : cdText(+el.dataset.t - S.now);
      setDisp(el, s); el.classList.toggle("blink", s === "NOW"); // an LCD at zero blinks, like an alarm clock
    });
    $$("[data-clock]").forEach((el) => setDisp(el, clockStr()));
    // the Day view: times to things, and the now line, the past shade and the free stretch moving with the clock
    $$("[data-rel]").forEach((el) => setDisp(el, relWhen(+el.dataset.t, el.dataset.e ? +el.dataset.e : null)));
    $$("[data-dur]").forEach((el) => setDisp(el, E.fmtDur(Math.max(0, +el.dataset.t - S.now))));
    $$("#list :is(.dv-now, .dv-gap, .dv-past)").forEach((el) => {
      const d = +(el.dataset.d || $("#list .dv-now").dataset.d); el.style.setProperty("--t", hrs(S.now, d));
      if (el.dataset.e) el.style.setProperty("--d", (Math.max(0, +el.dataset.e - S.now) / HR).toFixed(3));
    });
    const nt = $("#list .dv-nt"); if (nt) setDisp(nt, mTime(S.now));
    updateRings();
  }

  /* ─────────── overlays ─────────── */
  function openOv(name, html, cls) {
    if (S.overlay === "note" && name !== "note") { noteCommit(); setTimeout(renderAll, 0); }
    const ov = $("#ov"), again = !ov.hidden && S.overlay === name;
    if (!ov.hidden && !again) MO.leave(ov); // one overlay replacing another: the old one fades under the new
    ov.className = "ov " + (cls || "") + (again ? " again" : ""); ov.innerHTML = html; ov.hidden = false; S.overlay = name;
  }
  function closeOv() {
    const note = S.overlay === "note"; if (note) noteCommit();
    const ov = $("#ov"); MO.leave(ov); ov.hidden = true; ov.innerHTML = ""; S.overlay = null;
    if (note) renderAll();
  }
  function dialog(title, hint, body, cls) { return `<div class="dialog panel ${cls || ""}" role="dialog" aria-label="${title}"><div class="ph"><span class="pt">${title}</span><span class="sp"></span><span class="cnt">${hint}</span><button class="btn ghost sm ov-x" data-act="closeOv" aria-label="Close">${ic("close")}</button></div><div class="pb">${body}</div></div>`; }

  // quick add
  const TPL = [["Homework", "hw  fri ~2h"], ["Lab", "lab  tmr ~3h"], ["Reading", "read ch  tmr ~45m"], ["Exam prep", "study for midterm ~2h #exam"], ["Email TA", "email TA about  !!"], ["Errand", "buy  "], ["Apply", "apply  #career"], ["Office hours", "oh  "]];
  // Capture modes: Item reads the quick-add grammar; Jot keeps what you type as a note (its first line the title); List
  // makes a checklist note, or one task per line. Tab switches mode and keeps the text.
  const QMODES = [["item", "Item", "plus"], ["jot", "Jot", "jot"], ["list", "List", "done"]];
  function openQuick(prefill, mode, keep) {
    mode = mode || "item"; S.qaMode = mode; S.qaListAs = S.qaListAs || "note"; S.qaEdK = null;
    if (!keep || !S.qaOver) S.qaOver = {};
    const seg = `<div class="seg qa-mode" role="tablist" aria-label="What to capture">${QMODES.map(([v, l, i]) => `<button class="chip ${v === mode ? "on" : ""}" role="tab" aria-selected="${v === mode}" data-act="qaMode" data-v="${v}">${ic(i)}${l}</button>`).join("")}<span class="dim">Tab switches</span></div>`;
    if (mode !== "item") {
      const jot = mode === "jot";
      openOv("quick", dialog(jot ? "Quick jot" : "Quick list", jot ? `Enter save · Shift+Enter new line · ${MOD}+Enter save + open` : `Enter new line · ${MOD}+Enter save · Shift+${MOD}+Enter save + open`, seg + `<div class="qa-wrap tx"><span class="qa-prompt">${jot ? "✎" : "☐"}</span><textarea id="qaTx" rows="${jot ? 4 : 6}" autocomplete="off" aria-label="${jot ? "Jot" : "List, one item per line"}" placeholder="${jot ? "An idea, a thought, anything. The first line is its title; #tags and a class like 130a are picked up." : "Groceries:&#10;milk&#10;eggs&#10;(one per line · a first line ending in : is the title)"}"></textarea></div>
        <div class="qa-parse" id="qaParse"></div><div class="qa-ed" id="qaEd" hidden></div>${jot ? "" : `<div class="seg qa-as"><span class="dim">Save as</span>${[["note", "Checklist note"], ["tasks", "One task per line"]].map(([v, l]) => `<button class="chip ${S.qaListAs === v ? "on" : ""}" data-act="qaListAs" data-v="${v}" aria-pressed="${S.qaListAs === v}">${l}</button>`).join("")}</div>`}
        <div class="actions sm qa-go"><button class="btn primary" data-act="qaSave">${ic(jot ? "jot" : "done")}Save<kbd>${jot ? "Enter" : MOD + " Enter"}</kbd></button><button class="btn" data-act="qaSave" data-v="open">${ic("notes")}Save and open<kbd>${jot ? MOD + " Enter" : "Shift " + MOD + " Enter"}</kbd></button></div>`));
      const tx = $("#qaTx"); tx.value = prefill || ""; tx.focus(); tx.setSelectionRange(tx.value.length, tx.value.length); updateQuick(); CA.sound.whoosh();
      return;
    }
    openOv("quick", dialog("Quick add", `Enter add · Shift+Enter add + open · ${MOD}+Enter add + focus`, seg + `<div class="qa-wrap"><span class="qa-prompt">+</span><input id="qaIn" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" aria-label="Quick add" placeholder="pa3 130a fri 11:59p ~4h !!"><button class="btn primary" data-act="qaGo">${ic("plus")}Add<kbd>Enter</kbd></button></div>
      <div class="qa-parse" id="qaParse"></div><div class="qa-ed" id="qaEd" hidden></div><div class="qa-hl" id="qaHl"></div>
      <div class="tpl"><span class="dim">Templates</span>${TPL.map(([l, t], i) => `<button class="btn" data-act="tpl" data-i="${i}">${l}</button>`).join("")}</div>
      <div class="qa-hl">Start with <span class="tk-note">note:</span> to keep it as a note. Grammar: course <span class="tk-course">130a</span> · date <span class="tk-date">fri / tmr / 11/12 / in 3d</span> · time <span class="tk-time">5pm</span> · estimate <span class="tk-estimate">~2h</span> · priority <span class="tk-priority">!!</span> · <span class="tk-tag">#tag</span> · <span class="tk-location">@place</span> · <span class="tk-whenfree">whenfree</span> moves it to the nearest open slot · words like <span class="tk-kindhint">hw lab quiz midterm read</span> set the kind. Title only is fine; it lands in the Inbox.</div>`));
    const inp = $("#qaIn"); inp.value = prefill || ""; inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); S.qaPrev = null; updateQuick(); CA.sound.whoosh();
  }
  // whenfree places the draft in the nearest free slot (E.fitFree), so the preview shows where it lands. `over` is what the
  // chips set that no word says (S.qaOver): a kind, and noAuto when you took off the class it picked for you
  function draftFrom(text, over) {
    const o = over || {}, now = Date.now(), d = E.fitFree(E.parseQuick(text, now, S.courses), S.items, now), auto = !d.course && !o.noAuto ? ctxCourse() : null;
    if (o.kind) d.kind = o.kind;
    return { d, auto };
  }
  const freeWhy = (d) => (d.moved ? `moved ${d.moved < 0 ? "earlier" : "later"}${d.clash && d.clash[0] ? ", clear of " + d.clash[0].title : ""}` : "that time is free");
  const captureText = () => { const t = $("#qaTx") || $("#qaIn"); return t ? t.value : ""; };
  // a jot: the first line read as a note's quick add (its class and #tags), the rest kept as written
  function jotParts(text) {
    const lines = text.replace(/\r/g, "").split("\n"), first = lines[0].trim(), rest = lines.slice(1).join("\n").replace(/^\n+|\s+$/g, "");
    const o = S.qaOver || {}, d = E.parseQuick("note: " + first, Date.now(), S.courses), auto = !d.course && !o.noAuto ? ctxCourse() : null;
    let title = d.title.trim(), body = rest;
    if (!rest && title.length > 80) { body = first; title = title.slice(0, 60).replace(/\s+\S*$/, "") + "…"; }
    // a link on the first line leaves the title, so the note's text keeps it (and the note its links)
    const lost = d.links.filter((u) => !body.includes(u.replace(/^https?:\/\//i, "")));
    if (lost.length) body = lost.join("\n") + (body ? "\n\n" + body : "");
    const tags = [...d.tags, ...[...rest.matchAll(/(^|\s)#([\w-]+)/g)].map((m) => m[2])].filter((t, i, a) => a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i);
    return { title: title || (d.links[0] ? E.linkLabel(d.links[0]) : "Jot · " + shortDate(Date.now()) + ", " + mTime(Date.now())), body, tags, links: d.links,
      course: o.course !== undefined ? o.course : d.course || (auto && auto.id) || null, auto: o.course === undefined && !d.course && auto };
  }
  // a list: one item per line (bullets, boxes and numbers you typed are dropped); "Title:" on the first line names it
  function listParts(text) {
    const lines = text.replace(/\r/g, "").split("\n").map((l) => l.replace(/^\s*(?:[-*+•]\s+)?(?:\[[ xX]?\]\s*)?(?:\d+[.)]\s+)?/, "").trim()).filter(Boolean);
    let title = "";
    if (lines.length > 1 && /:$/.test(lines[0])) title = lines.shift().replace(/:$/, "").trim();
    return { title: title || "List · " + shortDate(Date.now()), lines };
  }
  function saveCapture(open) {
    const text = captureText(), mode = S.qaMode;
    if (!text.trim()) return refuse($(".qa-wrap"));
    closeOv();
    if (mode === "jot") {
      const p = jotParts(text), it = addNote({ title: p.title, notes: p.body, tags: p.tags, links: p.links.map((u) => [E.linkLabel(u), u]), course: p.course });
      return open ? openNote(it.id, { focus: "end" }) : renderAll();
    }
    const p = listParts(text); if (!p.lines.length) return;
    if (S.qaListAs === "tasks") {
      const made = p.lines.map((l) => addFromText(l, null, true, { noAuto: S.qaOver.noAuto })).filter(Boolean);
      remember({ label: "add " + made.length + " tasks", pairs: made.map((x) => [Object.assign(snap(x), { deleted: true }), snap(x)]) });
      toast(`Added ${made.length} task${made.length > 1 ? "s" : ""}`, { undo: true }); CA.sound.ok(); S.fx = { flip: true }; return renderAll();
    }
    const it = addNote({ title: p.title, notes: p.lines.map((l) => "- [ ] " + l).join("\n"), course: ((!S.qaOver.noAuto && ctxCourse()) || {}).id || null });
    return open ? openNote(it.id, { focus: "end" }) : renderAll();
  }
  function switchMode(v) { if (v !== S.qaMode) { openQuick(captureText(), v, true); CA.sound.click(); } }
  function updateQuick() {
    if (S.qaMode && S.qaMode !== "item") {
      const box = $("#qaParse"); if (!box) return;
      const text = captureText();
      if (S.qaMode === "jot") {
        const p = jotParts(text), c = cById(p.course);
        box.innerHTML = text.trim() ? [`<span class="pc">Title <b>${esc(p.title)}</b></span>`, c ? qaChip("course", `Course <b>${esc(c.code)}</b>${p.auto ? ` <i>auto · ${p.auto.why}</i>` : ""}`, "course", kc(c)) : qaNoCourse(),
          ...p.tags.map((t) => `<span class="pc">Tag <b>#${esc(t)}</b></span>`), `<span class="pc">Note <b>${NT().stats(p.body || p.title).words} words</b></span>`].join("") : `<span class="dim">Saved as a note in Notes (−)</span>`;
      } else {
        const p = listParts(text);
        box.innerHTML = text.trim() ? (S.qaListAs === "tasks" ? p.lines.slice(0, 4).map((l) => { const d = E.parseQuick(l, Date.now(), S.courses); return `<span class="pc">${esc(kLabel(d.kind))} <b>${esc(d.title || l)}</b>${d.due ? " <i>" + esc(mDue(d.due)) + "</i>" : ""}</span>`; }).join("") + (p.lines.length > 4 ? `<span class="pc">+${p.lines.length - 4} more</span>` : "")
          : `<span class="pc">Title <b>${esc(p.title)}</b></span><span class="pc">Checklist <b>${p.lines.length} item${p.lines.length === 1 ? "" : "s"}</b></span>`) : `<span class="dim">${S.qaListAs === "tasks" ? "Each line is read like quick add: “pa3 130a fri ~2h”" : "Saved as a checklist note"}</span>`;
      }
      return;
    }
    const inp = $("#qaIn"); if (!inp) return;
    if (!inp.value.trim()) S.qaOver.kind = null; // a kind you picked was for what you'd typed; the class you took off stays off
    const { d, auto } = draftFrom(inp.value, S.qaOver), c = cById(d.course || (auto && auto.id));
    const chips = [qaChip("title", `Title <b>${esc(d.title || (d.links[0] ? E.linkLabel(d.links[0]) : "…"))}</b>`), qaChip("kind", `Kind <b>${kLabel(d.kind)}</b>`)];
    chips.push(c ? qaChip("course", `Course <b>${esc(c.code)}</b>${!d.course && auto ? ` <i>auto · ${auto.why}</i>` : ""}`, "course", kc(c)) : qaNoCourse());
    chips.push(qaChip("due", `${d.whenFree ? "Starts" : "Due"} <b>${d.due ? mDue(d.due) + " · " + E.fmtRel(d.due, Date.now()) : "none"}</b>${!d.due && !c ? " <i>→ Inbox</i>" : ""}`));
    if (d.whenFree) chips.push(qaChip("free", `When free <b>${mTime(d.due)}–${mTime(d.end)}</b> <i>${esc(freeWhy(d))}</i>`, "free"));
    if (d.est) chips.push(qaChip("est", `Estimate <b>${E.fmtDur(d.est * MIN)}</b>`));
    if (d.pri) chips.push(qaChip("pri", `Priority <b>${"!".repeat(d.pri)}</b>`));
    d.tags.forEach((t) => chips.push(qaChip("tag:" + t, `Tag <b>#${esc(t)}</b>`)));
    d.links.forEach((u) => chips.push(qaChip("link:" + u, `Link <b>${esc(E.linkLabel(u))}</b>`, "", "", `title="${esc(u)}"`)));
    if (d.location) chips.push(qaChip("where", `Where <b>${esc(d.location)}</b>`));
    $("#qaParse").innerHTML = chips.join("");
    // what the grammar just recognized pops in; a value that changed flashes (the title changes on every key, so it doesn't)
    const prev = S.qaPrev; S.qaPrev = {};
    $$("#qaParse .pc").forEach((el) => {
      const k = el.dataset.k, v = el.textContent; S.qaPrev[k] = v;
      if (prev && k !== "title" && prev[k] !== v) MO.ack(el, prev[k] == null ? "pop" : "flash");
    });
    $("#qaHl").innerHTML = d.tokens.length ? d.tokens.map((t) => `<span class="tk tk-${t.type}">${esc(t.t)}</span>`).join(" ") : "";
  }
  // A parse chip is a button: it opens the strip under the row (#qaEd) that changes what it read or takes it out. Edits
  // rewrite the words you typed, so the highlights and what gets added stay one thing; only what no word says is kept
  // beside the text in S.qaOver: a kind you picked, noAuto once you take off the class it picked for you, and a jot's class.
  function qaChip(k, inner, cls, style, attr) {
    const on = S.qaEdK === k;
    return `<button class="pc ${cls || ""} ${on ? "on" : ""}" data-act="qaEd" data-k="${esc(k)}" aria-expanded="${on}"${style ? ` style="${style}"` : ""} ${attr || ""}>${inner}</button>`;
  }
  // once you take off the class it picked, the chip stays as "none" so you can pick one again
  function qaNoCourse() { return (S.qaOver.noAuto || S.qaOver.course === null) && ctxCourse() ? qaChip("course", "Course <b>none</b>") : ""; }
  const qaMarkOn = () => $$("#qaParse button.pc").forEach((el) => { const on = el.dataset.k === S.qaEdK; el.classList.toggle("on", on); el.setAttribute("aria-expanded", on); });
  const QA_KINDS = ["task", "assignment", "exam", "quiz", "lab", "reading", "project", "errand", "application", "office_hours", "event"];
  const QA_TOKS = { title: ["text", "kindhint"], course: ["course"], due: ["date", "time"], free: ["whenfree"], est: ["estimate"], pri: ["priority"], where: ["location"] };
  // the typed words a chip stands for
  function qaToks(k) {
    const ty = QA_TOKS[k];
    return E.parseQuick(captureText(), Date.now(), S.courses).tokens.filter((t) => (ty ? ty.includes(t.type)
      : k.startsWith("tag:") ? t.type === "tag" && t.t.slice(1) === k.slice(4) : k.startsWith("link:") && t.type === "url" && E.linkIn(t.t) === k.slice(5)));
  }
  // the quick-add text without the words `toks`, and `put` where the first of them stood (else at the end)
  function qaRewrite(toks, put) {
    const inp = $("#qaIn"); let v = inp.value, at = v.length;
    [...toks].sort((a, b) => b.s - a.s).forEach((t) => { v = v.slice(0, t.s) + v.slice(t.e); at = t.s; });
    if (put) v = v.slice(0, at) + " " + put + " " + v.slice(at);
    v = v.replace(/\s+/g, " ").trim(); inp.value = v ? v + " " : "";
  }
  // a time and a length as quick-add words ("today 5pm", "11/14 9:30am"; "1h30m"), so a chip can write them back
  function whenWords(t) {
    const x = new Date(t), h = x.getHours(), m = x.getMinutes(), day = E.startOfDay(t), today = E.startOfDay(Date.now());
    return (day === today ? "today" : day === E.addDays(today, 1) ? "tmr" : `${x.getMonth() + 1}/${x.getDate()}`) + " " + (h % 12 || 12) + (m ? ":" + String(m).padStart(2, "0") : "") + (h >= 12 ? "pm" : "am");
  }
  const estWords = (min) => (min ? (min >= 60 ? Math.floor(min / 60) + "h" : "") + (min % 60 ? (min % 60) + "m" : "") : "");
  const dtLocal = (t) => { if (t == null) return ""; const d = new Date(t), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  function qaEdit(k) {
    const box = $("#qaEd"); if (!box) return;
    if (!k || k === S.qaEdK) return qaEdClose(true);
    const jot = S.qaMode === "jot", text = captureText(), { d, auto } = draftFrom(jot ? "" : text, S.qaOver), has = !jot && qaToks(k).length > 0;
    const label = k.startsWith("tag:") ? "Tag" : k.startsWith("link:") ? "Link" : { title: "Title", kind: "Kind", course: "Course", due: d.whenFree ? "Starts" : "Due", free: "When free", est: "Estimate", pri: "Priority", where: "Where" }[k];
    const opt = (v, l, on, c) => `<button class="chip ${c ? "course" : ""} ${on ? "on" : ""}" data-act="qaEdSet" data-v="${esc(String(v))}" aria-pressed="${!!on}"${c ? ` style="${kc(c)}"` : ""}>${l}</button>`;
    const field = (v, ph, type) => `<input id="qaEdIn" type="${type || "text"}" value="${esc(v || "")}" placeholder="${ph || ""}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${label}"><button class="btn sm primary" data-act="qaEdSave">Save</button>`;
    const del = has ? `<button class="btn sm ghost" data-act="qaEdSet" data-v="">${ic("trash")}Remove</button>` : "";
    let body;
    if (k === "course") {
      const cur = jot ? jotParts(text).course : d.course || (auto && auto.id) || null;
      body = opt("", "No course", !cur) + S.courses.filter((c) => c.included).map((c) => opt(c.id, esc(c.code), c.id === cur, c)).join("");
    } else if (k === "title") body = field(d.title, "What it is");
    else if (k === "kind") body = QA_KINDS.map((x) => opt(x, kLabel(x), x === d.kind)).join("");
    else if (k === "due") body = field(dtLocal(d.due), "", "datetime-local") + del;
    else if (k === "free") body = `<span class="dim">It goes in the nearest open slot</span>` + del;
    else if (k === "est") body = ["15m", "30m", "1h", "2h", "4h"].map((x) => opt(x, x, x === estWords(d.est))).join("") + field(estWords(d.est), "1h30m") + del;
    else if (k === "pri") body = [1, 2, 3].map((n) => opt(n, "!".repeat(n), n === d.pri)).join("") + del;
    else if (k === "where") body = field(d.location, "Place") + del;
    else body = field(k.slice(k.indexOf(":") + 1), k.startsWith("tag:") ? "tag" : "https://…") + del;
    S.qaEdK = k;
    box.innerHTML = `<span class="qa-ed-l">${label}</span>${body}<button class="btn ghost sm qa-ed-x" data-act="qaEd" data-k="" aria-label="Close">${ic("close")}</button>`;
    box.hidden = false; qaMarkOn(); CA.sound.click();
    const f = $("#qaEdIn"), o = $("#qaEd .chip.on") || $("#qaEd .chip");
    if (f) { f.focus(); if (f.type === "text") f.select(); } else if (o) o.focus();
  }
  function qaEdClose(refocus) {
    const box = $("#qaEd"); S.qaEdK = null;
    if (box) { box.hidden = true; box.innerHTML = ""; }
    qaMarkOn();
    const t = refocus && ($("#qaTx") || $("#qaIn")); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  }
  // v: the value picked or typed, null to take it out
  function qaApply(v, el) {
    const k = S.qaEdK, o = S.qaOver, s = v == null ? "" : String(v).trim(); if (!k) return;
    if (S.qaMode === "jot") { o.course = s || null; if (!s) o.noAuto = true; }
    else if (k === "kind") o.kind = s === E.parseQuick(captureText(), Date.now(), S.courses).kind ? null : s;
    else {
      let put = null;
      if (v != null) {
        const t = new Date(s).getTime(), tag = s.replace(/^#+/, "").replace(/\s+/g, "-"), est = s.toLowerCase().replace(/[\s~]/g, "").replace(/^\d+$/, "$&m");
        if (k === "title") put = s;
        else if (k === "course") put = cById(s) && cById(s).code.replace(/\s+/g, "");
        else if (k === "due") put = s && !isNaN(t) && whenWords(t);
        else if (k === "est") put = /^\d+(\.\d+)?h(\d+m?)?$|^\d+m(in)?$/.test(est) && "~" + est;
        else if (k === "pri") put = "!".repeat(+s);
        else if (k === "where") put = s && "@" + s.replace(/\s+/g, "-");
        else if (k.startsWith("tag:")) put = /^[\w-]+$/.test(tag) && "#" + tag;
        else put = E.linkIn(s, true);
        if (!put) return refuse(el);
      } else if (k === "course") o.noAuto = true;
      qaRewrite(qaToks(k), put);
    }
    qaEdClose(true); updateQuick(); CA.sound.click();
  }
  // quiet: no undo step, toast or sound (the caller records one step for a batch); over: the quick-add chips' S.qaOver
  function addFromText(text, mode, quiet, over) {
    if (!text.trim()) return null;
    const { d, auto } = draftFrom(text, over), now = Date.now(), course = d.course || (auto && auto.id) || null;
    const it = { id: CA.store.uuid(), title: d.title || (d.links[0] ? E.linkLabel(d.links[0]) : "(untitled)"), kind: d.kind, status: d.kind === "note" || d.due || course ? "todo" : "inbox", course, due: d.due, end: d.end || null, est: d.est, pri: d.pri, weight: null,
      tags: d.tags, links: d.links.map((u) => [E.linkLabel(u), u]), location: d.location, notes: d.kind === "note" ? d.links.join("\n") : "", interrupt: "none", src: "manual", snoozed: null, created: now, updated: now };
    S.items.push(it); CA.store.save(it); S.flashId = it.id; S.sel = it.id; S.fx = { flip: true };
    if (quiet) return it;
    remember({ label: "add", pairs: [[Object.assign(snap(it), { deleted: true }), snap(it)]], id: it.id });
    toast(`Added · ${esc(it.title)}${course ? " · " + cById(course).tag : ""}${it.due ? " · " + mDue(it.due) : " · Inbox"}${d.whenFree ? " · " + esc(freeWhy(d)) : ""}`, { undo: true });
    CA.sound.ok();
    if (mode === "open") { if (isNote(it)) setTimeout(() => openNote(it.id, { focus: "end" }), 0); else S.insp = true; }
    if (mode === "focus" && !isNote(it)) startFocus(it.id, 25);
    return it;
  }

  // command palette: every action that creates, changes or removes something, so typing what you want finds it.
  // `kw` holds the other words people use for it ("new class", "remove course"); `more` entries wait for a query.
  const NEW_KINDS = [["New homework…", "hw  fri ~2h", "assignment pset essay paper"], ["New exam…", "midterm  ", "test final"], ["New quiz…", "quiz  ", ""],
    ["New lab…", "lab  tmr ~3h", ""], ["New reading…", "read ch  tmr ~45m", "chapter book"], ["New project…", "project  ", ""], ["New errand…", "buy  ", "chore"],
    ["New application…", "apply  #career", "job internship"], ["New office hours…", "oh  ", "ta professor"]];
  function quickWith(t) {
    openQuick(t); const inp = $("#qaIn"), k = t.indexOf("  ");
    if (inp && k >= 0) { inp.setSelectionRange(k + 1, k + 1); updateQuick(); }
  }
  function moveCourse(id) {
    S.sel = id; S.insp = true; renderAll();
    MO.after(() => { const f = $('#insp [data-field="course"]'); if (f) f.focus(); });
  }
  function dupItem(id) {
    const it = find(id); if (!it) return;
    const now = Date.now(), c = Object.assign(JSON.parse(JSON.stringify(it)), { id: CA.store.uuid(), title: it.title + " (copy)", status: it.status === "done" ? "todo" : it.status, src: "manual", _source: null, created: now, updated: now, deleted: false });
    S.items.push(c); CA.store.save(c); S.sel = c.id; S.flashId = c.id; S.fx = { flip: true };
    remember({ label: "duplicate", pairs: [[Object.assign(snap(c), { deleted: true }), snap(c)]], id: c.id });
    toast(`Duplicated · ${esc(it.title)}`, { undo: true }); CA.sound.ok(); renderAll();
  }
  // Clearing out done items or a tag in one go; one undo puts every item back.
  function bulkEdit(list, patch, label, msg) {
    remember({ label, pairs: list.map((it) => edit(it, typeof patch === "function" ? patch(it) : patch)) }); S.fx = { flip: true };
    toast(msg, { undo: true }); CA.sound.ok(); renderAll();
  }
  function palEntries() {
    const out = [], cmd = (label, hint, run, kw, more) => out.push({ sec: "Commands", label, hint, run, kw, more });
    const live = S.items.filter((it) => !it.deleted), t = target();
    const last = S.hist[S.hist.length - 1], next = S.redo[S.redo.length - 1];
    if (last) cmd("Undo " + last.label, MOD + "+Z", () => doUndo(), "revert back");
    if (next) cmd("Redo " + next.label, MOD + "+Shift+Z", doRedo, "again forward");
    cmd("Trash…", "", openTrash, "restore deleted recover bin recycle archive undone removed lost history");
    cmd("New item…", "Q", () => openQuick(), "add create task todo quick new thing");
    cmd("New note…", "W", () => newNote(), "write create document doc page notes editor text");
    cmd("Jot…", "Shift+Q", () => openQuick("", "jot"), "quick note idea thought capture write down remember");
    cmd("Quick list…", "", () => openQuick("", "list"), "checklist todo list groceries several tasks at once bulk add");
    cmd("New checklist…", "Shift+W", () => newNote(NT().TEMPLATES[1]), "todo list note checkboxes");
    cmd("New note from a template…", "", openNoteTpl, "lecture cornell study guide meeting ideas project weekly plan journal template");
    cmd("Ask AI…", "I · " + MOD + "+J", () => openAI(), "claude chatgpt gemini assistant chat generate write format organize summarize llm prompt");
    cmd("AI settings…", "", () => openAI({ setup: true }), "claude code cli subscription model codex gemini chatbot assistant rules", true);
    cmd("Import notes…", "", noteImport, "open file markdown md docx word text html backup restore", true);
    cmd("Export all notes…", "", openBackup, "backup zip markdown download save notes", true);
    cmd("Add a course…", "", () => openCourse(null), "new create class course subject lecture");
    dupPairs().forEach(([a, b]) => { const k = keeperOf(a, b), x = k === a ? b : a; cmd(`Merge duplicate ${x.code} into ${k.code}`, "", () => openCourseDel(x.id, k.id), "duplicate same course class combine delete remove fix"); });
    cmd("Focus 25 min on Do first", "F", focusTop, "start pomodoro timer study");
    cmd("Focus 50 min on Do first", "", () => topItem() && startFocus(topItem().id, 50), "start pomodoro timer study");
    cmd("Lockdown 90 min (kill games, block sites)", "", () => topItem() && startFocus(topItem().id, 90, "lockdown"), "focus block distraction");
    cmd("Focus setup…", "Shift+F", openFocusSetup, "pomodoro timer level block");
    cmd("Break 5 min", "B", () => takeBreak(5), "pause rest pomodoro timer short");
    cmd("Break 15 min", "", () => takeBreak(15), "pause rest pomodoro timer long");
    cmd("Clear filters", "Esc", clearQ, "reset show everything");
    if (LIVE) {
      const st = S.settings || {};
      cmd("Refresh sources", "", syncNow, "sync update pull fetch reload");
      cmd("Connect sources…", "", () => openFeeds(), "add calendar canvas google gradescope webwork import sync link");
      cmd("Add Collegiapp to Claude Desktop", "", mcpDesktop, "claude desktop mcp extension connector assistant ai chat write notes", true);
      cmd("Add Collegiapp to Claude Code", "", mcpCode, "claude code mcp connector assistant ai cli write notes", true);
      [["Canvas", st.canvas_feed_url], ["Google Calendar", st.gcal_feed_url], ["Gradescope", st.gradescope], ["WeBWorK", (st.webwork_courses || []).length]].forEach(([n, on]) =>
        cmd((on ? "Disconnect " : "Connect ") + n + "…", "", () => openFeeds(), on ? "remove stop unlink source sync" : "add source sync import link calendar", true));
      cmd("Pick which calendar events are classes", "", () => go("classes"), "google series lecture section not a class", true);
      if (WINOS) cmd(st.start_win_key ? "Use Windows' Start (turn off Pocket Start)" : "Use Pocket Start for the Win key", "", () => setWinKey(!st.start_win_key),
        "start menu win key windows taskbar disable enable turn off on pocket start replace");
    } else cmd("Sync now", "", syncNow, "refresh");
    cmd("Sync across devices…", "", () => openSync(), "sync firebase google account sign in login log out cloud backup phone iphone web mac devices");
    if (OWN && S.cloud && S.cloud.signed_in) cmd("Sync with your other devices now", "", () => cloudApi.now().then(onCloud, () => {}), "sync firebase cloud upload pull push", true);
    if (LIVE && !MOBILE) cmd(S.update ? `Install update ${S.update.version}…` : "Check for updates", "", () => (S.update ? openUpdate(S.update) : checkUpdate(true)), "upgrade version");
    const done = live.filter((it) => it.status === "done");
    if (done.length) cmd(`Delete all done items (${done.length})`, "", () => bulkEdit(done, { deleted: true }, "delete", `Deleted ${done.length} done items`), "clear completed clean up purge remove finished archive", true);
    cmd("Appearance…", MOD + "+.", openLab, "theme style look colors settings");
    if (navMode() === "side") {
      const shown = ["dock", "over"].includes(sideState());
      cmd(shown ? "Hide the sidebar" : "Show the sidebar", MOD + "+\\", () => sideToggle(), "folders navigation nav bar panel tree explorer files");
      cmd(`Move the sidebar to the ${sideAt() === "left" ? "right" : "left"}`, "", sideSwap, "side switch swap flip folders navigation nav bar panel", true);
      cmd(S.sideEdit ? "Done editing the sidebar" : "Edit the sidebar…", "", () => sideEdit(), "customize customise arrange rearrange reorder sections groups rename hide folders layout organize");
      if (CA.ui.sideLayout) cmd("Put the sidebar back to its usual layout", "", sdReset, "reset default sections groups order arrangement folders", true);
      if (sideP.w) cmd("Put the sidebar back to its usual width", "", () => { sideP.w = 0; sideSave(); sideApply(); }, "reset size resize narrow wide folders", true);
      cmd("Use the view keys along the top instead", "", () => setNavMode("top"), "sidebar tabs key row classic old layout navigation nav bar folders", true);
    } else cmd("Use the sidebar (folders)", MOD + "+\\", () => setNavMode("side"), "folders navigation nav bar panel tree explorer files new layout");
    cmd("Larger text", MOD + "+=", () => CA.lab.zoom(1), "zoom bigger font size");
    cmd("Smaller text", MOD + "+−", () => CA.lab.zoom(-1), "zoom font size");
    cmd("Switch light / night", "", () => CA.lab.toggleNight(), "dark mode theme");
    if (document.documentElement.dataset.look !== "standard") cmd("Degauss the screen", "", () => CA.fx.degauss(), "crt tube colour color blotches wobble magnet fix screen shake", true);
    cmd("Toggle desk preview", "", () => CA.lab.set({ desk: ui().desk === "desk" ? "full" : "desk" }), "", true);
    cmd("Toggle island", "", () => (TAURI ? TAURI.core.invoke("toggle_island").catch(() => {}) : CA.lab.set({ island: !ui().island })), "show hide widget", true);
    cmd("Simulate: class in 10 min (nudge)", "", () => simulate("nudge"), "test alert", true);
    cmd("Simulate: class in 10 min (alert)", "", () => simulate("alert"), "test alert", true);
    cmd("Simulate: class in 5 min (takeover)", "", () => simulate("takeover"), "test alert", true);
    cmd("Keyboard shortcuts", "?", openHelp, "help keys");
    NEW_KINDS.forEach(([l, pre, kw]) => out.push({ sec: "Create", label: l, hint: "", run: () => quickWith(pre), kw: "add create new " + kw, more: true }));
    NT().TEMPLATES.slice(2).forEach((tp) => out.push({ sec: "Create", label: "New " + tp.label.toLowerCase() + "…", hint: "", run: () => newNote(tp), kw: "note template add create new write", more: true }));
    // the selected item (or Do first): what its keys and radial menu do
    if (t) {
      const it = (label, hint, run, kw) => out.push({ sec: "Selected", label: label + " · " + t.title, hint, run, kw, more: !S.sel });
      it(isNote(t) ? "Open note" : "Open details", "Enter", () => select(t.id, true), "edit change rename notes");
      if (isNote(t)) {
        it("Ask AI about", "", () => openAI({ note: t.id }), "claude format organize summarize");
        [["docx", "Export as Word"], ["pdf", "Export as PDF"], ["md", "Export as Markdown"], ["print", "Print"], ["copyRich", "Copy for Docs and email"]].forEach(([v, l]) => it(l, "", () => noteOut(v, t.id), "save download file share transfer"));
        it(isPinned(t) ? "Unpin" : "Pin", "", () => notePin(t.id), "top favorite star");
        it("Send unchecked to tasks", "", () => noteTasks(t.id), "checklist todo convert");
      }
      if (!E.SCHEDULED(t.kind)) it(t.status === "done" ? "Reopen" : "Mark done", "X", () => toggleDone(t.id), "complete finish check");
      it("Snooze…", "S", () => openSnooze(t.id), "later postpone defer");
      if (!E.SCHEDULED(t.kind) && !isNote(t)) it("Focus 25 min on", "", () => startFocus(t.id, 25), "start pomodoro timer");
      it("Priority up", "+", () => bumpPri(t.id), "important urgent flag");
      it("Move to another course…", "", () => moveCourse(t.id), "change course class assign personal");
      it("Duplicate", "", () => dupItem(t.id), "copy clone");
      it("Delete", "Del", () => del(t.id), "remove trash erase");
    }
    tabs().concat(viewById("done")).forEach((v) => out.push({ sec: "Views", label: "Go to " + v.label, hint: v.k, sub: v.q, run: () => go(v.id), kw: "show open view tab" }));
    const tv = viewById(S.view), ti = tabs().findIndex((v) => v.id === tv.id);
    if (navMode() === "side" && !(tv.id in SIDE_BUILT)) {
      const mv = (MAC ? "⌥⇧" : "Alt+Shift+");
      out.push({ sec: "Views", label: `Move ${tv.label} up the sidebar`, hint: mv + "↑", sub: "", run: () => sideMove("view", tv.id, -1), kw: "reorder order rearrange sidebar", more: true });
      out.push({ sec: "Views", label: `Move ${tv.label} down the sidebar`, hint: mv + "↓", sub: "", run: () => sideMove("view", tv.id, 1), kw: "reorder order rearrange sidebar", more: true });
    } else if (navMode() === "side") { /* Classes and Notes stay at the top of their sections */ }
    else if (ti > 0) out.push({ sec: "Views", label: `Move the ${tv.label} key left`, hint: (MAC ? "⌥⇧" : "Alt+Shift+") + "←", sub: "", run: () => moveTab(tv.id, -1), kw: "reorder tab order rearrange", more: true });
    if (navMode() !== "side" && ti >= 0 && ti < TAB_IDS.length - 1) out.push({ sec: "Views", label: `Move the ${tv.label} key right`, hint: (MAC ? "⌥⇧" : "Alt+Shift+") + "→", sub: "", run: () => moveTab(tv.id, 1), kw: "reorder tab order rearrange", more: true });
    if ((CA.ui.tabs || []).length) out.push({ sec: "Views", label: "Put the view keys back in order", hint: "", sub: "", run: () => setTabs(TAB_IDS, "View keys back in their first order"), kw: "reset tab order reorder default", more: true });
    S.courses.forEach((c) => {
      const cc = (label, run, kw) => out.push({ sec: "Classes", label, sub: c.title, hint: "", run, kw: "course class " + c.tag + " " + kw, more: true });
      if (c.included) out.push({ sec: "Classes", label: c.code + " " + c.title, hint: "", sub: c.tag, run: () => (S.side ? sideGo("c:" + c.id) : setQ("is:open course:" + c.tag.toLowerCase())), kw: "show items folder" });
      if (c.included) cc("New item in " + c.code + "…", () => openQuick(c.tag.toLowerCase() + " "), "add create homework task");
      cc("Edit " + c.code + "…", () => openCourse(c.id), "rename change name link website gradescope page");
      cc("Delete " + c.code + "…", () => openCourseDel(c.id), "remove trash erase duplicate");
      if (S.courses.length > 1) cc("Merge " + c.code + " into another course…", () => openCourseDel(c.id), "duplicate combine same");
      cc((c.included ? "Exclude " : "Include ") + c.code, () => ACTIONS.incl({ dataset: { c: c.id } }), c.included ? "hide clutter canvas" : "show unhide canvas");
    });
    const series = new Set();
    live.filter((it) => E.matchItem(it, [], ctx()) && (E.isOpen(it, S.now) || (it.status === "done" && E.ACTIONABLE(it.kind)))).sort(cmpDue).forEach((it) => {
      if (E.SCHEDULED(it.kind)) { const k = it.kind + "|" + it.course + "|" + it.title.toLowerCase(); if (series.has(k)) return; series.add(k); }
      const c = courseOf(it), done = it.status === "done", sub = (done ? "Done · " : "") + (c ? c.tag + " · " : "") + iLabel(it) + (it.due ? " · " + fDue(it.due) : "");
      // a note is found by its words too
      out.push({ sec: isNote(it) ? "Notes" : "Items", label: it.title, sub, hint: "", run: () => select(it.id, true), kw: E.SCHEDULED(it.kind) ? "next" : isNote(it) ? "note " + NT().preview(it.notes, 400) : "", done });
      out.push({ sec: "Items", label: "Delete " + it.title, sub, hint: "", run: () => del(it.id), kw: "remove trash", more: true });
      if (!E.SCHEDULED(it.kind)) out.push({ sec: "Items", label: "Mark done " + it.title, sub, hint: "", run: () => toggleDone(it.id), kw: "complete finish check", more: true });
    });
    S.calendarSeries.forEach((x) => out.push({ sec: "Calendar", label: (x.hidden ? "Unhide " : "Hide ") + x.name, sub: x.rule, hint: "", run: () => serHide(x.id), kw: "google calendar series class remove delete duplicate", more: true }));
    const tags = new Map(); live.forEach((it) => it.tags.forEach((g) => { const k = g.toLowerCase(); tags.set(k, (tags.get(k) || []).concat(it)); }));
    tags.forEach((its, g) => {
      out.push({ sec: "Tags", label: "Show #" + g, sub: its.length + " items", hint: "", run: () => setQ("#" + g), kw: "tag filter label category", more: true });
      out.push({ sec: "Tags", label: "Remove tag #" + g, sub: "from " + its.length + " items", hint: "", kw: "delete tag label category clear", more: true,
        run: () => bulkEdit(its, (it) => ({ tags: it.tags.filter((x) => x.toLowerCase() !== g) }), "untag", `Removed #${esc(g)} from ${its.length} items`) });
    });
    S.courses.filter((c) => c.included).forEach((c) => c.links.forEach((l) => out.push({ sec: "Links", label: c.tag + " " + l[0], sub: hostOf(l[1]), hint: "↗", run: () => openLink(l[1]), kw: "open website" })));
    GLOBAL_LINKS.forEach((l) => out.push({ sec: "Links", label: l[0], sub: hostOf(l[1]), hint: "↗", run: () => openLink(l[1]), kw: "open website" }));
    return out;
  }
  // Every word of the query has to land somewhere in the entry's words; a match in the label counts most.
  function palScore(q, e) {
    const hay = e.label + " " + (e.sub || "") + " " + (e.kw || "") + " " + e.sec;
    let sc = 0;
    for (const w of q.trim().split(/\s+/)) { const a = E.fuzzy(w, e.label), b = a ? 0 : E.fuzzy(w, hay); if (!a && !b) return 0; sc += a ? a + 10 : b; }
    return sc + E.fuzzy(q, e.label) / 2;
  }
  function openPalette(initial) {
    openOv("palette", dialog("Search · commands", "↑↓ Enter · Esc", `<div class="qa-wrap"><span class="qa-prompt">&gt;</span><input id="palIn" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" aria-label="Search commands" placeholder="commands, items, classes, links…"></div><div class="pal-res" id="palRes"></div>`));
    const inp = $("#palIn"); inp.value = initial || ""; inp.focus(); S.palI = 0; updatePalette(); CA.sound.whoosh();
  }
  function updatePalette() {
    const q = ($("#palIn") || {}).value || "";
    let list = palEntries();
    if (q.trim()) {
      list = list.map((e) => ({ e, s: palScore(q, e) * (e.done ? 0.5 : 1) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.e);
      // a query is also a filter over the list: first when it uses the filter keys (kind:work, due<fri, #exam), else after the matches
      const terms = E.parseFilter(q), dsl = terms.some((t) => t.key !== "text"), n = S.items.filter((it) => E.matchItem(it, terms, ctx())).length;
      const fe = { sec: "Filter", label: (dsl ? "Filter: " : "Filter the list for ") + q.trim(), sub: n + " items" + (terms.some((t) => t.valid === false) ? " · some terms not understood" : ""), hint: "", run: () => setQ(q) };
      if (dsl) list.unshift(fe); else if (n) list.push(fe);
      // anything typed can go to your AI (I or Mod+J opens it empty)
      if (!dsl) list.push({ sec: "AI", label: "Ask AI: " + q.trim(), sub: S.note ? "with this note" : "", hint: MOD + "+J", run: () => openAI({ ask: q.trim() }) });
    }
    else list = list.filter((e) => !e.more && (e.sec === "Commands" || e.sec === "Selected" || e.sec === "Views"));
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
    if (e) e.run(); else if (q.trim()) { addFromText(q); renderAll(); }
  }

  function openHelp() {
    const keys = [["Q", "quick add (" + MOD + "+Shift+Space system-wide in the app)"], [MOD + "+K  /", "search and commands"], ["1 – 9, 0, −", "views by their place in the list"], [MOD + "+\\", "show or hide the sidebar (↑ ↓ ← → Enter in its folders)"], ["Hold · drag a view key", "reorder the views (" + (MAC ? "⌥⇧" : "Alt+Shift+") + "arrows move the current one)"], ["W  Shift+W", "new note · new checklist"], ["Shift+Q", "quick jot (Tab: item · jot · list)"], ["I  " + MOD + "+J", "ask your AI"], ["Esc", "close · clear filters"], [MAC ? "⌘[  ⌘]" : "Alt+←  Alt+→", "back / forward (also the mouse's side buttons)"],["J K ↑ ↓", "move selection"], ["Enter", "open details"],
      ["X  Space", "toggle done"], ["F", "focus 25 on selection / Do first"], ["Shift+F", "focus setup"], ["B", "break 5 min (ends a Soft focus first)"], ["S", "snooze"], ["N  Shift+N", "next / previous Do first"], ["[  ]", "calendar: previous / next week or month"], ["+", "priority up"], ["Del", "delete (undo)"], [MOD + "+Z", "undo"], [MOD + "+Shift+Z  " + MOD + "+Y", "redo"],
      [MOD + "+V", "paste a link onto the open item, or into a new one"], [MOD + "+R  F5", "refresh Canvas, Google, Gradescope and WeBWorK now"], [MOD + "+.", "appearance"], [MOD + "+=  " + MOD + "+−", "text size"], ["Hold " + ALT, "show every shortcut"], [MOD + "+P", "print the open note"], ["# ## - 1. [] > ```", "in a note: Markdown becomes formatting as you type"], ["Right-click · long-press", "radial menu (on a row: item actions)"], ["Swipe a row", "right: done · left: snooze (touch)"]];
    openOv("help", dialog("Keys & help", "Esc", `<div class="helpgrid">${keys.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join("")}</div>`));
  }

  /* ─────────── notes: the Notes lens, the editor sheet, capture modes, files in and out ─────────── */
  // A note is an Item of kind "note" (docs/NOTES.md): a title, and its document in Collegiapp Markdown in `notes`.
  // Pinned notes carry the tag "pinned"; archiving one marks it done (the Done view keeps it).
  const NT = () => CA.notes;
  const isNote = (it) => !!it && it.kind === "note";
  const isPinned = (it) => (it.tags || []).some((t) => String(t).toLowerCase() === "pinned");
  const keyLabel = (k) => k.replace(/Mod/g, MOD).replace(/Alt/g, MAC ? "⌥" : "Alt").replace(/Shift/g, MAC ? "⇧" : "Shift");
  const shortDate = (t) => { const d = new Date(t); return `${MNM[d.getMonth()]} ${d.getDate()}`; };
  function blankNote(fields) {
    const now = Date.now();
    return Object.assign({ id: CA.store.uuid(), title: "", kind: "note", status: "todo", course: null, due: null, end: null, est: null, pri: 0, weight: null,
      tags: [], links: [], location: null, notes: "", interrupt: "none", src: "manual", snoozed: null, created: now, updated: now }, fields);
  }
  // A note made in one go (a jot, a list, an import): kept now, one undo step takes it back.
  function addNote(fields, opts) {
    opts = opts || {};
    const it = blankNote(fields); S.items.push(it); CA.store.save(it); S.flashId = it.id; S.fx = { flip: true };
    if (!opts.quiet) {
      remember({ label: "new note", pairs: [[Object.assign(snap(it), { deleted: true }), snap(it)]], id: it.id });
      toast(`Saved note · ${esc(it.title)}`, { undo: true, actions: [["Open", () => openNote(it.id)]] }); CA.sound.ok();
    }
    return it;
  }
  // A new empty note opens in the editor; it's kept once it has something in it.
  function newNote(tpl) {
    const c = ctxCourse(), t = tpl || NT().TEMPLATES[0], d = new Date();
    const mon = new Date(E.addDays(E.startOfDay(Date.now()), -((d.getDay() + 6) % 7)));
    const title = !t.title ? "" : t.title + (/ $/.test(t.title) ? (t.id === "week" ? shortDate(mon.getTime()) : (c && t.id === "lecture" ? cById(c.id).code + " · " : "") + shortDate(Date.now())) : "");
    const it = blankNote({ title, notes: t.body, course: c ? c.id : null, tags: t.id === "ideas" ? ["ideas"] : [] });
    S.items.push(it);
    openNote(it.id, { isNew: true, focus: title ? "end" : "title" });
  }

  // the Notes lens: pinned first, then the most recently edited; the filter bar narrows them like any list
  function notesLens() {
    const list = listItems().sort((a, b) => isPinned(b) - isPinned(a) || b.updated - a.updated);
    S.listIds = list.map((x) => x.id);
    const bar = `<div class="nbar"><button class="btn primary" data-act="noteNew" data-hint="w">${ic("plus")}New note<kbd>W</kbd></button>
      <button class="btn" data-act="noteNew" data-v="list">${ic("done")}Checklist</button><button class="btn" data-act="quickMode" data-v="jot" data-hint="⇧Q">${ic("jot")}Jot<kbd>${MAC ? "⇧" : "Shift"} Q</kbd></button>
      <button class="btn" data-act="noteTpl">${ic("notes")}From a template</button><span class="sp"></span>
      <button class="btn ghost" data-act="noteImport" title="Markdown, text, web pages, Word documents or a notes backup">${ic("import")}Import</button>
      <button class="btn ghost" data-act="noteBackup" title="Every note as Markdown files in a .zip, or a backup to import later">${ic("export")}Export all</button>
      <button class="btn ghost" data-act="ai" data-hint="i" title="Ask your AI (I or ${MOD}+J)">${ic("ai")}Ask AI<kbd>I</kbd></button></div>`;
    if (!list.length) return { h: bar + `<div class="m-empty">${ic("notes", "big")}<b>${S.q === viewById("notes").q ? "No notes yet." : "No notes match."}</b><span>Jot an idea with <kbd>${MAC ? "⇧" : "Shift"} Q</kbd>, or type <code>note: …</code> in quick add.</span></div>`, n: 0 };
    const card = (it, i) => {
      const c = courseOf(it), ck = NT().checklist(it.notes), pv = NT().preview(it.notes, 220), tags = it.tags.filter((t) => t.toLowerCase() !== "pinned"), dr = NT().firstDrawing(it.notes);
      return `<div class="ncard${S.sel === it.id ? " sel" : ""}${S.flashId === it.id ? " new" : ""}${it.status === "done" ? " done" : ""}" data-act="noteOpen" data-id="${it.id}" data-k="n:${it.id}" style="--i:${i};${kc(c)}" tabindex="-1">
        <div class="nc-top">${c ? cchip(c, true) : ""}${isPinned(it) ? `<span class="nc-pin" title="Pinned">${ic("pin")}</span>` : ""}<span class="sp"></span><span class="nc-when" title="${esc(new Date(it.updated).toLocaleString())}">${esc(agoText(it.updated))}</span></div>
        <h4 class="nc-t">${esc(it.title || "Untitled note")}</h4>${dr ? `<img class="nc-img" src="${esc(dr)}" alt="" draggable="false">` : ""}${pv ? `<p class="nc-p">${esc(pv)}</p>` : ""}
        ${ck.total ? `<div class="nc-ck"><span class="nc-bar"><i style="width:${Math.round((ck.done / ck.total) * 100)}%"></i></span><span class="num">${ck.done}/${ck.total}</span></div>` : ""}
        ${tags.length ? `<div class="nc-tags">${tags.slice(0, 4).map((t) => `<span>#${esc(t)}</span>`).join("")}</div>` : ""}</div>`;
    };
    return { h: bar + `<div class="ngrid">${list.map(card).join("")}</div>`, n: list.length };
  }

  function notePin(id) {
    const it = find(id); if (!it) return;
    const on = isPinned(it), n = S.note && S.note.id === id ? S.note : null;
    editStep(it, { tags: on ? it.tags.filter((t) => t.toLowerCase() !== "pinned") : it.tags.concat("pinned") }, on ? "unpin" : "pin");
    if (n) { n.kept = true; n.before.tags = snap(it.tags); const b = $('#ov [data-act="notePin"]'); if (b) { b.classList.toggle("on", !on); b.setAttribute("aria-pressed", !on); MO.ack(b, "stamp"); } }
    toast(on ? "Unpinned · " + esc(it.title) : "Pinned to the top of Notes · " + esc(it.title)); CA.sound.click(); S.fx = { flip: true };
    if (S.overlay !== "note") renderAll();
  }
  // the editor sheet over the screen; one sheet at a time, and closing it records one undo step for the whole session
  function openNote(id, how) {
    how = how || {};
    const it = find(id); if (!it) return;
    if (S.overlay === "note" && S.note && S.note.id === id) return;
    if (S.overlay === "note") noteCommit();
    S.sel = id;
    S.note = { id, before: how.isNew ? Object.assign(snap(it), { deleted: true }) : snap(it), isNew: !!how.isNew, kept: !how.isNew, side: S.noteSide != null ? S.noteSide : !narrow(), panel: "outline" };
    openOv("note", noteSheet(it), "sheet");
    S.note.ed = CA.editor.mount($("#nsEd"), {
      md: it.notes, onChange: (md) => noteSave({ notes: md }), onInput: noteSoon, onState: noteTools, onLink: noteLinkAsk, onOpen: openLink,
      onRefuse: (m) => { toast(esc(m)); CA.sound.nope(); }, onCheck: (li, on) => { if (on) MO.ack(li, "stamp"); CA.sound.tick(); },
      onCallout: (k) => toast("Callout · " + NT().CALLOUT_LABEL[k] + " · click again for the next kind"), onDraw: openDraw,
    });
    noteInfo();
    if (how.focus === "title" || (!it.title && how.focus !== "end")) $("#nsTitle").focus(); else S.note.ed.focus(true);
    CA.sound.whoosh();
  }
  function noteSheet(it) {
    const tool = (t) => `<button class="btn ns-t" data-act="edTool" data-t="${t.id}" title="${esc(t.label)}${t.k ? " · " + esc(keyLabel(t.k)) : ""}" aria-label="${esc(t.label)}">${t.icon ? ic(t.icon) : `<span class="ns-tx ns-${t.id}">${t.text}</span>`}</button>`;
    const groups = []; CA.editor.TOOLS.forEach((t) => { const g = groups[groups.length - 1]; if (g && g.g === t.g) g.list.push(t); else groups.push({ g: t.g, list: [t] }); });
    const courses = S.courses.filter((c) => c.included || c.id === it.course).map((c) => `<option value="${c.id}" ${c.id === it.course ? "selected" : ""}>${esc(c.code)}</option>`).join("");
    const tags = it.tags.filter((t) => t.toLowerCase() !== "pinned").map((t) => "#" + t).join(" ");
    return `<div class="nsheet panel" role="dialog" aria-label="Note editor">
      <div class="ph"><span class="pt">${ic("notes")}Note</span><span class="ns-st" id="nsSt">${S.note.kept ? "Saved" : "New"}</span><span class="sp"></span>
        <button class="btn ghost sm" data-act="noteAI" title="Ask your AI about this note (${MOD}+J)">${ic("ai")}<span class="bl">AI</span><kbd>${MOD} J</kbd></button>
        <button class="btn ghost sm" data-act="noteMenu" aria-haspopup="menu" title="Export, print, copy, share">${ic("export")}<span class="bl">Export</span></button>
        <button class="btn ghost sm${isPinned(it) ? " on" : ""}" data-act="notePin" aria-pressed="${isPinned(it)}" title="Pin to the top of Notes">${ic("pin")}</button>
        <button class="btn ghost sm${S.note.side ? " on" : ""}" data-act="noteSide" aria-pressed="${S.note.side}" title="Outline and details">${ic("outline")}</button>
        <button class="btn ghost sm" data-act="closeOv" aria-label="Close">${ic("close")}<span class="bl">Close</span><kbd>Esc</kbd></button></div>
      <div class="ns-tools" role="toolbar" aria-label="Formatting">${groups.map((g) => `<span class="ns-g">${g.list.map(tool).join("")}</span>`).join("")}</div>
      <div class="ns-bar" id="nsBar" hidden></div>
      <div class="ns-body${S.note.side ? " side" : ""}" id="nsBody"><div class="ns-scroll" id="nsScroll"><div class="ns-page">
          <input class="ns-title" id="nsTitle" value="${esc(it.title)}" placeholder="Untitled" aria-label="Title" autocomplete="off">
          <div class="ns-meta"><select id="nsCourse" aria-label="Course"><option value="">Personal</option>${courses}</select>
            <input id="nsTags" value="${esc(tags)}" placeholder="#tags" aria-label="Tags" autocomplete="off" spellcheck="false">
            <span class="dim" title="${esc(new Date(it.created).toLocaleString())}">Created ${esc(shortDate(it.created))}</span></div>
          <div id="nsEd" aria-label="Note text"></div></div></div>
        <aside class="ns-side" id="nsSide" aria-label="Outline and details"></aside></div>
      <div class="ns-foot" id="nsFoot"></div><div class="ns-menu" id="nsMenu" role="menu" hidden></div></div>`;
  }
  function noteSave(patch) {
    const n = S.note, it = n && find(n.id); if (!it) return;
    if (!n.kept) { n.kept = true; if (!S.items.includes(it)) S.items.push(it); }
    edit(it, patch); const st = $("#nsSt"); if (st) { st.textContent = "Saved"; MO.ack(st, "flash"); }
  }
  // the footer and the side panel follow the text, a frame after typing
  let noteRaf = 0;
  function noteSoon() { const st = $("#nsSt"); if (st && st.textContent !== "Editing") st.textContent = "Editing"; cancelAnimationFrame(noteRaf); noteRaf = requestAnimationFrame(noteInfo); }
  function noteInfo() {
    const n = S.note; if (!n || !n.ed) return;
    const md = n.ed.md(), st = NT().stats(md), ck = NT().checklist(md), foot = $("#nsFoot");
    if (foot) foot.innerHTML = `<span class="num">${st.words}</span> words · <span class="num">${st.chars}</span> characters · ${st.minutes} min read${ck.total ? ` · <span class="num">${ck.done}/${ck.total}</span> done` : ""}<span class="sp"></span><span class="dim">${esc(keyLabel("Mod+K"))} link · ${esc(keyLabel("Mod+Enter"))} tick · Markdown works as you type</span>`;
    if (n.side && n.panel === "outline") noteSidePanel(md, ck);
  }
  function noteSidePanel(md, ck) {
    const side = $("#nsSide"), n = S.note; if (!side || !n || n.panel !== "outline") return;
    const hs = n.ed.headings(), it = find(n.id);
    side.innerHTML = `<div class="sub-h">Outline</div>${hs.length ? `<div class="ns-out">${hs.map((h, i) => `<button class="ns-oh l${h.level}" data-act="noteGoto" data-i="${i}">${esc(h.text)}</button>`).join("")}</div>` : `<p class="dim">Headings (#, ##, ###) show up here.</p>`}
      ${ck.total ? `<div class="sub-h">Checklist</div><div class="nc-ck"><span class="nc-bar"><i style="width:${Math.round((ck.done / ck.total) * 100)}%"></i></span><span class="num">${ck.done}/${ck.total}</span></div>
        <button class="btn sm" data-act="noteTasks" ${ck.total - ck.done ? "" : "disabled"}>${ic("go")}Send ${ck.total - ck.done} unchecked to tasks</button>` : ""}
      <div class="sub-h">Do more</div><div class="ns-acts">
        <button class="btn sm" data-act="noteAI">${ic("ai")}Ask AI</button><button class="btn sm" data-act="noteOut" data-v="docx">${ic("export")}Word</button>
        <button class="btn sm" data-act="noteOut" data-v="pdf">${ic("export")}PDF</button><button class="btn sm" data-act="noteOut" data-v="print">${ic("print")}Print</button></div>
      <p class="dim ns-upd">Edited ${esc(it ? agoText(it.updated) : "")}</p>`;
  }
  // which tools are on where the caret is; the table tools show while the caret is in a table
  function noteTools(st) {
    if (!st) return;
    const on = { p: st.block === "p" && !st.quote && !st.callout && !st.pre, h1: st.block === "h1", h2: st.block === "h2", h3: st.block === "h3", b: st.b, i: st.i, u: st.u, s: st.s,
      mark: st.mark, code: st.code, link: st.link, ul: st.ul, ol: st.ol, todo: st.todo, quote: st.quote, callout: !!st.callout, pre: st.pre };
    $$(".ns-tools .ns-t").forEach((b) => { const v = !!on[b.dataset.t]; if (b.classList.contains("on") !== v) { b.classList.toggle("on", v); b.setAttribute("aria-pressed", v); } });
    // a picked image or drawing brings its own tools, else a caret in a table the table's
    const bar = $("#nsBar"); if (!bar || bar.dataset.mode === "link") return;
    const mode = st.img ? "img" : st.table ? "table" : "", key = st.img ? ["img", st.img.place, st.img.w, st.img.drawing].join(":") : mode;
    if (bar.dataset.key === key) return;
    bar.dataset.mode = mode; bar.dataset.key = key; bar.hidden = !mode;
    bar.innerHTML = mode === "table" ? `<span class="dim">Table</span>${CA.editor.TABLE_TOOLS.map(([id, l]) => `<button class="chip" data-act="edTool" data-t="${id}">${l}</button>`).join("")}`
      : mode === "img" ? imgBar(st.img) : "";
  }
  function imgBar(im) {
    const chip = (id, label, on) => `<button class="chip${on ? " on" : ""}" data-act="edTool" data-t="${id}"${on != null ? ` aria-pressed="${on}"` : ""}>${label}</button>`;
    return `<span class="dim">${im.drawing ? "Drawing" : "Image"}</span>${im.drawing ? chip("imgEdit", `${ic("draw")}Edit drawing`) : ""}
      <span class="ns-seg">${CA.editor.IMG_PLACES.map(([p, l]) => chip("img_" + (p || "inline"), l, im.place === p)).join("")}</span>
      <label class="ns-imgw"><span class="dim">Size</span><input type="range" id="nsImgW" min="5" max="100" step="1" value="${im.w || 100}" aria-label="Width, a share of the page"><span class="num" id="nsImgWv">${im.w ? im.w + "%" : "Natural"}</span></label>
      ${chip("imgDel", `${ic("trash")}Delete`)}`;
  }
  // Drawing (draw.js): the layer covers the sheet. Done puts a new drawing at the caret, on a line of its own at the size
  // it was drawn, or a changed one back where it was at the scale you gave it there; erasing everything removes it.
  const drawPct = (w, k) => Math.max(5, Math.min(100, Math.round((w / CA.draw.COL) * 100 * (k || 1))));
  function openDraw(img) {
    const n = S.note, sheet = $(".nsheet"); if (!n || !n.ed || n.draw || !sheet) return;
    const src = img ? img.getAttribute("src") : null, was = src && CA.draw.read(src);
    if (img && !was) return toast("Only drawings made in Collegiapp can be drawn on");
    const k = was && +img.dataset.w ? +img.dataset.w / ((was.box.w / CA.draw.COL) * 100) : 1;
    n.draw = CA.draw.open(sheet, {
      src, keyLabel, onRefuse: (m) => { toast(esc(m)); CA.sound.nope(); },
      onCancel: () => { n.draw = null; n.ed.restoreLast(); },
      onDone: (out) => {
        n.draw = null;
        if (img) n.ed.replaceImg(img, out ? { src: out.src, w: drawPct(out.w, k) } : null);
        else if (out) n.ed.insertDrawing({ src: out.src, w: drawPct(out.w) });
        else n.ed.restoreLast();
        if (out) { CA.sound.ok(); if (n.ed.md().length > 900000) toast("This note is over 900 KB now, so it stays on this device and won't sync", { ms: 9000 }); }
        else if (img) toast(`Drawing removed · ${esc(keyLabel("Mod+Z"))} brings it back`);
        noteInfo();
      },
    });
    CA.sound.whoosh();
  }
  function noteLinkAsk(range, href) {
    const bar = $("#nsBar"); if (!bar) return;
    bar.dataset.mode = "link"; bar.dataset.key = "link"; bar.hidden = false;
    bar.innerHTML = `<span class="dim">Link</span><input id="nsLink" value="${esc(href)}" placeholder="Paste or type a link · Enter · empty removes it" autocomplete="off" spellcheck="false" aria-label="Link address"><button class="btn sm primary" data-act="noteLinkGo">Apply<kbd>Enter</kbd></button><button class="btn sm ghost" data-act="noteLinkX">Cancel<kbd>Esc</kbd></button>`;
    const inp = $("#nsLink"); inp.focus(); inp.select();
  }
  function noteLinkEnd(apply) {
    const bar = $("#nsBar"), n = S.note; if (!bar || !n) return;
    const v = apply ? ($("#nsLink") || {}).value || "" : null;
    bar.hidden = true; bar.dataset.mode = ""; bar.dataset.key = ""; bar.innerHTML = "";
    if (apply) n.ed.link(v.trim()); else n.ed.restore();
  }
  // Closing the sheet keeps the note (or drops a new one left empty) and records the session as one undo step.
  function noteCommit() {
    const n = S.note; if (!n) return;
    if (n.draw) n.draw.done(); // a drawing still open goes into the note first
    S.note = null;
    const it = find(n.id) || (n.ed && null); if (n.ed) n.ed.destroy();
    if (!it) return;
    const md = n.ed ? n.ed.md() : it.notes, t = ($("#nsTitle") || {}).value;
    const patch = {}; if (md !== it.notes) patch.notes = md; if (t != null && t.trim() !== it.title) patch.title = t.trim();
    if (Object.keys(patch).length) { edit(it, patch); n.kept = true; }
    if (!n.kept && !it.title.trim() && !it.notes.trim()) { S.items.splice(S.items.indexOf(it), 1); if (S.sel === it.id) S.sel = null; S.fx = { flip: true }; return; }
    if (!n.kept) { n.kept = true; CA.store.save(it); }
    if (!it.title.trim()) edit(it, { title: NT().titleOf(it.notes) || "Untitled note" });
    const a = snap(it), keys = ["title", "notes", "tags", "course", "status"];
    if (n.isNew || keys.some((k) => JSON.stringify(n.before[k]) !== JSON.stringify(a[k]))) remember({ label: n.isNew ? "new note" : "note edit", pairs: [[n.before, a]], id: it.id });
    S.fx = { flip: true };
  }
  function noteMenu() {
    const m = $("#nsMenu"); if (!m) return;
    if (!m.hidden) { m.hidden = true; return; }
    const it = find(S.note.id), share = !!navigator.share;
    const rows = [["docx", "Word document", ".docx"], ["pdf", "PDF", LIVE && WINOS ? "saved to Downloads" : "print to PDF"], ["print", "Print…", keyLabel("Mod+P")], ["md", "Markdown", ".md"], ["html", "Web page", ".html"], ["txt", "Plain text", ".txt"],
      ["copyMd", "Copy as Markdown", ""], ["copyRich", "Copy for Docs and email", "rich text"], ...(share ? [["share", "Share…", ""]] : []), ["-"], ["dup", "Duplicate", ""], ["archive", it && it.status === "done" ? "Restore from archive" : "Archive", ""], ["del", "Delete", "Del"]];
    m.innerHTML = rows.map(([v, l, h]) => (v === "-" ? `<div class="ns-sep"></div>` : `<div class="pal-it" role="menuitem" data-act="noteOut" data-v="${v}"><span>${esc(l)}</span><span class="sp"></span>${h ? `<span class="dim">${esc(h)}</span>` : ""}</div>`)).join("");
    m.hidden = false;
  }
  // Files out. Inside the app they land in Downloads (save_export); the web demo downloads them.
  function noteMeta(it) { const c = courseOf(it); return [c && c.code, "Edited " + shortDate(it.updated) + ", " + new Date(it.updated).getFullYear()].filter(Boolean).join(" · "); }
  function noteOut(fmt, id) {
    const n = S.note; id = id || (n && n.id);
    if (n && n.id === id && n.ed) n.ed.flush();
    const it = find(id), m = $("#nsMenu"); if (m) m.hidden = true;
    if (!it) return;
    const F = NT().files, c = courseOf(it);
    switch (fmt) {
      case "md": return saveFile(F.name(it.title, "md"), F.md(it, c && c.code), "text/markdown");
      case "txt": return saveFile(F.name(it.title, "txt"), F.txt(it), "text/plain");
      case "html": return saveFile(F.name(it.title, "html"), F.html(it, noteMeta(it)), "text/html");
      case "docx": return F.docxMedia(it).then((media) => saveFile(F.name(it.title, "docx"), F.docx(it, media), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
      case "pdf": return printNote(it, true);
      case "print": return printNote(it, false);
      case "copyMd": return copyOut(F.md(it, c && c.code), null, "Copied as Markdown");
      case "copyRich": return copyOut(NT().toText(it.notes), F.docHTML(it, ""), "Copied · paste into Google Docs, Word or an email");
      case "share": return navigator.share({ title: it.title, text: it.title + "\n\n" + it.notes }).catch(() => {});
      case "dup": { if (n) closeOv(); const d = addNote({ title: it.title + " (copy)", notes: it.notes, tags: it.tags.slice(), course: it.course }); return openNote(d.id); }
      case "archive": { const wasOpen = !!n; if (n) closeOv(); toggleDone(it.id); if (wasOpen && it.status !== "done") openNote(it.id); return; }
      case "del": if (n) closeOv(); return del(it.id);
      case "tasks": return noteTasks(it.id);
    }
  }
  function saveFile(name, data, mime) {
    if (LIVE) {
      const args = typeof data === "string" ? { name, text: data, bytes: null } : { name, text: null, bytes: Array.from(data) };
      return CA.store.invoke("save_export", args).then((path) => {
        toast(`Saved to Downloads · ${esc(String(path).split(/[\\/]/).pop())}`, { ms: 7000, actions: [["Show", () => CA.store.invoke("reveal_export", { path }).catch((e) => toast(esc(String(e))))]] }); CA.sound.ok();
        return path;
      }).catch((e) => toast("Not saved · " + esc(String(e))));
    }
    const url = URL.createObjectURL(new Blob([data], { type: mime })), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Downloaded · " + esc(name)); return Promise.resolve(name);
  }
  // Print and PDF go through the page's print view: #printArea holds the note alone (core.css @media print). On
  // Windows the app writes the PDF itself (WebView2's PrintToPdf); elsewhere the print dialog's "Save as PDF" does.
  function printNote(it, pdf) {
    const area = $("#printArea"), F = NT().files, root = document.documentElement;
    area.innerHTML = `<style>${F.printCss}</style><article class="doc">${F.docHTML(it, noteMeta(it))}</article>`;
    root.classList.add("printing");
    const done = () => { root.classList.remove("printing"); area.innerHTML = ""; };
    if (pdf && LIVE && WINOS) {
      toast("Making the PDF…");
      return CA.store.invoke("save_pdf", { name: F.name(it.title, "pdf") }).then((path) => {
        done(); CA.sound.ok();
        toast(`Saved to Downloads · ${esc(String(path).split(/[\\/]/).pop())}`, { ms: 7000, actions: [["Open", () => CA.store.invoke("open_export", { path }).catch((e) => toast(esc(String(e))))], ["Show", () => CA.store.invoke("reveal_export", { path }).catch(() => {})]] });
      }).catch((e) => { done(); toast("PDF not saved · " + esc(String(e))); });
    }
    if (pdf) toast("Pick “Save as PDF” as the printer", { ms: 7000 });
    window.addEventListener("afterprint", done, { once: true });
    setTimeout(() => (TAURI && MAC ? CA.store.invoke("print_page").catch(() => window.print()) : window.print()), 30);
  }
  function copyOut(text, html, msg) {
    const ok = () => { toast(msg); CA.sound.ok(); }, bad = (e) => toast("Couldn't copy · " + esc(String(e)));
    if (html && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      return navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]).then(ok, bad);
    }
    return navigator.clipboard ? navigator.clipboard.writeText(text).then(ok, bad) : bad("no clipboard here");
  }
  // every unchecked line of a note's checklists becomes a task (the quick-add grammar reads each), one undo step for all
  function noteTasks(id) {
    const it = find(id); if (!it) return;
    if (S.note && S.note.id === id && S.note.ed) S.note.ed.flush();
    const lines = (it.notes || "").split("\n").map((l) => /^\s*[-*+]\s+\[ \]\s+(.+)$/.exec(l)).filter(Boolean).map((m) => m[1].replace(/[*_~=`]/g, "").trim()).filter(Boolean);
    if (!lines.length) return toast("No unchecked items in this note");
    const made = lines.map((l) => addFromText(l + (it.course && !/\b\d{2,3}[a-z]?\b/i.test(l) ? " " + (cById(it.course) || {}).tag : ""), null, true)).filter(Boolean);
    remember({ label: "tasks from a note", pairs: made.map((x) => [Object.assign(snap(x), { deleted: true }), snap(x)]) });
    toast(`Added ${made.length} task${made.length > 1 ? "s" : ""} from ${esc(it.title)}`, { undo: true }); CA.sound.ok(); S.fx = { flip: true }; renderAll();
  }
  function openNoteTpl() {
    openOv("notetpl", dialog("New note from a template", "1–9 · Esc", `<div class="pal-res stag">${NT().TEMPLATES.map((t, i) => `<div class="pal-it" data-act="noteTplGo" data-i="${i}" style="--i:${i}">${i < 9 ? `<kbd>${i + 1}</kbd>` : ""}<span>${esc(t.label)}</span><span class="sp"></span><span class="dim">${esc(NT().preview(t.body, 60))}</span></div>`).join("")}</div>`, "sm"));
  }
  // Files in: each becomes a note; a notes backup (.json) brings back every note in it.
  function noteImport() {
    let inp = $("#noteFileIn");
    if (!inp) { inp = document.createElement("input"); inp.type = "file"; inp.id = "noteFileIn"; inp.multiple = true; inp.hidden = true; inp.accept = ".md,.markdown,.txt,.text,.html,.htm,.docx,.json"; document.body.appendChild(inp); }
    inp.value = ""; inp.click();
  }
  async function noteFiles(files) {
    const made = [], bad = [];
    for (const f of files) {
      try {
        if (/\.json$/i.test(f.name)) { (await restoreBackup(JSON.parse(await f.text()))).forEach((x) => made.push(x)); continue; }
        const d = await NT().readFile(f);
        made.push(addNote({ title: d.title, notes: d.body, tags: d.tags, course: null }, { quiet: true }));
      } catch (e) { bad.push(f.name + " (" + e.message + ")"); }
    }
    if (made.length) {
      remember({ label: made.length > 1 ? "import " + made.length + " notes" : "import", pairs: made.map((x) => [Object.assign(snap(x), { deleted: true }), snap(x)]) });
      toast(`Imported ${made.length} note${made.length > 1 ? "s" : ""}${bad.length ? " · couldn't read " + esc(bad.join(", ")) : ""}`, { undo: true }); CA.sound.ok();
      if (S.view !== "notes") go("notes"); else renderAll();
      if (made.length === 1) openNote(made[0].id);
    } else if (bad.length) toast("Couldn't import " + esc(bad.join(", ")));
  }
  function restoreBackup(data) {
    if (!data || data.format !== "collegiapp-notes" || !Array.isArray(data.notes)) return Promise.reject(new Error("not a Collegiapp notes backup"));
    const have = new Set(S.items.filter(isNote).map((x) => x.title + "\u0000" + x.notes));
    const code = (c) => (c ? (S.courses.find((x) => x.code === c || x.tag === c) || {}).id || null : null);
    return Promise.resolve(data.notes.filter((x) => x && typeof x.notes === "string" && !have.has((x.title || "") + "\u0000" + x.notes))
      .map((x) => addNote({ title: String(x.title || "Untitled note"), notes: x.notes, tags: Array.isArray(x.tags) ? x.tags.map(String) : [], course: code(x.course), status: x.status === "done" ? "done" : "todo", created: +x.created || Date.now() }, { quiet: true })));
  }
  function openBackup() {
    const n = S.items.filter((x) => isNote(x) && !x.deleted).length;
    openOv("backup", dialog("Export all notes", n + " notes · Esc", `<div class="pal-res stag">
      <div class="pal-it" data-act="noteBackupGo" data-v="zip"><span>Markdown files in a .zip</span><span class="sp"></span><span class="dim">opens in Obsidian, VS Code, Notion</span></div>
      <div class="pal-it" data-act="noteBackupGo" data-v="json"><span>Collegiapp backup (.json)</span><span class="sp"></span><span class="dim">Import brings every note back</span></div></div>`, "sm"));
  }
  function noteBackupGo(kind) {
    closeOv();
    const notes = S.items.filter((x) => isNote(x) && !x.deleted), F = NT().files, day = new Date().toISOString().slice(0, 10);
    if (!notes.length) return toast("No notes to export yet");
    if (kind === "json") {
      return saveFile(`Collegiapp notes ${day}.json`, JSON.stringify({ format: "collegiapp-notes", version: 1, exported: new Date().toISOString(),
        notes: notes.map((x) => ({ title: x.title, notes: x.notes, tags: x.tags, course: (courseOf(x) || {}).code || null, status: x.status, created: x.created, updated: x.updated })) }, null, 1), "application/json");
    }
    const used = new Set(), files = notes.map((x) => {
      let nm = F.name(x.title, "md"), k = 2; while (used.has(nm.toLowerCase())) nm = F.name(x.title + " " + k++, "md"); used.add(nm.toLowerCase());
      return [nm, F.md(x, (courseOf(x) || {}).code)];
    });
    return saveFile(`Collegiapp notes ${day}.zip`, NT().zip(files), "application/zip");
  }

  /* ─────────── AI: your own chatbot subscription (ai.js; src-tauri/src/ai.rs runs the CLI) ─────────── */
  // The tool, model and chat site are per device (the CLIs live on this computer), so they stay in localStorage.
  // With a note open the panel sits beside it, so a reply can replace the note or go in at the caret; otherwise a dialog.
  function aiPrefs() {
    let p = null; try { p = JSON.parse(localStorage.getItem("ca.ai") || "null"); } catch (e) { p = null; }
    return Object.assign({ tool: "", model: "", effort: "", site: "claude", share: { items: true, schedule: true, courses: false } }, p);
  }
  function aiSet(patch) { const p = Object.assign(aiPrefs(), patch); try { localStorage.setItem("ca.ai", JSON.stringify(p)); } catch (e) { /* storage off: picks reset */ } return p; }
  // what answers: a signed-in CLI found on this computer, else the chat website by copy and paste
  function aiTool() {
    const p = aiPrefs(), found = (S.aiTools || []).filter((x) => x.found), T = CA.ai.TOOLS;
    const pick = p.tool !== "chat" && LIVE && (found.find((x) => x.id === p.tool) || (!p.tool && found[0]));
    if (pick) { const t = T.find((x) => x.id === pick.id), m = (t.models.find((x) => x[0] === p.model) || t.models[0])[1]; return { kind: "cli", id: t.id, label: `${t.name} · your ${t.sub} plan${p.model ? " · " + m : ""}` }; }
    const s = CA.ai.SITES.find((x) => x[0] === p.site) || CA.ai.SITES[0];
    return { kind: "chat", id: s[0], label: `${s[1]} in your browser · copy and paste` };
  }
  function openAI(o) {
    o = o || {};
    const n = S.overlay === "note" && S.note ? S.note : null;
    if (o.note && (!n || n.id !== o.note)) { openNote(o.note); return openAI(Object.assign({}, o, { note: null })); }
    const host = n ? "side" : "ov", keep = S.ai && S.ai.host === host && S.ai.note === (n ? n.id : null) ? S.ai.run : null;
    S.ai = { host, note: n ? n.id : null, ask: o.ask || (S.ai && S.ai.host === host ? S.ai.ask : ""), run: keep, setup: !!o.setup };
    if (LIVE && !S.aiTools) CA.store.invoke("ai_tools").then((t) => { S.aiTools = t || []; aiRender(); }).catch(() => { S.aiTools = []; aiRender(); });
    if (n) { n.panel = "ai"; n.side = true; $("#nsBody").classList.add("side"); const b = $('#ov [data-act="noteSide"]'); if (b) b.classList.add("on"); }
    else openOv("ai", dialog("Ask AI", "Esc", `<div id="aiHost"></div>`, "ai-dlg"));
    aiRender(true);
    if (o.ask && o.go) aiGo();
  }
  function aiRender(focus) {
    const a = S.ai, host = a && (a.host === "side" ? (S.note && S.note.panel === "ai" && $("#nsSide")) : S.overlay === "ai" && $("#aiHost"));
    if (!host) return;
    const was = $("#aiIn"), val = was ? was.value : a.ask;
    host.innerHTML = a.setup ? aiSetupHTML() : aiHTML(val);
    const inp = $("#aiIn"); if (inp && (focus || was === document.activeElement)) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
  function aiHTML(val) {
    const a = S.ai, p = aiPrefs(), it = a.note && find(a.note), n = S.note && S.note.id === a.note ? S.note : null;
    const sel = n && n.ed ? n.ed.selectionMD() : "", running = a.run && a.run.status === "running";
    const presets = (it ? CA.ai.NOTE_PRESETS : CA.ai.PRESETS).map(([l], i) => `<button class="chip" data-act="aiPreset" data-i="${i}">${esc(l)}</button>`).join("");
    const share = [["items", "Open items"], ["schedule", "Schedule"], ["courses", "Classes"]].map(([k, l]) => `<button class="chip ${p.share[k] ? "on" : ""}" data-act="aiShare" data-v="${k}" aria-pressed="${!!p.share[k]}">${l}</button>`).join("");
    return `<div class="ai">${a.host === "side" ? `<div class="ai-top"><span class="sub-h">${ic("ai")}Ask AI</span><span class="sp"></span><button class="btn ghost sm" data-act="noteOutline" title="Back to the outline">${ic("outline")}</button></div>` : ""}
      <div class="ai-who"><span class="dim">Using</span><b>${esc(aiTool().label)}</b><button class="chip" data-act="aiSetup">Change</button></div>
      <div class="ai-pre">${presets}</div>
      <textarea id="aiIn" rows="3" aria-label="Ask your AI" placeholder="${it ? "About this note, e.g. “make it a study guide with a checklist”" : "Anything, e.g. “plan tonight around the 130A homework”"}">${esc(val || "")}</textarea>
      <div class="ai-share"><span class="dim">Shares</span>${it ? `<span class="chip on static">${ic("notes")}${sel ? "The selection" : "This note"}</span>` : ""}${share}</div>
      <div class="ai-go"><button class="btn primary" data-act="aiGo" ${running ? "disabled" : ""}>${ic("ai")}${running ? "Thinking…" : "Ask"}<kbd>${MOD} Enter</kbd></button>${running ? `<button class="btn" data-act="aiStop">Stop</button>` : ""}<span class="sp"></span><button class="btn ghost sm" data-act="aiRules" title="Notes tagged #ai are instructions your AI always gets">My AI rules</button></div>
      <div class="ai-out" id="aiOut">${aiOutHTML()}</div></div>`;
  }
  function aiOutHTML() {
    const a = S.ai, r = a && a.run;
    if (!r) return `<p class="dim">Your AI gets Collegiapp's formatting rules, your notes tagged <b>#ai</b> and only what's marked under Shares. Changes wait for you to click Apply, and ${MOD}+Z undoes them.</p>`;
    if (r.status === "paste") return `<div class="ai-paste"><p>The prompt is on your clipboard and ${esc((CA.ai.SITES.find((x) => x[0] === aiPrefs().site) || CA.ai.SITES[0])[1])} opened in your browser. Paste it there${r.prefilled ? " (it may already be filled in)" : ""}, then paste the whole reply here:</p>
      <textarea id="aiPaste" rows="5" aria-label="The AI's reply" placeholder="Paste the reply…"></textarea><div class="ai-go"><button class="btn primary" data-act="aiPasteGo">Read reply<kbd>${MOD} Enter</kbd></button><button class="btn ghost" data-act="aiCopy">Copy the prompt again</button></div></div>`;
    if (r.status === "error") return `<div class="ai-err">${ic("close")}<span>${esc(r.err)}</span></div>${r.hint ? `<p class="dim">${r.hint}</p>` : ""}`;
    const pr = CA.ai.parse(r.text, r.media), it = a.note && find(a.note), hasSel = !!(S.note && S.note.ed && S.note.ed.selectionMD());
    const label = (x) => x.type === "replace" ? (it ? "Replace this note's text" : "New note") : x.type === "insert" ? (it ? (hasSel ? "Replace the selection" : "Insert at the cursor") : "New note")
      : x.type === "items" ? `Add ${x.lines.length} task${x.lines.length === 1 ? "" : "s"}` : "New note · " + (x.title || "AI note");
    const prev = (x) => x.type === "items" ? `<ul>${x.lines.slice(0, 8).map((l) => `<li>${esc(l)}</li>`).join("")}${x.lines.length > 8 ? `<li class="dim">+${x.lines.length - 8} more</li>` : ""}</ul>` : `<div class="ai-doc">${NT().toHTML(x.body)}</div>`;
    const acts = pr.actions.map((x, i) => `<div class="ai-act${r.applied && r.applied[i] ? " done" : ""}"><div class="ai-ah"><b>${esc(label(x))}</b><span class="sp"></span>${r.applied && r.applied[i] ? `<span class="dim">${ic("check")}Applied</span>` : `<button class="btn sm primary" data-act="aiApply" data-i="${i}">Apply</button>`}</div>${prev(x)}</div>`).join("");
    const more = pr.actions.length > 1 && !(r.applied && pr.actions.every((_, i) => r.applied[i])) ? `<button class="btn sm" data-act="aiApply" data-i="all">Apply all</button>` : "";
    // while it writes, the part being written ends in a teletype's block cursor (pocket.css .tty), and the dots are only
    // for the wait before the first words
    const tty = (on) => (on && r.status === "running" ? " tty" : "");
    const writing = pr.open ? `<div class="ai-act live"><div class="ai-ah"><b>${esc(label(pr.open))}</b><span class="sp"></span><span class="dim${tty(true)}">writing… ${pr.open.body.split("\n").length} lines</span></div></div>` : "";
    const meta = r.status === "done" ? `<p class="dim ai-meta">${esc(((Date.now() - r.t0) / 1000).toFixed(1))} s${r.usage ? " · " + esc(r.usage) : ""}</p>` : `<p class="dim ai-meta">${r.text ? "" : `<span class="ai-dots"><i></i><i></i><i></i></span>`}${r.text ? "Writing" : "Thinking"}</p>`;
    return `${pr.message ? `<div class="ai-msg${tty(!pr.open)}">${NT().toHTML(pr.message)}</div>` : ""}${acts}${writing}${more}${meta}`;
  }
  let aiRaf = 0;
  function aiOutSoon() { cancelAnimationFrame(aiRaf); aiRaf = requestAnimationFrame(() => { const o = $("#aiOut"); if (o) { o.innerHTML = aiOutHTML(); o.scrollTop = o.scrollHeight; } }); }
  function aiContext(ask) {
    const a = S.ai, p = aiPrefs(), d = new Date(), it = a.note && find(a.note), n = S.note && S.note.id === a.note ? S.note : null;
    const line = (x) => { const c = courseOf(x); return `- ${kLabel(x.kind)}: ${x.title}${c ? " · " + c.code : ""}${x.due ? " · due " + mDue(x.due) : ""}${x.est ? " · ~" + E.fmtDur(x.est * MIN) : ""}${x.pri ? " · " + "!".repeat(x.pri) : ""}`; };
    const soon = E.addDays(E.startOfDay(S.now), 2);
    return {
      ask, now: `${DNL[d.getDay()]}, ${MNL[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${mTime(d.getTime())} · ${CA.quarter.name}, week ${weekInfo().wk}`,
      note: it ? { title: it.title, notes: n && n.ed ? n.ed.md() : it.notes, course: (courseOf(it) || {}).code, tags: it.tags.filter((t) => t.toLowerCase() !== "pinned") } : null,
      selection: n && n.ed ? n.ed.selectionMD() : "",
      items: p.share.items ? ranked().slice(0, 25).map((r) => line(r.it)) : [],
      schedule: p.share.schedule ? scheduleItems().filter((x) => x.due < soon).slice(0, 14).map((x) => `- ${mDue(x.due)}${x.end ? " to " + mTime(x.end) : ""} · ${iLabel(x)}: ${x.title}${courseOf(x) ? " · " + courseOf(x).code : ""}${x.location ? " @ " + x.location : ""}`) : [],
      courses: p.share.courses ? S.courses.filter((c) => c.included).map((c) => `- ${c.code} (${c.tag}): ${c.title}`) : [],
    };
  }
  function aiGo() {
    const a = S.ai, inp = $("#aiIn"), ask = inp ? inp.value.trim() : a.ask;
    if (!a || !ask) return refuse(inp);
    if (a.run && a.run.status === "running") return;
    a.ask = ask;
    // drawings go as short stand-ins, and the reply's stand-ins turn back into them (CA.ai.pack, parse)
    const ctx = aiContext(ask), media = [];
    if (ctx.note) ctx.note.notes = CA.ai.pack(ctx.note.notes, media);
    ctx.selection = CA.ai.pack(ctx.selection, media);
    const sys = CA.ai.system(S.items), prompt = CA.ai.prompt(ctx), tool = aiTool(), p = aiPrefs();
    const r = (a.run = { id: CA.store.uuid(), text: "", status: "running", t0: Date.now(), applied: {}, media });
    if (tool.kind === "cli") {
      CA.store.invoke("ai_run", { id: r.id, tool: tool.id, prompt, system: sys, model: p.model || null, effort: p.effort || null }).then((res) => {
        if (a.run !== r) return;
        r.text = res.text || r.text; r.status = res.error ? "error" : "done"; r.err = res.error; r.hint = res.hint ? esc(res.hint) : ""; r.usage = res.usage || "";
        if (!res.error) CA.sound.ding(); aiRender(); // the carriage's bell at the end of the reply
      }).catch((e) => { if (a.run === r) { r.status = "error"; r.err = String(e); aiRender(); } });
    } else {
      r.status = "paste"; r.chat = CA.ai.forChat(sys, prompt);
      const url = CA.ai.siteUrl(p.site, r.chat); r.prefilled = /\?q=/.test(url);
      copyOut(r.chat, null, "Prompt copied · paste it into the chat").then(() => openLink(url));
    }
    aiRender(); CA.sound.click();
  }
  function onAIChunk(c) {
    const r = S.ai && S.ai.run; if (!r || !c || r.id !== c.id || r.status !== "running") return;
    if (c.delta) r.text += c.delta; else if (c.text != null) r.text = c.text;
    aiOutSoon();
  }
  // Apply one action (or "all"). A change to the open note lands in the editor, so the sheet's one undo step covers it.
  function aiApply(which) {
    const a = S.ai, r = a && a.run; if (!r) return;
    const acts = CA.ai.parse(r.text, r.media).actions, n = S.note && S.note.id === a.note ? S.note : null, it = a.note && find(a.note);
    const made = [];
    (which === "all" ? acts.map((_, i) => i) : [+which]).forEach((i) => {
      const x = acts[i]; if (!x || r.applied[i]) return;
      if ((x.type === "replace" || x.type === "insert") && it) {
        if (n && n.ed) { if (x.type === "replace") n.ed.set(x.body); else { n.ed.restoreLast(); n.ed.insertMD(x.body); } noteSave({ notes: n.ed.md() }); noteInfo(); MO.ack($("#nsEd"), "flash"); }
        else editStep(it, { notes: x.type === "replace" ? x.body : (it.notes ? it.notes.replace(/\s+$/, "") + "\n\n" : "") + x.body }, "AI edit");
      } else if (x.type === "items") x.lines.forEach((l) => { const t = addFromText(l, null, true); if (t) made.push(t); });
      else made.push(addNote({ title: x.title || NT().titleOf(x.body) || "AI note", notes: x.body, course: it ? it.course : null }, { quiet: true }));
      r.applied[i] = true;
    });
    if (made.length) {
      remember({ label: "AI " + (made.length > 1 ? made.length + " new items" : "new " + (isNote(made[0]) ? "note" : "item")), pairs: made.map((x) => [Object.assign(snap(x), { deleted: true }), snap(x)]), id: made[0].id });
      const notes = made.filter(isNote);
      toast(`Added ${made.length > 1 ? made.length + " items" : esc(made[0].title)}`, { undo: true, actions: notes.length === 1 ? [["Open", () => openNote(notes[0].id)]] : [] });
      S.fx = { flip: true }; if (S.overlay !== "note") renderAll();
    }
    CA.sound.ok(); aiOutSoon();
  }
  function aiStop() { const r = S.ai && S.ai.run; if (!r || r.status !== "running") return; CA.store.invoke("ai_cancel", { id: r.id }).catch(() => {}); r.status = "error"; r.err = "Stopped"; aiRender(); }
  function aiRules() {
    const have = CA.ai.rulesNotes(S.items)[0];
    if (have) return openNote(have.id);
    const it = addNote({ title: "My AI rules", tags: ["ai"], notes: "Instructions my AI always follows. Edit them freely; every note tagged #ai counts.\n\n- Use ## headings for sections and keep paragraphs short.\n- Bold key terms the first time they appear.\n- Write formulas in `code`.\n- End lecture notes with a ## Questions checklist." }, { quiet: true });
    toast("Made “My AI rules” · notes tagged #ai are instructions your AI always gets"); openNote(it.id, { focus: "end" });
  }
  function aiSetupHTML() {
    const p = aiPrefs(), tools = S.aiTools, T = CA.ai.TOOLS, cur = aiTool();
    const how = { claude: "Install Claude Code (claude.com/claude-code), then run <code>claude</code> once in a terminal to sign in with your plan.", codex: "<code>npm i -g @openai/codex</code>, then run <code>codex</code> once to sign in with ChatGPT.", gemini: "<code>npm i -g @google/gemini-cli</code>, then run <code>gemini</code> once to sign in with Google." };
    const row = (t) => {
      const f = (tools || []).find((x) => x.id === t.id), on = cur.kind === "cli" && cur.id === t.id;
      return `<div class="ai-tool${on ? " on" : ""}"><div><b>${esc(t.name)}</b> <span class="dim">· ${esc(t.sub)}</span><div class="dim">${!LIVE ? "Runs inside the Collegiapp app" : tools == null ? "Looking…" : f && f.found ? "Found · " + esc(f.path) : how[t.id]}</div></div>${LIVE && f && f.found ? `<button class="chip ${on ? "on" : ""}" data-act="aiPick" data-v="${t.id}">${on ? "In use" : "Use"}</button>` : ""}</div>`;
    };
    const ct = T.find((t) => cur.kind === "cli" && t.id === cur.id);
    return `<div class="ai ai-setup"><div class="ai-top"><span class="sub-h">AI settings</span><span class="sp"></span><button class="btn ghost sm" data-act="aiSetupX">Done</button></div>
      <p class="dim">Collegiapp uses the chatbot plan you already pay for. No API key, nothing billed per use, and only what you share goes to it.</p>
      ${T.map(row).join("")}
      <div class="ai-tool${cur.kind === "chat" ? " on" : ""}"><div><b>Chat website</b> <span class="dim">· any plan, copy and paste</span><div class="seg">${CA.ai.SITES.map(([id, l]) => `<button class="chip ${cur.kind === "chat" && cur.id === id ? "on" : ""}" data-act="aiSite" data-v="${id}">${l}</button>`).join("")}</div></div></div>
      ${ct && ct.models.length > 1 ? `<div class="ai-opt"><span class="dim">Model</span><div class="seg">${ct.models.map(([v, l]) => `<button class="chip ${p.model === v ? "on" : ""}" data-act="aiModel" data-v="${v}">${l}</button>`).join("")}</div></div>` : ""}
      ${ct && ct.id === "claude" ? `<div class="ai-opt"><span class="dim">Effort</span><div class="seg">${[["", "Default"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]].map(([v, l]) => `<button class="chip ${p.effort === v ? "on" : ""}" data-act="aiEffort" data-v="${v}">${l}</button>`).join("")}</div></div>` : ""}
      ${cur.kind === "cli" ? `<div class="ai-go"><button class="btn" data-act="aiTest">${ic("ai")}Test it</button><span class="dim" id="aiTestSt"></span></div>` : ""}</div>`;
  }
  function aiTest() {
    const st = $("#aiTestSt"), tool = aiTool(), p = aiPrefs(); if (st) st.textContent = "Asking…";
    CA.store.invoke("ai_run", { id: CA.store.uuid(), tool: tool.id, prompt: "Reply with the single word: ready", system: "You are a connection test. Reply with one word.", model: p.model || null, effort: "low" })
      .then((res) => { const s = $("#aiTestSt"); if (s) s.innerHTML = res.error ? `<span class="badc">${esc(res.error)}</span>` : `Works · replied “${esc((res.text || "").trim().slice(0, 40))}”${res.usage ? " · " + esc(res.usage) : ""}`; })
      .catch((e) => { const s = $("#aiTestSt"); if (s) s.innerHTML = `<span class="badc">${esc(String(e))}</span>`; });
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
    openOv("snooze", dialog("Snooze · " + esc(it.title), "1–" + opts.length + " · Esc", `<div class="pal-res stag">${opts.map(([l, ts], i) => `<div class="pal-it" data-act="snoozePick" data-i="${i}" style="--i:${i}"><kbd>${i + 1}</kbd><span>${esc(l)}</span><span class="sp"></span><span class="dim">${fDue(ts, now)}</span></div>`).join("")}</div>`, "sm"));
  }
  function snoozePick(i) {
    const it = find(S.snoozeId), o = S.snoozeOpts[i]; closeOv(); if (!it || !o) return;
    editStep(it, { snoozed: o[1] }, "snooze"); S.fx = { flip: true, exit: { [it.id]: "snooze" } };
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
      <span class="dim">Blocks</span><span class="dim">${S.fsetup.level === "soft" ? "nothing — nudges only" : LIVE ? "closes " + (S.blocklist.length ? S.blocklist.join(" · ") : "games and chat apps") + " · sites need the Firefox extension (M3)" : BLOCK_APPS.join(" · ") + " · " + BLOCK_SITES.length + " sites"}</span></div>
      <div class="nb" style="justify-content:center;margin-top:.8em"><button class="btn primary" data-act="fsGo">${ic("play")}Start<kbd>Enter</kbd></button><button class="btn" data-act="closeOv">Cancel<kbd>Esc</kbd></button></div>`;
    S.fsetupBody = body;
    openOv("fsetup", dialog("Focus setup", "Enter start · Esc", `<div id="fsBody">${body()}</div>`, "sm"));
  }
  // Inside the app a session is real (src-tauri/src/focus.rs): Hard and Lockdown close the blocked apps every 2 s
  // and end early only with the phrase. The web demo simulates it.
  function startFocus(id, min, level) {
    closeOv();
    level = level || ui().focusLevel || "hard";
    if (!LIVE) return beginFocus(id, min, level, null);
    CA.store.invoke("start_focus", { minutes: min, level }).then((st) => beginFocus(id, min, level, st)).catch((e) => toast("Focus did not start · " + esc(String(e))));
  }
  function beginFocus(id, min, level, st) {
    const now = Date.now();
    S.focus = { id, start: st ? Date.parse(st.started_at) : now, end: st ? Date.parse(st.ends_at) : now + min * MIN, min, level, killed: 0 };
    S.brk = null; // focusing ends a break
    const it = find(id); if (it && it.status !== "done") edit(it, { status: "doing" });
    CA.sound.ok(); showFocus(true); renderAll();
    CA.fx.osd("▶︎", "Play", $("#ov .focus")); // the tape starts
  }
  // End a session: the Rust session first (a Hard one refuses without the phrase), then the screen.
  function endFocus(completed, phrase) {
    if (!LIVE || !S.focus) return finishFocus(completed);
    CA.store.invoke("end_focus", { phrase: phrase || null }).then(() => finishFocus(completed)).catch((e) => { if (S.focus) S.focus.brk = 0; toast(esc(String(e))); });
  }
  function onFocusTick(st) {
    const f = S.focus; if (!f || !st || !st.active) return;
    f.end = Date.parse(st.ends_at);
    const log = $("#foLog"), fresh = (st.killed || []).slice(f.killed); f.killed = (st.killed || []).length;
    if (log && fresh.length) { log.innerHTML += fresh.map((n) => `<span class="ok">${esc(("> " + n).padEnd(26, ".") + " CLOSED")}</span>\n`).join(""); CA.sound.key(); }
  }
  function showFocus(fresh) {
    const f = S.focus; if (!f) return;
    const it = find(f.id), c = courseOf(it);
    openOv("focus", `<div class="focus"><div class="fo-top">Focus · ${cap(f.level)} level · ends ${mTime(f.end)}${LIVE ? "" : " · simulated in the prototype"}</div>
      <div class="fo-task">${c ? `<span style="${kc(c)}color:var(--kc)">${c.tag}</span> ` : ""}${esc(it ? it.title : "Focus")}</div>
      <div class="display big${f.end - Date.now() <= MIN ? " hot" : ""}"><span class="d-lbl">Time left</span><span class="d-num fo-time num" data-cd data-f="clock" data-t="${f.end}"></span></div>
      <div class="fo-bar meter" id="foBar">${Array.from({ length: 24 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div>
      <div class="fo-log" id="foLog"></div>
      <div class="nb" style="justify-content:center"><button class="btn" data-act="foAdd">+5 min</button>${f.level !== "lockdown" ? `<button class="btn" data-act="foMin">Minimize to island<kbd>Esc</kbd></button>` : ""}<button class="btn primary" data-act="foDone">${ic("check")}Task done</button>${f.level === "soft" ? `<button class="btn" data-act="foBreak">${ic("pause")}Break<kbd>B</kbd></button>` : ""}<button class="btn" data-act="foEnd">End early…</button>${LIVE ? "" : `<button class="btn ghost" data-act="foSkip">Demo: finish now</button>`}</div>
      <div class="fo-exit" id="foExit" hidden><span class="dim">Type “${PHRASE}” to quit early:</span><input id="foPhrase" autocomplete="off" spellcheck="false" aria-label="Exit phrase"></div></div>`, "full");
    focusBar();
    if (fresh) MO.ack($("#ov .display.big"), "boot");
    if (fresh && LIVE) {
      const apps = S.blocklist.length ? S.blocklist.join(" · ").toUpperCase() : "GAMES AND CHAT APPS";
      typeLines($("#foLog"), f.level === "soft" ? ["> FOCUS ARMED · SOFT · " + f.min + ":00", "> NOTHING IS CLOSED · SOFT IS A TIMER"]
        : ["> FOCUS ARMED · " + f.level.toUpperCase() + " · " + f.min + ":00", "> CLOSING ON SIGHT: " + apps, "> SITE BLOCKING ARRIVES WITH THE FIREFOX EXTENSION",
          f.level === "lockdown" ? "> LOCKDOWN · QUIT IS REFUSED UNTIL THE TIMER ENDS" : "> ESC MINIMIZES · IT DOES NOT END THE SESSION"]);
    } else if (fresh) {
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
    const f = S.focus || S.brk, bar = $("#foBar"); if (!f || !bar) return;
    const p = Math.max(0, Math.min(1, (Date.now() - f.start) / (f.end - f.start))), n = Math.round(p * 24);
    $$("i", bar).forEach((x, i) => (x.className = i < n ? "on" : ""));
  }
  function finishFocus(completed) {
    const f = S.focus; if (!f) return;
    const mins = Math.max(1, Math.round((Math.min(Date.now(), f.end) - f.start) / MIN)), full = completed ? f.min : mins;
    addFocusStats(full, completed); S.focus = null;
    if (f.brk) { toast(`+${full} min focused · ${S.stats.focusMin} today`); return startBreak(f.brk, f.id); } // Break on a Soft session
    const it = find(f.id), open = it && it.status !== "done", long = completed && S.stats.sessions > 0 && S.stats.sessions % 4 === 0; // every fourth session earns a long one
    openOv("focusdone", `<div class="focus"><div class="fo-top">Session ${completed ? "complete" : "ended"}</div><div class="fo-time" id="foGain">+${full} min</div><div class="fo-task">${S.stats.focusMin} min focused today · ${S.stats.streak}-day streak</div>
      <div class="nb" style="justify-content:center">${open ? `<button class="btn primary" data-act="done" data-id="${it.id}">${ic("check")}Mark “${esc(it.title)}” done</button>` : ""}<button class="btn${open ? "" : " primary"}" data-act="brk" data-id="${f.id}" data-min="${long ? 15 : 5}">${ic("pause")}${long ? "Long break" : "Break"} · ${long ? 15 : 5} min<kbd>B</kbd></button><button class="btn" data-act="focus" data-id="${f.id}" data-min="25">Keep going +25<kbd>F</kbd></button><button class="btn" data-act="closeOv">Close<kbd>Esc</kbd></button></div></div>`, "full");
    CA.sound.done(); renderAll();
    CA.fx.osd("■", "Stop", $("#ov .focus"));
    // the minutes count up on the LCD, then the pixels go
    MO.count($("#foGain"), full, (n) => "+" + n + " min");
    setTimeout(() => MO.burstAt($("#foGain"), { n: 18, reach: 64, ms: 700 }), 450 * motion());
  }
  // true when it did something (the F key presses its on-screen twins only then)
  function focusTop() {
    if (S.focus) { showFocus(false); return true; }
    const t = target(), pick = t && E.ACTIONABLE(t.kind) ? t : topItem(); // a selected class can't be focused on; fall back to Do First
    if (pick) { startFocus(pick.id, 25); return true; }
    return refuse(hinted("f"));
  }

  // A break is a timer between sessions, kept here and not in focus.rs: it closes nothing, ends any time and counts no
  // focus minutes. A Soft session ends into one; Hard and Lockdown keep their time, so their break comes after.
  const brkNext = (id) => { const it = id && find(id); return it && it.status !== "done" ? it : topItem(); };
  function takeBreak(min) {
    const f = S.focus;
    if (S.brk && !f) { showBreak(false); return true; }
    if (!f) { const t = target(); startBreak(min, t && E.ACTIONABLE(t.kind) ? t.id : null); return true; }
    if (f.level === "soft" || Date.now() >= f.end) { f.brk = min; endFocus(Date.now() >= f.end); return true; }
    toast(`${cap(f.level)} focus · your break comes when it ends at ${mTime(f.end)}`); return refuse($("#ov .display.big"));
  }
  function startBreak(min, id) {
    closeOv();
    const now = Date.now();
    S.brk = { id: id || null, start: now, end: now + min * MIN, min };
    CA.sound.ok(); showBreak(true); renderAll();
    CA.fx.osd("❚❚", "Pause", $("#ov .focus")); // the tape pauses
  }
  function showBreak(fresh) {
    const b = S.brk; if (!b) return;
    const it = brkNext(b.id);
    openOv("brk", `<div class="focus"><div class="fo-top">Break · ${b.min} min · ends ${mTime(b.end)}</div>
      <div class="fo-task">Step away from the screen</div>
      <div class="display big${b.end - Date.now() <= MIN ? " hot" : ""}"><span class="d-lbl">Break left</span><span class="d-num fo-time num" data-cd data-f="clock" data-t="${b.end}"></span></div>
      <div class="fo-bar meter" id="foBar">${Array.from({ length: 24 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div>
      ${it ? `<div class="fo-top">Next · ${esc(it.title)}</div>` : ""}
      <div class="nb" style="justify-content:center"><button class="btn" data-act="brkAdd">+5 min</button><button class="btn" data-act="brkMin">Minimize<kbd>Esc</kbd></button>${it ? `<button class="btn primary" data-act="focus" data-id="${it.id}" data-min="25">${ic("play")}Back to focus · 25<kbd>F</kbd></button>` : ""}<button class="btn" data-act="brkEnd">End break</button></div></div>`, "full");
    focusBar();
    if (fresh) MO.ack($("#ov .display.big"), "boot");
  }
  function finishBreak() {
    const b = S.brk; if (!b) return;
    S.brk = null;
    const it = brkNext(b.id);
    // over another dialog (a note you came back to early) it rings as a toast instead of taking the screen
    if (S.overlay && S.overlay !== "brk") toast(`${ic("bell")}Break over${it ? " · next: " + esc(it.title) : ""}`, { ms: 12000, ring: true, actions: it ? [["Focus 25", () => startFocus(it.id, 25)]] : [] });
    else openOv("brkdone", `<div class="focus"><div class="fo-top">Break over</div><div class="fo-task">${it ? esc(it.title) : "Nothing on Do first"}</div>
      <div class="nb" style="justify-content:center">${it ? `<button class="btn primary" data-act="focus" data-id="${it.id}" data-min="25">${ic("play")}Focus 25<kbd>F</kbd></button>` : ""}<button class="btn" data-act="closeOv">Close<kbd>Esc</kbd></button></div></div>`, "full");
    CA.sound.alarm(); renderAll();
    if (LIVE) CA.store.invoke("break_over", { next: it ? it.title : null }).catch(() => {});
  }

  /* ─────────── interruptions ─────────── */
  function fireAlert(it, level) {
    const c = courseOf(it), lbl = `${c ? c.tag + " " : ""}${it.title}`, trip = tripTo(it), leave = trip ? "leave by " + mTime(trip.leave) : "";
    const zoom = (it.links || []).find((l) => /zoom/i.test(l[0]));
    if (level === "nudge") {
      toast(`${ic("bell")}${esc(lbl)} in ${cdText(it.due - Date.now())}${it.location ? " · " + esc(it.location) : ""}${leave ? " · " + leave : ""}`, { ms: 9000, ring: true, actions: [...(zoom ? [["Zoom", () => openLink(zoom[1])]] : []), ["Snooze 5m", () => { S.alerted[it.id] = false; if (LIVE) setTimeout(() => { const x = find(it.id); if (x && x.due > Date.now()) fireAlert(x, "nudge"); }, 5 * MIN); toast("I'll remind you again in 5 min"); }]] });
      CA.sound.beep(); return;
    }
    CA.sound.alarm();
    const acts = `<button class="btn primary" data-act="alertGo">${ic("walk")}On my way</button>${zoom ? `<button class="btn" data-act="open" data-url="${esc(zoom[1])}">${ic("video")}Join Zoom</button>` : ""}<button class="btn" data-act="alertSkip" data-id="${it.id}">Skipping…</button>`;
    if (level === "takeover") {
      openOv("takeover", `<div class="takeover"><div class="fo-top">Interrupt · takeover</div><div class="big">Get up.</div><div class="fo-task">${esc(lbl)}</div><div class="display big bad"><span class="d-lbl">Starts in</span><span class="d-num num" data-cd data-f="clock" data-t="${it.due}"></span></div>${locBanner(it, trip)}<div class="dim">This screen stays until you answer</div><div class="actions">${acts}</div><div id="skipWhy"></div></div>`, "full");
    } else {
      openOv("alert", `<div class="dialog panel alertbox sm"><div class="ph"><span class="pt">${ic("bell")}${iLabel(it)} soon</span><span class="sp"></span><span class="cnt">Alert</span></div><div class="pb"><div class="nx-t">${esc(lbl)}</div><div class="display"><span class="d-lbl">Starts in</span><span class="d-num num" data-cd data-f="clock" data-t="${it.due}"></span></div>${locBanner(it, trip)}<div class="actions">${acts}</div><div id="skipWhy"></div></div></div>`);
    }
    updateCountdowns(); MO.ack($("#ov .display"), "boot");
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

  // The Rust ticker sends "alert" when a class with an interrupt level is 10 minutes out (src-tauri/src/presence.rs).
  function onAlert(a) {
    const it = a && find(a.item_id); if (!it || S.alerted[it.id]) return;
    S.alerted[it.id] = true;
    if (!S.overlay || a.level === "takeover") fireAlert(it, a.level); else toast(`◷ ${esc(it.title)} in ${cdText(it.due - Date.now())}`);
  }

  /* ─────────── calendar feeds (src-tauri/src/feeds.rs) ─────────── */
  function feedLine(log, url) {
    if (!url) return "Not connected";
    if (!log || !log.checked_at) return "Connected · not checked yet";
    if (!log.ok) return `<span class="nosig"><span>No signal</span></span> <span class="bad">${esc(log.error)}</span>`; // the tag rolls in like a lost picture (pocket.css)
    const n = log.counts || {};
    return `Checked ${agoText(Date.parse(log.checked_at))} · ${n.added} new · ${n.updated} updated · ${n.unchanged} unchanged${n.removed ? " · " + n.removed + " removed" : ""}`;
  }
  function openFeeds() {
    const st = S.settings || {}, fd = S.feeds || {};
    const field = (id, name, where, url, log, ph) => `<div class="feed"><label for="${id}In"><b>${name}</b></label><div class="dim">${where}</div>
      <div class="qa-wrap"><input id="${id}In" class="feed-in" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${url ? "Connected to " + esc(hostOf(url).split("/")[0]) + " · paste a new link to replace" : ph}"></div>
      <div class="dim feed-st" id="${id}St">${feedLine(log, url)}${url ? ` · <button class="chip" data-act="feedOff" data-s="${id === "fC" ? "canvas" : "gcal"}">Disconnect</button>` : ""}</div></div>`;
    const gsOn = !!st.gradescope, gsCourses = (fd.gradescope_courses || []).map((c) => esc(c.short_name)).join(", ");
    const wwCourses = (st.webwork_courses || []).map((c) => esc(c.code)).join(", "), wwOn = !!wwCourses;
    const redo = S.newHere ? signInHere() : []; // just signed in to sync here: the sign-ins still to do
    openOv("feeds", dialog("Connect sources", "Enter import · Esc", `<div class="feeds">
      ${redo.length ? `<div class="dim">Your list and calendar links came over from your other devices. ${redo.join(" and ")} sign${redo.length > 1 ? "" : "s"} in on each device: sign in below and this computer keeps that work up to date too.</div>` : ""}
      ${field("fC", "Canvas calendar feed", "Canvas › Calendar › Calendar feed (bottom right) › copy the link.", st.canvas_feed_url, fd.canvas, "https://canvas.ucsb.edu/feeds/calendars/user_….ics")}
      ${field("fG", "Google Calendar", "Google Calendar › Settings › your calendar › Integrate calendar › Secret address in iCal format.", st.gcal_feed_url, fd.gcal, "https://calendar.google.com/calendar/ical/…/basic.ics")}
      <div class="feed"><b>Sync across devices</b><div class="dim">Your list and notes on your other computers, your phone and the web app, through your own free Firebase project.</div>
      <div class="dim feed-st">${S.cloud && S.cloud.signed_in ? "Signed in as " + esc(S.cloud.email || "you") : S.cloud && S.cloud.configured ? "Not signed in" : "Not set up"} · <button class="chip on" data-act="cloudOpen">${S.cloud && S.cloud.signed_in ? "Sync…" : "Set up…"}</button></div></div>
      <div class="dim">These links work like passwords to your calendars. With sync on they go to your other devices through your own Firebase project, where only your Google account can read them. They're checked every 30 minutes; ${MOD}+R or F5 checks now.</div>
      <div class="feed"><b>Gradescope</b><div class="dim">For classes that post work on Gradescope instead of Canvas. Sign in with your school account in the window that opens; the app then reads this quarter's courses and assignments every 30 minutes and checks off what you've submitted.</div>
      <div class="dim feed-st" id="gsSt">${gsOn ? (gsCourses ? gsCourses + " · " : "") + feedLine(fd.gradescope, "gradescope") : "Not connected"} · <button class="chip ${gsOn ? "" : "on"}" data-act="gsConnect">${gsOn ? "Sign in again" : "Sign in to Gradescope…"}</button>${gsOn ? ' <button class="chip" data-act="gsOff">Disconnect</button>' : ""}</div></div>
      <div class="feed"><b>WeBWorK</b><div class="dim">For math classes that put homework on WeBWorK. Pick your course and sign in with its WeBWorK username and password in the window that opens; the app then reads its open sets and due dates every 20 minutes. WeBWorK signs you out after 30 idle minutes, so after the app has been closed a while you may need to sign in again. Your sets stay either way.</div>
      <div class="dim feed-st" id="wwSt">${wwOn ? wwCourses + " · " + feedLine(fd.webwork, "webwork") : "Not connected"} · <button class="chip ${wwOn ? "" : "on"}" data-act="wwConnect">${wwOn ? "Sign in again or add a course" : "Sign in to WeBWorK…"}</button>${wwOn ? ' <button class="chip" data-act="wwOff">Disconnect</button>' : ""}</div></div>
      ${LIVE ? `<div class="feed"><b>PocketCanvas</b><div class="dim">The Firefox extension for Canvas. It sends your classes with their priority, ghost and hidden choices, all your work (undated work too), and the due dates it reads from WeBWorK and Gradescope with Firefox's own sign-in, so a Google sign-in works there. Connect it from its settings; the app asks you here first.</div>
      <div class="dim feed-st" id="pcSt">Checking…</div></div>
      <div class="feed"><b>Assistants</b><div class="dim">Claude Desktop and Claude Code can search and read your notes, write new ones and add to them from a chat, while the app runs in the tray. Add Collegiapp to one of them, ask Claude for a note, and the app asks you here first. Text an assistant replaces goes to the trash.</div>
      <div class="dim feed-st"><button class="chip on" data-act="mcpDesktop">Add to Claude Desktop</button> <button class="chip" data-act="mcpCode">Add to Claude Code</button></div>
      <div class="dim feed-st" id="asSt">Checking…</div></div>` : ""}
      <div class="nb"><button class="btn primary" data-act="feedSave">${ic("check")}Save and import<kbd>Enter</kbd></button>${st.canvas_feed_url || st.gcal_feed_url || gsOn || wwOn ? '<button class="btn" data-act="syncNow">Refresh now<kbd>F5</kbd></button>' : ""}<button class="btn" data-act="feedFile">Import a .ics file…</button><button class="btn" data-act="closeOv">Close<kbd>Esc</kbd></button></div>
      <input type="file" id="feedFileIn" accept=".ics,text/calendar" hidden></div>`));
    const inp = $("#fCIn"); if (inp) inp.focus();
    if (LIVE) pcClients();
  }
  // PocketCanvas, other browser extensions and assistants (src-tauri/src/bridge.rs): a pairing request shows its code
  // here, and allowing it gives that client a token. Connect sources lists the browsers and assistants you allowed.
  function pcClients() {
    CA.store.invoke("bridge_clients").then((cs) => {
      const ai = (c) => c.kind === "assistant";
      const line = (c) => `${esc(c.name)} · ${c.seen ? (ai(c) ? "used " : "synced ") + agoText(Date.parse(c.seen)) : "connected " + agoText(Date.parse(c.created))} · <button class="chip" data-act="pcForget" data-id="${esc(c.id)}">Disconnect</button>`;
      const put = (sel, list, none) => { const el = $(sel); if (el) el.innerHTML = list.length ? list.map(line).join("<br>") : none; };
      put("#pcSt", cs.filter((c) => !ai(c)), "No browser connected");
      put("#asSt", cs.filter(ai), "No assistant connected");
    }).catch(() => {});
  }
  // Collegiapp's MCP server for Claude (src-tauri/src/mcp.rs): Claude Desktop gets it as an extension saved to Downloads
  // and opened, which shows Claude's Install dialog; Claude Code gets `claude mcp add`, or the command on the clipboard.
  function mcpDesktop() {
    CA.store.invoke("mcp_desktop").then((r) => {
      const file = esc(String(r.path).split(/[\\/]/).pop()), show = [["Show", () => CA.store.invoke("reveal_export", { path: r.path }).catch(() => {})]];
      toast(r.opened ? `Opening ${file} in Claude Desktop · click Install there, then ask Claude for a note` : `Saved ${file} to Downloads · drag it into Claude Desktop › Settings › Extensions`, { ms: 12000, actions: show });
      CA.sound.ok();
    }, (e) => toast(esc(String(e))));
  }
  function mcpCode() {
    CA.store.invoke("mcp_code").then((r) => {
      if (r.added) { toast("Added to Claude Code for every project · ask for a note in a new session", { ms: 9000 }); return CA.sound.ok(); }
      copyOut(r.command, null, `${esc(r.error || "Not added")} · the command that adds it is on your clipboard`);
    }, (e) => toast(esc(String(e))));
  }
  // Sync across devices: your own Firebase project with Google sign-in (src-tauri/src/cloud.rs in the app, cloud.js in the
  // web app; docs/SYNC.md). The app uses the project built in from cloud-config.js (or one pasted here) and signs in on
  // the web app's link page in the browser; the web app signs in with Google on the page.
  const cloudApi = {
    status: () => (CLOUD ? Promise.resolve(CA.cloud.status()) : CA.store.invoke("cloud_status")),
    signIn: () => (CLOUD ? CA.cloud.signIn() : CA.store.invoke("cloud_sign_in")),
    signOut: () => (CLOUD ? CA.cloud.signOut() : CA.store.invoke("cloud_sign_out")),
    now: () => (CLOUD ? CA.cloud.syncNow() : CA.store.invoke("cloud_sync_now")),
    config: (config) => CA.store.invoke("cloud_config", { config }),
  };
  function openSync(edit) {
    if (!OWN) return openOv("sync", dialog("Sync across devices", "Esc", `<div class="feeds"><div class="dim">In the app and the web app this keeps your list and notes the same on every device, through your own free Firebase project and your Google account. The demo keeps everything on this page.</div>
      <div class="nb"><button class="btn" data-act="closeOv">Close<kbd>Esc</kbd></button></div></div>`));
    S.cloudEdit = !!edit;
    cloudApi.status().then((st) => { S.cloud = st; syncDialog(); }, (e) => toast("Sync · " + esc(String(e))));
  }
  // The top bar's sync key. Signed out it says "Sign in" and one click starts it; signed in it's the cloud alone, with a
  // dot for how sync is doing (ok, busy, offline, error), and opens the Sync dialog. Hidden in the demo.
  function cloudKey() {
    const st = S.cloud;
    if (!OWN || !st) return "";
    // the web app is "busy" until Firebase says who's signed in, so a signed-in page doesn't flash "Sign in"
    const k = st.signing_in ? "wait" : st.signed_in ? (st.error ? "bad" : st.offline ? "off" : st.busy ? "busy" : "ok") : st.busy && st.configured ? "busy" : "out";
    const tip = st.signed_in ? [st.email || "Signed in", cloudLine(st), st.error].filter(Boolean).join(" · ")
      : k === "out" ? "Sign in to sync your list and notes across your devices" : cloudLine(st);
    const label = k === "out" ? '<span class="bl">Sign in</span>' : k === "wait" ? '<span class="bl">Signing in</span>' : "";
    return `<button class="btn cloudkey" data-act="cloudKey" data-st="${k}" title="${esc(tip)}" aria-label="${esc(st.signed_in ? "Sync · " + tip : tip)}">${ic("cloud")}${label}<i class="ck-dot" aria-hidden="true"></i></button>`;
  }
  function paintCloudKey() {
    const el = $("#top .cloudkey"), h = cloudKey();
    if (el && el.outerHTML !== h) el.outerHTML = h;
    else if (!el && h && $("#top")) mTop($("#top"));
  }
  function cloudLine(st) {
    if (st.signing_in) return LIVE ? "Waiting for you to sign in on the page in your browser…" : "Signing in…";
    if (st.busy) return "Syncing…";
    if (!st.signed_in) return st.configured ? "Not signed in" : "Not set up";
    const ago = st.last_sync ? "Synced " + agoText(Date.parse(st.last_sync)) : "Signed in";
    return (st.offline ? "Offline · changes wait here" : ago) + (st.pending ? ` · ${st.pending} to upload` : "");
  }
  // the status line's markup: while it syncs, a modem's send and receive lights flicker beside it (pocket.css .modem)
  const cloudStHTML = (st) => esc(cloudLine(st)) + (st.busy ? `<span class="modem" aria-hidden="true"><i data-l="SD"></i><i data-l="RD"></i></span>` : "");
  function syncDialog() {
    const st = S.cloud || {}, form = LIVE && (!st.configured || S.cloudEdit);
    const err = st.error ? `<div class="feed-st"><span class="bad">${esc(st.error)}</span></div>` : "";
    const close = '<button class="btn" data-act="closeOv">Close<kbd>Esc</kbd></button>';
    const body = form ? `<div class="feed"><b>Your Firebase project</b><div class="dim">Free on the Spark plan, with the web app deployed to it (docs/SYNC.md). Paste the web app's config from the Firebase console: the block with apiKey and projectId.${st.built_in || !st.configured ? "" : " Leave it empty to go back to the project built into this app."}</div>
        <div class="qa-wrap"><textarea id="cfIn" class="feed-in ta" rows="5" spellcheck="false" autocapitalize="off" placeholder="const firebaseConfig = { apiKey: &quot;AIza…&quot;, projectId: &quot;collegiapp-…&quot;, … }"></textarea></div></div>
      <div class="dim">None of it is secret; it stays on this device, and your data goes only to your own project.</div>${err}
      <div class="nb"><button class="btn primary" data-act="cloudSave">${ic("check")}Save<kbd>Enter</kbd></button>${st.configured ? '<button class="btn" data-act="cloudBack">Back</button>' : ""}${close}</div>`
      : `<div class="feed"><b>${st.signed_in ? esc(st.email || "Signed in") : "Sign in with Google"}</b><div class="dim">${st.signed_in
        ? `Your list and notes sync through ${esc(st.project_id)} with ${LIVE ? "your other devices and the web app" : "the desktop app and your other devices"}. When two devices change the same thing, the later edit wins.`
        : LIVE ? `Opens ${esc(st.project_id)}'s sign-in page in your browser. What's here goes up and what's there comes down; when both changed, the later edit wins.` : "Use the Google account you signed in with in the desktop app."}</div>
        <div class="dim feed-st" id="cloudSt">${cloudStHTML(st)}</div>${err}</div>
      <div class="dim">${LIVE ? `Your courses, look, calendar links and class picks sync too. Gradescope and WeBWorK sign-ins, paired browsers and text size stay on each device, so sign in to them here as well. An item deleted on another device goes to the trash here.`
        : "Your courses and look sync too; text size stays on each device."}</div>
      <div class="nb">${st.signed_in ? `<button class="btn primary" data-act="cloudNow">${ic("check")}Sync now<kbd>Enter</kbd></button><button class="btn" data-act="cloudOut">Sign out</button>`
        : LIVE && st.signing_in ? `<button class="btn primary" data-act="cloudIn">${ic("check")}Open the page again<kbd>Enter</kbd></button>`
        : `<button class="btn primary" data-act="cloudIn"${st.signing_in ? " disabled" : ""}>${ic("check")}Sign in with Google<kbd>Enter</kbd></button>`}${LIVE && st.signed_in ? '<button class="btn" data-act="feedsOpen">Connect sources</button>' : ""}${LIVE ? '<button class="btn" data-act="cloudEdit">Change project</button>' : ""}${close}</div>`;
    openOv("sync", dialog("Sync across devices", "Enter · Esc", `<div class="feeds">${body}</div>`));
    const f = $("#cfIn"); if (f) f.focus();
  }
  // Gradescope and WeBWorK sign in on each device (docs/SYNC.md): the ones with work on your list that this computer
  // isn't signed in to.
  function signInHere() {
    const st = S.settings || {}, from = new Set(S.items.map((it) => it.src));
    return [["gradescope", "Gradescope", !!st.gradescope], ["webwork", "WeBWorK", !!(st.webwork_courses || []).length]]
      .filter(([id, , on]) => !on && from.has(id)).map(([, name]) => name);
  }
  // After the first sync on a computer signed in to neither (a new one), point at Connect sources: the list, the look
  // and the calendar links came over, but those sign-ins didn't. Connect sources then says so too (S.newHere).
  function hintConnect() {
    const names = LIVE ? signInHere() : [];
    if (!names.length) return;
    S.newHere = true;
    toast(`Your list, look and calendar links are here. ${names.join(" and ")} sign${names.length > 1 ? "" : "s"} in on each device: sign in on this one too`,
      { ms: 15000, ring: true, actions: [["Connect sources", openFeeds]] });
  }
  // a status from cloud.rs or cloud.js: the open dialog follows it, a new sign-in says so, and the web app asks to sign in
  function onCloud(st) {
    const was = S.cloud; S.cloud = st; paintCloudKey();
    if (st.signed_in && was && !was.signed_in) { toast(`Signed in as ${esc(st.email || "you")} · syncing`); CA.sound.ok(); S.cloudNew = true; }
    if (S.cloudNew && st.signed_in && was && was.busy && !st.busy && !st.error) { S.cloudNew = false; reload().then(hintConnect); }
    if (S.overlay === "sync") {
      if ($("#cfIn")) return; // the form is open: keep what's typed
      const same = was && ["signed_in", "signing_in", "configured", "error", "email"].every((k) => was[k] === st[k]), el = $("#cloudSt");
      if (same && el) { el.innerHTML = cloudStHTML(st); if (was.busy && !st.busy) MO.ack(el, "print"); return; } // the result prints when the line drops
      return syncDialog();
    }
    if (CLOUD && !st.signed_in && !st.busy && !st.signing_in && !S.overlay) openSync();
  }
  function cloudSave() {
    const raw = (($("#cfIn") || {}).value || "").trim();
    const pick = (k) => (raw.match(new RegExp(k + "[\"']?\\s*[:=]\\s*[\"']([^\"']+)")) || [])[1] || "";
    const config = { api_key: pick("apiKey"), project_id: pick("projectId") };
    if (raw && (!config.api_key || !config.project_id)) return toast("Paste the web app's config: the block with apiKey and projectId");
    cloudApi.config(config).then((st) => { S.cloud = st; S.cloudEdit = false; CA.sound.ok(); syncDialog(); }, (e) => toast(esc(String(e))));
  }
  function openPair(req) {
    S.pair = req;
    const ai = req.kind === "assistant";
    openOv("pair", dialog(ai ? "Connect an assistant" : "Connect a browser", "Enter allow · Esc", `<div class="feeds">
      <div class="feed"><b>${esc(req.name)} wants to connect</b><div class="dim">${ai ? `Allow it only if ${esc(req.name)} shows the same code in your chat. It can then search and read your notes, write new ones and add to them, and add items. Text it replaces goes to the trash. Disconnect it any time in Connect sources.`
        : "Allow it only if the browser shows the same code. It can then send your Canvas classes and work here, add items and follow your focus sessions. Disconnect it any time in Connect sources."}</div></div>
      <div class="display big"><span class="d-lbl">Code</span><span class="d-num num">${esc(req.code)}</span></div>
      <div class="nb"><button class="btn primary" data-act="pairAnswer" data-v="1">${ic("check")}Allow<kbd>Enter</kbd></button><button class="btn" data-act="pairAnswer" data-v="">Don't allow</button><button class="btn" data-act="closeOv">Later<kbd>Esc</kbd></button></div></div>`));
  }
  function pairAnswer(allow) {
    const req = S.pair; if (!req) return closeOv();
    S.pair = null;
    CA.store.invoke("bridge_answer", { id: req.id, allow }).then(() => { toast(allow ? `${esc(req.name)} is connected` : "Not allowed"); if (allow) CA.sound.ok(); })
      .catch((e) => toast(esc(String(e))));
    closeOv();
  }
  function feedSummary(f) {
    const part = (name, log) => (!log || !log.checked_at ? "" : log.ok ? `${name} ${log.counts.added} new, ${log.counts.updated} updated` : `${name} failed`);
    return [part("Canvas", f.canvas), part("Google", f.gcal), part("Gradescope", f.gradescope), part("WeBWorK", f.webwork)].filter(Boolean).join(" · ") || "Nothing connected yet";
  }
  async function feedSave() {
    const pairs = [["canvas", $("#fCIn")], ["gcal", $("#fGIn")]].filter(([, el]) => el && el.value.trim());
    try {
      for (const [adapter, el] of pairs) S.settings = await CA.store.invoke("set_feed", { adapter, url: el.value.trim() });
    } catch (e) { return toast(esc(String(e))); }
    if (!S.settings || !(S.settings.canvas_feed_url || S.settings.gcal_feed_url)) return toast("Paste a feed link first");
    $$(".feed-st").forEach((el) => (el.textContent = "Importing…"));
    try {
      S.feeds = await CA.store.invoke("refresh_feeds");
      toast("Imported · " + esc(feedSummary(S.feeds)) + (S.feeds.series.length ? " · pick lectures and sections in Classes (7)" : ""), { ms: 7000 }); CA.sound.ok();
    } catch (e) { toast("Import failed · " + esc(String(e))); }
    if (S.overlay === "feeds") openFeeds();
    renderAll();
  }
  function feedFile(file) {
    const r = new FileReader();
    r.onload = () => {
      const text = String(r.result || ""), adapter = /PRODID:[^\r\n]*Instructure|UID:[^\r\n]*assignment/i.test(text) ? "canvas" : "gcal";
      CA.store.invoke("import_ics", { text, adapter }).then((n) => { toast(`Imported ${adapter === "canvas" ? "Canvas" : "Google"} file · ${n.added} new · ${n.updated} updated`); CA.sound.ok(); })
        .catch((e) => toast("Import failed · " + esc(String(e))));
    };
    r.readAsText(file);
  }

  // Gradescope (src-tauri/src/gradescope.rs): a sign-in window; once you're in, the app imports and says so here.
  function gsConnect() {
    CA.store.invoke("gradescope_connect").then(() => toast("Sign in to Gradescope in the window that opened. The app takes it from there.", { ms: 7000 }))
      .catch((e) => toast(esc(String(e))));
  }
  function onGradescope(log) {
    if (!log) return;
    if (log.ok) { toast(`Gradescope connected · ${log.counts.added} new · ${log.counts.updated} updated`, { ms: 7000 }); CA.sound.ok(); }
    else toast("Gradescope · " + esc(log.error), { ms: 9000 });
    reload().then(() => { if (S.overlay === "feeds") openFeeds(); });
  }
  // WeBWorK (src-tauri/src/webwork.rs): the same, one course per sign-in.
  function wwConnect() {
    CA.store.invoke("webwork_connect").then(() => toast("Open your course in the WeBWorK window and sign in. The app takes it from there.", { ms: 7000 }))
      .catch((e) => toast(esc(String(e))));
  }
  function onWebwork(log) {
    if (!log) return;
    if (log.ok) { toast(`WeBWorK connected · ${log.counts.added} new · ${log.counts.updated} updated`, { ms: 7000 }); CA.sound.ok(); }
    else toast("WeBWorK · " + esc(log.error), { ms: 9000 });
    reload().then(() => { if (S.overlay === "feeds") openFeeds(); });
  }

  /* ─────────── courses you add yourself ─────────── */
  function openCourse(id) {
    const c = id ? cById(id) : null, v = (x) => esc(x || "");
    const site = c && c.links.find((l) => !/canvas/i.test(l[0]));
    const box = (fid, label, sub, val, ph) => `<div class="feed"><label for="${fid}"><b>${label}</b></label>${sub ? `<div class="dim">${sub}</div>` : ""}
      <div class="qa-wrap"><input id="${fid}" class="course-in" autocomplete="off" spellcheck="false" value="${v(val)}" placeholder="${ph}"></div></div>`;
    openOv("course", dialog(c ? "Edit " + esc(c.code) : "Add a course", "Enter save · Esc", `<div class="feeds">
      ${box("crCode", "Course code", "As GOLD writes it. Quick add then knows CMPSC 16 as “cs16” and “16”: try “hw5 cs16 fri 11:59p”.", c && c.code, "CMPSC 16")}
      ${box("crTitle", "Name", "", c && c.title, "Problem Solving with Computers I")}
      ${box("crLink", "Course page", "Optional: Gradescope, the class website or anywhere its work is posted.", site && site[1], "https://www.gradescope.com/courses/…")}
      <div class="nb"><button class="btn primary" data-act="courseSave" data-c="${c ? c.id : ""}">${ic("check")}Save<kbd>Enter</kbd></button>${c ? `<button class="btn" data-act="courseDel" data-c="${c.id}">${ic("trash")}Delete or merge…</button>` : ""}<button class="btn" data-act="closeOv">Cancel<kbd>Esc</kbd></button></div></div>`));
    const inp = $("#crCode"); if (inp) inp.focus();
  }
  function courseSave(id) {
    const code = ($("#crCode").value || "").trim().replace(/\s+/g, " ").toUpperCase(), title = ($("#crTitle").value || "").trim(), link = ($("#crLink").value || "").trim();
    if (!code) return toast("Type the course code, like CMPSC 16");
    if (link && !/^https:\/\//i.test(link)) return toast("Paste the full https:// address of the course page");
    const tok = (x) => String(x).toLowerCase().replace(/\s+/g, "");
    const dup = S.courses.find((x) => x.id !== id && tok(x.code) === tok(code));
    if (dup) return toast(`You already have ${esc(dup.code)}`);
    let c = id && cById(id);
    if (!c) {
      let cid = tok(code); while (cById(cid)) cid += "x";
      c = { id: cid, code, tag: "", title: "", color: (S.courses.length % 6) + 1, aliases: [], included: true, quarter: "", canvas_id: null, meet: [], links: [] };
      S.courses.push(c);
    }
    c.code = code; c.tag = CA.store.tagOf(code); c.title = title;
    const old = c.links.find((l) => !/canvas/i.test(l[0]));
    if (old) c.links.splice(c.links.indexOf(old), 1);
    if (link) c.links.push([/gradescope\.com/i.test(link) ? "Gradescope" : /\/webwork2\//i.test(link) ? "WeBWorK" : hostOf(link).split("/")[0], link]);
    CA.store.saveCourse(c).catch((e) => toast("Not saved · " + esc(String(e))));
    closeOv(); toast(`${esc(code)} ${id ? "saved" : `added · press Q and try “hw1 ${esc(c.tag.toLowerCase())} fri”`}`, { ms: 7000 }); CA.sound.ok(); S.fx = { flip: true }; renderAll();
  }

  // Duplicates: two sources naming one class ("CS 130A" from Gradescope, "CMPSC 130A" from Canvas), or the same
  // Canvas course twice. Merging keeps one: delete_course moves the items, links and names over (model.rs remove_course).
  const cKey = (c) => String(c.code).toLowerCase().replace(/\s+/g, "").replace(/^cs(?=\d)/, "cmpsc");
  const dupOf = (c) => S.courses.find((x) => x.id !== c.id && (cKey(x) === cKey(c) || (c.canvas_id && x.canvas_id === c.canvas_id) || (c.title && x.title.toLowerCase() === c.title.toLowerCase())));
  function dupPairs() {
    const seen = new Set(), out = [];
    S.courses.forEach((c) => { const d = dupOf(c); if (d && !seen.has(c.id)) { seen.add(c.id); seen.add(d.id); out.push([d, c]); } });
    return out;
  }
  // The course that stays: the one Canvas owns, else the one with more items.
  const keeperOf = (a, b) => (!!a.canvas_id !== !!b.canvas_id ? (a.canvas_id ? a : b) : S.items.filter((it) => it.course === b.id).length > S.items.filter((it) => it.course === a.id).length ? b : a);
  const synced = (c) => !!c.canvas_id || c.links.some((l) => /gradescope\.com|\/webwork2\//i.test(l[1]));
  function openCourseDel(id, into) {
    const c = cById(id); if (!c) return;
    const n = S.items.filter((it) => it.course === c.id && !it.deleted).length, others = S.courses.filter((x) => x.id !== c.id), d = into ? cById(into) : dupOf(c);
    const nItems = n + (n === 1 ? " item" : " items");
    const merge = others.length ? `<div class="feed"><label for="cdInto"><b>Merge into another course</b></label><div class="dim">For a duplicate. Its ${nItems}, links and names move to the course you keep, so Canvas, Gradescope and WeBWorK file them there from now on.</div>
      <div class="row2"><select id="cdInto" class="cal-course" aria-label="Course to keep">${others.map((x) => `<option value="${x.id}" ${d && x.id === d.id ? "selected" : ""}>${esc(x.code)}${x.title ? " · " + esc(x.title) : ""}</option>`).join("")}</select>
      <button class="btn ${d ? "primary" : ""}" data-act="courseDelGo" data-c="${c.id}" data-v="merge">${ic("check")}Merge${d ? "<kbd>Enter</kbd>" : ""}</button></div></div>` : "";
    const back = synced(c) ? `<div class="dim">${c.canvas_id ? "Canvas" : c.links.some((l) => /gradescope\.com/i.test(l[1])) ? "Gradescope" : "WeBWorK"} lists this course, so the next refresh adds it back. Exclude hides it and its items for good.</div>` : "";
    openOv("coursedel", dialog("Delete " + esc(c.code), (d ? "Enter merge · " : "") + "Esc", `<div class="feeds">${merge}
      <div class="feed"><b>Delete the course</b>${back}<div class="row2">
        ${synced(c) && c.included ? `<button class="btn" data-act="incl" data-c="${c.id}">Exclude instead</button>` : ""}
        <button class="btn" data-act="courseDelGo" data-c="${c.id}" data-v="keep">${ic("trash")}Delete${n ? ", keep its " + nItems : ""}</button>
        ${n ? `<button class="btn" data-act="courseDelGo" data-c="${c.id}" data-v="drop">${ic("trash")}Delete it and its ${nItems}</button>` : ""}</div></div>
      <div class="nb"><button class="btn" data-act="closeOv">Cancel<kbd>Esc</kbd></button></div></div>`, "sm"));
  }
  function courseDelGo(id, mode) {
    const c = cById(id), sel = $("#cdInto"), keep = mode === "merge" && sel && cById(sel.value); if (!c || (mode === "merge" && !keep)) return;
    const n = S.items.filter((it) => it.course === c.id && !it.deleted).length, u = { label: keep ? "merge" : "course delete", undo: courseDel(c, keep, mode) };
    // redo runs it again on the courses the undo put back, which makes a fresh undo
    u.redo = () => { const c2 = cById(id), k2 = keep && cById(keep.id); if (c2 && (!keep || k2)) u.undo = courseDel(c2, k2, mode); };
    remember(u); closeOv(); S.fx = { flip: true };
    toast(keep ? `Merged ${esc(c.code)} into ${esc(keep.code)} · ${n} moved` : `Deleted ${esc(c.code)}${n ? mode === "drop" ? ` and ${n} items` : ` · ${n} items kept as personal` : ""}`, { undo: true });
    CA.sound.ok(); renderAll();
  }
  // Delete a course (merged into `keep`, or with mode "drop" its items too) here and in the store. Returns the undo.
  function courseDel(c, keep, mode) {
    const was = snap(c), keepWas = keep && snap(keep);
    const hit = S.items.filter((it) => it.course === c.id && !it.deleted), prev = hit.map((it) => [it, it.course, it.deleted]);
    CA.store.deleteCourse(c.id, keep && keep.id, mode === "drop").catch((e) => toast("Not deleted · " + esc(String(e))));
    // the same change here, so the list answers at once; the store's items-changed reload then brings Rust's version
    S.courses = S.courses.filter((x) => x.id !== c.id);
    if (keep) {
      c.links.forEach((l) => { if (!keep.links.some((k) => k[1] === l[1])) keep.links.push(l); });
      [c.code, ...c.aliases].forEach((a) => { if (!E.findCourse(a, [keep], true)) keep.aliases.push(a); });
      keep.meet = keep.meet.concat(c.meet);
    }
    hit.forEach((it) => { if (keep) it.course = keep.id; else if (mode === "drop") it.deleted = true; else it.course = null; it.updated = Date.now(); });
    return () => {
      S.courses.push(was); CA.store.saveCourse(was).catch(() => {});
      if (keepWas) { const i = S.courses.findIndex((x) => x.id === keepWas.id); if (i >= 0) S.courses[i] = keepWas; CA.store.saveCourse(keepWas).catch(() => {}); }
      prev.forEach(([it, course, deleted]) => { let cur = find(it.id); if (!cur) { cur = it; S.items.push(it); } Object.assign(cur, { course, deleted, updated: Date.now() }); CA.store.save(cur); });
    };
  }

  /* ─────────── trash (src-tauri/src/trash.rs) ─────────── */
  // What you deleted and the versions an undo threw away, newest first. Picking one puts it back as a step you can undo;
  // the store keeps them compressed and drops the oldest past the limit (50 MB unless you pick another).
  const TRASH_MB = [10, 25, 50, 100, 250, 500, 1000];
  const fmtBytes = (n) => (n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB");
  function openTrash() {
    if (!LIVE) return openOv("trash", dialog("Trash", "Esc", `<div class="trash"><div class="dim">In the app, what you delete and what an undo throws away wait here to be restored. The demo has undo (${MOD}+Z) and redo (${MOD}+Shift+Z).</div></div>`, "sm"));
    CA.store.trash.list().then((t) => showTrash(t, true)).catch((e) => toast("Trash not read · " + esc(String(e))));
  }
  function showTrash(t, open) {
    S.trash = t; S.trashEmpty = false;
    if (!open && S.overlay !== "trash") return;
    const n = t.entries.length, mb = Math.round(t.limit / 1048576), now = Date.now(), pct = Math.min(100, (100 * t.bytes) / t.limit);
    const ago = (at) => (now - Date.parse(at) < MIN ? "just now" : E.fmtRel(Date.parse(at), now));
    const rows = t.entries.slice(0, 300).map((m, i) => { const c = m.course_id && cById(m.course_id);
      return `<div class="pal-it" data-act="trashRestore" data-id="${m.id}" style="--i:${Math.min(i, 10)}"><kbd>${i < 9 ? i + 1 : "·"}</kbd><span class="tr-t"><b>${esc(m.title)}</b><span class="dim">${esc(m.why)} · ${ago(m.at)}${c ? " · " + esc(c.tag) : ""}</span></span><span class="sp"></span><span class="dim">Restore</span></div>`; }).join("");
    const opts = TRASH_MB.concat(TRASH_MB.includes(mb) ? [] : [mb]).sort((a, b) => a - b).map((v) => `<option value="${v}" ${v === mb ? "selected" : ""}>${v >= 1000 ? v / 1000 + " GB" : v + " MB"}</option>`).join("");
    openOv("trash", dialog("Trash", (n ? "1–" + Math.min(n, 9) + " restore · " : "") + "Esc", `<div class="trash">
      <div class="display"><span class="d-lbl">Trash</span><span class="d-num num">${fmtBytes(t.bytes)}</span><span class="d-sub">of ${mb >= 1000 ? mb / 1000 + " GB" : mb + " MB"} · ${n} ${n === 1 ? "version" : "versions"}</span><span class="d-bar"><i style="width:${pct.toFixed(1)}%"></i></span></div>
      ${n ? `<div class="pal-res stag">${rows}</div>` : `<div class="dim">Nothing here yet. What you delete, and what an undo throws away, waits here.</div>`}
      <div class="row2"><label for="trashLimit" class="dim">Keep up to</label><select id="trashLimit" class="cal-course">${opts}</select><span class="dim">Past it the oldest go first.</span></div>
      <div class="nb"><button class="btn" data-act="trashEmpty"${n ? "" : " disabled"}>${ic("trash")}Empty trash</button><button class="btn" data-act="closeOv">Close<kbd>Esc</kbd></button></div></div>`, "sm"));
  }
  function trashRestore(ids) {
    CA.store.trash.restore(ids).then((r) => {
      if (!r.items.length) return;
      r.items.forEach((it) => { const i = S.items.findIndex((x) => x.id === it.id); if (i >= 0) S.items[i] = it; else S.items.push(it); });
      remember({ label: "restore", pairs: r.items.map((it, i) => [r.before[i] || Object.assign(snap(it), { deleted: true }), snap(it)]), id: r.items[0].id });
      S.flashId = r.items[0].id; S.fx = { flip: true }; showTrash(r.trash);
      toast(`Restored · ${esc(r.items[0].title)}${r.items.length > 1 ? ` and ${r.items.length - 1} more` : ""}`, { undo: true }); CA.sound.ok(); renderAll();
    }).catch((e) => toast("Not restored · " + esc(String(e))));
  }
  // Emptying is the one thing here that can't be undone, so it takes a second press.
  function trashEmpty(el) {
    if (!S.trashEmpty) { S.trashEmpty = true; el.classList.add("primary"); el.innerHTML = ic("trash") + "Press again to delete for good"; return; }
    CA.store.trash.purge(null).then((t) => { showTrash(t); toast("Trash emptied"); }).catch((e) => toast("Trash not emptied · " + esc(String(e))));
  }
  function trashLimit(mb) {
    CA.store.trash.limit(mb).then((t) => { if (S.settings) S.settings.trash_limit_mb = mb; showTrash(t); toast(`Trash keeps up to ${mb >= 1000 ? mb / 1000 + " GB" : mb + " MB"}`); })
      .catch((e) => toast("Not saved · " + esc(String(e))));
  }

  function syncNow() {
    if (LIVE) {
      const st = S.settings || {};
      if (!st.canvas_feed_url && !st.gcal_feed_url && !st.gradescope && !(st.webwork_courses || []).length) return openFeeds();
      toast("Refreshing sources…");
      if (S.overlay === "feeds") $$(".feed-st").forEach((el) => (el.textContent = "Checking…"));
      return CA.store.invoke("refresh_feeds").then((f) => { S.feeds = f; toast("Refreshed · " + esc(feedSummary(f))); CA.sound.ok(); })
        .catch((e) => toast(/already/i.test(String(e)) ? "Already refreshing · give it a few seconds" : "Refresh failed · " + esc(String(e))))
        .finally(() => { if (S.overlay === "feeds") openFeeds(); });
    }
    setTimeout(() => { toast("Synced · Windows ⇄ Mac · 0 conflicts · 6 Firestore writes"); CA.sound.ok(); }, 900);
  }

  /* ─────────── updates (src-tauri/src/updater.rs) ─────────── */
  // The app checks GitHub Releases in the background and says so once per version (toast, palette, tray). Installing
  // restarts the app, so it waits for the user, and Rust refuses it during focus.
  function checkUpdate(manual) {
    if (!LIVE || MOBILE) return;
    if (manual) toast("Checking for updates…");
    CA.store.invoke("check_update").then((u) => (u ? openUpdate(u) : manual && toast("Collegiapp is up to date")))
      .catch((e) => manual && toast("Could not check for updates · " + esc(String(e))));
  }
  function onUpdate(u) {
    const fresh = !S.update || S.update.version !== u.version; S.update = u;
    if (fresh && S.overlay !== "update") toast(`${ic("bell")}Collegiapp ${esc(u.version)} is ready`, { ms: 12000, ring: true, actions: [["See what's new", () => openUpdate(u)]] });
  }
  function openUpdate(u) {
    S.update = u;
    const wait = S.focus ? "Finish your focus session first. The update waits for you." : "";
    openOv("update", dialog("Update", "Enter install · Esc", `<div class="upd">
      <div class="display"><span class="d-lbl">New version</span><span class="d-num num">${esc(u.version)}</span><span class="d-sub" id="updSt">You have ${esc(u.current)}</span><span class="d-bar"><i id="updBar" style="width:0%"></i></span></div>
      ${u.notes ? `<div class="upd-notes">${esc(u.notes)}</div>` : ""}
      <div class="dim">${wait || "Collegiapp closes, installs and reopens in a few seconds. Your list and settings stay as they are."}</div>
      <div class="nb"><button class="btn primary" data-act="updGo"${wait ? " disabled" : ""}>${ic("check")}Install and restart<kbd>Enter</kbd></button><button class="btn" data-act="closeOv">Later<kbd>Esc</kbd></button></div></div>`));
  }
  function installUpdate() {
    const b = $("[data-act=updGo]"), st = $("#updSt");
    if (!b || b.disabled) return;
    b.disabled = true; st.textContent = "Downloading…";
    CA.store.invoke("install_update").catch((e) => { b.disabled = false; st.textContent = "Not installed"; toast("Update failed · " + esc(String(e))); });
  }
  function onUpdateProgress(p) {
    const bar = $("#updBar"), st = $("#updSt"); if (!bar) return;
    const pct = p.total ? Math.min(100, Math.round((100 * p.done) / p.total)) : 0;
    bar.style.width = pct + "%"; st.textContent = pct >= 100 ? "Installing · Collegiapp reopens in a moment" : `Downloading · ${pct}%`;
  }

  /* ─────────── item actions ─────────── */
  // Links pasted or typed onto an item go on the end, named after their site (engine.js linkLabel), as one undo step
  // with `patch` (the title a paste into it left).
  function addLinks(it, urls, patch) {
    const add = urls.filter((u) => !it.links.some((l) => l[1] === u));
    if (add.length) patch = Object.assign({}, patch, { links: it.links.concat(add.map((u) => [E.linkLabel(u), u])) });
    if (patch) editStep(it, patch, add.length > 1 ? "new links" : add.length ? "new link" : null);
    if (add.length) { toast(`${add.length > 1 ? add.length + " links" : "Link"} added · ${esc(add.length > 1 ? it.title : E.linkLabel(add[0]) + " → " + it.title)}`, { undo: true }); CA.sound.ok(); }
    else toast("Already linked");
    S.fx = { flip: true }; renderAll();
    return add.length;
  }
  // Pasting a link. A text field takes it as usual (quick add reads it as a link); the details' title and link box put it
  // on the item. With no field focused it goes on the item whose details are open or whose row is selected, else quick
  // add opens with it and the caret in front, to type the rest.
  function onPaste(e) {
    const t = e.target, text = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
    if (!text.trim() || !t.closest || t.closest("#lab")) return;
    const inField = /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable, it = S.sel && find(S.sel);
    const refocus = (sel, end) => MO.after(() => {
      const f = $(sel); if (!f) return; f.focus(); if (!end) return;
      const r = document.createRange(), s = getSelection(); r.selectNodeContents(f); r.collapse(false); s.removeAllRanges(); s.addRange(r);
    });
    if (t.id === "lnkIn") {
      const urls = E.linksIn(text, true); if (!urls.length || !it) return;
      e.preventDefault(); addLinks(it, urls); return refocus("#lnkIn");
    }
    if (t.closest('#insp [data-field="title"]')) {
      const urls = E.linksIn(text); if (!urls.length || !it) return;
      e.preventDefault();
      const rest = (text.match(/\S+/g) || []).filter((w) => !E.linkIn(w)).join(" ");
      if (rest) document.execCommand("insertText", false, rest);
      const v = t.textContent.trim();
      addLinks(it, urls, v && v !== it.title ? { title: v } : null); return refocus('#insp [data-field="title"]', true);
    }
    if (inField || S.overlay) return;
    const urls = E.linksIn(text); if (!urls.length) return;
    e.preventDefault();
    const onScreen = it && !it.deleted && !isNote(it) && ((S.insp && !$("#insp").hidden) || $$(".sel[data-id]", $("#content")).some((el) => el.dataset.id === it.id));
    if (onScreen) return addLinks(it, urls);
    openQuick(" " + text.replace(/\s+/g, " ").trim());
    const inp = $("#qaIn"); if (inp) { inp.setSelectionRange(0, 0); updateQuick(); }
  }
  function select(id, open) {
    if (isNote(find(id))) { S.sel = id; return openNote(id); }
    if (S.sel === id && S.insp && open !== true) { S.insp = false; } else { S.sel = id; S.insp = true; }
    CA.sound.click(); renderAll();
  }
  // Done answers where it was pressed: pixels burst from the key or the check, the row's check stamps and its title
  // strikes as it leaves (renderAll, exit "done"), and the rows below close the gap. It commits at once, so a second X
  // acts on the next item. Clearing the last Do first item plays the fanfare.
  function toggleDone(id, src, kind) {
    const it = find(id); if (!it || E.SCHEDULED(it.kind)) return;
    const row = $(`#list .row[data-k="${id}"]`), before = ranked().length;
    editStep(it, { status: it.status === "done" ? "todo" : "done" }, it.status === "done" ? "reopen" : "done");
    const done = it.status === "done"; S.fx = { flip: true, exit: { [id]: done ? kind || "done" : "out" } };
    if (isNote(it) || it.kind === "info") { toast(done ? `Archived · ${esc(it.title)} · it's in Done` : `Restored · ${esc(it.title)}`, { undo: true }); CA.sound.click(); return renderAll(); }
    if (done) {
      const from = (src && src.isConnected && shown(src) && src) || (row && row.querySelector(".chk")) || $(`#now [data-act="done"][data-id="${id}"]`);
      MO.burstAt(from);
      if (S.focus && S.focus.id === id) focusDone(it);
    }
    toast(done ? `Done · ${esc(it.title)}` : `Reopened · ${esc(it.title)}`, { undo: true });
    if (S.sel === id && done && S.view === "now") S.sel = null;
    renderAll();
    if (!done) return CA.sound.click();
    if (before && !ranked().length) { CA.sound.clear(); MO.after(() => MO.burstAt($("#now .hero-empty"), { n: 22, reach: 72, ms: 760 })); } else CA.sound.done();
  }
  function del(id) {
    const it = find(id); if (!it) return;
    editStep(it, { deleted: true }, "delete"); S.fx = { flip: true, exit: { [id]: "del" } };
    if (S.sel === id) { S.sel = null; S.insp = false; }
    toast(`Deleted · ${esc(it.title)}`, { undo: true }); renderAll();
  }
  function bumpPri(id) {
    const it = find(id); if (!it) return;
    editStep(it, { pri: (it.pri + 1) % 4 }); S.fx = { flip: true };
    toast(`Priority ${it.pri ? "!".repeat(it.pri) : "none"} · ${esc(it.title)}`); CA.sound.click(); renderAll();
    $$(`#list .row[data-k="${id}"] .m-pri, #now .prio`).forEach((el) => { el.dataset.dir = it.pri ? "up" : "down"; MO.ack(el, "bump"); });
  }
  // Undo puts the item back where it was: the rows make room and it drops in, flashing. `u` is a toast's own step (it
  // may not be the last one any more); a version the undo throws away goes to the trash.
  function doUndo(u) {
    if (u && !S.hist.includes(u)) return toast("Already undone");
    u = u || S.hist[S.hist.length - 1];
    if (!u) return toast("Nothing to undo");
    S.hist.splice(S.hist.indexOf(u), 1); S.redo.push(u);
    if (u.undo) u.undo(); else u.pairs.forEach(([b, a]) => put(a, b, "Undone " + u.label));
    const kept = LIVE && u.pairs && u.pairs.some(([, a]) => !a.deleted);
    S.fx = { flip: true }; S.flashId = u.id || null;
    toast("Undid " + u.label + (kept ? " · the undone version is in the trash" : ""), { actions: [["Redo", () => S.redo[S.redo.length - 1] === u && doRedo()], ...(kept ? [["Trash", openTrash]] : [])] });
    renderAll();
    if (S.overlay || !CA.fx.track(true, $("#list"))) CA.sound.undo(); // the tape rewinds (fx.js), with its own sound
  }
  function doRedo() {
    const u = S.redo.pop(); if (!u) return toast("Nothing to redo");
    S.hist.push(u);
    if (u.redo) u.redo(); else u.pairs.forEach(([b, a]) => put(b, a));
    S.fx = { flip: true }; S.flashId = u.id || null;
    toast("Redid " + u.label, { undo: true }); renderAll();
    if (S.overlay || !CA.fx.track(false, $("#list"))) CA.sound.click();
  }
  // N: the next Do first candidate slides in from the right; Shift+N (d = -1) the previous one from the left. Both wrap
  // round, and are refused when there is no other.
  function skip(d) {
    const n = ranked().length; d = d || 1;
    if (n < 2) return refuse(hinted(d < 0 ? "⇧N" : "n"));
    S.skip = (((S.skip + d) % n) + n) % n; S.fx = { skip: d }; CA.sound.click(); renderAll(); return true;
  }
  function moveSel(d) {
    if (!S.listIds.length) return;
    let i = S.listIds.indexOf(S.sel); i = i < 0 ? (d > 0 ? 0 : S.listIds.length - 1) : Math.max(0, Math.min(S.listIds.length - 1, i + d));
    S.sel = S.listIds[i]; CA.sound.key(); renderAll();
    const sel = MO.ack($("#list .row.sel, #list .ncard.sel")), pb = sel && sel.closest(".pb");
    if (sel && pb) { const r = sel.getBoundingClientRect(), b = pb.getBoundingClientRect(); if (r.top < b.top) pb.scrollTop -= b.top - r.top; else if (r.bottom > b.bottom) pb.scrollTop += r.bottom - b.bottom; }
  }
  // Windows: the Win key and the taskbar's Start key open Pocket Start, or Windows' own Start (start.rs `set_win_key`;
  // the tray and Start's Power menu have the same switch, and "start-win-key" keeps S.settings in step with them)
  function setWinKey(on) {
    CA.store.invoke("set_start_win_key", { on }).then(() => {
      if (S.settings) S.settings.start_win_key = on;
      toast(on ? "The Win key opens Pocket Start" : "The Win key opens Windows' Start · Ctrl+Alt+Space still opens Pocket Start"); CA.sound.ok();
    }).catch((e) => toast(esc(String(e))));
  }
  function openLink(url) {
    if (!url) return;
    if (TAURI) { TAURI.core.invoke("open_link", { url }).catch((e) => toast("Could not open link · " + esc(String(e)))); return; }
    toast(`Opening in Firefox → ${esc(hostOf(url))}`); CA.sound.click();
  }
  // Toasts stack like receipts: a new one pushes the others up (they glide), an undo toast drains a bar for the time it
  // has left, and hovering one holds it. opts.ring rings the bell icon (nudges, updates).
  function toast(msg, opts) {
    opts = opts || {};
    const host = $("#toasts"), t = document.createElement("div"), m = motion();
    let left = opts.ms || 4200, t0 = 0, timer = 0;
    t.className = "toast" + (opts.ring ? " ring" : ""); t._actions = opts.actions || []; t._step = opts.undo ? S.hist[S.hist.length - 1] : null;
    t.innerHTML = `<span class="msg">${msg}</span>${opts.undo ? `<button class="btn" data-act="undo">Undo<kbd>${MOD}+Z</kbd></button>` : ""}${t._actions.map((a, i) => `<button class="btn" data-act="toastAct" data-i="${i}">${esc(a[0])}</button>`).join("")}${opts.undo && m ? `<i class="t-life" style="animation-duration:${left}ms"></i>` : ""}`;
    const old = [...host.children], tops = old.map((x) => x.getBoundingClientRect().top);
    host.appendChild(t); while (host.children.length > 4) host.firstChild.remove();
    if (m) old.forEach((x, i) => {
      const dy = x.isConnected ? tops[i] - x.getBoundingClientRect().top : 0;
      if (Math.abs(dy) > 1) x.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 220 * m, easing: MO.EASE });
    });
    const run = () => { t0 = Date.now(); timer = setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, left); };
    t.addEventListener("pointerenter", () => { clearTimeout(timer); left = Math.max(900, left - (Date.now() - t0)); t.classList.add("hold"); });
    t.addEventListener("pointerleave", () => { t.classList.remove("hold"); run(); });
    run();
  }

  /* ─────────── radial menu + key tips ─────────── */
  function openRadial(x, y, it, ser) {
    const el = $("#radial"), s = ser && S.calendarSeries.find((z) => z.id === ser);
    const role = (v) => () => ACTIONS.calmap({ dataset: { s: s.id, v } });
    const opts = s ? (s.hidden ? [["all", "Unhide", () => serHide(s.id)]] : [["classes", "Lecture", role("lecture")], ["all", "Section", role("section")], ["close", "Not a class", role("skip")],
      ...(s.isClass ? [["go", "Course…", () => ACTIONS.serCourse({ dataset: { s: s.id } })]] : []), ["trash", "Hide", () => serHide(s.id)]])
      : isNote(it) ? [["notes", "Open", () => openNote(it.id)], ["pin", isPinned(it) ? "Unpin" : "Pin", () => notePin(it.id)], ["ai", "Ask AI", () => openAI({ note: it.id })],
        ["export", "Word", () => noteOut("docx", it.id)], ["done", it.status === "done" ? "Restore" : "Archive", () => toggleDone(it.id)], ["trash", "Delete", () => del(it.id)]]
      : !it ? [["plus", "Add", () => openQuick()], ["focus", "Focus", focusTop], ["today", "Today", () => go("today")], ["work", "Work", () => go("work")], ["search", "Search", () => openPalette()], ["classes", "Classes", () => go("classes")]]
      : E.SCHEDULED(it.kind) ? [["all", "Details", () => select(it.id, true)], ["bell", "Takeover alert", () => { editStep(it, { interrupt: "takeover" }); toast("Takeover alert set · " + esc(it.title)); }], ["ext", "Links", () => it.links[0] && openLink(it.links[0][1])], ["trash", "Delete", () => del(it.id)]]
      : [["check", "Done", () => toggleDone(it.id)], ["play", "Focus", () => startFocus(it.id, 25)], ["clock", "Snooze", () => openSnooze(it.id)], ["all", "Details", () => select(it.id, true)], ["flag", "Priority +", () => bumpPri(it.id)], ["trash", "Delete", () => del(it.id)]];
    S.radialOpts = opts;
    el.style.left = x + "px"; el.style.top = y + "px";
    el.innerHTML = `<div class="ring"></div><div class="hub">${s ? "Class" : isNote(it) ? "Note" : it ? "Item" : "Menu"}</div>${opts.map((o, i) => { const a = (i / opts.length) * Math.PI * 2 - Math.PI / 2; return `<button class="btn rb" data-act="radial" data-i="${i}" style="--x:${Math.cos(a).toFixed(3)};--y:${Math.sin(a).toFixed(3)};animation-delay:${i * 25}ms">${ic(o[0])}${o[1]}</button>`; }).join("")}`;
    el.hidden = false;
    // measure the laid-out menu (entrances held back) and slide it inside the content, however long its labels
    el.classList.add("sizing");
    const cr = $("#layer").getBoundingClientRect(), m = 0.5 * parseFloat(getComputedStyle($("#content")).fontSize), bx = [...el.children].map((c) => c.getBoundingClientRect());
    const l = Math.min(...bx.map((b) => b.left)), r = Math.max(...bx.map((b) => b.right)), t = Math.min(...bx.map((b) => b.top)), b = Math.max(...bx.map((b) => b.bottom));
    const fit = (lo, hi, min, max) => Math.max(min + m - lo, Math.min(0, max - m - hi));
    el.style.left = x + fit(l, r, cr.left, cr.right) + "px"; el.style.top = y + fit(t, b, cr.top, cr.bottom) + "px";
    el.classList.remove("sizing"); CA.sound.whoosh();
  }
  function closeRadial() { const el = $("#radial"); if (!el.hidden) { MO.leave(el); el.hidden = true; el.innerHTML = ""; return true; } return false; }
  function showTips() {
    if (ui().guide === "g3") return;
    const tips = $("#tips"), cr = $("#layer").getBoundingClientRect();
    tips.innerHTML = $$("[data-hint]", $("#screen")).filter((el) => el.offsetParent && el.getBoundingClientRect().width).map((el, i) => { const r = el.getBoundingClientRect(); return `<span class="tip" style="left:${r.left - cr.left}px;top:${r.top - cr.top}px;--i:${Math.min(i, 16)}">${esc(el.dataset.hint)}</span>`; }).join("");
    tips.hidden = false;
  }
  function hideTips() { const t = $("#tips"); if (t && !t.hidden) { t.hidden = true; t.innerHTML = ""; return true; } return false; }

  /* ─────────── lab bridge ─────────── */
  function openLab() { CA.lab && CA.lab.open(); }

  /* ─────────── events ─────────── */
  const ACTIONS = {
    go: (el) => go(el.dataset.v), q: (el) => { S.view = "all"; setQ(el.dataset.q); }, sel: (el) => select(el.dataset.id),
    toggle: (el) => toggleDone(el.dataset.id, el), done: (el) => { if (S.overlay === "focusdone") closeOv(); toggleDone(el.dataset.id, el); },
    focus: (el) => startFocus(el.dataset.id, +el.dataset.min || 25), snooze: (el) => openSnooze(el.dataset.id), skip: () => skip(), back: () => skip(-1),
    del: (el) => del(el.dataset.id), quick: () => openQuick(), palette: () => openPalette(), help: () => openHelp(), lab: openLab,
    sdGo: (el) => sideGo(el.dataset.node), goClass: (el) => goClass(el.dataset.c, el.dataset.v === "notes"), sdFold: (el) => sideFold(el.dataset.node), sideToggle: () => sideToggle(), sideSwap,
    sideEdit: () => sideEdit(), sdHide, sdDelSec, sdNewSec, sdReset,
    clearQ, rmTerm: (el) => { const t = E.parseFilter(S.q); t.splice(+el.dataset.i, 1); setQ(t.map((x) => x.raw).join(" ")); },
    toggleTerm: (el) => toggleTerm(el.dataset.t), closeInsp: () => { S.insp = false; renderAll(); }, closeOv,
    open: (el) => openLink(el.dataset.url),
    linkDel: (el) => { const it = find(S.sel), i = +el.dataset.i, l = it && it.links[i]; if (!l) return; editStep(it, { links: it.links.filter((_, j) => j !== i) }, "link removal"); toast(`Link removed · ${esc(l[0])}`, { undo: true }); S.fx = { flip: true }; renderAll(); },
    undo: (el) => { const t = el.closest(".toast"); if (t && t._step) doUndo(t._step); if (t) t.remove(); }, toastAct: (el) => { const t = el.closest(".toast"); const a = t && t._actions[+el.dataset.i]; if (a) a[1](); if (t) t.remove(); },
    sortAs: (el) => {
      const it = find(el.dataset.id); if (!it) return;
      editStep(it, { kind: el.dataset.v, status: "todo" });
      S.fx = { flip: true, exit: { [it.id]: "out" } };
      toast(`${esc(it.title)} · ${el.dataset.v === "info" ? "kept as info" : (el.dataset.v === "assignment" ? "homework" : kLabel(el.dataset.v).toLowerCase())}`, { undo: true }); CA.sound.click(); renderAll();
    },
    setf: (el) => { const it = find(S.sel); if (!it) return; const f = el.dataset.f, v = el.dataset.v; editStep(it, { [f]: f === "est" || f === "pri" ? +v : v }); S.fx = { flip: true }; CA.sound.click(); renderAll(); },
    incl: (el) => {
      const c = cById(el.dataset.c); c.included = !c.included; if (S.overlay === "coursedel") closeOv();
      CA.store.saveCourse(c).catch((e) => toast("Not saved · " + esc(String(e))));
      toast(`${c.code} ${c.included ? "included" : "excluded · its items are hidden everywhere"}`); S.fx = { flip: true }; renderAll();
    },
    serHide: (el) => serHide(el.dataset.s), serShowHidden: () => { S.showHidden = !S.showHidden; renderAll(); },
    serCourse: (el) => { const f = $(`.cal-course[data-s="${CSS.escape(el.dataset.s)}"]`); if (f) { f.focus(); if (f.showPicker) try { f.showPicker(); } catch (e) { /* needs a user gesture */ } } },
    calmap: (el) => {
      const s = S.calendarSeries.find((x) => x.id === el.dataset.s), v = el.dataset.v;
      s.isClass = v !== "skip"; s.isSection = v === "section";
      saveClassPicks();
      const c = s.isClass && cById(s.course);
      toast(`${esc(s.name)} → ${!s.isClass ? "not a class" : (s.isSection ? "section" : "lecture") + (c ? " of " + esc(c.code) : " · pick its course") + " (alerts + countdown)"}`); renderAll();
    },
    courseNew: () => openCourse(null), courseEdit: (el) => openCourse(el.dataset.c), courseSave: (el) => courseSave(el.dataset.c || null),
    courseDel: (el) => openCourseDel(el.dataset.c, el.dataset.v), courseDelGo: (el) => courseDelGo(el.dataset.c, el.dataset.v),
    gsConnect, gsOff: () => CA.store.invoke("gradescope_disconnect").then((f) => { S.feeds = f; S.settings.gradescope = false; toast("Gradescope disconnected · its items stay"); openFeeds(); renderAll(); }).catch((e) => toast(esc(String(e)))),
    pairAnswer: (el) => pairAnswer(!!el.dataset.v),
    mcpDesktop, mcpCode,
    pcForget: (el) => CA.store.invoke("bridge_forget", { id: el.dataset.id }).then(() => { toast("Disconnected · its items stay"); pcClients(); }).catch((e) => toast(esc(String(e)))),
    wwConnect, wwOff: () => CA.store.invoke("webwork_disconnect").then((f) => { S.feeds = f; S.settings.webwork_courses = []; toast("WeBWorK disconnected · its items stay"); openFeeds(); renderAll(); }).catch((e) => toast(esc(String(e)))),
    source: (el) => {
      const id = el.dataset.s;
      if (LIVE && ["canvas", "gcal", "gradescope", "webwork"].includes(id)) return openFeeds();
      toast(LIVE ? "Shoreline and the UCSB APIs come next (M2 and M3 in docs/SPEC.md)" : `Source setup · ${esc(srcName(id))} · see docs/SPEC.md § Integrations`);
    },
    feedSave: () => feedSave(), syncNow: () => syncNow(),
    cloudOpen: () => openSync(), feedsOpen: () => openFeeds(),
    cloudKey: () => { const st = S.cloud || {}; if (st.configured && !st.signed_in && !st.signing_in) ACTIONS.cloudIn(); openSync(); },
    cloudSave: () => cloudSave(), cloudEdit: () => openSync(true), cloudBack: () => { S.cloudEdit = false; syncDialog(); },
    cloudIn: () => cloudApi.signIn().then((st) => { if (st) onCloud(st); }, (e) => toast("Sign-in · " + esc(String(e)))),
    cloudOut: () => cloudApi.signOut().then((st) => { if (st) { onCloud(st); toast("Signed out · your data stays here and in your project"); } }, (e) => toast(esc(String(e)))),
    cloudNow: () => {
      // the modem dials: its lights come on at once, before the first status comes back
      CA.sound.modem(); S.cloud = Object.assign({}, S.cloud, { busy: true }); const el = $("#cloudSt"); if (el) el.innerHTML = cloudStHTML(S.cloud);
      cloudApi.now().then((st) => { onCloud(st); toast("Syncing with your other devices"); }, (e) => toast(esc(String(e))));
    }, feedFile: () => { const f = $("#feedFileIn"); if (f) f.click(); }, updGo: installUpdate,
    feedOff: (el) => CA.store.invoke("set_feed", { adapter: el.dataset.s, url: null }).then((st) => { S.settings = st; toast("Disconnected · its items stay"); openFeeds(); renderAll(); }).catch((e) => toast(esc(String(e)))),
    tpl: (el) => { const inp = $("#qaIn"); qaEdClose(); S.qaOver.kind = null; inp.value = TPL[+el.dataset.i][1]; inp.focus(); const k = inp.value.indexOf("  "); inp.setSelectionRange(k + 1, k + 1); updateQuick(); },
    palRun: (el) => runPalette(+el.dataset.i), snoozePick: (el) => snoozePick(+el.dataset.i),
    trashRestore: (el) => trashRestore([el.dataset.id]), trashEmpty, trash: openTrash,
    fsMin: (el) => { S.fsetup.min = +el.dataset.v; $("#fsBody").innerHTML = S.fsetupBody(); }, fsLvl: (el) => { S.fsetup.level = el.dataset.v; $("#fsBody").innerHTML = S.fsetupBody(); },
    fsGo: () => S.fsetup.id && startFocus(S.fsetup.id, S.fsetup.min, S.fsetup.level), focusSetup: () => openFocusSetup(), focusTop,
    foAdd: () => {
      if (!LIVE) { S.focus.end += 5 * MIN; return showFocus(false); }
      CA.store.invoke("extend_focus", { minutes: 5 }).then((st) => { S.focus.end = Date.parse(st.ends_at); showFocus(false); }).catch((e) => toast(esc(String(e))));
    }, foMin: () => { closeOv(); renderAll(); toast("Focus continues · the timer is in the island and the top bar"); },
    foDone: () => { const it = find(S.focus.id); if (it && it.status !== "done") { editStep(it, { status: "done" }, "done"); } focusDone(it); },
    foEnd: () => { if (S.focus.level === "soft") return endFocus(false); const x = $("#foExit"); x.hidden = false; $("#foPhrase").focus(); },
    foSkip: () => { S.focus.end = Date.now(); finishFocus(true); }, foBreak: () => takeBreak(5),
    brk: (el) => startBreak(+el.dataset.min || 5, el.dataset.id), brkShow: () => showBreak(false),
    brkAdd: () => { S.brk.end += 5 * MIN; S.brk.min += 5; showBreak(false); },
    brkMin: () => { closeOv(); renderAll(); toast("Break continues · the timer is in the top bar"); },
    brkEnd: () => { S.brk = null; closeOv(); renderAll(); },
    alertGo: () => { closeOv(); toast("Go. The island keeps the countdown."); CA.sound.ok(); },
    alertSkip: (el) => { $("#skipWhy").innerHTML = `<div class="actions sm" style="justify-content:center;margin-top:.5em"><span class="dim">Why?</span>${["sick", "watching recording", "exam prep", "other"].map((w) => `<button class="chip" data-act="skipWhy" data-w="${w}">${w}</button>`).join("")}</div>`; },
    skipWhy: (el) => { closeOv(); toast(`Skip logged · “${esc(el.dataset.w)}” · shows in your weekly review`); },
    island: () => { S.islandOpen = !S.islandOpen; renderIsland(); CA.sound.click(); },
    tdone: (el) => { const t = target(); if (t) toggleDone(t.id); else refuse(el); }, tsnooze: (el) => { const t = target(); if (t) openSnooze(t.id); else refuse(el); },
    qaGo: () => { const v = $("#qaIn").value; if (!v.trim()) return refuse($(".qa-wrap")); closeOv(); addFromText(v, null, false, S.qaOver); renderAll(); },
    calMode: (el) => {
      if (S.cal.mode === el.dataset.v) return;
      S.cal.mode = el.dataset.v; if (S.cal.at != null && S.cal.mode === "month") { const d = new Date(S.cal.at); S.cal.at = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
      S.animRows = true; CA.sound.click(); renderAll();
    },
    calStep: (el) => calStep(+el.dataset.d),
    dvAdd: (el) => quickWith("  " + el.dataset.v),
    calToday: () => { S.cal.at = null; S.animRows = true; CA.sound.click(); renderAll(); },
    calDay: (el) => { S.cal.mode = "day"; S.cal.at = +el.dataset.t; S.animRows = true; CA.sound.click(); renderAll(); },
    radial: (el) => { const o = S.radialOpts[+el.dataset.i]; closeRadial(); o && o[2](); },
    focusQ: () => { const f = $("#fq"); if (f) f.focus(); },
    winMin: () => WIN && WIN.minimize().catch(() => {}), winMax: () => WIN && WIN.toggleMaximize().catch(() => {}),
    winClose: () => WIN && WIN.close().catch(() => {}),
    // notes
    noteNew: (el) => newNote(el.dataset.v === "list" ? NT().TEMPLATES[1] : null), noteOpen: (el) => openNote(el.dataset.id), noteTpl: openNoteTpl,
    noteTplGo: (el) => { closeOv(); newNote(NT().TEMPLATES[+el.dataset.i]); }, noteImport, noteBackup: openBackup, noteBackupGo: (el) => noteBackupGo(el.dataset.v),
    quickMode: (el) => openQuick("", el.dataset.v), qaMode: (el) => switchMode(el.dataset.v), qaSave: (el) => saveCapture(el.dataset.v === "open"),
    qaEd: (el) => qaEdit(el.dataset.k), qaEdSet: (el) => qaApply(el.dataset.v || null, el), qaEdSave: () => { const f = $("#qaEdIn"); if (f) qaApply(f.value, f); },
    qaListAs: (el) => { S.qaListAs = el.dataset.v; $$(".qa-as .chip").forEach((c) => { c.classList.toggle("on", c.dataset.v === S.qaListAs); c.setAttribute("aria-pressed", c.dataset.v === S.qaListAs); }); updateQuick(); const t = $("#qaTx"); if (t) t.focus(); },
    edTool: (el) => S.note && S.note.ed && S.note.ed.run(el.dataset.t), draw: (el) => S.note && S.note.draw && S.note.draw.act(el.dataset.d, el.dataset.v), noteMenu, noteOut: (el) => noteOut(el.dataset.v), notePin: () => S.note && notePin(S.note.id),
    noteSide: (el) => {
      const n = S.note; if (!n) return;
      n.side = S.noteSide = !n.side; n.panel = "outline"; $("#nsBody").classList.toggle("side", n.side); el.classList.toggle("on", n.side); el.setAttribute("aria-pressed", n.side); noteInfo();
    },
    noteGoto: (el) => { const h = S.note && S.note.ed.headings()[+el.dataset.i]; if (h) { h.el.scrollIntoView({ block: "start", behavior: motion() ? "smooth" : "auto" }); MO.ack(h.el, "flash"); } },
    noteTasks: () => S.note && noteTasks(S.note.id), noteLinkGo: () => noteLinkEnd(true), noteLinkX: () => noteLinkEnd(false),
    noteAI: () => openAI({ note: S.note && S.note.id }), ai: () => openAI(),
    noteOutline: () => { if (S.note) { S.note.panel = "outline"; noteInfo(); } },
    // AI
    aiGo, aiStop, aiApply: (el) => aiApply(el.dataset.i), aiRules, aiTest,
    aiPreset: (el) => {
      const pr = (S.ai.note ? CA.ai.NOTE_PRESETS : CA.ai.PRESETS)[+el.dataset.i], inp = $("#aiIn"); if (!pr || !inp) return;
      inp.value = pr[1]; S.ai.ask = pr[1];
      if (/: $/.test(pr[1])) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } else aiGo();
    },
    aiShare: (el) => { const p = aiPrefs(); p.share[el.dataset.v] = !p.share[el.dataset.v]; aiSet({ share: p.share }); aiRender(); },
    aiSetup: () => { S.ai.ask = ($("#aiIn") || {}).value || S.ai.ask; S.ai.setup = true; aiRender(); }, aiSetupX: () => { S.ai.setup = false; aiRender(true); },
    aiPick: (el) => { aiSet({ tool: el.dataset.v, model: "" }); aiRender(); }, aiSite: (el) => { aiSet({ tool: "chat", site: el.dataset.v }); aiRender(); },
    aiModel: (el) => { aiSet({ model: el.dataset.v }); aiRender(); }, aiEffort: (el) => { aiSet({ effort: el.dataset.v }); aiRender(); },
    aiPasteGo: () => { const r = S.ai && S.ai.run, v = ($("#aiPaste") || {}).value || ""; if (!r || !v.trim()) return refuse($("#aiPaste")); r.text = v; r.status = "done"; aiRender(); },
    aiCopy: () => { const r = S.ai && S.ai.run; if (r && r.chat) copyOut(r.chat, null, "Prompt copied again"); },
  };

  // The key that was clicked springs back up (.ack). Most actions re-render, so the key may be a new element by then:
  // find it again by what it is (its kind, action and data) inside the same region.
  const ACK = ["btn", "nv", "chip", "wk", "row", "fpill", "pal-it"];
  function ackKey(a) {
    if (!motion() || a.closest(".gone")) return;
    const kind = ACK.find((c) => a.classList.contains(c)); if (!kind) return;
    const d = a.dataset, sig = "." + kind + ["act", "id", "v", "i", "f", "t", "s", "c", "min"].map((k) => (d[k] != null ? `[data-${k}="${CSS.escape(d[k])}"]` : "")).join("");
    const host = a.parentElement && a.parentElement.closest("[id]"), hid = host && host.id;
    MO.after(() => {
      if (a.isConnected) return MO.ack(a);
      const root = hid && document.getElementById(hid), b = root && root.querySelector(sig);
      if (b) MO.ack(b);
    });
  }

  // Horizontal strips (view keys, quick filters, a narrow week) hide their scrollbars, so a mouse needs a way
  // past the edge: the wheel scrolls them sideways (until the end, then the page scrolls), a drag pans them without
  // pressing the chip it started on, and an edge fades only while there's more that way (data-more="l r"). A render keeps
  // each strip where it was and brings the current view key into view.
  const STRIPS = ".nkeys, .qstrip, .week, .ns-tools";
  const hscroll = (el) => el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX);
  function stripEdges(el) {
    const more = [el.scrollLeft > 1 && "l", el.scrollLeft + el.clientWidth < el.scrollWidth - 1 && "r"].filter(Boolean).join(" ");
    if (el.dataset.more !== more) el.dataset.more = more;
  }
  const stripKey = (el) => (el.closest("[id]") || {}).id + "|" + el.className.split(" ")[0];
  function stripScroll(saved) {
    const els = $$(STRIPS);
    if (!saved) return new Map(els.map((el) => [stripKey(el), el.scrollLeft]));
    els.forEach((el) => {
      const x = saved.get(stripKey(el)); if (x) el.scrollLeft = x;
      const on = el.matches(".nkeys") && $(".nv.on", el);
      if (on && hscroll(el)) { const a = el.getBoundingClientRect(), b = on.getBoundingClientRect(); if (b.left < a.left || b.right > a.right) el.scrollLeft += b.left < a.left ? b.left - a.left - 8 : b.right - a.right + 8; }
      stripEdges(el);
    });
  }
  function bindStrips() {
    document.addEventListener("scroll", (e) => { const el = e.target; if (el.matches && el.matches(STRIPS)) stripEdges(el); }, true);
    window.addEventListener("resize", () => $$(STRIPS).forEach(stripEdges));
    document.addEventListener("wheel", (e) => {
      // pinch zoom, Shift+wheel and a touchpad's sideways swipe already do the right thing
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const el = e.target.closest && e.target.closest(STRIPS); if (!el || !hscroll(el)) return;
      // the week's days scroll up and down inside the list, so the wheel stays vertical there while it can
      const pb = el.matches(".week") && el.closest(".pb"); if (pb && pb.scrollHeight > pb.clientHeight + 1) return;
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientWidth : e.deltaY, max = el.scrollWidth - el.clientWidth;
      if ((d > 0 && el.scrollLeft >= max - 1) || (d < 0 && el.scrollLeft <= 0)) return;
      e.preventDefault(); el.scrollLeft += d; stripEdges(el);
    }, { passive: false });
    let pan = null;
    document.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const el = e.target.closest && e.target.closest(STRIPS); if (!el || e.target.closest("input, textarea, select") || !hscroll(el)) return;
      pan = { el, id: e.pointerId, x: e.clientX, left: el.scrollLeft, moved: false };
    });
    document.addEventListener("pointermove", (e) => {
      if (!pan || e.pointerId !== pan.id || S.sorting) return;
      const dx = e.clientX - pan.x;
      if (!pan.moved) { if (Math.abs(dx) < 5) return; pan.moved = true; pan.el.classList.add("panning"); }
      pan.el.scrollLeft = pan.left - dx; stripEdges(pan.el);
    });
    const endPan = (e) => {
      if (!pan || e.pointerId !== pan.id) return;
      if (pan.moved) { pan.el.classList.remove("panning"); S.noClickUntil = Date.now() + 250; } // the click that ends a drag isn't a press
      pan = null;
    };
    document.addEventListener("pointerup", endPan); document.addEventListener("pointercancel", endPan);
  }
  // Your order of the view keys. One that matches the first order is saved as none, so it syncs as the default.
  function setTabs(ids, msg) {
    if (!CA.lab) return;
    CA.lab.set({ tabs: ids.join() === TAB_IDS.join() ? [] : ids }, { light: true });
    renderAll(); if (msg) toast(esc(msg));
  }
  function moveTab(id, d) {
    const ids = tabs().map((v) => v.id), i = ids.indexOf(id);
    if (i < 0 || i + d < 0 || i + d >= ids.length) return CA.sound.nope();
    ids.splice(i + d, 0, ids.splice(i, 1)[0]); setTabs(ids); CA.sound.tick();
    MO.after(() => { const b = $(`.nkeys .nv[data-v="${id}"]`); if (b) { MO.ack(b); b.scrollIntoView({ block: "nearest", inline: "nearest" }); } });
  }
  // Hold a view key and drag it along the strip to put it somewhere else; the others make room. A mouse lifts it on a
  // drag where the strip fits, and after a quarter-second hold where it scrolls (a quick drag pans it); touch lifts it
  // with a long-press. Esc puts it back. A press let go where it started is still a click.
  function bindTabSort() {
    let s = null;
    const keysIn = (strip) => $$(".nv", strip);
    function lift() {
      if (!s || s.on) return;
      const r = s.key.getBoundingClientRect();
      s.on = true; s.gx = s.x - r.left; S.sorting = true;
      s.strip.classList.add("sorting"); s.key.classList.add("lift");
      CA.sound.tick(); if (navigator.vibrate) navigator.vibrate(8);
    }
    // the lifted key under the pointer; it trades places with a neighbour once the pointer passes that one's middle
    function follow(x) {
      const strip = s.strip, a = strip.getBoundingClientRect();
      if (hscroll(strip)) { if (x < a.left + 32) strip.scrollLeft -= 10; else if (x > a.right - 32) strip.scrollLeft += 10; stripEdges(strip); }
      const others = keysIn(strip).filter((b) => b !== s.key);
      const before = others.find((b) => { const r = b.getBoundingClientRect(); return x < r.left + r.width / 2; });
      if ((before || null) !== s.key.nextElementSibling || (!before && strip.lastElementChild !== s.key)) {
        const was = new Map(others.map((b) => [b, b.getBoundingClientRect().left]));
        strip.insertBefore(s.key, before || null);
        if (motion()) others.forEach((b) => { const dx = was.get(b) - b.getBoundingClientRect().left; if (dx) b.animate([{ translate: `${dx}px 0` }, { translate: "0 0" }], { duration: 160 * CA.motion.level + 1, easing: "cubic-bezier(.2, .9, .3, 1)" }); });
      }
      s.key.style.translate = "";
      s.key.style.translate = `${Math.round(x - s.gx - s.key.getBoundingClientRect().left)}px 0`;
    }
    function finish(keep) {
      const t = s; s = null; S.sorting = false; clearTimeout(t.t);
      if (!t.on) return;
      t.strip.classList.remove("sorting"); t.key.classList.remove("lift"); t.key.style.translate = "";
      const ids = keysIn(t.strip).map((b) => b.dataset.v), same = ids.join() === tabs().map((v) => v.id).join();
      if (!same || t.far) S.noClickUntil = Date.now() + 250; // the click that ends a drag isn't a press
      if (same) return; // back where it was: a slow or shaky click is still a click
      if (keep) { setTabs(ids); CA.sound.tick(); } else renderAll();
    }
    document.addEventListener("pointerdown", (e) => {
      if (s || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      const key = e.target.closest && e.target.closest(".nkeys .nv"); if (!key) return;
      s = { key, strip: key.parentElement, pid: e.pointerId, x: e.clientX, y: e.clientY, on: false, far: false, mouse: e.pointerType === "mouse" };
      s.t = setTimeout(lift, s.mouse ? 250 : 420);
    });
    document.addEventListener("pointermove", (e) => {
      if (!s || e.pointerId !== s.pid) return;
      const d = Math.hypot(e.clientX - s.x, e.clientY - s.y);
      if (!s.on) { if (d <= 8) return; if (s.mouse && !hscroll(s.strip)) lift(); else { clearTimeout(s.t); s = null; return; } }
      e.preventDefault(); s.far = s.far || d > 12;
      follow(e.clientX);
    });
    document.addEventListener("pointerup", (e) => { if (s && e.pointerId === s.pid) finish(true); });
    document.addEventListener("pointercancel", (e) => { if (s && e.pointerId === s.pid) finish(false); });
    // a lifted key keeps the finger: the strip doesn't scroll under it
    document.addEventListener("touchmove", (e) => { if (s && s.on) e.preventDefault(); }, { passive: false });
    document.addEventListener("keydown", (e) => { if (s && s.on && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } }, true);
  }
  function bind() {
    bindStrips();
    bindTabSort();
    bindSide();
    document.addEventListener("click", (e) => {
      if (Date.now() < S.noClickUntil) { e.preventDefault(); return; } // a swipe or long-press just ended
      const radial = $("#radial"); if (!radial.hidden && !e.target.closest("#radial")) closeRadial();
      const a = e.target.closest("[data-act]"); if (!a || !ACTIONS[a.dataset.act]) return;
      if (a.closest("#lab")) return;
      if (a.dataset.act === "island" && e.target.closest(".is-more")) return;
      e.preventDefault(); ACTIONS[a.dataset.act](a, e);
      if (!a.classList.contains("nope")) ackKey(a);
    });
    document.addEventListener("dblclick", (e) => { const r = e.target.closest(".row"), it = r && find(r.dataset.id); if (it && !E.SCHEDULED(it.kind) && !isNote(it)) startFocus(it.id, 25); });
    document.addEventListener("contextmenu", (e) => {
      if (S.sorting) return e.preventDefault();
      const content = $("#content"); if (!content.contains(e.target) || e.target.closest("input, textarea, select")) return;
      e.preventDefault(); const cr = $("#layer").getBoundingClientRect(), row = e.target.closest(".row, .un-row, .wi, .ag, .ncard, .sd-row[data-id]"), ser = e.target.closest("[data-ser]");
      openRadial(e.clientX - cr.left, e.clientY - cr.top, row ? find(row.dataset.id) : null, ser && ser.dataset.ser);
    });
    // touch: long-press opens the radial menu (iOS fires no contextmenu); swiping a row right marks it done, left snoozes it
    let press = null, lp = null;
    const swallow = () => { S.noClickUntil = Date.now() + 450; };
    const lpOff = () => { if (lp) { lp.remove(); lp = null; } };
    document.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" || !e.isPrimary || !$("#content").contains(e.target) || e.target.closest("input, textarea, select, [contenteditable], .nkeys, .sd-sort")) return;
      const row = e.target.closest("#list .row.mrow"), it = row && find(row.dataset.id);
      const ser = e.target.closest("[data-ser]");
      press = { x: e.clientX, y: e.clientY, it, ser: ser && ser.dataset.ser, row: it && !E.SCHEDULED(it.kind) ? row : null, dx: 0 };
      press.t = setTimeout(() => { lpOff(); if (!press || press.dx) return; const cr = $("#layer").getBoundingClientRect(); swallow(); openRadial(press.x - cr.left, press.y - cr.top, press.it, press.ser); press = null; }, 520);
      // the ring fills toward the radial menu (pocket.css .lpress)
      lpOff(); const layer = $("#layer");
      if (motion() && layer) { const lr = layer.getBoundingClientRect(); lp = document.createElement("i"); lp.className = "lpress"; lp.style.left = e.clientX - lr.left + "px"; lp.style.top = e.clientY - lr.top + "px"; layer.appendChild(lp); }
    });
    document.addEventListener("pointermove", (e) => {
      if (!press || !e.isPrimary) return;
      const dx = e.clientX - press.x, dy = e.clientY - press.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) lpOff();
      if (!press.dx && Math.abs(dy) > 10) { clearTimeout(press.t); press = null; return; } // scrolling, not a gesture
      if (press.row && (press.dx || Math.abs(dx) > 12)) {
        clearTimeout(press.t); press.dx = dx; press.row.style.translate = `${dx}px 0`; press.row.classList.add("drag");
        const sw = dx > 90 ? "done" : dx < -90 ? "snooze" : "";
        if (sw !== (press.row.dataset.swipe || "")) { press.row.dataset.swipe = sw; if (sw) { CA.sound.tick(); if (navigator.vibrate) navigator.vibrate(8); } } // a detent at the threshold
      }
    });
    const release = (e) => {
      if (!press) return; clearTimeout(press.t);
      lpOff(); const p = press; press = null; if (!p.row || !p.dx) return;
      p.row.classList.remove("drag"); delete p.row.dataset.swipe; swallow();
      // a done row leaves from where it was dragged to; any other springs back (pocket.css transitions translate)
      if (e.type === "pointerup" && p.dx > 90) return toggleDone(p.row.dataset.id, null, "swipe");
      p.row.style.translate = "";
      if (e.type === "pointerup" && p.dx < -90) openSnooze(p.row.dataset.id);
    };
    document.addEventListener("pointerup", release); document.addEventListener("pointercancel", release);
    document.addEventListener("input", (e) => {
      const t = e.target;
      if (t.id === "qaIn" || t.id === "qaTx") { if (S.qaEdK) qaEdClose(); updateQuick(); }
      else if (t.id === "nsTitle") { clearTimeout(S.titleT); S.titleT = setTimeout(() => { const v = t.value.trim(); const it = S.note && find(S.note.id); if (it && v && v !== it.title) noteSave({ title: v }); }, 400); }
      else if (t.id === "palIn") { S.palI = 0; updatePalette(); }
      else if (t.id === "foPhrase" && t.value.trim().toLowerCase() === PHRASE) endFocus(false, t.value);
      else if (t.id === "nsImgW" && S.note && S.note.ed) { S.note.ed.imgLive(+t.value); const v = $("#nsImgWv"); if (v) v.textContent = t.value + "%"; }
    });
    document.addEventListener("change", (e) => {
      const t = e.target;
      if (t.id === "feedFileIn") { if (t.files && t.files[0]) feedFile(t.files[0]); t.value = ""; return; }
      if (t.id === "trashLimit") return trashLimit(+t.value);
      if (t.id === "noteFileIn") { if (t.files && t.files.length) noteFiles([...t.files]); return; }
      if (t.id === "nsCourse") return noteSave({ course: t.value || null });
      if (t.id === "nsImgW") return S.note && S.note.ed && S.note.ed.imgSet({ w: +t.value });
      if (t.id === "nsTags") {
        const it = S.note && find(S.note.id); if (!it) return;
        const tags = t.value.split(/[\s,]+/).map((x) => x.replace(/^#+/, "").trim()).filter(Boolean);
        return noteSave({ tags: [...new Set(tags), ...(isPinned(it) ? ["pinned"] : [])] });
      }
      if (t.classList.contains("cal-course")) {
        const s = S.calendarSeries.find((x) => x.id === t.dataset.s); if (!s) return;
        s.course = t.value || null; s.courseSet = !!t.value; saveClassPicks();
        const c = cById(s.course); if (c) toast(`${esc(s.name)} → ${s.isSection ? "section" : "lecture"} of ${esc(c.code)}`);
        return renderAll();
      }
      const f = t.dataset && t.dataset.field; if (!f || !t.closest("#insp")) return;
      const it = find(S.sel); if (!it) return;
      if (f === "due") editStep(it, { due: t.value ? new Date(t.value).getTime() : null });
      else if (f === "course") editStep(it, { course: t.value || null });
      else editStep(it, { [f]: t.value });
      S.fx = { flip: true }; renderAll(); MO.ack($(`#insp [data-field="${f}"]`), "saved");
    });
    document.addEventListener("focusout", (e) => {
      const t = e.target; if (!t.dataset || t.dataset.field !== "title" || !t.closest("#insp")) return;
      const it = find(S.sel); const v = t.textContent.trim(); if (it && v && v !== it.title) { editStep(it, { title: v }); setTimeout(() => { S.fx = { flip: true }; renderAll(); MO.ack($('#insp [data-field="title"]'), "saved"); }, 0); }
    });
    // the mouse's back and forward buttons act on release, as in a browser; both presses are taken so the web view
    // never runs its own history
    document.addEventListener("mousedown", (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
    // the formatting keys keep the caret (and the selection) in the note they format
    document.addEventListener("mousedown", (e) => { if (e.target.closest && e.target.closest('.ns-tools .ns-t, #nsBar .chip[data-act="edTool"]')) e.preventDefault(); });
    document.addEventListener("mouseup", (e) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); walk(e.button === 3 ? -1 : 1); } });
    document.addEventListener("keydown", onKey);
    document.addEventListener("paste", onPaste);
    document.addEventListener("keyup", (e) => { if (e.key === "Alt") hideTips(); });
    window.addEventListener("blur", hideTips);
    window.addEventListener("resize", () => renderAll());
  }

  function onKey(e) {
    const k = e.key, t = e.target, inField = /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable;
    // back / forward (on a Mac, Option+arrows move by word, so ⌘[ ⌘] instead)
    const plain = !e.shiftKey && !e.ctrlKey, nav = k === "BrowserBack" ? -1 : k === "BrowserForward" ? 1
      : !MAC && plain && e.altKey && !e.metaKey && (k === "ArrowLeft" || k === "ArrowRight") ? (k === "ArrowLeft" ? -1 : 1)
      : MAC && plain && e.metaKey && !e.altKey && (k === "[" || k === "]") ? (k === "[" ? -1 : 1) : 0;
    if (nav) { e.preventDefault(); return walk(nav); }
    if (t.closest && t.closest("#lab")) { if (k === "Escape") CA.lab.close(); return; }
    // a held Alt repeats its keydown; rebuilding the tips each time would restart their fade-in from nothing
    if (k === "Alt") { e.preventDefault(); if (!e.repeat) showTips(); return; }
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && !inField && !S.overlay && /^Arrow(Left|Right|Up|Down)$/.test(k)) {
      // the focused part of the sidebar, else your view
      const d = k === "ArrowLeft" || k === "ArrowUp" ? -1 : 1, it = t.closest && t.closest("#side .sd-it");
      e.preventDefault(); hideTips();
      if (it) return it.dataset.drag ? sideMove(it.dataset.drag, it.dataset.drag === "view" ? it.dataset.v : it.dataset.drag === "sec" ? it.dataset.sec : it.dataset.course, d) : CA.sound.nope();
      return navMode() === "side" ? sideMove("view", S.view, d) : moveTab(S.view, d);
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      // match the physical key: Option+letter on a Mac types a symbol (Option+Q is “œ”)
      const ch = ((e.code || "").match(/^(?:Key|Digit)(\w)$/) || [])[1] || k;
      const hit = $$(`[data-hint]`, $("#screen")).find((el) => el.dataset.hint.toLowerCase() === ch.toLowerCase() && el.offsetParent);
      if (hit) { e.preventDefault(); hideTips(); hit.click(); }
      return;
    }
    const mod = e.ctrlKey || e.metaKey, lk = k.toLowerCase();
    if (S.overlay === "note") {
      if (mod && lk === "p") { e.preventDefault(); return noteOut("print"); }
      if (mod && lk === "s") { e.preventDefault(); if (S.note && S.note.ed) S.note.ed.flush(); const st = $("#nsSt"); if (st) { st.textContent = "Saved"; MO.ack(st, "flash"); } return; }
      if (t.id === "nsTitle" && (k === "Enter" || k === "ArrowDown")) { e.preventDefault(); return S.note && S.note.ed.focus(false); }
      if (t.id === "nsLink" && k === "Enter") { e.preventDefault(); return noteLinkEnd(true); }
    }
    if (mod && lk === "j" && !e.shiftKey) { e.preventDefault(); return openAI(S.overlay === "note" && S.note ? { note: S.note.id } : null); }
    if (S.overlay === "quick" && k === "Tab" && (t.id === "qaIn" || t.id === "qaTx")) { e.preventDefault(); const i = QMODES.findIndex(([v]) => v === S.qaMode); return switchMode(QMODES[(i + (e.shiftKey ? 2 : 1)) % 3][0]); }
    if ((t.id === "aiIn" || t.id === "aiPaste") && k === "Enter" && mod) { e.preventDefault(); return t.id === "aiIn" ? aiGo() : ACTIONS.aiPasteGo(); }
    if (t.id === "qaTx" && k === "Enter") {
      if (S.qaMode === "jot" && !e.shiftKey) { e.preventDefault(); return saveCapture(mod); }
      if (S.qaMode === "list" && mod) { e.preventDefault(); return saveCapture(e.shiftKey); }
    }
    if (mod && k.toLowerCase() === "k") { e.preventDefault(); mirror("k"); return openPalette(); }
    if (mod && k === ".") { e.preventDefault(); return CA.lab.toggle(); }
    if (mod && (k === "\\" || e.code === "Backslash") && !e.shiftKey && !e.altKey && !S.overlay) { e.preventDefault(); return sideToggle(); }
    if (mod && e.shiftKey && k === " ") { e.preventDefault(); return openQuick(); }
    if (mod && !inField && (k.toLowerCase() === "y" || (k.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); return doRedo(); }
    if (mod && k.toLowerCase() === "z" && !inField) { e.preventDefault(); return doUndo(); }
    if (mod && (k === "=" || k === "+")) { e.preventDefault(); return CA.lab.zoom(1); }
    if (mod && (k === "-" || k === "_")) { e.preventDefault(); return CA.lab.zoom(-1); }
    if (mod && k === "0") { e.preventDefault(); return CA.lab.zoom(0); }
    if ((mod && k.toLowerCase() === "r") || k === "F5") { e.preventDefault(); return syncNow(); }
    const FK = { F1: openHelp, F2: () => openQuick(), F3: () => openPalette(), F4: ACTIONS.focusQ, F8: () => openFocusSetup(), F9: () => CA.lab.toggle() };
    if (FK[k]) { e.preventDefault(); return FK[k](); }
    if (k === "Escape") return onEsc(e);

    // inputs with their own key handling
    if (t.id === "qaIn" && k === "Enter") { e.preventDefault(); const v = t.value; if (!v.trim()) return refuse($(".qa-wrap")); closeOv(); addFromText(v, e.shiftKey ? "open" : mod ? "focus" : null, false, S.qaOver); if (!(mod && v.trim())) renderAll(); return; }
    if (t.id === "qaEdIn" && k === "Enter") { e.preventDefault(); return ACTIONS.qaEdSave(); }
    if (t.id === "palIn") {
      if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); S.palI = Math.max(0, Math.min(S.palList.length - 1, S.palI + (k === "ArrowDown" ? 1 : -1))); updatePalette(); }
      else if (k === "Enter") { e.preventDefault(); runPalette(S.palI); }
      return;
    }
    if (t.id === "isIn" && k === "Enter") { e.preventDefault(); const v = t.value; t.value = ""; t.blur(); addFromText(v); renderAll(); return; }
    if (t.id === "lnkIn" && k === "Enter") {
      e.preventDefault(); const it = find(S.sel), urls = E.linksIn(t.value, true);
      if (!it || !t.value.trim()) return;
      if (!urls.length) { refuse(t.closest(".fbox")); return toast("That isn't a link · paste the whole address"); }
      addLinks(it, urls); return MO.after(() => { const f = $("#lnkIn"); if (f) f.focus(); });
    }
    if (t.id === "fq") {
      if (k === "Enter" && t.value.trim()) { e.preventDefault(); const have = E.parseFilter(S.q).map((x) => x.raw); setQ([...have, ...E.parseFilter(t.value).map((x) => x.raw).filter((r) => !have.includes(r))].join(" "), true); }
      else if (k === "Backspace" && !t.value) { const ts = E.parseFilter(S.q); if (ts.length) { e.preventDefault(); ts.pop(); setQ(ts.map((x) => x.raw).join(" "), true); } }
      return;
    }
    if (S.overlay === "snooze" && /^[1-9]$/.test(k)) { e.preventDefault(); return snoozePick(+k - 1); }
    if (S.overlay === "notetpl" && /^[1-9]$/.test(k)) { const tp = NT().TEMPLATES[+k - 1]; e.preventDefault(); if (tp) { closeOv(); newNote(tp); } return; }
    if (S.overlay === "trash" && /^[1-9]$/.test(k) && !inField && !mod) { const m = S.trash && S.trash.entries[+k - 1]; e.preventDefault(); return m && trashRestore([m.id]); }
    if (S.overlay === "fsetup" && k === "Enter") { e.preventDefault(); return ACTIONS.fsGo(); }
    // B and F press the focus screens' keys: break, back to focus
    if ((k === "b" || k === "f") && !inField && !mod && /^(focus|focusdone|brk|brkdone)$/.test(S.overlay || "")) {
      const b = $(k === "b" ? '#ov :is([data-act="brk"], [data-act="foBreak"])' : '#ov [data-act="focus"]');
      if (b) { e.preventDefault(); return b.click(); }
      if (k === "b" && S.overlay === "focus") { e.preventDefault(); return takeBreak(5); }
    }
    if (S.overlay === "pair" && k === "Enter" && t.tagName !== "BUTTON") { e.preventDefault(); return pairAnswer(true); }
    if (S.overlay === "feeds" && k === "Enter" && t.classList && t.classList.contains("feed-in")) { e.preventDefault(); return feedSave(); }
    if (S.overlay === "sync" && k === "Enter" && !e.shiftKey && t.tagName !== "TEXTAREA" && !(t.tagName === "BUTTON")) {
      const b = $(".dialog .nb .btn.primary:not([disabled])"); if (b) { e.preventDefault(); b.click(); return; }
    }
    if (S.overlay === "course" && k === "Enter" && t.classList && t.classList.contains("course-in")) { e.preventDefault(); const b = $('[data-act="courseSave"]'); return courseSave((b && b.dataset.c) || null); }
    if (S.overlay === "coursedel" && k === "Enter" && t.tagName !== "BUTTON") { const b = $('#ov [data-act="courseDelGo"][data-v="merge"].primary'); if (b) { e.preventDefault(); return courseDelGo(b.dataset.c, "merge"); } }
    if (S.overlay === "update" && k === "Enter") { e.preventDefault(); return installUpdate(); }
    if (inField) return;
    if (S.overlay) return;
    if (mod) return;

    const view = tabs().find((v) => v.k && v.k === k);
    if (view) { e.preventDefault(); mirror(view.k); return go(view.id); }
    const tg = target();
    switch (k) {
      case "/": e.preventDefault(); mirror("k"); return openPalette();
      case "q": case "+": e.preventDefault(); if (k === "+" && S.sel) return bumpPri(S.sel); mirror("q"); return openQuick();
      case "Q": e.preventDefault(); mirror("⇧Q"); return openQuick("", "jot");
      case "w": e.preventDefault(); return newNote();
      case "W": e.preventDefault(); return newNote(NT().TEMPLATES[1]);
      case "i": e.preventDefault(); mirror("i"); return openAI();
      case "?": e.preventDefault(); return openHelp();
      case "j": case "ArrowDown": e.preventDefault(); return moveSel(1);
      case "k": case "ArrowUp": e.preventDefault(); return moveSel(-1);
      case "Enter": if (S.sel) { e.preventDefault(); select(S.sel, true); } return;
      case "x": case " ": e.preventDefault(); if (!tg) return refuse(hinted("x")); mirror("x"); return toggleDone(tg.id);
      case "f": e.preventDefault(); if (focusTop()) mirror("f"); return;
      case "F": e.preventDefault(); return openFocusSetup();
      case "b": e.preventDefault(); return takeBreak(5);
      case "s": e.preventDefault(); if (!tg) return refuse(hinted("s")); mirror("s"); return openSnooze(tg.id);
      case "n": e.preventDefault(); if (skip()) mirror("n"); return;
      case "N": e.preventDefault(); if (skip(-1)) mirror("⇧N"); return;
      case "[": case "]": if (S.lens !== "week") return; e.preventDefault(); mirror(k); return calStep(k === "]" ? 1 : -1);
      case "Delete": return S.sel && del(S.sel);
    }
  }
  function onEsc(e) {
    if (closeRadial()) return;
    if (S.overlay === "note") {
      const m = $("#nsMenu"); if (m && !m.hidden) { m.hidden = true; return; }
      const bar = $("#nsBar"); if (bar && bar.dataset.mode === "link") return noteLinkEnd(false);
    }
    if (hideTips()) return;
    if (S.overlay === "quick" && S.qaEdK) return qaEdClose(true); // the chip's strip first, then the dialog
    if (S.overlay) {
      if (S.overlay === "focus") { if (S.focus && S.focus.level !== "lockdown") { closeOv(); renderAll(); toast("Focus continues · the timer is in the island and the top bar"); } else { refuse($("#ov .display.big")); toast("Lockdown · Esc does nothing here"); } return; }
      if (S.overlay === "brk") return ACTIONS.brkMin();
      if (S.overlay === "takeover") { refuse($("#ov .takeover .big")); return toast("Answer the takeover first"); }
      return closeOv();
    }
    if (S.sideEdit) return sideEdit(false);
    if (S.sideOver) return sideToggle(false);
    const t = e.target;
    if (/INPUT|TEXTAREA/.test(t.tagName)) { if (t.value) { t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); } else t.blur(); return; }
    if (S.insp) { S.insp = false; return renderAll(); }
    if (S.q !== "is:open" || S.view !== "all") { mirror("esc"); return clearQ(); }
    S.sel = null; renderAll();
  }

  let minute = 0; // the now lines are the beam: they flicker as they step to the next minute (pocket.css .blip)
  function tick() {
    S.now = Date.now(); S.ticks++;
    updateCountdowns(); focusBar(); if (!LIVE) checkAlerts();
    const mn = Math.floor(S.now / MIN);
    if (mn !== minute) { if (minute) $$(".dv-now, .timeline .nowln").forEach((el) => MO.ack(el, "blip")); minute = mn; }
    const run = S.overlay === "focus" ? S.focus : S.overlay === "brk" ? S.brk : null, fo = run && $("#ov .display.big");
    if (fo && (run.end - S.now <= MIN) !== fo.classList.contains("hot")) { fo.classList.toggle("hot"); if (fo.classList.contains("hot")) { MO.ack(fo, "boot"); CA.sound.beep(); } }
    if (S.focus && S.now >= S.focus.end) endFocus(true);
    if (S.brk && S.now >= S.brk.end) finishBreak();
    if (S.ticks % 8 === 0) { S.coachI++; const c = $("#coach"); if (c) c.innerHTML = "Tip: " + TIPS[S.coachI % TIPS.length]; }
    if (S.ticks % 30 === 0 && !busy() && !S.overlay) renderAll();
  }

  // Tauri: the global shortcut (Ctrl/⌘+Shift+Space) and the tray's Quick Add open the quick-add box. Inside the app the
  // items come from the Rust store and reload whenever something else changes them (a feed import, the tray, Start).
  function bridge() {
    if (CLOUD) {
      CA.store.onChange(() => reload());
      CA.cloud.onStatus(onCloud);
      S.cloud = CA.cloud.status();
      reload();
      return;
    }
    if (!TAURI || !TAURI.event) return;
    TAURI.event.listen("quickadd", () => { if (!S.overlay) openQuick(); }).catch(() => {});
    if (!LIVE) return;
    CA.store.onError((e) => toast("Not saved · " + esc(String(e))));
    CA.store.onChange(() => reload());
    CA.store.on("alert", onAlert);
    CA.store.on("focus-tick", onFocusTick);
    CA.store.on("focus-ended", (st) => { if (S.focus) finishFocus(!!st && st.ended_reason === "completed"); });
    CA.store.on("update-available", onUpdate);
    CA.store.on("update-progress", onUpdateProgress);
    CA.store.on("update-check", () => checkUpdate(true));
    CA.store.on("sync-now", () => syncNow());
    CA.store.on("backdrop", setBackdrop); syncBackdrop();
    CA.store.on("gradescope", onGradescope);
    CA.store.on("webwork", onWebwork);
    CA.store.on("pair-request", openPair);
    CA.store.on("note-changed", onNoteChanged);
    CA.store.on("ai-chunk", onAIChunk);
    CA.store.on("power-off", onPowerOff);
    CA.store.on("cloud", onCloud); CA.store.invoke("cloud_status").then((st) => { S.cloud = st; paintCloudKey(); }).catch(() => {});
    CA.store.on("start-win-key", (on) => { if (S.settings) S.settings.start_win_key = on; });
    CA.store.invoke("bridge_pending").then((ps) => { if (ps && ps[0] && !S.overlay) openPair(ps[0]); }).catch(() => {});
    // a Do first row picked in Pocket Start (start.html): show it, after a reload in case Start just added it
    CA.store.on("open-item", (id) => reload().then(() => { if (find(id)) { S.sel = id; S.insp = true; renderAll(); } }));
    CA.store.invoke("focus_blocklist").then((l) => { S.blocklist = l || []; }).catch(() => {});
    reload();
  }
  // Closing the window (or Quit in the tray) turns the screen off like a tube first (fx.js); the window goes once it's
  // dark (power.rs). An open note is saved first; Quit also ends its editing session.
  function onPowerOff(p) {
    if (S.overlay === "note" && S.note) { if (p && p.quit) noteCommit(); else if (S.note.ed) S.note.ed.flush(); }
    CA.store.flushLook();
    CA.fx.powerOff(() => CA.store.invoke("power_done", { seq: p ? p.seq : 0 }).catch(() => {}));
  }
  // ...and it comes back on when the window does: shown and focused again, made visible, or clicked
  function bindPower() {
    const wake = () => { if (!CA.fx.powered()) CA.fx.powerOn(); };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });
    document.addEventListener("pointerdown", wake, true);
    // a launch into the tray (autostart --minimized) waits dark until the window is first shown
    $("#screen").classList.add("off");
    if (!WIN) return CA.fx.powerOn();
    WIN.isVisible().then((v) => { if (v) CA.fx.powerOn(); }).catch(() => CA.fx.powerOn());
  }
  // Windows: what's behind the window (backdrop.rs). With only the desktop behind it ("desktop") the dot grid takes the
  // Pocket wallpaper's cell and phase, so the dots carry on the wallpaper's; over other windows ("solid") the page keeps
  // its own grid. The grid comes in physical pixels from the window's corner.
  function setBackdrop(b) {
    const r = document.documentElement;
    if (!b) { delete r.dataset.backdrop; return; }
    const d = window.devicePixelRatio || 1, c = b.grid[0] / d, at = $("#screen").getBoundingClientRect();
    const phase = (v, o) => (((v / d - o) % c) + c) % c;
    [["--grid", c], ["--grid-x", phase(b.grid[1], at.left)], ["--grid-y", phase(b.grid[2], at.top)], ["--grid-r", 1.25 * c / 16]]
      .forEach(([k, v]) => r.style.setProperty(k, v + "px"));
    r.dataset.backdrop = b.mode;
  }
  function syncBackdrop() {
    if (LIVE) CA.store.invoke("backdrop").then(setBackdrop, () => {});
  }
  // Take the store's data, keeping local edits whose save is still in flight.
  function reload() {
    return CA.store.load().then((d) => {
      const keep = S.items.filter((it) => CA.store.isPending(it.id) || (S.note && S.note.id === it.id && !S.note.kept)), ids = new Set(keep.map((it) => it.id));
      S.items = d.items.filter((it) => !ids.has(it.id)).concat(keep);
      S.courses = d.courses; S.calendarSeries = d.calendarSeries; S.settings = d.settings; S.feeds = d.feeds;
      if (S.sel && !find(S.sel)) { S.sel = null; S.insp = false; }
      if (busy()) return;
      if (LIVE && d.settings) CA.lab.fromStore(d.settings.look); // the look, maybe changed on another device
      if (S.loaded) S.fx = { flip: true }; else S.loaded = S.animRows = true;
      renderAll();
    }).catch((e) => toast("Could not read your data · " + esc(String(e))));
  }
  // An assistant wrote a note over the bridge (bridge.rs). An editor showing it takes the new text, or closing the sheet
  // would put the old text back; otherwise a toast says what changed.
  function onNoteChanged(ev) {
    reload().then(() => {
      const n = S.note, it = find(ev.id); if (!it) return;
      if (S.overlay === "note" && n && n.id === it.id && n.ed) {
        if (n.ed.md() !== it.notes) n.ed.set(it.notes);
        const t = $("#nsTitle"); if (t && document.activeElement !== t) t.value = it.title;
        noteInfo(); return toast(`${esc(ev.by)} changed this note`);
      }
      toast(`${esc(ev.by)} ${ev.made ? "added a note" : "changed"} · ${esc(it.title)}`, { actions: [["Open", () => openNote(it.id)]] });
    });
  }
  // "Task done" during a session: a Soft one ends; a Hard one keeps its time and moves on to the next Do First item.
  function focusDone(it) {
    const f = S.focus; if (!f) return;
    if (!LIVE || f.level === "soft" || Date.now() >= f.end) return endFocus(true);
    const next = topItem();
    f.id = next ? next.id : f.id;
    toast(`Done${it ? " · " + esc(it.title) : ""}. Still focusing until ${mTime(f.end)}${next ? " · next: " + esc(next.title) : ""}`, { ms: 7000 });
    if (S.overlay === "focus") showFocus(false); else renderAll();
  }
  CA.app = { init() { bind(); bridge(); renderAll(); bindFrame(); bindPower(); setInterval(tick, 1000); }, renderAll, toast, sideEdit, openQuick, openPalette, startFocus, simulate, go, VIEWS, focusTop, openFocusSetup, select, openNote, newNote, openAI,
    ic, icons: Object.keys(PIX) }; // the pixel icons, also drawn by the UI kit sheet (docs/UIKit/index.html)
})();
