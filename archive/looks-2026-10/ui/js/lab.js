/* Collegiapp — Design Lab: the variant catalogue (every axis has a stable ID), live switching,
   style codes ("CAPP1 L2 P4 B6 …") for marking picks as final, and theme-pack JSON export. */
(function () {
  const CA = window.CA;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("capp." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("capp." + k, JSON.stringify(v)); } catch (e) {} },
  };

  const mono = (h, rgb, o) => Object.assign({ "glow-rgb": rgb, "hover-bg": `rgba(${rgb}, .09)`, shadow: "rgba(0,0,0,.8)" }, h, o || {});
  const PALETTES = {
    P1: { name: "Green", note: "P1 phosphor · the classic terminal", t: mono({ "desk-c": "#030805", "panel-bg": "#030805", bg: "#030805", bg2: "#0a1a0e", fg: "#41ff7a", dim: "#1f9447", hi: "#c8ffd8", acc: "#41ff7a", acc2: "#b6ff5c", warn: "#e3ff6b", bad: "#ffffff", ok: "#41ff7a", "sel-bg": "#41ff7a", "sel-fg": "#021006", "chrome-bg": "#41ff7a", "chrome-fg": "#021006", hot: "#ffffff",
      k1: "#41ff7a", k2: "#b6ff5c", k3: "#c8ffd8", k4: "#2fd36a", k5: "#7dffa8", k6: "#1f9447", "t-r": "#e6ffe9", "t-g": "#41ff7a", "t-y": "#b6ff5c", "t-b": "#2fd36a", "t-c": "#7dffa8", "t-m": "#c8ffd8" }, "65, 255, 122") },
    P2: { name: "Amber", note: "P3 phosphor · warm, easy on the eyes at night", t: mono({ "desk-c": "#0c0700", "panel-bg": "#0c0700", bg: "#0c0700", bg2: "#1d1100", fg: "#ffb000", dim: "#a26a00", hi: "#ffe2a6", acc: "#ffb000", acc2: "#ffd04a", warn: "#ffe36b", bad: "#ffffff", ok: "#ffb000", "sel-bg": "#ffb000", "sel-fg": "#120900", "chrome-bg": "#ffb000", "chrome-fg": "#120900", hot: "#fff1c9",
      k1: "#ffb000", k2: "#ffd04a", k3: "#ffe2a6", k4: "#ff8c1a", k5: "#ffc870", k6: "#b07400", "t-r": "#ffe2a6", "t-g": "#ffb000", "t-y": "#ffd04a", "t-b": "#ff8c1a", "t-c": "#ffc870", "t-m": "#fff1c9" }, "255, 176, 0") },
    P3: { name: "Paper white", note: "P4 phosphor · cool white, pastel accents", t: mono({ "desk-c": "#090b0f", "panel-bg": "#090b0f", bg: "#090b0f", bg2: "#151a21", fg: "#dfe7ef", dim: "#7d8996", hi: "#ffffff", acc: "#dfe7ef", acc2: "#a9d4ff", warn: "#ffe7a0", bad: "#ffb3b3", ok: "#c9f5d4", "sel-bg": "#dfe7ef", "sel-fg": "#090b0f", "chrome-bg": "#dfe7ef", "chrome-fg": "#090b0f", hot: "#ffffff",
      k1: "#dfe7ef", k2: "#a9d4ff", k3: "#ffe7a0", k4: "#c9f5d4", k5: "#f3d9ff", k6: "#9fb6cc", "t-r": "#ffc7c7", "t-g": "#c9f5d4", "t-y": "#ffe7a0", "t-b": "#bcd6ff", "t-c": "#c9f3ff", "t-m": "#f3d9ff" }, "205, 225, 255") },
    P4: { name: "Teletext", note: "Broadcast 8-colour set", t: mono({ "desk-c": "#000000", "panel-bg": "#000000", bg: "#000000", bg2: "#111111", fg: "#ffffff", dim: "#8c8c8c", hi: "#ffff3c", acc: "#3cffff", acc2: "#3cff3c", warn: "#ffff3c", bad: "#ff3c3c", ok: "#3cff3c", "sel-bg": "#3cffff", "sel-fg": "#000000", "chrome-bg": "#3d5cff", "chrome-fg": "#ffff3c", hot: "#ffff3c",
      k1: "#3cffff", k2: "#3cff3c", k3: "#ffff3c", k4: "#ff3cff", k5: "#ff7a3c", k6: "#ffffff", "t-r": "#ff3c3c", "t-g": "#3cff3c", "t-y": "#ffff3c", "t-b": "#3d5cff", "t-c": "#3cffff", "t-m": "#ff3cff" }, "255, 255, 255") },
    P5: { name: "DOS blue", note: "16-colour text mode · blue windows, grey chrome", t: mono({ "desk-c": "#1b2a63", "panel-bg": "#0000aa", bg: "#0000aa", bg2: "#0000d4", fg: "#e8e8e8", dim: "#aab4ff", hi: "#ffff55", acc: "#00aaaa", acc2: "#00aa00", warn: "#ffff55", bad: "#ff5555", ok: "#55ff55", "sel-bg": "#00aaaa", "sel-fg": "#000000", "chrome-bg": "#aaaaaa", "chrome-fg": "#000000", hot: "#aa0000", shadow: "rgba(0,0,0,.6)",
      k1: "#55ffff", k2: "#55ff55", k3: "#ffff55", k4: "#ff55ff", k5: "#ff5555", k6: "#ffffff", "t-r": "#ff5555", "t-g": "#55ff55", "t-y": "#ffff55", "t-b": "#5555ff", "t-c": "#55ffff", "t-m": "#ff55ff" }, "170, 190, 255", { "hover-bg": "rgba(255,255,255,.1)" }) },
    P6: { name: "Vector cyan", note: "Vector-scan beam · cyan with magenta", t: mono({ "desk-c": "#02040b", "panel-bg": "#02040b", bg: "#02040b", bg2: "#07112a", fg: "#7df9ff", dim: "#2f7695", hi: "#eaffff", acc: "#7df9ff", acc2: "#ff5fd2", warn: "#ffd84f", bad: "#ff4f6d", ok: "#7dff9b", "sel-bg": "#7df9ff", "sel-fg": "#02040b", "chrome-bg": "#7df9ff", "chrome-fg": "#02040b", hot: "#ff5fd2",
      k1: "#7df9ff", k2: "#ff5fd2", k3: "#ffd84f", k4: "#7dff9b", k5: "#b18cff", k6: "#eaffff", "t-r": "#ff4f6d", "t-g": "#7dff9b", "t-y": "#ffd84f", "t-b": "#5f8bff", "t-c": "#7df9ff", "t-m": "#ff5fd2" }, "125, 249, 255") },
    P7: { name: "Gaucho", note: "UCSB navy #003660 + gold #FEBC11, coral and aqua accents", t: mono({ "desk-c": "#001426", "panel-bg": "#001a33", bg: "#001a33", bg2: "#00284d", fg: "#fbe7b5", dim: "#7590ad", hi: "#febc11", acc: "#febc11", acc2: "#4fc3d6", warn: "#febc11", bad: "#ef5645", ok: "#2bb8a8", "sel-bg": "#febc11", "sel-fg": "#001426", "chrome-bg": "#febc11", "chrome-fg": "#001426", hot: "#003660",
      k1: "#febc11", k2: "#4fc3d6", k3: "#ef5645", k4: "#2bb8a8", k5: "#dce1e5", k6: "#f7d774", "t-r": "#ef5645", "t-g": "#2bb8a8", "t-y": "#febc11", "t-b": "#5f9be0", "t-c": "#4fc3d6", "t-m": "#dce1e5" }, "254, 200, 80") },
    // retro-modern palettes: solid surfaces with tuned text contrast (p-*), plus the colours of their display inlays (p-disp-*)
    P8: { name: "Slate", note: "Dark slate UI, green phosphor accent and displays", t: mono({ "desk-c": "#0c0f13", "panel-bg": "#141820", bg: "#0c0f13", bg2: "#0f1318", fg: "#c9d1da", dim: "#8590a0", hi: "#f1f4f7", acc: "#3ddc84", acc2: "#6ea8fe", warn: "#f5b942", bad: "#ff6b6b", ok: "#3ddc84", "sel-bg": "#3ddc84", "sel-fg": "#04150b", "chrome-bg": "#1b2029", "chrome-fg": "#eef1f5", hot: "#ff6b6b",
      k1: "#6ea8fe", k2: "#3ddc84", k3: "#f5b942", k4: "#ff7eb6", k5: "#b69cff", k6: "#5ad1d1", "t-r": "#ff6b6b", "t-g": "#3ddc84", "t-y": "#f5b942", "t-b": "#6ea8fe", "t-c": "#5ad1d1", "t-m": "#ff7eb6",
      "p-surface": "#141820", "p-surface2": "#1b2029", "p-line": "#2a313d", "p-text": "#eef1f5", "p-text2": "#b3bcc8", "p-text3": "#8590a0", "p-acc": "#3ddc84", "p-on-acc": "#04150b",
      "p-disp-bg": "#06130b", "p-disp-fg": "#5dff9d", "p-disp-rgb": "61, 255, 140", "p-island": "#5dff9d" }, "61, 220, 132", { "hover-bg": "rgba(255,255,255,.04)", shadow: "rgba(0,0,0,.5)" }) },
    P9: { name: "Cream", note: "Light handheld plastic, orange keys, reflective LCD", t: mono({ scheme: "light", "desk-c": "#e6e2d8", "panel-bg": "#f6f3ec", bg: "#e6e2d8", bg2: "#fbf9f4", fg: "#2a2722", dim: "#6f695e", hi: "#151310", acc: "#ff5b1f", acc2: "#2f6fde", warn: "#9a5b00", bad: "#c8341b", ok: "#2e7d32", "sel-bg": "#ff5b1f", "sel-fg": "#1b1915", "chrome-bg": "#2a2722", "chrome-fg": "#f6f3ec", hot: "#ff5b1f",
      k1: "#2f6fde", k2: "#ff5b1f", k3: "#2e8b57", k4: "#b03aa8", k5: "#c27a00", k6: "#5b5548", "t-r": "#c8341b", "t-g": "#2e7d32", "t-y": "#9a5b00", "t-b": "#2f6fde", "t-c": "#00838f", "t-m": "#b03aa8",
      "p-surface": "#f6f3ec", "p-surface2": "#ebe7dd", "p-line": "#d3ccbd", "p-text": "#1b1915", "p-text2": "#4a453c", "p-text3": "#6f695e", "p-acc": "#ff5b1f", "p-on-acc": "#1b1915",
      "p-disp-bg": "#b1bd93", "p-disp-fg": "#1f2a17", "p-disp-rgb": "0, 0, 0", "p-island": "#ff7a3d" }, "255, 91, 31", { "hover-bg": "rgba(0,0,0,.04)", shadow: "rgba(60,50,30,.25)" }) },
    P10: { name: "Ivory", note: "Ivory paper, ledger green ink, black split-flap board", t: mono({ scheme: "light", "desk-c": "#e9e4d6", "panel-bg": "#fffdf6", bg: "#e9e4d6", bg2: "#fffefa", fg: "#2a2f35", dim: "#6b6f73", hi: "#15191d", acc: "#1f6f4a", acc2: "#8a2b2b", warn: "#9a5b00", bad: "#b42318", ok: "#1f6f4a", "sel-bg": "#1f6f4a", "sel-fg": "#ffffff", "chrome-bg": "#1f6f4a", "chrome-fg": "#ffffff", hot: "#b42318",
      k1: "#2b59c3", k2: "#1f6f4a", k3: "#b7791f", k4: "#8a2b2b", k5: "#6b4fa0", k6: "#2a7f8f", "t-r": "#b42318", "t-g": "#1f6f4a", "t-y": "#9a5b00", "t-b": "#2b59c3", "t-c": "#2a7f8f", "t-m": "#8a2b2b",
      "p-surface": "#fffdf6", "p-surface2": "#f3efe3", "p-line": "#ddd5c2", "p-text": "#191d22", "p-text2": "#454b52", "p-text3": "#6b6f73", "p-acc": "#1f6f4a", "p-on-acc": "#ffffff",
      "p-disp-bg": "#1b1d21", "p-disp-fg": "#f6f1e3", "p-disp-rgb": "246, 241, 227", "p-greenbar": "#ecf3ea", "p-island": "#f2c94c" }, "31, 111, 74", { "hover-bg": "rgba(31,111,74,.06)", shadow: "rgba(40,30,10,.18)" }) },
  };
  // ui/mono/num feed the retro-modern family; classic faces fall back to body/display
  const TYPES = {
    T1: { name: "VT323", note: "DEC VT320 terminal face", body: '"VT323", "Cascadia Mono", Consolas, monospace', display: '"VT323", "Cascadia Mono", Consolas, monospace', scale: 1.3, ds: 1 },
    T2: { name: "Plex Mono", note: "IBM PC lineage · the most readable classic face", body: '"IBM Plex Mono", "Cascadia Mono", Consolas, monospace', display: '"IBM Plex Mono", "Cascadia Mono", Consolas, monospace', scale: 0.9, ds: 1, ns: 0.62 },
    T3: { name: "Share Tech + Orbitron", note: "Arcade HUD numerals", body: '"Share Tech Mono", "Cascadia Mono", Consolas, monospace', display: '"Orbitron", "Share Tech Mono", sans-serif', scale: 1.02, ds: 0.8, ns: 0.6 },
    T4: { name: "VT323 + Press Start", note: "8-bit display headings", body: '"VT323", "Cascadia Mono", Consolas, monospace', display: '"Press Start 2P", "VT323", monospace', scale: 1.3, ds: 0.5, ns: 0.42 },
    T5: { name: "Inter + VT323", note: "Inter for everything you read; VT323 only inside displays", body: '"Inter", "Segoe UI", system-ui, sans-serif', display: '"Inter", "Segoe UI", system-ui, sans-serif',
      mono: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace', num: '"VT323", "Cascadia Mono", monospace', scale: 0.94, ds: 1, ns: 1 },
    T6: { name: "Space Grotesk + Doto", note: "Grotesk UI, Space Mono labels, a dot-matrix LCD face", body: '"Space Grotesk", "Segoe UI", system-ui, sans-serif', display: '"Space Grotesk", "Segoe UI", system-ui, sans-serif',
      mono: '"Space Mono", Consolas, monospace', num: '"Doto", "VT323", monospace', scale: 0.95, ds: 1, ns: 0.74 },
    T7: { name: "Plex Sans + Plex Mono", note: "IBM Plex family; mono numerals on split-flap tiles", body: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif', display: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
      mono: '"IBM Plex Mono", Consolas, monospace', num: '"IBM Plex Mono", Consolas, monospace', scale: 0.94, ds: 1, ns: 0.62 },
  };
  const BUTTONS = { b1: ["Bracket", "Terminal [ OK ]; reverse video on hover"], b2: ["Reverse", "Solid inverse-video blocks"], b3: ["Keycap", "Sculpted keys that travel when pressed"],
    b4: ["Bevel", "DOS dialog buttons with a hard shadow that presses flat"], b5: ["Vector", "Corner brackets that draw into a full outline"], b6: ["Block", "Teletext colour blocks; flash on hover"],
    b7: ["Soft", "Filled primary, outlined secondary, ghost tertiary; shortcut chip inside"], b8: ["Key", "Raised hardware keys that travel 3px when pressed"] };
  const FRAMES = { f1: ["Single", "Label cut into a single rule"], f2: ["Double", "Windowed double rule, centred title, close box"], f3: ["Band", "Full-width colour band header"],
    f4: ["Ticks", "Vector corner ticks with a trailing rule"], f5: ["Glow", "Soft rounded phosphor outline"],
    f6: ["Card", "Solid rounded card, quiet border, sentence-case header"], f7: ["Module", "Device module with a printed label and accent tab"], f8: ["Sheet", "Paper sheet with a perforated edge and ruled header"] };
  const GUIDES = { g1: ["Keycaps", "Every button shows its key. Fastest to learn."], g2: ["Alt tips", "Clean buttons; hold Alt to overlay every shortcut, then press it."],
    g3: ["Minimal", "No hints anywhere. For when you know it all."], g4: ["Coach", "Rotating tips in the footer and a pulse on the next best action."] };
  const MOTION = { 0: ["Off", 0], 1: ["Subtle", 0.7], 2: ["Full", 1], 3: ["Overdrive", 1.15] };
  const DENS = { D1: ["Compact", "14px", ".45em", ".5em", ".04em"], D2: ["Cozy", "16px", ".6em", ".7em", ".18em"], D3: ["Roomy", "18px", ".8em", ".9em", ".32em"] };
  const FLAT = { curve: "0", scan: 0, flicker: 0, noise: 0, ab: 0, vig: 0, mask: "N", bezel: "N" };
  const RENDITIONS = [
    { key: "signal", id: "L5", fam: "modern", name: "Signal", vision: "Dark dashboard. Sidebar of views and classes, one Do First card with a big Start button, an up-next rail. CRT glass only on the countdowns.",
      d: Object.assign({ pal: "P8", btn: "b7", frm: "f6", type: "T5", guide: "g1", motion: "2", density: "D2", glow: 60 }, FLAT) },
    { key: "pocket", id: "L6", fam: "modern", name: "Pocket", vision: "Handheld device. Program keys for views, LCD countdowns, and a deck of big labelled keys for the five things you do all day.",
      d: Object.assign({ pal: "P9", btn: "b8", frm: "f7", type: "T6", guide: "g1", motion: "2", density: "D2", glow: 0 }, FLAT) },
    { key: "ledger", id: "L7", fam: "modern", name: "Ledger", vision: "Paper planner. Binder tabs, a green-bar sheet of work, a split-flap board for what's next.",
      d: Object.assign({ pal: "P10", btn: "b7", frm: "f8", type: "T7", guide: "g1", motion: "2", density: "D2", glow: 0 }, FLAT) },
    { key: "phosphor", id: "L1", fam: "crt", name: "Phosphor", vision: "Terminal. Tree of views on the left, a command line that is also quick-add, rows that type themselves out.",
      d: { pal: "P1", btn: "b1", frm: "f1", type: "T1", guide: "g1", motion: "2", density: "D2", curve: "1", scan: 55, glow: 65, flicker: 15, noise: 12, ab: 15, vig: 55, mask: "A", bezel: "G" } },
    { key: "teletext", id: "L2", fam: "crt", name: "Teletext", vision: "Broadcast pages. Type a 3-digit page, four colour Fastext keys that change with context, a ticker of what matters.",
      d: { pal: "P4", btn: "b6", frm: "f3", type: "T4", guide: "g4", motion: "2", density: "D2", curve: "1", scan: 45, glow: 40, flicker: 10, noise: 10, ab: 35, vig: 45, mask: "S", bezel: "G" } },
    { key: "mainframe", id: "L3", fam: "crt", name: "Mainframe", vision: "DOS desktop. Draggable windows with drop shadows, Alt-letter menus, an F-key status line.",
      d: { pal: "P5", btn: "b4", frm: "f2", type: "T2", guide: "g1", motion: "1", density: "D2", curve: "1", scan: 30, glow: 18, flicker: 6, noise: 6, ab: 8, vig: 40, mask: "N", bezel: "B" } },
    { key: "vector", id: "L4", fam: "crt", name: "Vector", vision: "Arcade HUD. A reactor ring around the Do First item, XP and streaks, a dock and a radial menu.",
      d: { pal: "P6", btn: "b5", frm: "f4", type: "T3", guide: "g2", motion: "3", density: "D2", curve: "1", scan: 30, glow: 90, flicker: 12, noise: 8, ab: 25, vig: 60, mask: "A", bezel: "G" } },
  ];
  const rByKey = (k) => RENDITIONS.find((r) => r.key === k) || RENDITIONS[0];

  // ── state ──
  const env = { desk: window.innerWidth >= 1100 ? "desk" : "full", shell: "win", island: true, sound: "0", focusLevel: "hard" };
  let saved = store.get("ui", null);
  const hash = (location.hash || "").slice(1);
  if (saved && saved.v !== 2) saved = null; // looks saved by the all-CRT v1 prototype start over on Signal; candidates are kept
  CA.ui = Object.assign({ r: RENDITIONS[0].key, v: 2 }, RENDITIONS[0].d, env, saved || {});
  // a #rendition link switches layout (with its defaults) but never undoes your tweaks to the current one
  if (RENDITIONS.some((r) => r.key === hash) && hash !== (saved && saved.r)) Object.assign(CA.ui, { r: hash }, rByKey(hash).d);
  let cands = store.get("cands", []);
  let open = false;
  let applied = []; // palette tokens currently set on :root, so a switch can clear ones the next palette lacks

  function code(u) {
    u = u || CA.ui;
    return ["CAPP1", rByKey(u.r).id, u.pal, u.btn.toUpperCase(), u.frm.toUpperCase(), u.type, u.guide.toUpperCase(), "M" + u.motion, u.density, "C" + u.curve,
      "s" + u.scan, "g" + u.glow, "f" + u.flicker, "n" + u.noise, "a" + u.ab, "v" + u.vig, "m" + u.mask, "b" + u.bezel, "S" + u.sound].join(" ");
  }
  function parseCode(str) {
    const out = {}; let ok = false;
    for (const t of String(str).trim().split(/\s+/)) {
      let m;
      if ((m = t.match(/^L(\d)$/))) { const r = RENDITIONS.find((x) => x.id === t); if (r) { out.r = r.key; ok = true; } }
      else if ((m = t.match(/^P(\d{1,2})$/)) && PALETTES[t]) out.pal = t;
      else if ((m = t.match(/^B(\d)$/)) && BUTTONS["b" + m[1]]) out.btn = "b" + m[1];
      else if ((m = t.match(/^F(\d)$/)) && FRAMES["f" + m[1]]) out.frm = "f" + m[1];
      else if ((m = t.match(/^T(\d)$/)) && TYPES[t]) out.type = t;
      else if ((m = t.match(/^G([1-4])$/))) out.guide = "g" + m[1];
      else if ((m = t.match(/^M([0-3])$/))) out.motion = m[1];
      else if ((m = t.match(/^D([1-3])$/))) out.density = "D" + m[1];
      else if ((m = t.match(/^C([0-2])$/))) out.curve = m[1];
      else if ((m = t.match(/^([sgfnav])(\d{1,3})$/))) out[{ s: "scan", g: "glow", f: "flicker", n: "noise", a: "ab", v: "vig" }[m[1]]] = Math.min(100, +m[2]);
      else if ((m = t.match(/^m([NAS])$/))) out.mask = m[1];
      else if ((m = t.match(/^b([GBN])$/))) out.bezel = m[1];
      else if ((m = t.match(/^S([0-2])$/))) out.sound = m[1];
    }
    return ok ? out : null;
  }

  function apply(light) {
    const u = CA.ui, root = document.documentElement, sc = $("#screen");
    if (!PALETTES[u.pal]) u.pal = rByKey(u.r).d.pal;
    if (!TYPES[u.type]) u.type = rByKey(u.r).d.type;
    const pal = PALETTES[u.pal].t, keys = Object.keys(pal).filter((k) => k !== "scheme");
    applied.filter((k) => !(k in pal)).forEach((k) => root.style.removeProperty("--" + k));
    keys.forEach((k) => root.style.setProperty("--" + k, pal[k])); applied = keys;
    root.style.colorScheme = pal.scheme || "dark";
    const ty = TYPES[u.type], fam = rByKey(u.r).fam;
    root.style.setProperty("--font-body", ty.body); root.style.setProperty("--font-display", ty.display);
    root.style.setProperty("--font-ui", ty.body); root.style.setProperty("--font-mono", ty.mono || ty.body); root.style.setProperty("--font-num", ty.num || ty.display);
    root.style.setProperty("--font-scale", ty.scale); root.style.setProperty("--display-scale", ty.ds); root.style.setProperty("--num-scale", ty.ns || 1);
    root.dataset.fam = fam; sc.dataset.fam = fam;
    const dn = DENS[u.density];
    root.style.setProperty("--fs-base", dn[1]); root.style.setProperty("--pad", dn[2]); root.style.setProperty("--gap", dn[3]); root.style.setProperty("--rowpad", dn[4]);
    root.dataset.motion = u.motion; root.style.setProperty("--m", MOTION[u.motion][1]);
    sc.dataset.r = u.r; sc.dataset.guide = u.guide;
    [...sc.classList].filter((c) => /^(bset|fset)-/.test(c)).forEach((c) => sc.classList.remove(c));
    sc.classList.add("bset-" + u.btn, "fset-" + u.frm);
    $(".bezel").dataset.bezel = u.bezel;
    CA.fx.apply(u); CA.sound.level = +u.sound;
    store.set("ui", u);
    store.set("tokens", fam === "modern" // island.html reads these; the island is always dark, so modern looks send their island colour
      ? { fg: pal["p-island"] || pal.acc, hi: "#f2f4f7", warn: pal.warn, "glow-rgb": pal["glow-rgb"], "font-body": ty.body, "font-scale": 0.95 }
      : { fg: pal.fg, hi: pal.hi, warn: pal.warn, "glow-rgb": pal["glow-rgb"], "font-body": ty.body, "font-scale": ty.scale });
    if (!light && CA.app) CA.app.renderAll();
    if (open) light ? refreshCode() : render();
  }
  function set(patch, opts) {
    const prevR = CA.ui.r;
    Object.assign(CA.ui, patch);
    if (patch.r && patch.r !== prevR) CA.fx.degauss();
    apply(opts && opts.light);
  }
  function setRendition(key) {
    Object.assign(CA.ui, { r: key }, rByKey(key).d);
    CA.fx.degauss(); apply();
    try { history.replaceState(null, "", "#" + key); } catch (e) {}
    if (CA.app) CA.app.toast(`${rByKey(key).id} ${rByKey(key).name} · ${esc(rByKey(key).vision)}`, { ms: 5200 });
  }
  function cycle(d) { const i = RENDITIONS.findIndex((r) => r.key === CA.ui.r); setRendition(RENDITIONS[(i + d + RENDITIONS.length) % RENDITIONS.length].key); }

  // ── lab panel ──
  const finalCand = () => cands.find((c) => c.final);
  function isFinal(axis, v) { const f = finalCand(); if (!f) return false; const p = parseCode(f.code); return p && String(p[axis]) === String(v); }
  const opt = (axis, v, id, label, extra) => `<button class="opt ${String(CA.ui[axis]) === String(v) ? "on" : ""} ${isFinal(axis, v) ? "final" : ""}" data-lab="${axis}" data-v="${v}">${extra || ""}<span class="id">${id}</span>${label}</button>`;
  function thumb(key) {
    const box = (css) => `<div style="position:absolute;${css}"></div>`;
    if (key === "signal") return `<div class="thumb t-signal">${box("left:0;top:0;bottom:0;width:21%;background:#141820;border-right:1px solid #2a313d")}${[9, 17, 25, 33].map((t, i) => box(`left:4%;top:${t}px;width:${i ? 11 : 13}%;height:3px;border-radius:2px;background:${i ? "#3a4250" : "#3ddc84"}`)).join("")}
      ${box("left:25%;top:6px;width:44%;height:6px;border-radius:3px;background:#1b2029")}${box("left:25%;top:17px;width:47%;height:24px;border-radius:5px;background:#141820;box-shadow:0 0 0 1px #2a313d")}${box("left:28%;top:22px;width:24%;height:4px;border-radius:2px;background:#eef1f5")}${box("left:28%;top:31px;width:15%;height:6px;border-radius:3px;background:#3ddc84")}
      ${box("left:56%;top:20px;width:13%;height:18px;border-radius:4px;background:#06130b;box-shadow:0 0 8px rgba(61,255,140,.45)")}${box("left:25%;top:46px;width:47%;height:3px;border-radius:2px;background:#2a313d")}${box("left:25%;top:52px;width:38%;height:3px;border-radius:2px;background:#2a313d")}${box("left:75%;top:6px;right:3%;bottom:6px;border-radius:5px;background:#141820;box-shadow:0 0 0 1px #2a313d")}${box("left:78%;top:11px;right:6%;height:12px;border-radius:3px;background:#06130b")}</div>`;
    if (key === "pocket") return `<div class="thumb t-pocket">${[0, 1, 2, 3, 4, 5].map((i) => box(`left:${5 + i * 11}%;top:6px;width:9%;height:6px;border-radius:2px;background:${i ? "#f6f3ec" : "#2a2722"};box-shadow:0 1px 0 #cfc8b9`)).join("")}
      ${box("left:5%;top:17px;width:38%;height:14px;border-radius:3px;background:#b1bd93;box-shadow:0 0 0 2px #2a2722")}${box("left:5%;top:35px;width:38%;height:8px;border-radius:3px;background:#f6f3ec;box-shadow:0 0 0 1px #d3ccbd")}${box("left:47%;top:17px;right:5%;height:26px;border-radius:4px;background:#f6f3ec;box-shadow:0 0 0 1px #d3ccbd")}
      ${[0, 1, 2, 3].map((i) => box(`left:${5 + i * 14}%;bottom:4px;width:12%;height:8px;border-radius:3px;background:${i ? "#f6f3ec" : "#ff5b1f"};box-shadow:0 2px 0 #b6ad99`)).join("")}</div>`;
    if (key === "ledger") return `<div class="thumb t-ledger">${[0, 1, 2, 3, 4].map((i) => box(`left:${5 + i * 10}%;top:5px;width:9%;height:6px;border-radius:3px 3px 0 0;background:${i ? "#f3efe3" : "#fffdf6"};box-shadow:inset 0 ${i ? 0 : 2}px 0 #1f6f4a`)).join("")}
      ${box("left:5%;top:11px;width:56%;bottom:5px;background:#fffdf6;box-shadow:0 0 0 1px #ddd5c2")}${[16, 24, 32, 40].map((t, i) => box(`left:6%;top:${t}px;width:54%;height:7px;background:${i % 2 ? "#ecf3ea" : "transparent"}`)).join("")}
      ${box("left:65%;top:11px;right:5%;height:17px;border-radius:3px;background:#1b1d21")}${[0, 1, 2, 3].map((i) => box(`left:${68 + i * 6.5}%;top:14px;width:5%;height:11px;border-radius:1px;background:#2c2f35`)).join("")}${box("left:65%;top:32px;right:5%;bottom:5px;border-radius:3px;background:#1b1d21")}</div>`;
    if (key === "phosphor") return `<div class="thumb t-phosphor">${[[8, 40], [16, 70], [24, 55], [32, 80], [40, 30], [48, 62]].map(([t, w]) => `<i style="top:${t}px;width:${w}%"></i>`).join("")}</div>`;
    if (key === "teletext") return `<div class="thumb t-teletext"><div style="position:absolute;left:6px;right:6px;top:5px;height:5px;background:#fff"></div><div style="position:absolute;left:6px;right:6px;top:14px;height:14px;background:#3d5cff"></div><div style="position:absolute;left:12px;top:17px;width:40%;height:8px;background:#ffff3c"></div>${["#ff3c3c", "#3cff3c", "#ffff3c", "#3d5cff"].map((c, i) => `<div style="position:absolute;bottom:5px;left:${6 + i * 24}%;width:21%;height:7px;background:${c}"></div>`).join("")}<div style="position:absolute;left:6px;top:33px;width:58%;height:3px;background:#3cffff"></div><div style="position:absolute;left:6px;top:39px;width:46%;height:3px;background:#fff"></div></div>`;
    if (key === "mainframe") return `<div class="thumb t-mainframe"><div style="position:absolute;left:0;right:0;top:0;height:7px;background:#aaa"></div><div style="position:absolute;left:7%;top:14px;width:38%;height:34px;background:#0000aa;border:2px double #aab4ff;box-shadow:5px 4px 0 rgba(0,0,0,.6)"></div><div style="position:absolute;left:52%;top:12px;width:40%;height:38px;background:#0000aa;border:2px double #ffff55;box-shadow:5px 4px 0 rgba(0,0,0,.6)"></div><div style="position:absolute;left:0;right:0;bottom:0;height:6px;background:#aaa"></div></div>`;
    return `<div class="thumb t-vector"><svg viewBox="0 0 160 58" width="100%" height="100%"><circle cx="80" cy="29" r="21" fill="none" stroke="#2f7695" stroke-width="1.5"/><circle cx="80" cy="29" r="21" fill="none" stroke="#7df9ff" stroke-width="2.5" stroke-dasharray="132" stroke-dashoffset="44" transform="rotate(-90 80 29)" style="filter:drop-shadow(0 0 3px #7df9ff)"/><path d="M10 10h12M10 10v8M150 10h-12M150 10v8M10 48h12M10 48v-8M150 48h-12M150 48v-8" stroke="#7df9ff" stroke-width="1.5" fill="none"/><text x="80" y="33" fill="#eaffff" font-size="10" text-anchor="middle" font-family="Orbitron, sans-serif">25:00</text></svg></div>`;
  }
  function render() {
    const lab = $("#lab"), body = $(".lab-body", lab), st = body ? body.scrollTop : 0, u = CA.ui, f = finalCand(), modern = rByKey(u.r).fam === "modern";
    const sl = (k, label) => `<div class="sl"><label for="sl-${k}">${label}</label><input type="range" id="sl-${k}" min="0" max="100" value="${u[k]}" data-slider="${k}"><output id="out-${k}">${u[k]}</output></div>`;
    const card = (r) => `<button class="rcard ${u.r === r.key ? "on" : ""}" data-labact="rend" data-v="${r.key}">${thumb(r.key)}<span class="nm"><span class="id">${r.id}</span>${r.name}${isFinal("r", r.key) ? " ★" : ""}</span><span class="ds">${esc(r.vision)}</span></button>`;
    const group = (fam, title, note) => `<div class="rgroup"><div class="rg-h">${title}</div><p>${note}</p><div class="rcards">${RENDITIONS.filter((r) => r.fam === fam).map(card).join("")}</div></div>`;
    lab.innerHTML = `<div class="lab-head"><span class="led"></span><div><h2>Design Lab</h2><div class="sub">Every choice has an ID · ${/Mac/.test(navigator.platform || "") ? "⌘" : "Ctrl"}+. toggles · [ and ] switch layouts</div></div><button class="lab-btn lab-x" data-labact="close" aria-label="Close Design Lab">Close</button></div>
    <div class="lab-body">
      <div class="lab-sec"><h3>Final pick</h3>${f ? `<div class="final-card"><span class="lbl">★ To be used finally · ${esc(f.name)}</span><div class="code">${esc(f.code)}</div><div class="lab-row"><button class="lab-btn" data-labact="load" data-i="${cands.indexOf(f)}">Load final</button><span class="note">Send this code along to make it the default theme.</span></div></div>` : `<p>Nothing marked final yet. Tune the screen, then press ★ Mark as final at the bottom. Options in your final pick show a ★.</p>`}</div>
      <div class="lab-sec"><h3>Layout</h3>${group("modern", "Retro-modern · recommended", "Clean, readable layouts. The retro lives in the displays, keys and paper, never on top of text.")}${group("crt", "Classic CRT", "Full-screen CRT renditions. Atmospheric, but harder to read for long sessions.")}<p style="margin-top:8px">Choosing a layout loads its default palette, buttons, frames and type. Mix freely below.</p></div>
      <div class="lab-sec"><h3>Palette</h3><div class="opts">${Object.entries(PALETTES).map(([id, p]) => opt("pal", id, id, p.name, `<span class="sw" style="background:linear-gradient(135deg, ${p.t["desk-c"]} 0 40%, ${p.t["p-acc"] || p.t.fg} 40% 70%, ${p.t["p-disp-bg"] || p.t.acc2} 70%)"></span>`)).join("")}</div><div class="opt-desc">${esc(PALETTES[u.pal].note)}</div></div>
      <div class="lab-sec"><h3>Buttons</h3><div class="prev">${Object.entries(BUTTONS).map(([id, [nm]]) => `<div class="pv-row bset-${id} ${u.btn === id ? "on" : ""}" data-lab="btn" data-v="${id}"><span class="pv-id">${id.toUpperCase()}${isFinal("btn", id) ? "★" : ""}</span><span class="btn primary">▶ Focus<kbd>F</kbd></span><span class="btn" data-tone="g">Done</span><span class="btn ghost" data-tone="y">${nm}</span></div>`).join("")}</div><div class="opt-desc">${esc(BUTTONS[u.btn][1])}</div></div>
      <div class="lab-sec"><h3>Frames</h3><div class="prev"><div class="pv-fr">${Object.entries(FRAMES).map(([id, [nm]]) => `<div class="fset-${id} ${u.frm === id ? "on" : ""}" data-lab="frm" data-v="${id}"><div class="panel"><div class="ph"><span class="wbtn">[■]</span><span class="pt">Do first</span><span class="sp"></span><span class="cnt">#1</span></div><div class="pb">HW 6 · 11:59 PM</div></div><div class="pv-id">${id.toUpperCase()} ${nm}${isFinal("frm", id) ? " ★" : ""}</div></div>`).join("")}</div></div><div class="opt-desc">${esc(FRAMES[u.frm][1])}</div></div>
      <div class="lab-sec"><h3>Type</h3><div class="opts">${Object.entries(TYPES).map(([id, t]) => opt("type", id, id, `<span style="font-family:${esc(t.display)};font-size:${id === "T4" ? 9 : 13}px">${t.name}</span>`)).join("")}</div><div class="opt-desc">${esc(TYPES[u.type].note)}</div></div>
      <div class="lab-sec"><h3>Guidance · how shortcuts are taught</h3><div class="opts">${Object.entries(GUIDES).map(([id, [nm]]) => opt("guide", id, id.toUpperCase(), nm)).join("")}</div><div class="opt-desc">${esc(GUIDES[u.guide][1])}</div></div>
      <div class="lab-sec"><h3>Motion · density</h3><div class="opts">${Object.entries(MOTION).map(([id, [nm]]) => opt("motion", id, "M" + id, nm)).join("")}</div><div class="opts" style="margin-top:6px">${Object.entries(DENS).map(([id, [nm]]) => opt("density", id, id, nm)).join("")}</div></div>
      <div class="lab-sec"><h3>CRT effects · whole screen</h3>${modern ? `<p>Retro-modern layouts keep these at 0 so text stays crisp. Glow only lights the display inlays.</p>` : ""}<div class="opts">${opt("curve", "0", "C0", "Flat")}${opt("curve", "1", "C1", "Rounded tube")}${opt("curve", "2", "C2", "Warped glass · experimental")}</div>
        <div style="margin-top:8px">${sl("scan", "Scanlines")}${sl("glow", "Glow")}${sl("flicker", "Flicker")}${sl("noise", "Noise")}${sl("ab", "Aberration")}${sl("vig", "Vignette")}</div>
        <div class="opts" style="margin-top:6px">${opt("mask", "N", "mN", "No mask")}${opt("mask", "A", "mA", "Aperture grille")}${opt("mask", "S", "mS", "Shadow mask")}</div>
        <div class="opts" style="margin-top:6px">${opt("bezel", "G", "bG", "Graphite bezel")}${opt("bezel", "B", "bB", "Beige bezel")}${opt("bezel", "N", "bN", "No bezel")}</div></div>
      <div class="lab-sec"><h3>Desktop presence preview</h3><div class="opts">${opt("desk", "desk", "", "Desk preview")}${opt("desk", "full", "", "App window only")}</div>
        <div class="opts" style="margin-top:6px">${opt("shell", "win", "", "Windows taskbar")}${opt("shell", "zebar", "", "Zebar bar")}${opt("shell", "mac", "", "macOS menu bar")}</div>
        <div class="opts" style="margin-top:6px"><button class="opt ${u.island ? "on" : ""}" data-labact="island">Island ${u.island ? "on" : "off"}</button></div>
        <p style="margin-top:8px">The island is the always-on-top live activity. The taskbar shows progress and a due-today badge; Zebar and the macOS menu bar show text.</p></div>
      <div class="lab-sec"><h3>Focus · sound</h3><div class="opts">${opt("focusLevel", "soft", "", "Soft")}${opt("focusLevel", "hard", "", "Hard")}${opt("focusLevel", "lockdown", "", "Lockdown")}</div><div class="opt-desc">Default level when you press F.</div>
        <div class="opts">${opt("sound", "0", "S0", "Sound off")}${opt("sound", "1", "S1", "Soft")}${opt("sound", "2", "S2", "Full")}<button class="lab-btn" data-labact="snd">Test</button></div></div>
      <div class="lab-sec"><h3>Simulate</h3><div class="lab-row"><button class="lab-btn" data-labact="sim" data-v="nudge">Class nudge</button><button class="lab-btn" data-labact="sim" data-v="alert">Class alert</button><button class="lab-btn" data-labact="sim" data-v="takeover">Takeover</button><button class="lab-btn" data-labact="lock">Lockdown focus</button><button class="lab-btn" data-labact="boot">Boot sequence</button><button class="lab-btn" data-labact="power">Power cycle</button></div></div>
      <div class="lab-sec"><h3>Lock in</h3><div class="code" id="labCode">${esc(code())}</div>
        <div class="lab-row" style="margin-top:8px"><button class="lab-btn hot" data-labact="final">★ Mark as final</button><button class="lab-btn" data-labact="save">Save candidate</button><button class="lab-btn" data-labact="copy">Copy code</button></div>
        <div class="cands">${cands.map((c, i) => `<div class="cand ${c.final ? "final" : ""}"><span class="cn">${c.final ? "★ " : ""}${esc(c.name)}</span><span class="lab-row"><button class="lab-btn" data-labact="load" data-i="${i}">Load</button><button class="lab-btn" data-labact="star" data-i="${i}">${c.final ? "Unstar" : "★"}</button><button class="lab-btn" data-labact="rm" data-i="${i}" aria-label="Remove">×</button></span><span class="cc">${esc(c.code)}</span></div>`).join("")}</div>
        <div style="margin-top:10px"><label class="note" for="labImport">Paste a style code</label><div class="lab-row"><input type="text" id="labImport" placeholder="CAPP1 L5 P8 B7 F6 …" spellcheck="false"><button class="lab-btn" data-labact="import">Apply code</button><button class="lab-btn" data-labact="reset">Reset to layout defaults</button></div><div class="note" id="labMsg"></div></div></div>
      <div class="lab-sec"><h3>Export theme pack</h3><p>Save as <b>themes/&lt;id&gt;/theme.json</b>. Format: docs/THEME_FORMAT.md.</p><textarea id="labJson" readonly spellcheck="false">${esc(JSON.stringify(themeJSON(), null, 2))}</textarea><div class="lab-row" style="margin-top:6px"><button class="lab-btn" data-labact="copyJson">Copy JSON</button></div></div>
    </div>`;
    const nb = $(".lab-body", lab); if (nb) nb.scrollTop = st;
  }
  function refreshCode() { const c = $("#labCode"); if (c) c.textContent = code(); const j = $("#labJson"); if (j) j.value = JSON.stringify(themeJSON(), null, 2); }
  function themeJSON() {
    const u = CA.ui, r = rByKey(u.r), t = TYPES[u.type];
    const pre = r.fam === "modern" ? "rm-" : "crt-";
    return { $schema: "docs/THEME_FORMAT.md", format: 1, id: pre + r.key + "-custom", name: (r.fam === "modern" ? "Retro-modern " : "CRT ") + r.name + " (custom)", extends: pre + r.key, styleCode: code(),
      layout: r.key, family: r.fam, palette: Object.assign({ id: u.pal }, { tokens: PALETTES[u.pal].t }),
      typography: { id: u.type, body: t.body, display: t.display, mono: t.mono || t.body, numerals: t.num || t.display, scale: t.scale, displayScale: t.ds, numeralScale: t.ns || 1 },
      components: { button: BUTTONS[u.btn][0].toLowerCase(), frame: FRAMES[u.frm][0].toLowerCase() }, guidance: GUIDES[u.guide][0].toLowerCase().replace(" ", "-"),
      density: DENS[u.density][0].toLowerCase(), motion: { level: +u.motion, multiplier: MOTION[u.motion][1] },
      effects: { crt: { curvature: ["flat", "tube", "warp"][+u.curve], scanlines: u.scan / 100, glow: u.glow / 100, flicker: u.flicker / 100, noise: u.noise / 100, aberration: u.ab / 100, vignette: u.vig / 100,
        mask: { N: "none", A: "aperture-grille", S: "shadow-mask" }[u.mask] }, bezel: { G: "graphite", B: "beige", N: "none" }[u.bezel] }, sounds: { level: +u.sound } };
  }
  function copy(text, btn) {
    const orig = btn.textContent, done = (ok) => { btn.textContent = ok ? "Copied" : "Selected · press Ctrl+C"; setTimeout(() => (btn.textContent = orig), 1600); };
    const fallback = () => { const el = $("#labCode"); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); done(false); };
    try { navigator.clipboard.writeText(text).then(() => done(true), fallback); } catch (e) { fallback(); }
  }
  function msg(t) { const m = $("#labMsg"); if (m) { m.innerHTML = t; } }

  function openLab() { open = true; const lab = $("#lab"); lab.hidden = false; document.body.classList.add("lab-open"); render(); if (CA.app) CA.app.renderAll(); }
  function closeLab() { open = false; $("#lab").hidden = true; document.body.classList.remove("lab-open"); if (CA.app) CA.app.renderAll(); }

  function bindLab() {
    const lab = $("#lab");
    lab.addEventListener("click", (e) => {
      const o = e.target.closest("[data-lab]");
      if (o) { const axis = o.dataset.lab; set({ [axis]: o.dataset.v }); CA.sound.click(); return; }
      const a = e.target.closest("[data-labact]"); if (!a) return;
      const act = a.dataset.labact, i = +a.dataset.i;
      if (act === "close") closeLab();
      else if (act === "rend") setRendition(a.dataset.v);
      else if (act === "island") set({ island: !CA.ui.island });
      else if (act === "snd") { const prev = CA.sound.level; CA.sound.level = Math.max(1, prev); CA.sound.done(); CA.sound.level = prev; }
      else if (act === "sim") CA.app.simulate(a.dataset.v);
      else if (act === "lock") { const f = document.querySelector('#now [data-act="focus"][data-id]'); CA.app.startFocus(CA.state.sel || (f && f.dataset.id), 90, "lockdown"); }
      else if (act === "boot") CA.app.boot(true);
      else if (act === "power") { CA.app.power(); setTimeout(() => CA.app.power(), 1400); }
      else if (act === "final" || act === "save") {
        const c = code(), existing = cands.find((x) => x.code === c);
        if (act === "final") { cands.forEach((x) => (x.final = false)); if (existing) existing.final = true; else cands.push({ name: "Final · " + rByKey(CA.ui.r).name, code: c, final: true }); }
        else if (!existing) cands.push({ name: "Candidate " + String.fromCharCode(65 + (cands.length % 26)) + " · " + rByKey(CA.ui.r).name, code: c, final: false });
        store.set("cands", cands); render(); CA.sound.ok();
        if (act === "final") CA.app.toast("★ Marked as final · " + esc(c), { ms: 6000 });
      }
      else if (act === "copy") copy(code(), a);
      else if (act === "copyJson") { const j = $("#labJson"); try { navigator.clipboard.writeText(j.value).then(() => (a.textContent = "Copied"), () => { j.select(); a.textContent = "Selected · Ctrl+C"; }); } catch (err) { j.select(); } }
      else if (act === "load") { const p = parseCode(cands[i].code); if (p) set(p); }
      else if (act === "star") { const was = cands[i].final; cands.forEach((x) => (x.final = false)); cands[i].final = !was; store.set("cands", cands); render(); }
      else if (act === "rm") { cands.splice(i, 1); store.set("cands", cands); render(); }
      else if (act === "import") { const p = parseCode($("#labImport").value); if (p) { set(p); msg('<span class="ok">Applied.</span>'); } else msg("That doesn't look like a style code. It should start with CAPP1 and include a layout from L1 to L7."); }
      else if (act === "reset") setRendition(CA.ui.r);
    });
    lab.addEventListener("input", (e) => {
      const k = e.target.dataset && e.target.dataset.slider; if (!k) return;
      const out = $("#out-" + k); if (out) out.textContent = e.target.value;
      set({ [k]: +e.target.value }, { light: true });
    });
    lab.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "labImport") { e.preventDefault(); lab.querySelector('[data-labact="import"]').click(); } });
    document.querySelector(".bezel-bar").addEventListener("click", (e) => {
      const b = e.target.closest("[data-hw]"); if (!b) return;
      const h = b.dataset.hw; CA.sound.click();
      if (h === "menu") (open ? closeLab : openLab)(); else if (h === "prev") cycle(-1); else if (h === "next") cycle(1); else if (h === "power") CA.app.power(); else if (h === "degauss") CA.fx.degauss();
    });
  }

  CA.lab = {
    open: openLab, close: closeLab, toggle: () => (open ? closeLab() : openLab()), set, setRendition, cycle, code, parseCode,
    renditions: () => RENDITIONS.map((r) => ({ key: r.key, id: r.id, name: r.name })),
    modelLabel: () => { const u = CA.ui, r = rByKey(u.r); return `${r.id} ${r.name.toUpperCase()} · ${u.pal} ${u.btn.toUpperCase()} ${u.frm.toUpperCase()} ${u.guide.toUpperCase()}`; },
  };

  // boot order: settings → app → lab bindings
  apply(true);
  CA.app.init();
  bindLab();
  window.addEventListener("hashchange", () => { const k = location.hash.slice(1); if (k !== CA.ui.r && RENDITIONS.some((r) => r.key === k)) setRendition(k); });
})();
