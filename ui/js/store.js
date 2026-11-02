/* Collegiapp — the bridge to the Rust store. Inside the app, items, courses, settings and feed status live in the
   core's JSON store (src-tauri/src/store.rs). This file converts between the Rust shapes (snake_case, ISO times,
   uuids) and the UI's (engine.js and app.js: ms timestamps, short names), loads everything, and saves the UI's
   edits in one `save_items` call per turn. In a plain page (the web demo) `live` is false and app.js runs on
   sample data from data.js. */
(function () {
  const CA = (window.CA = window.CA || {});
  const T = window.__TAURI__ || null;
  const live = !!(T && T.core);
  const invoke = (cmd, args) => T.core.invoke(cmd, args);
  const ms = (s) => (s ? Date.parse(s) : null);
  const iso = (t) => (t == null || t === "" || isNaN(t) ? null : new Date(+t).toISOString());
  const num = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
  const label = live && T.window ? T.window.getCurrentWindow().label : "main";

  // v4 uuid from getRandomValues (randomUUID needs a secure context, which a custom protocol may not be)
  function uuid() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // Short course tag for chips: "CMPSC 130A" → "CS130A", "PSTAT 120A" → "PSTAT120A". engine.js matches it too.
  const DEPT = { CMPSC: "CS" };
  function tagOf(code) {
    const w = String(code || "").trim().split(/\s+/).filter(Boolean);
    if (!w.length) return "?";
    const dept = DEPT[w[0].toUpperCase()] || w[0].toUpperCase();
    return dept + w.slice(1).join("").toUpperCase();
  }
  const hue = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return 1 + (h % 6); };

  function itemIn(r) {
    return {
      id: r.id, title: r.title, kind: r.kind || "task", status: r.status || "inbox", course: r.course_id || null,
      due: ms(r.due), end: ms(r.end), est: num(r.est_minutes), pri: r.priority || 0, weight: num(r.weight_pct),
      tags: r.tags || [], links: (r.links || []).map((l) => [l.label, l.url]), location: r.location || null, notes: r.notes || "",
      interrupt: r.interrupt || "none", src: (r.source && r.source.adapter) || "manual", snoozed: ms(r.snoozed_until),
      created: ms(r.created_at), updated: ms(r.updated_at), deleted: !!r.deleted, _source: r.source || null,
    };
  }
  function itemOut(it) {
    const est = num(it.est), w = num(it.weight);
    return {
      id: it.id, title: String(it.title || "(untitled)"), kind: it.kind || "task", status: it.status || "inbox", course_id: it.course || null,
      due: iso(it.due), end: iso(it.end), est_minutes: est == null ? null : Math.max(0, Math.round(est)),
      priority: Math.max(0, Math.min(3, it.pri | 0)), weight_pct: w, tags: it.tags || [],
      links: (it.links || []).map(([l, u]) => ({ label: String(l), url: String(u) })), location: it.location || null, notes: it.notes || "",
      interrupt: it.interrupt || "none", source: Object.assign({ external_id: null, url: null }, it._source, { adapter: it.src || "manual" }),
      snoozed_until: iso(it.snoozed), created_at: iso(it.created || Date.now()), updated_at: iso(it.updated || Date.now()), updated_by: "",
      deleted: !!it.deleted,
    };
  }
  function courseIn(c) {
    return {
      id: c.id, code: c.code, tag: tagOf(c.code), title: c.title || "", color: c.color >= 1 && c.color <= 6 ? c.color : hue(c.id),
      aliases: c.aliases || [], included: c.included !== false, quarter: c.quarter || "", canvas_id: c.canvas_id || null,
      meet: [], links: (c.links || []).map((l) => [l.label, l.url]),
    };
  }
  function courseOut(c) {
    return { id: c.id, code: c.code, title: c.title || "", aliases: c.aliases || [], color: c.color || 0, quarter: c.quarter || "",
      included: !!c.included, links: (c.links || []).map(([l, u]) => ({ label: l, url: u })), canvas_id: c.canvas_id || null };
  }

  // Google series → the Classes lens' "which are classes?" rows, and each course's meeting pattern.
  const DAYL = { Mon: "M", Tue: "T", Wed: "W", Thu: "R", Fri: "F", Sat: "S", Sun: "U" }, DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  function seriesRows(feeds, settings) {
    const all = (feeds && feeds.series) || [];
    const picked = new Set(settings && settings.gcal_series ? settings.gcal_series : all.filter((s) => s.course_id).map((s) => s.uid));
    // sections (discussion, lab): the ones you marked, else the ones whose title reads as one (ics.rs looks_like_section)
    const sections = new Set(settings && settings.gcal_sections ? settings.gcal_sections : all.filter((s) => s.section).map((s) => s.uid));
    const chosen = (settings && settings.gcal_courses) || {}, hidden = new Set((settings && settings.gcal_hidden) || []);
    return all.map((s) => {
      const st = new Date(s.first_start), en = new Date(+st + s.minutes * 6e4), isSection = sections.has(s.uid);
      // a weekly rule without BYDAY repeats on the first meeting's weekday
      const days = (s.by_day.length ? s.by_day : [DOW[st.getDay()]]).map((d) => DAYL[d] || d).join("");
      return { id: s.uid, name: s.summary, rule: `${days} ${hm(st)}–${hm(en)}`, isClass: picked.has(s.uid) && !hidden.has(s.uid), isSection, hidden: hidden.has(s.uid),
        course: chosen[s.uid] || s.course_id || null, courseSet: !!chosen[s.uid],
        meet: { days, h: st.getHours(), m: st.getMinutes(), dur: s.minutes, loc: s.location || "", label: s.summary, sec: isSection } };
    });
  }

  function shape(d) {
    const courses = d.courses.map(courseIn), calendarSeries = seriesRows(d.feeds, d.settings);
    for (const s of calendarSeries) { const c = s.isClass && courses.find((x) => x.id === s.course); if (c) c.meet.push(s.meet); }
    return { items: d.items.map(itemIn), courses, calendarSeries, settings: d.settings, feeds: d.feeds };
  }

  // Edits made in one turn go out in one call. `pending` lets a reload keep edits that are still in flight. `why` tags
  // the saves of an undo ("Undone rename"): the store trashes the version each one replaces (trash.rs).
  const queue = new Map(), whys = new Map(), pending = new Set();
  let flushing = false, onError = (e) => console.error(e);
  function flush() {
    flushing = false;
    if (!queue.size) return;
    const items = Array.from(queue.values()), why = whys.size ? Object.fromEntries(whys) : null; queue.clear(); whys.clear();
    const ids = items.map((it) => it.id); ids.forEach((id) => pending.add(id));
    invoke("save_items", { items: items.map(itemOut), why }).catch((e) => onError(e)).finally(() => ids.forEach((id) => pending.delete(id)));
  }
  const restored = (r) => ({ items: r.items.map(itemIn), before: r.before.map((b) => (b ? itemIn(b) : null)), trash: r.trash });

  CA.store = {
    live, uuid, tagOf, convert: { itemIn, itemOut, courseIn, courseOut, shape },
    empty: () => ({ courses: [], items: [], calendarSeries: [] }),
    load: () => invoke("load_all").then(shape),
    save(it, why) { if (!live) return; queue.set(it.id, it); if (why) whys.set(it.id, why); if (!flushing) { flushing = true; Promise.resolve().then(flush); } },
    isPending: (id) => queue.has(id) || pending.has(id),
    saveCourse: (c) => (live ? invoke("upsert_course", { course: courseOut(c) }) : Promise.resolve()),
    // Merge a course `into` another, or remove it (its items kept as personal, or deleted with dropItems).
    deleteCourse: (id, into, dropItems) => (live ? invoke("delete_course", { id, into: into || null, dropItems: !!dropItems }) : Promise.resolve()),
    // The trash: deleted items and undone versions ({ entries, bytes, limit }). Restoring answers with the items (UI shape),
    // what each replaced, and the trash after.
    trash: {
      list: () => invoke("trash_list"),
      restore: (ids) => invoke("trash_restore", { ids }).then(restored),
      purge: (ids) => invoke("trash_purge", { ids: ids || null }),
      limit: (mb) => invoke("trash_set_limit", { mb }),
    },
    onError(fn) { onError = fn; },
    // fn(origin) on every change made elsewhere: an import, another window, the tray
    onChange(fn) { if (live && T.event) T.event.listen("items-changed", (e) => { if (e.payload !== label) fn(e.payload); }).catch(() => {}); },
    on(name, fn) { if (live && T.event) T.event.listen(name, (e) => fn(e.payload)).catch(() => {}); },
    invoke: (cmd, args) => (live ? invoke(cmd, args) : Promise.reject(new Error("only inside the app"))),
  };
})();
