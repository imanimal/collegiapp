/* Collegiapp — Appearance: the theme browser, settings, the style code ("CAPP1 L6 P9 B8 F3 …") and the theme-pack JSON.
   A theme (themes.js) is a palette plus a look: Pocket (L6) or Standard (L8, standard.css), written to html[data-look],
   which also picks the icon set app.js draws. Imported themes live in the saved state (`themes`). Variant IDs are
   permanent: the archive (archive/looks-2026-10) holds every earlier option, and new options take the next free number.
   Boots the app (script order: … → app → themes → lab). */
(function () {
  const CA = window.CA, TH = CA.themes;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("capp." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("capp." + k, JSON.stringify(v)); } catch (e) {} },
  };
  const ua = navigator.userAgent, plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  const MAC = /Mac|iPhone|iPad/.test(plat), IOS = /iPhone|iPad/.test(plat) || (/Mac/.test(plat) && navigator.maxTouchPoints > 1);
  const MOD = MAC ? "⌘" : "Ctrl";

  // The final design (marked by the user on 2026-10-31; motion on since 2026-11-01, M0 → M2). "Reset" returns here.
  const FINAL = "CAPP1 L6 P9 B8 F3 T6 G2 M2 D3 C2 s4 g0 f0 n0 a0 v0 mN bN S1";

  const TYPES = TH.TYPES; // each look's fonts and numeral scale
  // Standard has no screen glass: the effect layers get nothing (the Pocket settings stay as they are)
  const FLAT = { curve: "0", scan: 0, glow: 0, flicker: 0, noise: 0, ab: 0, vig: 0, mask: "N" };
  const GUIDES = { g1: ["Keycaps", "Every button shows its key. Fastest to learn."], g2: ["Hold " + (MAC ? "⌥" : "Alt"), "Clean buttons; hold " + (MAC ? "⌥ Option" : "Alt") + " to overlay every shortcut, then press it."],
    g3: ["None", "No hints anywhere. For when you know it all."], g4: ["Coach", "Rotating tips under the deck and a pulse on the next best action."] };
  const MOTION = { 0: ["Off", 0], 1: ["Subtle", 0.7], 2: ["Full", 1], 3: ["Lively", 1.15] };
  const DENS = { D1: ["Compact", "14px", ".45em", ".5em", ".04em"], D2: ["Cozy", "16px", ".6em", ".7em", ".18em"], D3: ["Roomy", "18px", ".8em", ".9em", ".32em"] };
  const CURVES = { 0: ["Flat", "No glass. Sharpest text."], 1: ["Tube", "A soft glass reflection over the screen."], 2: ["Warped glass", "A real barrel bulge. Needs the Windows engine; Mac, iPhone and touch screens show Tube instead."] };
  const ZOOMS = [0.9, 1, 1.15, 1.3, 1.5];
  // when to switch to the night theme, and what each answer means
  const NIGHTS = { off: ["Off", "One theme, day and night."], auto: ["With the system", "Day and night follow your system's light and dark mode."], on: ["Always", "The night theme stays on."] };
  const SLOTS = { day: ["Day", "sun"], night: ["Night", "moon"] };

  // ── state ──
  const env = { r: "pocket", v: 4, desk: "full", shell: MAC ? "mac" : "win", island: true, focusLevel: "hard", zoom: 1, night: "off" };
  const parsedFinal = parseCode(FINAL);
  let saved = store.get("ui", null);
  // v3 (motion off by default) keeps everything but takes the new default motion; older versions, from the
  // multi-look prototype, start fresh on the final design. v4 states from before the theme browser just gain
  // nightPal and themes from the defaults.
  if (saved && saved.v === 3) Object.assign(saved, { v: 4, motion: parsedFinal.motion });
  if (saved && saved.v !== 4) saved = null;
  const DEFAULTS = Object.assign({ pal: "P9", nightPal: "P11", themes: [], tabs: [], btn: "b8", frm: "f3", type: "T6", glow: 0, flicker: 0, noise: 0, ab: 0, vig: 0, mask: "N", bezel: "N" }, parsedFinal, env);
  CA.ui = Object.assign({}, DEFAULTS, { themes: [], tabs: [] }, saved || {});
  if (!Array.isArray(CA.ui.themes)) CA.ui.themes = [];
  if (!Array.isArray(CA.ui.tabs)) CA.ui.tabs = [];
  let open = false;
  let slot = null; // the Day or Night slot picked in the drawer; null follows the one in effect
  let applied = [];
  const darkMQ = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  // ── themes: the day theme (pal), the night theme (nightPal) and when to switch (night: off, auto = with the system, on = always) ──
  const find = (key, u) => TH.find(key, (u || CA.ui).themes);
  const isNight = (u) => u.night === "on" || (u.night === "auto" && !!(darkMQ && darkMQ.matches));
  // what's in each slot, whatever its scheme or look: you see both in the drawer
  function themeAt(u, night) {
    const day = find(u.pal, u) || find("P9");
    return night ? find(u.nightPal, u) || find(TH.NIGHT[day.look]) : day;
  }
  const cur = (u = CA.ui) => themeAt(u, isNight(u));
  // With switching on, the drawer selects the Day or the Night slot (the one in effect unless you pick the other). The
  // other one shows on screen as a preview, never saved, until you pick back or close the drawer.
  const nowSlot = (u = CA.ui) => (isNight(u) ? "night" : "day");
  const selSlot = () => (CA.ui.night === "off" ? null : slot || nowSlot());
  const peek = () => (open && selSlot() && selSlot() !== nowSlot() ? selSlot() : null);
  const shown = () => (peek() ? themeAt(CA.ui, peek() === "night") : cur());
  // Using a theme puts it in the selected slot; with switching off there's one theme, the day theme
  const usePatch = (th) => ({ [selSlot() === "night" ? "nightPal" : "pal"]: TH.keyOf(th) });

  function code(u) {
    u = u || CA.ui; const th = cur(u);
    return ["CAPP1", th.look === "standard" ? "L8" : "L6", th.pid || "P:" + th.id, "B8", "F3", "T6", u.guide.toUpperCase(), "M" + u.motion, u.density, "C" + u.curve,
      "s" + u.scan, "g" + u.glow, "f" + u.flicker, "n" + u.noise, "a" + u.ab, "v" + u.vig, "m" + u.mask, "bN", "S" + u.sound].join(" ");
  }
  // Codes from the archive parse too; L6 and L8 apply here. The palette's theme sets the look (an imported theme reads
  // P:<id>); L8 without a palette means Standard. Unknown or archived values keep the current setting.
  function parseCode(str) {
    const out = {}; let layout = null;
    const mine = CA.ui ? CA.ui.themes : [];
    for (const t of String(str).trim().split(/\s+/)) {
      let m;
      if ((m = t.match(/^L(\d)$/))) layout = t;
      else if (/^P(\d{1,2}|:[a-z0-9-]+)$/.test(t)) { const th = TH.find(t.replace(/^P:/, ""), mine); if (th) out.pal = TH.keyOf(th); }
      else if ((m = t.match(/^G([1-4])$/))) out.guide = "g" + m[1];
      else if ((m = t.match(/^M([0-3])$/))) out.motion = m[1];
      else if ((m = t.match(/^D([1-3])$/))) out.density = "D" + m[1];
      else if ((m = t.match(/^C([0-2])$/))) out.curve = m[1];
      else if ((m = t.match(/^([sgfnav])(\d{1,3})$/))) out[{ s: "scan", g: "glow", f: "flicker", n: "noise", a: "ab", v: "vig" }[m[1]]] = Math.min(100, +m[2]);
      else if ((m = t.match(/^m([NAS])$/))) out.mask = m[1];
      else if ((m = t.match(/^S([0-2])$/))) out.sound = m[1];
    }
    if (layout !== "L6" && layout !== "L8") return layout ? { archived: layout } : null;
    if (!out.pal && layout === "L8") out.pal = TH.DAY.standard;
    const th = out.pal && TH.find(out.pal, mine);
    if (th) Object.assign(out, th.scheme === "dark" ? { nightPal: out.pal, night: "on" } : { night: "off" });
    return out;
  }

  // paints the theme on screen (a previewed slot's while the drawer shows one); what's saved and shared is the one in effect
  function apply(light) {
    const u = CA.ui, root = document.documentElement, sc = $("#screen"), th = shown(), pal = TH.palette(th), type = TYPES[th.look];
    const keys = Object.keys(pal).filter((k) => k !== "scheme");
    applied.filter((k) => !(k in pal)).forEach((k) => root.style.removeProperty("--" + k));
    keys.forEach((k) => root.style.setProperty("--" + k, pal[k])); applied = keys;
    root.style.colorScheme = pal.scheme;
    root.dataset.scheme = pal.scheme; root.dataset.look = th.look; root.dataset.fam = "modern"; sc.dataset.fam = "modern";
    root.dataset.os = IOS ? "ios" : MAC ? "mac" : /Android/.test(ua) ? "android" : "win";
    const meta = $('meta[name="theme-color"]'); if (meta) meta.content = pal["desk-c"];
    [["font-body", type.body], ["font-display", type.body], ["font-ui", type.body], ["font-mono", type.mono], ["font-num", type.num],
      ["font-scale", type.scale], ["display-scale", 1], ["num-scale", type.ns]].forEach(([k, v]) => root.style.setProperty("--" + k, v));
    const dn = DENS[u.density];
    root.style.setProperty("--fs-base", dn[1]); root.style.setProperty("--pad", dn[2]); root.style.setProperty("--gap", dn[3]); root.style.setProperty("--rowpad", dn[4]);
    root.style.setProperty("--zoom", u.zoom);
    root.dataset.motion = u.motion; root.style.setProperty("--m", MOTION[u.motion][1]); CA.motion.level = MOTION[u.motion][1];
    sc.dataset.r = th.look; sc.dataset.guide = u.guide;
    sc.classList.add("bset-b8", "fset-f3");
    $(".bezel").dataset.bezel = "N";
    CA.fx.apply(th.look === "standard" ? Object.assign({}, u, FLAT) : u); CA.sound.level = +u.sound;
    themeCss(th.css);
    store.set("ui", u);
    // island.html (an always-dark window) reads these
    const rth = cur(u), rp = TH.palette(rth), rt = TYPES[rth.look];
    store.set("tokens", { fg: rp["p-island"], hi: "#f2f4f7", warn: rp["p-disp-hot"], "glow-rgb": rp["glow-rgb"], "font-body": rt.body, "font-num": rt.num, "lcd-bg": rp["p-disp-bg"], "lcd-fg": rp["p-disp-fg"], "font-scale": rt.scale, m: MOTION[u.motion][1] });
    // start.html picks the day or the night palette by Windows' own mode, under the names it knows. It gets both slots
    // only while switching is with the system; Off gives it the day theme twice and Always the night theme twice.
    store.set("palettes", { P9: TH.palette(themeAt(u, u.night === "on")), P11: TH.palette(themeAt(u, u.night !== "off")) });
    if (!light && CA.app) CA.app.renderAll();
    if (open) light ? refreshCode() : render();
  }
  // a theme's own CSS (stripped of anything that loads when it was imported), after the app's
  function themeCss(css) {
    let el = document.getElementById("themeCss");
    if (!css && !el) return;
    if (!el) { el = document.createElement("style"); el.id = "themeCss"; document.head.appendChild(el); }
    if (el.textContent !== (css || "")) el.textContent = css || "";
  }
  // A theme change redraws the whole device (a View Transition: an LCD refresh in Pocket, a fade in Standard)
  function redraw(fn, light) {
    const was = TH.keyOf(shown()); fn();
    if (TH.keyOf(shown()) !== was) CA.motion.swap("theme", () => apply(light)); else apply(light);
  }
  // a new night setting selects the slot it puts in effect; a change made here goes to your other devices
  function set(patch, opts) { redraw(() => { if ("night" in patch) slot = null; Object.assign(CA.ui, patch); }, opts && opts.light); sendLook(); }

  // ── sync: the look follows you to your other devices (store.js save_look → cloud.rs, or cloud.js; docs/SYNC.md) ──
  // These choices sync, with the view keys' order (`tabs`, app.js); text size, the desk preview, the island and the
  // shell stay on each device. One at its default goes as null, so a new device's defaults never win over the account's.
  const SYNCED = ["pal", "nightPal", "night", "themes", "tabs", "guide", "motion", "density", "curve", "scan", "glow", "flicker", "noise", "ab", "vig", "mask", "sound", "focusLevel"];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function look(u) { u = u || CA.ui; const o = {}; SYNCED.forEach((k) => (o[k] = same(u[k], DEFAULTS[k]) ? null : u[k])); return o; }
  let sent = null; // the look last sent or taken, as JSON
  function sendLook(force) {
    const l = look(), j = JSON.stringify(l);
    if (j === sent && !force) return;
    sent = j; if (CA.store.saveLook) CA.store.saveLook(l);
  }
  // another device's look (null for a default; a key it leaves out stays as it is), shown without sending it back
  function adopt(l) {
    if (!l) return;
    const patch = {};
    SYNCED.forEach((k) => {
      if (!(k in l)) return;
      const v = l[k] == null ? JSON.parse(JSON.stringify(DEFAULTS[k])) : l[k];
      if (!same(v, CA.ui[k]) && ((k !== "themes" && k !== "tabs") || Array.isArray(v))) patch[k] = v;
    });
    if (Object.keys(patch).length) redraw(() => { if ("night" in patch) slot = null; Object.assign(CA.ui, patch); });
    sent = JSON.stringify(look());
  }
  // The store's copy, at launch and on every reload (app.js). The first time it has none and this look goes in; after
  // that the store's wins, since it has what your other devices changed. Not while a change made here is on its way.
  function fromStore(l) {
    if (CA.store.lookPending && CA.store.lookPending()) return;
    if (l == null) sendLook(true); else adopt(l);
  }
  // select the Day or Night slot; the one in effect means following it again
  function pickSlot(k, focus) {
    redraw(() => (slot = k === nowSlot() ? null : k));
    if (focus) CA.motion.after(() => { const b = $("#slot-" + k); if (b) b.focus(); });
  }
  function zoom(d) {
    const i = ZOOMS.indexOf(CA.ui.zoom), n = d === 0 ? 1 : ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 1 : i) + d))];
    set({ zoom: n }); if (CA.app) CA.app.toast(`Text size ${Math.round(n * 100)}%`, { ms: 1400 });
  }
  // light → the night theme; dark → the day theme. When that slot holds the same scheme, its look's dark or light
  // theme (P11/P16, P9/P15) goes in it, so the command always flips.
  function toggleNight() {
    const th = cur(), u = CA.ui;
    if (th.scheme === "light") set(themeAt(u, true).scheme === "dark" ? { night: "on" } : { nightPal: TH.NIGHT[th.look], night: "on" });
    else set(themeAt(u, false).scheme === "light" ? { night: "off" } : { pal: TH.DAY[th.look], night: "off" });
  }

  // ── theme files: import (a file, pasted JSON or a chatbot's reply), export, delete ──
  let pending = null, thmNote = "";
  function note(h) { thmNote = h; const m = $("#thmMsg"); if (m) m.innerHTML = h; }
  // low contrast waits for Fix contrast and save (or Save as it is); anything else is saved and used at once
  function readTheme(text) {
    const r = TH.normalize(text);
    pending = null;
    if (r.error) return note(`<span class="bad">${esc(r.error)}</span>`);
    if (!r.lowContrast) return saveTheme(r.theme, r.warnings);
    pending = r.theme;
    note(`${r.warnings.map(esc).join(" ")}<span class="lab-row"><button class="lab-btn" data-labact="thmSave" data-v="fix">Fix contrast and save</button><button class="lab-btn" data-labact="thmSave">Save as it is</button></span>`);
  }
  function saveTheme(th, warnings) {
    const low = TH.checks(th.tokens), extra = (warnings || []).filter((w) => !/^Low contrast/.test(w));
    pending = null; const p = $("#thmPaste"); if (p) p.value = "";
    note(`<span class="ok">Saved ${esc(th.name)}.</span> ${extra.map(esc).join(" ")}${low.length ? ` Still low: ${low.map((c) => `${c.f} on ${c.b} ${c.r.toFixed(1)}:1`).join(", ")}.` : ""}`);
    set(Object.assign({ themes: CA.ui.themes.filter((t) => t.id !== th.id).concat([th]) }, usePatch(th)));
  }
  function delTheme(id) {
    const th = find(id); if (!th || th.builtin) return;
    const patch = { themes: CA.ui.themes.filter((t) => t.id !== id) };
    if (CA.ui.pal === id) patch.pal = (th.scheme === "dark" ? TH.NIGHT : TH.DAY)[th.look];
    if (CA.ui.nightPal === id) patch.nightPal = TH.NIGHT[th.look];
    note(`Deleted ${esc(th.name)}.`); set(patch);
  }
  function exportTheme() {
    const th = shown(), a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(TH.file(th), null, 2)], { type: "application/json" }));
    a.download = th.id + ".json"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    note(`Exported ${esc(th.id)}.json. Copy JSON gives the same file as text.`);
  }
  // the app's own opener (commands.rs open_link, in the preferred browser); a plain page opens a tab
  function openUrl(url) {
    const T = window.__TAURI__;
    if (T && T.core) T.core.invoke("open_link", { url }).catch(() => window.open(url, "_blank", "noopener"));
    else window.open(url, "_blank", "noopener");
  }

  // ── panel ──
  const opt = (axis, v, id, label) => `<button class="opt ${String(CA.ui[axis]) === String(v) ? "on" : ""}" data-lab="${axis}" data-v="${v}" aria-pressed="${String(CA.ui[axis]) === String(v)}">${id ? `<span class="id">${id}</span>` : ""}${label}</button>`;
  // a theme's preview drawn from its own tokens: a card with its header, a number panel, text and the key
  const PV = ["bg", "surface", "line", "chrome-bg", "accent", "disp-bg", "disp-fg", "text", "text3"];
  const pv = (t) => `<span class="thm-pv" style="${PV.map((n) => `--pv-${n}:${t.tokens[n]}`).join(";")}" aria-hidden="true"><span class="pv-card"><i class="pv-band"></i><i class="pv-lcd">9:41</i><i class="pv-t"></i><i class="pv-t3"></i><i class="pv-key"></i></span></span>`;
  // First the question (switch at night?). Off: one theme, and a card click uses it. On: the Day and Night slots are a
  // tablist over the grid, a card click fills the selected slot, and the other slot's theme keeps a quiet sun or moon.
  function themeSec(u) {
    const ic = CA.app.ic, on = u.night !== "off", s = selSlot(), o = s === "day" ? "night" : "day", now = nowSlot(u);
    const picked = on ? themeAt(u, s === "night") : themeAt(u, false), other = on ? themeAt(u, o === "night") : null;
    const card = (t) => {
      const k = TH.keyOf(t), sel = t === picked;
      const mark = t === other ? `<span class="thm-mark" role="img" aria-label="${SLOTS[o][0]} theme" title="${SLOTS[o][0]} theme">${ic(SLOTS[o][1])}</span>` : "";
      return `<div class="thm${sel ? " on" : ""}" data-pv="${t.look}"><button class="thm-use" data-thm="${esc(k)}" aria-pressed="${sel}" title="${esc(t.note || t.name)}">${pv(t)}`
        + `<span class="thm-n"><span class="thm-nm">${esc(t.name)}</span>${mark}</span><span class="thm-m">${t.pid ? `<b>${t.pid}</b> · ` : ""}${t.look === "standard" ? "Standard" : "Pocket"} · ${t.scheme}</span></button>`
        + `${t.builtin ? "" : `<button class="thm-del" data-labact="thmDel" data-v="${esc(k)}" aria-label="Delete ${esc(t.name)}">Delete</button>`}</div>`;
    };
    const slotKey = (k) => {
      const t = themeAt(u, k === "night"), [nm, icon] = SLOTS[k], selk = k === s;
      return `<button class="slot${selk ? " on" : ""}" role="tab" id="slot-${k}" data-slot="${k}" data-pv="${t.look}" aria-selected="${selk}" aria-controls="thmPanel" tabindex="${selk ? 0 : -1}" aria-label="${nm} theme: ${esc(t.name)}${k === now ? ", on now" : ""}">`
        + `<span class="slot-h">${ic(icon)}<span>${nm}</span>${k === now ? `<span class="slot-now">Now</span>` : ""}</span>${pv(t)}<span class="slot-n">${esc(t.name)}</span></button>`;
    };
    return `<div class="lab-sec"><h3>Theme</h3>
      <span class="thm-q" id="thmQ">Switch theme at night</span>
      <div class="opts" role="group" aria-labelledby="thmQ">${Object.entries(NIGHTS).map(([v, [l]]) => opt("night", v, "", l)).join("")}</div>
      <div class="opt-desc">${NIGHTS[u.night][1]}</div>
      ${on ? `<div class="thm-slots" role="tablist" aria-label="Day or night theme">${slotKey("day")}${slotKey("night")}</div>` : ""}
      <div class="thm-pick"><h4 id="thmPick">Pick a ${on ? s + " " : ""}theme</h4>${on && s !== now ? `<span class="thm-peek">Preview · ${SLOTS[now][0]} is on now</span>` : ""}</div>
      <div class="thm-grid"${on ? ` role="tabpanel" id="thmPanel" aria-labelledby="thmPick"` : ""}>${TH.all(u.themes).map(card).join("")}</div>
      <div class="opt-desc">${esc(picked.note)}</div>
      <div class="lab-row" style="margin-top:8px"><button class="lab-btn" data-labact="thmFile">Import a file</button><button class="lab-btn" data-labact="thmExport">Export</button><button class="lab-btn" data-labact="thmCopy">Copy JSON</button><input type="file" id="thmFile" accept=".json,application/json,text/plain" hidden></div>
      <div class="note" id="thmMsg">${thmNote}</div>
      <details id="thmMake"><summary>Make one with a chatbot</summary>
        <p>Describe it, open a chatbot with the prompt filled in (or copy the prompt into any chatbot), then paste its reply below. A theme's JSON from PocketCanvas works here too. Format: docs/THEMES.md.</p>
        <input type="text" id="thmIdea" placeholder="Dark green chalkboard, calm for late study" spellcheck="false" aria-label="Describe the theme">
        <div class="lab-row"><button class="lab-btn" data-labact="thmBot" data-v="claude">Open Claude</button><button class="lab-btn" data-labact="thmBot" data-v="chatgpt">Open ChatGPT</button><button class="lab-btn" data-labact="thmPrompt">Copy the prompt</button></div>
        <textarea id="thmPaste" placeholder="Paste the reply or a theme's JSON" spellcheck="false" aria-label="The reply or a theme's JSON"></textarea>
        <div class="lab-row"><button class="lab-btn" data-labact="thmRead">Check and save</button></div>
      </details></div>`;
  }
  function render() {
    const lab = $("#lab"), body = $(".lab-body", lab), st = body ? body.scrollTop : 0, u = CA.ui, isFinal = code() === FINAL, std = shown().look === "standard";
    // a re-render keeps what's typed into the theme maker, whether it's open, and the focus
    const typed = ["thmIdea", "thmPaste"].map((id) => { const el = $("#" + id); return el ? el.value : ""; }), mk = $("#thmMake"), mkOpen = !!(mk && mk.open);
    const fk = ctlKey(document.activeElement);
    lab.innerHTML = `<div class="lab-head"><span class="led"></span><div><h2>Appearance</h2><div class="sub">${std ? "Standard" : "Pocket"} · ${MOD}+. toggles</div></div><button class="lab-btn lab-x" data-labact="close" aria-label="Close Appearance">Close</button></div>
    <div class="lab-body">
      <div class="lab-sec"><div class="final-card"><span class="lbl">${isFinal ? "★ Your final design" : "Your final design, adjusted"}</span><div class="code" id="labCode">${esc(code())}</div>
        <div class="lab-row"><button class="lab-btn" data-labact="copy">Copy code</button>${isFinal ? "" : `<button class="lab-btn" data-labact="reset">Back to final</button>`}</div></div></div>
      ${themeSec(u)}
      <div class="lab-sec"><h3>Text size</h3><div class="opts">${ZOOMS.map((z) => opt("zoom", z, "", Math.round(z * 100) + "%")).join("")}</div><div class="opt-desc">${MOD}+= and ${MOD}+− work anywhere; ${MOD}+0 resets.</div></div>
      <div class="lab-sec"><h3>Density</h3><div class="opts">${Object.entries(DENS).map(([id, [nm]]) => opt("density", id, id, nm)).join("")}</div></div>
      ${std ? "" : `<div class="lab-sec"><h3>Screen glass</h3><div class="opts">${Object.entries(CURVES).map(([v, [nm]]) => opt("curve", v, "C" + v, nm)).join("")}</div><div class="opt-desc">${esc(CURVES[u.curve][1])}${u.curve === "2" && CA.fx.warpFallback() ? " <b>Showing Tube on this device.</b>" : ""}</div>
        <div class="sl"><label for="sl-scan">Scanlines</label><input type="range" id="sl-scan" min="0" max="30" value="${u.scan}" data-slider="scan"><output id="out-scan">${u.scan}</output></div></div>`}
      <div class="lab-sec"><h3>Shortcut hints</h3><div class="opts">${Object.entries(GUIDES).map(([id, [nm]]) => opt("guide", id, id.toUpperCase(), nm)).join("")}</div><div class="opt-desc">${esc(GUIDES[u.guide][1])}</div></div>
      <div class="lab-sec"><h3>Motion · sound</h3><div class="opts">${Object.entries(MOTION).map(([id, [nm]]) => opt("motion", id, "M" + id, nm)).join("")}</div>
        <div class="opts" style="margin-top:6px">${opt("sound", "0", "S0", "Silent")}${opt("sound", "1", "S1", "Soft")}${opt("sound", "2", "S2", "Full")}<button class="lab-btn" data-labact="snd">Test</button></div></div>
      <div class="lab-sec"><h3>Focus</h3><div class="opts">${opt("focusLevel", "soft", "", "Soft")}${opt("focusLevel", "hard", "", "Hard")}${opt("focusLevel", "lockdown", "", "Lockdown")}</div><div class="opt-desc">Default level when you press F.</div></div>
      <div class="lab-sec"><h3>Desktop presence preview</h3><div class="opts">${opt("desk", "full", "", "App only")}${opt("desk", "desk", "", "On a desk")}</div>
        <div class="opts" style="margin-top:6px">${opt("shell", "win", "", "Windows taskbar")}${opt("shell", "mac", "", "macOS menu bar")}${opt("shell", "zebar", "", "Zebar bar")}</div>
        <div class="opts" style="margin-top:6px"><button class="opt ${u.island ? "on" : ""}" data-labact="island">Island ${u.island ? "on" : "off"}</button></div>
        <p>The island is the always-on-top live activity. The taskbar shows progress and a due-today badge; Zebar and the macOS menu bar show text.</p></div>
      <div class="lab-sec"><h3>Try it</h3><div class="lab-row"><button class="lab-btn" data-labact="sim" data-v="nudge">Class nudge</button><button class="lab-btn" data-labact="sim" data-v="alert">Class alert</button><button class="lab-btn" data-labact="sim" data-v="takeover">Takeover</button><button class="lab-btn" data-labact="lock">Lockdown focus</button></div></div>
      <div class="lab-sec"><h3>Style code</h3><label class="note" for="labImport">Paste a code to apply it</label><div class="lab-row"><input type="text" id="labImport" placeholder="CAPP1 L6 P9 B8 F3 …" spellcheck="false" autocapitalize="off"><button class="lab-btn" data-labact="import">Apply</button></div><div class="note" id="labMsg"></div>
        <details><summary>Theme pack JSON</summary><p>Save as <b>themes/&lt;id&gt;/theme.json</b>. Format: docs/THEME_FORMAT.md. To share just the colours and look, use Export under Theme.</p><textarea id="labJson" readonly spellcheck="false">${esc(JSON.stringify(themeJSON(), null, 2))}</textarea><div class="lab-row"><button class="lab-btn" data-labact="copyJson">Copy JSON</button></div></details>
        <p>L6 is Pocket and L8 is Standard; a theme picks one. The other looks (L1–L5, L7 and their palettes, buttons and frames) are archived, untouched, in <b>archive/looks-2026-10</b>.</p></div>
    </div>`;
    const nb = $(".lab-body", lab); if (nb) nb.scrollTop = st;
    ["thmIdea", "thmPaste"].forEach((id, i) => { const el = $("#" + id); if (el) el.value = typed[i]; });
    if (mkOpen) $("#thmMake").open = true;
    const f = fk && $(fk, lab); if (f) f.focus({ preventScroll: true });
  }
  // how to find a drawer control again after a re-render
  function ctlKey(el) {
    if (!el || el === document.body || !$("#lab").contains(el)) return null;
    if (el.id) return "#" + CSS.escape(el.id);
    const a = ["data-thm", "data-lab", "data-labact"].find((k) => el.hasAttribute(k)), v = el.getAttribute("data-v");
    return a ? `[${a}="${CSS.escape(el.getAttribute(a))}"]${v != null ? `[data-v="${CSS.escape(v)}"]` : ""}` : null;
  }
  function refreshCode() { const c = $("#labCode"); if (c) c.textContent = code(); const j = $("#labJson"); if (j) j.value = JSON.stringify(themeJSON(), null, 2); }
  function themeJSON() {
    const u = CA.ui, th = cur(u), std = th.look === "standard", type = TYPES[th.look];
    return { $schema: "docs/THEME_FORMAT.md", format: 1, id: std ? "rm-standard" : "rm-pocket-final", name: std ? "Standard" : "Pocket (final)", extends: "rm-pocket", styleCode: code(), layout: th.look, family: "modern",
      palette: { id: TH.keyOf(th), tokens: TH.palette(th) }, typography: { id: type.id, body: type.body, display: type.body, mono: type.mono, numerals: type.num, scale: type.scale, displayScale: 1, numeralScale: type.ns },
      components: std ? { button: "flat", frame: "header" } : { button: "key", frame: "band" }, guidance: GUIDES[u.guide][0].toLowerCase(), density: DENS[u.density][0].toLowerCase(), motion: { level: +u.motion, multiplier: MOTION[u.motion][1] },
      effects: { crt: { curvature: ["flat", "tube", "warp"][+u.curve], scanlines: u.scan / 100, glow: u.glow / 100, flicker: u.flicker / 100, noise: u.noise / 100, aberration: u.ab / 100, vignette: u.vig / 100,
        mask: { N: "none", A: "aperture-grille", S: "shadow-mask" }[u.mask] }, bezel: "none" }, sounds: { level: +u.sound } };
  }
  // the clipboard, or a hidden field and the old copy command where the clipboard is refused
  function copy(text, btn) {
    const orig = btn.textContent, done = (ok) => { btn.textContent = ok ? "Copied" : "Couldn't copy"; setTimeout(() => (btn.textContent = orig), 1600); };
    const fallback = () => {
      const t = document.createElement("textarea"); t.value = text; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (e) {} t.remove(); done(ok);
    };
    try { navigator.clipboard.writeText(text).then(() => done(true), fallback); } catch (e) { fallback(); }
  }
  function msg(t) { const m = $("#labMsg"); if (m) m.innerHTML = t; }

  function openLab() { open = true; $("#lab").hidden = false; document.body.classList.add("lab-open"); render(); if (CA.app) CA.app.renderAll(); const x = $("#lab .lab-x"); if (x) x.focus(); }
  // closing drops a previewed slot: the screen goes back to the theme in effect
  function closeLab() {
    const back = !!peek();
    CA.motion.leave($("#lab")); $("#lab").hidden = true; document.body.classList.remove("lab-open");
    if (back) redraw(() => { open = false; slot = null; });
    else { open = false; slot = null; if (CA.app) CA.app.renderAll(); }
  }

  function bindLab() {
    const lab = $("#lab");
    lab.addEventListener("click", (e) => {
      const o = e.target.closest("[data-lab]");
      if (o) { const axis = o.dataset.lab; set({ [axis]: axis === "zoom" ? +o.dataset.v : o.dataset.v }); CA.sound.click(); return; }
      const sl = e.target.closest("[data-slot]");
      if (sl) { pickSlot(sl.dataset.slot); CA.sound.click(); return; }
      // a card fills the selected slot, whose preview pops as the screen redraws in that theme
      const tc = e.target.closest("[data-thm]");
      if (tc) {
        const th = find(tc.dataset.thm), s = selSlot();
        if (th) { set(usePatch(th)); if (s) CA.motion.after(() => CA.motion.ack($(`#slot-${s} .thm-pv`), "pop")); }
        CA.sound.click(); return;
      }
      const a = e.target.closest("[data-labact]"); if (!a) return;
      const act = a.dataset.labact, idea = () => ($("#thmIdea") ? $("#thmIdea").value.trim() : "");
      if (act === "close") closeLab();
      else if (act === "island") set({ island: !CA.ui.island });
      else if (act === "snd") { const prev = CA.sound.level; CA.sound.level = Math.max(1, prev); CA.sound.done(); CA.sound.level = prev; }
      else if (act === "sim") CA.app.simulate(a.dataset.v);
      else if (act === "lock") { const f = document.querySelector('#now [data-act="focus"][data-id]'); CA.app.startFocus(CA.state.sel || (f && f.dataset.id), 90, "lockdown"); }
      else if (act === "copy") copy(code(), a);
      else if (act === "copyJson") { const j = $("#labJson"); try { navigator.clipboard.writeText(j.value).then(() => (a.textContent = "Copied"), () => { j.select(); a.textContent = "Selected · " + MOD + "+C"; }); } catch (err) { j.select(); } }
      else if (act === "reset") set(Object.assign({}, parsedFinal, { nightPal: "P11" }));
      else if (act === "import") {
        const p = parseCode($("#labImport").value);
        if (p && !p.archived) { set(p); msg('<span class="ok">Applied.</span>'); }
        else msg(p ? `${esc(p.archived)} is an archived look. Run <b>python tools/serve_ui.py 4792 archive/looks-2026-10/ui</b> to see it.` : "That doesn't look like a style code. It starts with CAPP1 and includes L6 or L8.");
      }
      else if (act === "thmFile") $("#thmFile").click();
      else if (act === "thmExport") exportTheme();
      else if (act === "thmCopy") copy(JSON.stringify(TH.file(shown()), null, 2), a);
      else if (act === "thmBot") openUrl(TH.BOTS[a.dataset.v](TH.prompt(idea())));
      else if (act === "thmPrompt") copy(TH.prompt(idea()), a);
      else if (act === "thmRead") readTheme($("#thmPaste").value);
      else if (act === "thmSave") { if (pending) saveTheme(a.dataset.v === "fix" ? TH.fix(pending) : pending); }
      else if (act === "thmDel") delTheme(a.dataset.v);
    });
    lab.addEventListener("change", (e) => {
      const f = e.target.id === "thmFile" && e.target.files && e.target.files[0]; if (!f) return;
      f.text().then(readTheme, () => note('<span class="bad">That file couldn\'t be read.</span>'));
      e.target.value = "";
    });
    lab.addEventListener("input", (e) => {
      const k = e.target.dataset && e.target.dataset.slider; if (!k) return;
      const out = $("#out-" + k); if (out) out.textContent = e.target.value;
      set({ [k]: +e.target.value }, { light: true });
    });
    lab.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.id === "labImport") { e.preventDefault(); lab.querySelector('[data-labact="import"]').click(); }
      // the slots are a tablist: arrows move between Day and Night, Home and End go to either end
      const tab = e.target.closest && e.target.closest("[data-slot]");
      if (tab && /^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(e.key)) {
        e.preventDefault(); CA.sound.click();
        pickSlot(e.key === "Home" ? "day" : e.key === "End" ? "night" : tab.dataset.slot === "day" ? "night" : "day", true);
      }
    });
    if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener("change", () => { if (CA.ui.night === "auto") apply(); });
  }

  CA.lab = { open: openLab, close: closeLab, toggle: () => (open ? closeLab() : openLab()), isOpen: () => open, set, code, parseCode, zoom, toggleNight, theme: () => shown(), FINAL,
    look, adopt, fromStore };

  // boot order: settings → app → panel bindings
  apply(true);
  CA.app.init();
  bindLab();
})();
