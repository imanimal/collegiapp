/* Collegiapp Pocket for Wallpaper Engine: the Pocket desk, live (project.json "type": "web").
   The desk is the app's 16 px dot grid on two canvases: #desk holds the still grid, #fx the dots that the cursor lens
   and the ripples light up (one each minute from the clock, two on the hour, one per click, and an orange one every
   5 minutes while Do first is due soon or late: orange stays for Do first). The loop runs only while something moves
   and stops while Wallpaper Engine pauses the wallpaper. Widgets: an LCD clock with the quarter's week, Do first
   (Collegiapp's top item, else a line typed in the properties) with its countdown, This week, and a Now playing LCD
   fed by Wallpaper Engine's audio and media listeners. Countdown text and urgency mirror ui/js/app.js (cdText) and
   ui/js/engine.js (fmtDur, fmtClock, score). */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const MIN = 60e3, HR = 60 * MIN, DAY = 24 * HR;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // user properties: keep in step with project.json (Wallpaper Engine sends them all on load, then each change)
  const P = {
    theme: "auto", layout: "right", size: 100, clock: true, clock24: false,
    live: true, dofirst: "", dofirstcourse: "", dofirstdue: "", quarter: "Fall 2026", quarterstart: "2026-09-24",
    lens: true, ripples: true, audio: true,
  };
  // in a browser, the query string sets them (?theme=night&layout=center&dofirst=…); ?preview draws the library thumbnail
  const q = new URLSearchParams(location.search);
  for (const [k, v] of q) if (k in P) P[k] = typeof P[k] === "boolean" ? v !== "0" && v !== "false" : typeof P[k] === "number" ? +v || P[k] : v;
  if (q.has("preview") && !q.has("layout")) P.layout = "center";

  /* ─────────── pixel icons: 9×9 bitmaps ("#" = lit pixel), as in app.js ─────────── */
  const PIX = {
    now: ".....###.|....###..|...###...|..######.|.....##..|....##...|...##....|..##.....|.##......",
    week: "..#...#..|#########|#########|#.......#|#.#.#.#.#|#.......#|#.#.#...#|#.......#|#########",
    music: "...######|...######|...#....#|...#....#|...#....#|.###..###|####.####|####.####|.##...##.",
  };
  const icon = (n) => PIX[n].split("|").map((row, y) => row.replace(/#+/g, (run, x) => `M${x} ${y}h${run.length}v1h-${run.length}z`).replace(/\./g, "")).join("");
  document.querySelectorAll("svg[data-ic]").forEach((svg) => svg.firstElementChild.setAttribute("d", icon(svg.dataset.ic)));

  /* ─────────── time ─────────── */
  const pad = (n) => String(n).padStart(2, "0");
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
    return h ? h + ":" + pad(m) + ":" + pad(ss) : pad(m) + ":" + pad(ss);
  }
  const cdText = (ms) => (ms >= DAY ? fmtDur(ms).toUpperCase() : fmtClock(ms));
  const day0 = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const at = (d, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime();
  const daysBetween = (a, b) => Math.round((day0(b) - day0(a)) / DAY);
  const mdy = (d) => MON[d.getMonth()] + " " + d.getDate();
  function timeStr(d) {
    if (P.clock24) return pad(d.getHours()) + ":" + pad(d.getMinutes());
    return (d.getHours() % 12 || 12) + ":" + pad(d.getMinutes()) + (d.getHours() < 12 ? " AM" : " PM");
  }
  function whenStr(t, now) {
    const d = new Date(t), n = daysBetween(now, t);
    const day = n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : n > 1 && n < 7 ? d.toLocaleDateString("en-US", { weekday: "short" }) : mdy(d);
    return day + " " + timeStr(d);
  }
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
  }
  function parseDay(s) { const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((s || "").trim()); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; }
  // "2026-11-02 23:59", "2026-11-02 11:59 pm", "2026-11-02" (end of that day), or anything Date.parse reads
  function parseDue(s) {
    s = (s || "").trim(); if (!s) return 0;
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})\s*([ap])?\.?m?\.?)?$/i.exec(s);
    if (m) {
      let h = m[4] ? +m[4] : 23; const mi = m[5] ? +m[5] : 59, ap = (m[6] || "").toLowerCase();
      if (ap === "p" && h < 12) h += 12; if (ap === "a" && h === 12) h = 0;
      return new Date(+m[1], m[2] - 1, +m[3], h, mi).getTime();
    }
    const t = Date.parse(s); return isNaN(t) ? 0 : t;
  }

  /* ─────────── the quarter ───────────
     UCSB weeks: a quarter that starts mid-week (Fall, on a Thursday) begins in week 0; a Monday start is week 1.
     Weeks 1–10 are classes; finals run from the Saturday before week 11 through its Friday. */
  function term(now) {
    const start = parseDay(P.quarterstart); if (!start) return null;
    const mon = addDays(start, -((start.getDay() + 6) % 7));
    const w1 = start.getDay() === 1 ? start : addDays(mon, 7);
    const finals = addDays(w1, 70);
    return { name: P.quarter.trim() || "Quarter", start, finals, week: Math.floor(daysBetween(w1, now) / 7) + 1, toStart: daysBetween(now, start), toFinals: daysBetween(now, addDays(finals, -2)) };
  }
  function termLine(t, now) {
    if (!t || t.week > 14) return "Week " + isoWeek(now) + " of " + now.getFullYear();
    if (t.toStart > 0) return t.name + " starts " + (t.toStart === 1 ? "tomorrow" : "in " + t.toStart + " days");
    if (t.week > 11) return t.name + " is over";
    if (t.week === 11 || t.toFinals <= 0) return "Finals week · " + t.name;
    const f = t.toFinals, fin = f >= 14 ? "finals in " + Math.round(f / 7) + " weeks" : f >= 7 ? "finals next week" : f === 1 ? "finals tomorrow" : "finals in " + f + " days";
    return (t.week < 1 ? "Week 0" : "Week " + t.week + " of 10") + " · " + t.name + " · " + fin;
  }

  /* ─────────── theme ─────────── */
  const darkMQ = matchMedia("(prefers-color-scheme: dark)");
  let T = {};
  function scheme() {
    if (P.theme === "cream" || P.theme === "night") return P.theme;
    if (P.theme === "time") { const h = new Date().getHours(); return h >= 19 || h < 7 ? "night" : "cream"; }
    return darkMQ.matches ? "night" : "cream";
  }
  function applyScheme() {
    const sc = scheme();
    if (body.dataset.scheme === sc && T.bg) return;
    body.dataset.scheme = sc;
    const cs = getComputedStyle(body), g = (n) => cs.getPropertyValue(n).trim();
    T = { bg: g("--bg"), text: g("--text"), accent: g("--accent"), dfg: g("--disp-fg") };
    drawDesk(); kick();
  }
  darkMQ.addEventListener("change", applyScheme);
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return "rgb(" + x.map((v, i) => Math.round(v * t + y[i] * (1 - t))).join(",") + ")"; };

  /* ─────────── the desk: a still grid, and the dots the lens and ripples excite ─────────── */
  const desk = $("desk"), fx = $("fx"), dctx = desk.getContext("2d"), fctx = fx.getContext("2d");
  let dpr = 1, W = 0, H = 0, S = 1, u = 1, cs = 16, cols = 0, rows = 0, dotR = 1.25;
  function layout() {
    dpr = window.devicePixelRatio || 1;
    // the column scales with the screen (a 16:9 screen by its height, a tall one by its width) and the size property
    S = Math.min(innerHeight / 1080, innerWidth / 1280) * ((+P.size || 100) / 100);
    document.documentElement.style.setProperty("--s", S.toFixed(4));
    W = Math.round(innerWidth * dpr); H = Math.round(innerHeight * dpr);
    // the grid follows the screen only: 16 px cells at 1080p, 32 at 4K, whole device pixels. Collegiapp's window lines its
    // dots up with these (desk_cell and grid in src-tauri/src/backdrop.rs, the tile below in ui/css/pocket.css): change all together
    u = H / 1080; cs = Math.max(8, Math.round(16 * u)); dotR = 1.25 * cs / 16;
    cols = Math.ceil(W / cs); rows = Math.ceil(H / cs);
    for (const c of [desk, fx]) { c.width = W; c.height = H; }
    drawDesk(); kick();
  }
  function drawDesk() {
    if (!W || !T.bg) return;
    const tile = document.createElement("canvas"); tile.width = tile.height = cs;
    const t = tile.getContext("2d");
    t.fillStyle = T.bg; t.fillRect(0, 0, cs, cs);
    t.fillStyle = mix(T.text, T.bg, 0.12); t.beginPath(); t.arc(cs / 2, cs / 2, dotR, 0, 2 * Math.PI); t.fill();
    dctx.fillStyle = dctx.createPattern(tile, "repeat"); dctx.fillRect(0, 0, W, H);
  }

  const ripples = [];
  const lens = { x: 0, y: 0, tx: 0, ty: 0, a: 0, last: -1e9 };
  let raf = 0, lastFrame = 0, fps = 30, paused = false;
  function kick() { if (!raf && !paused) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (paused) return;
    if (now - lastFrame < 1000 / fps - 4) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(100, now - lastFrame); lastFrame = now;
    if (drawFx(now, dt)) raf = requestAnimationFrame(frame);
  }
  // x, y in CSS px; hot ripples are orange and belong to Do first
  function ripple(x, y, amp, hot) {
    if (!P.ripples || !W) return;
    const X = x * dpr, Y = y * dpr;
    ripples.push({ x: X, y: Y, amp, hot: !!hot, t0: performance.now(), v: 1.1 * u, w: 64 * u, rad: 0, max: Math.hypot(Math.max(X, W - X), Math.max(Y, H - Y)) });
    kick();
  }
  const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  function origin() { const el = !$("clock").hidden ? $("clock") : !$("df").hidden ? $("df") : $("wk"); return centre(el); }

  const LV = 5;
  function drawFx(now, dt) {
    fctx.clearRect(0, 0, W, H);
    const ease = (k) => 1 - Math.pow(k, dt / 16.7);
    lens.a += ((P.lens && now - lens.last < 2500 ? 1 : 0) - lens.a) * ease(0.88);
    lens.x += (lens.tx - lens.x) * ease(0.72); lens.y += (lens.ty - lens.y) * ease(0.72);
    for (let i = ripples.length - 1; i >= 0; i--) { const r = ripples[i]; r.rad = (now - r.t0) * r.v; if (r.rad - r.w > r.max) ripples.splice(i, 1); }
    const L = lens.a > 0.01 ? lens.a : 0;
    if (!L && !ripples.length) { lens.a = 0; return false; }

    const R = 180 * u;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    if (L) { x0 = lens.x - R; x1 = lens.x + R; y0 = lens.y - R; y1 = lens.y + R; }
    for (const r of ripples) { const e = r.rad + r.w; x0 = Math.min(x0, r.x - e); x1 = Math.max(x1, r.x + e); y0 = Math.min(y0, r.y - e); y1 = Math.max(y1, r.y + e); }
    const i0 = Math.max(0, Math.floor(x0 / cs)), i1 = Math.min(cols - 1, Math.floor(x1 / cs));
    const j0 = Math.max(0, Math.floor(y0 / cs)), j1 = Math.min(rows - 1, Math.floor(y1 / cs));
    const ink = [], acc = [];
    for (let l = 0; l < LV; l++) { ink.push(new Path2D()); acc.push(new Path2D()); }
    for (let j = j0; j <= j1; j++) {
      const py = j * cs + cs / 2;
      for (let i = i0; i <= i1; i++) {
        const px = i * cs + cs / 2;
        let e = 0, h = 0;
        if (L) { const d = Math.hypot(px - lens.x, py - lens.y); if (d < R) { const k = 1 - d / R; e += L * k * k * (3 - 2 * k); } }
        for (const r of ripples) {
          const g = Math.abs(Math.hypot(px - r.x, py - r.y) - r.rad);
          if (g < r.w) { const k = 1 - g / r.w, v = r.amp * k * k * Math.max(0, 1 - r.rad / r.max); if (r.hot) h += v; else e += v; }
        }
        if (e + h < 0.05) continue;
        const t = Math.min(1, e + h), rad = dotR * (1 + 1.7 * t);
        const p = (h > e ? acc : ink)[Math.min(LV - 1, Math.floor(t * LV))];
        p.moveTo(px + rad, py); p.arc(px, py, rad, 0, 2 * Math.PI);
      }
    }
    fctx.fillStyle = T.text;
    for (let l = 0; l < LV; l++) { fctx.globalAlpha = 0.16 + 0.36 * (l + 1) / LV; fctx.fill(ink[l]); }
    fctx.fillStyle = T.accent;
    for (let l = 0; l < LV; l++) { fctx.globalAlpha = 0.35 + 0.6 * (l + 1) / LV; fctx.fill(acc[l]); }
    fctx.globalAlpha = 1;
    return true;
  }

  addEventListener("mousemove", (e) => {
    if (!P.lens) return;
    lens.tx = e.clientX * dpr; lens.ty = e.clientY * dpr;
    if (lens.a < 0.01) { lens.x = lens.tx; lens.y = lens.ty; }
    lens.last = performance.now(); kick();
  });
  document.addEventListener("mouseleave", () => { lens.last = -1e9; kick(); });
  addEventListener("mousedown", (e) => ripple(e.clientX, e.clientY, 0.8));
  addEventListener("resize", layout);

  /* ─────────── clock and this week, once a minute ─────────── */
  const WD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  let lastMin = -1;
  function minute(d, quiet) {
    if (P.theme === "time") applyScheme();
    $("hh").textContent = P.clock24 ? pad(d.getHours()) : String(d.getHours() % 12 || 12);
    $("mm").textContent = pad(d.getMinutes());
    $("ap").textContent = P.clock24 ? "" : d.getHours() < 12 ? "AM" : "PM";
    $("date").textContent = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const t = term(d);
    $("term").textContent = termLine(t, d);
    renderWeek(d, t);
    renderDF(); // Collegiapp's export may have gone stale
    syncBlink();
    if (quiet) return;
    // Do first due soon or late: every 5 minutes its ripple is orange and comes from the module
    if ((dfState === "hot" || dfState === "bad") && d.getMinutes() % 5 === 0) { const [x, y] = centre($("df")); ripple(x, y, 1, true); return; }
    const [x, y] = origin(), hour = d.getMinutes() === 0;
    ripple(x, y, hour ? 1 : 0.55);
    if (hour) setTimeout(() => ripple(x, y, 0.8), 450);
  }
  // the seconds sweep and the colon follow the real clock; restarting them at the minute is invisible
  function syncBlink() {
    const ms = Date.now() % MIN;
    for (const [el, period] of [[$("sec"), MIN], [$("colon"), 1000]]) {
      el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
      el.style.animationDelay = -(ms % period) / 1000 + "s";
    }
  }
  function renderWeek(d, t) {
    const today = day0(d), mon = addDays(today, -((today.getDay() + 6) % 7)), sun = addDays(mon, 6);
    $("wkc").textContent = mdy(mon) + " – " + (sun.getMonth() === mon.getMonth() ? sun.getDate() : mdy(sun));
    let html = WD.map((w) => `<span class="wd">${w}</span>`).join("");
    for (let i = 0; i < 7; i++) {
      const x = addDays(mon, i), n = daysBetween(today, x), f = t ? daysBetween(t.finals, x) : 99;
      html += `<span class="d${n === 0 ? " today" : n < 0 ? " past" : ""}${f >= -2 && f <= 4 ? " exam" : ""}">${x.getDate()}</span>`;
    }
    $("cal").innerHTML = html;

    // the quarter: weeks 1–10, then finals; done weeks graphite, this one pulsing
    const show = !!t && t.week <= 14;
    $("qm").hidden = !show;
    if (show) {
      $("qn").textContent = t.name;
      $("qs").textContent = t.toStart > 0 ? "Starts " + mdy(t.start) : t.week > 11 ? "Done" : t.week === 11 ? "Finals week" : "Finals " + mdy(addDays(t.finals, -2));
      let m = "";
      for (let i = 1; i <= 11; i++) m += `<i class="${[i < t.week || t.week > 11 ? "on" : "", i === t.week ? "cur" : "", i === 11 ? "fin" : ""].join(" ").trim()}"></i>`;
      $("meter").innerHTML = m;
    }

    // today, 7a to 11p
    const p = Math.max(0, Math.min(1, (d - at(today, 7)) / (at(today, 23) - at(today, 7))));
    $("tlf").style.width = p * 100 + "%"; $("tln").style.left = p * 100 + "%";
    $("left").textContent = fmtDur(addDays(today, 1) - d) + " left";
  }

  /* ─────────── do first: Collegiapp's top item, else a line you type ───────────
     Collegiapp rewrites presence.js beside its store every 15 s (src-tauri/src/presence.rs) and feed.js says where.
     A file:// page can load a script from another folder but can't fetch a file, so the export is a script that
     calls collegiappPresence(). An export older than 3 minutes means the app has stopped: the typed line takes over. */
  let feed = null, feedEl = null;
  window.collegiappPresence = (d) => { feed = d && typeof d === "object" ? d : null; renderDF(); };
  function poll() {
    if (!window.CA_PRESENCE || !P.live || paused) return;
    if (feedEl) feedEl.remove();
    feedEl = document.createElement("script");
    feedEl.src = window.CA_PRESENCE + "?t=" + Date.now();
    document.head.appendChild(feedEl);
  }
  const live = () => (P.live && feed && Date.now() - Date.parse(feed.updated_at) < 3 * MIN ? feed : null);
  // a typed course gets its colour from its name, the way ui/js/store.js's hue does from a course id
  const hue = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return 1 + (h % 6); };
  function dfSource() {
    const f = live();
    if (f && f.do_first_item) {
      const it = f.do_first_item;
      return { title: it.title, course: it.course || "", color: it.color, kind: it.kind || "", due: it.due ? Date.parse(it.due) : 0, count: f.do_first_count };
    }
    const t = P.dofirst.trim();
    return t ? { title: t, course: P.dofirstcourse.trim(), color: 0, kind: "", due: parseDue(P.dofirstdue), count: 0 } : null;
  }
  let due = 0, dfState = null, dfKey = "", dfKind = "";
  function renderDF() {
    const s = dfSource(), key = JSON.stringify(s);
    if (key === dfKey) return;
    dfKey = key;
    $("df").hidden = !s;
    due = s ? s.due || 0 : 0;
    if (!s) return;
    $("dft").textContent = s.title;
    const cc = $("dfc");
    cc.hidden = !s.course; cc.textContent = s.course;
    if (s.course) cc.style.setProperty("--kc", `var(--k${s.color >= 1 && s.color <= 6 ? s.color : hue(s.course)})`);
    $("dfw").textContent = s.count > 1 ? "1 of " + s.count : "";
    dfKind = s.kind ? s.kind[0].toUpperCase() + s.kind.slice(1).replace(/_/g, " ") : "";
    $("dfs").textContent = dfKind;
    $("dfm").hidden = !s.course && !dfKind && !due;
    $("dfl").hidden = !due;
    dfState = null; tickDF(Date.now());
  }
  function tickDF(now) {
    if (!due) { if (dfState !== null) dfState = ""; return; }
    const left = due - now, over = left <= 0, urg = over ? 1 : 1 / (1 + left / HR / 24);
    const st = over ? "bad" : urg > 0.7 ? "hot" : "";
    if (st !== dfState) {
      if (dfState !== null && st === "bad") { const [x, y] = centre($("df")); ripple(x, y, 1, true); }
      dfState = st; $("dfl").className = "lcd dfl" + (st ? " " + st : "");
    }
    $("dfk").textContent = over ? "Overdue by" : "Due in";
    $("dfn").textContent = cdText(Math.abs(left));
    $("dfbar").style.width = Math.round(urg * 100) + "%";
    $("dfs").textContent = (dfKind ? dfKind + " · " : "") + whenStr(due, now);
  }

  /* ─────────── now playing: Wallpaper Engine's audio (128 bins, L then R) and media integration ─────────── */
  const NB = 32, NR = 8, bins = new Float32Array(NB), peaks = new Float32Array(NB);
  const spec = $("spec"), sctx = spec.getContext("2d"), np = $("np");
  const media = { title: "", artist: "", playing: false, pos: 0, dur: 0, at: 0 };
  let lastSound = -1e9;
  function onAudio(a) {
    if (!P.audio || paused) return;
    let sum = 0;
    for (let i = 0; i < NB; i++) {
      const k = i * 2, raw = (a[k] + a[k + 1] + a[64 + k] + a[65 + k]) / 4, v = Math.min(1, raw * (1.1 + i / 20));
      bins[i] = v > bins[i] ? v : bins[i] * 0.8 + v * 0.2;
      peaks[i] = Math.max(peaks[i] - 0.02, bins[i]);
      sum += raw;
    }
    const now = performance.now();
    if (sum > 0.02) lastSound = now;
    npShow(now);
    if (!np.hidden) drawSpec();
  }
  function npShow(now) {
    const on = P.audio && (media.playing || now - lastSound < 2500);
    if (np.hidden !== on) return;
    np.hidden = !on;
    if (on) renderNP(); else { bins.fill(0); peaks.fill(0); }
  }
  function drawSpec() {
    const w = Math.round(spec.clientWidth * S * dpr), h = Math.round(spec.clientHeight * S * dpr);
    if (!w || !h) return;
    if (spec.width !== w || spec.height !== h) { spec.width = w; spec.height = h; }
    sctx.clearRect(0, 0, w, h);
    sctx.fillStyle = T.dfg;
    const pw = w / NB, ph = h / NR, g = Math.max(1, Math.round(1.5 * S * dpr));
    for (let i = 0; i < NB; i++) {
      const lit = Math.round(bins[i] * NR), pr = peaks[i] > 0.03 ? Math.min(NR - 1, Math.ceil(peaks[i] * NR) - 1) : -1;
      const x = Math.round(i * pw), cw = Math.round((i + 1) * pw) - x - g;
      for (let r = 0; r < NR; r++) {
        sctx.globalAlpha = r < lit || r === pr ? 1 : 0.1;
        const y = Math.round(h - (r + 1) * ph);
        sctx.fillRect(x, y, cw, Math.round(h - r * ph) - y - g);
      }
    }
    sctx.globalAlpha = 1;
  }
  function renderNP() {
    $("npt").textContent = media.title;
    $("npa").textContent = media.artist;
    tickNP(performance.now());
  }
  const mss = (s) => Math.floor(s / 60) + ":" + pad(Math.floor(s % 60));
  function tickNP(now) {
    npShow(now);
    if (np.hidden) return;
    const has = media.dur > 0, pos = Math.min(media.dur, media.pos + (media.playing ? (now - media.at) / 1000 : 0));
    $("npc").textContent = has ? mss(pos) + " / " + mss(media.dur) : "";
    $("npl").hidden = !has;
    if (has) $("npb").style.width = (pos / media.dur) * 100 + "%";
  }
  function bindWE() {
    const w = window;
    if (w.wallpaperRegisterAudioListener) w.wallpaperRegisterAudioListener(onAudio);
    if (w.wallpaperRegisterMediaPropertiesListener) w.wallpaperRegisterMediaPropertiesListener((e) => { media.title = e.title || ""; media.artist = e.artist || ""; if (!np.hidden) renderNP(); });
    if (w.wallpaperRegisterMediaPlaybackListener) w.wallpaperRegisterMediaPlaybackListener((e) => {
      const playing = (w.wallpaperMediaIntegration && w.wallpaperMediaIntegration.PLAYBACK_PLAYING) ?? 1;
      if (media.playing && e.state !== playing) media.pos += (performance.now() - media.at) / 1000;
      media.playing = e.state === playing; media.at = performance.now(); tickNP(media.at);
    });
    if (w.wallpaperRegisterMediaTimelineListener) w.wallpaperRegisterMediaTimelineListener((e) => { media.pos = e.position || 0; media.dur = e.duration || 0; media.at = performance.now(); });
  }

  /* ─────────── properties and the second tick ─────────── */
  function apply() {
    body.dataset.layout = P.layout === "center" ? "center" : "right";
    $("clock").hidden = !P.clock;
    $("scale").innerHTML = (P.clock24 ? ["07", "11", "15", "19", "23"] : ["7a", "11a", "3p", "7p", "11p"]).map((s) => `<span>${s}</span>`).join("");
    applyScheme(); layout(); renderDF(); poll();
    minute(new Date(), true);
    if (!P.lens) lens.last = -1e9;
    npShow(performance.now());
  }
  function tick() {
    const now = Date.now(), m = Math.floor(now / MIN);
    if (m !== lastMin) { const first = lastMin < 0; lastMin = m; minute(new Date(now), first); }
    tickDF(now); tickNP(performance.now());
    setTimeout(tick, 1000 - (now % 1000) + 8);
  }

  let applied = 0;
  window.wallpaperPropertyListener = {
    applyUserProperties(props) {
      for (const k in props) if (k in P && props[k] && "value" in props[k]) P[k] = props[k].value;
      apply();
      if (applied++) kick();
    },
    applyGeneralProperties(props) { if (props.fps) fps = props.fps; },
    setPaused(v) { paused = !!v; if (!paused) { syncBlink(); poll(); kick(); } },
  };

  apply();
  tick();
  setInterval(poll, 15e3);
  addEventListener("load", bindWE);
  // power on: the grid answers the clock once
  setTimeout(() => { const [x, y] = origin(); ripple(x, y, 1); }, 500);
})();
