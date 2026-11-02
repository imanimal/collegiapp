/* Collegiapp — themes: the built-in palettes, each look's type, and the shared Pocket theme format (docs/THEMES.md)
   that Collegiapp and PocketCanvas both import and export, so a theme made for one works in both:
     { "pocketTheme": 1, "id", "name", "by", "note", "look": "pocket" | "standard", "scheme": "light" | "dark",
       "tokens": { bg … k6 }, "css": "optional extra CSS" }
   `look` picks the rendition: "pocket" is L6 (the handheld), "standard" is L8 (the plain look, standard.css).
   palette() turns a theme's 27 tokens into the full Collegiapp palette lab.js writes on :root (THEMES.md's mapping);
   P9 Cream and P11 Night keep the palettes they were tuned with, so Pocket looks exactly as it always has.
   Palette IDs are permanent and new ones take the next number. normalize, checks, fix and prompt are ported from
   pocketcanvas/src/lib/themes.js: keep them in step. Loaded by index.html (… → app → themes → lab) and the UI kit. */
(function () {
  const CA = (window.CA = window.CA || {});

  const KEYS = ["bg", "bg2", "surface", "surface2", "line", "text", "text2", "text3", "chrome-bg", "chrome-fg", "accent", "on-accent",
    "warn", "bad", "on-bad", "ok", "acc2", "disp-bg", "disp-fg", "disp-hot", "disp-bad", "k1", "k2", "k3", "k4", "k5", "k6"];

  // P9 and P11, written out in full (docs/UIKit/README.md § 2). Their `fg`, `dim`, `hi`, `p-island` and `t-c` predate the
  // shared format and differ a little from what palette() would derive, so they stay as they are.
  const P9 = { scheme: "light",
    "desk-c": "#e6e2d8", "panel-bg": "#f6f3ec", bg: "#e6e2d8", bg2: "#fbf9f4", fg: "#2a2722", dim: "#6f695e", hi: "#151310", acc: "#ff5b1f", acc2: "#2f6fde", warn: "#9a5b00", bad: "#c8341b", ok: "#2e7d32",
    "sel-bg": "#ff5b1f", "sel-fg": "#1b1915", "chrome-bg": "#2a2722", "chrome-fg": "#f6f3ec", hot: "#ff5b1f",
    k1: "#2f6fde", k2: "#ff5b1f", k3: "#2e8b57", k4: "#b03aa8", k5: "#c27a00", k6: "#5b5548", "t-r": "#c8341b", "t-g": "#2e7d32", "t-y": "#9a5b00", "t-b": "#2f6fde", "t-c": "#00838f", "t-m": "#b03aa8",
    "p-surface": "#f6f3ec", "p-surface2": "#ebe7dd", "p-line": "#d3ccbd", "p-text": "#1b1915", "p-text2": "#4a453c", "p-text3": "#6a645a", "p-acc": "#ff5b1f", "p-on-acc": "#1b1915",
    "p-disp-bg": "#b1bd93", "p-disp-fg": "#1f2a17", "p-disp-rgb": "0, 0, 0", "p-disp-hot": "#e9b45a", "p-disp-bad": "#ee8f6e", "p-island": "#ff7a3d",
    "glow-rgb": "255, 91, 31", "hover-bg": "rgba(0,0,0,.04)", shadow: "rgba(60,50,30,.25)" };
  // the same device in graphite, with an Indiglo-style backlit LCD
  const P11 = { scheme: "dark",
    "desk-c": "#141311", "panel-bg": "#22211e", bg: "#1a1917", bg2: "#2a2926", fg: "#e9e3d6", dim: "#a39c8d", hi: "#fbf8f1", acc: "#ff6a2b", acc2: "#7aa5ff", warn: "#f0b54a", bad: "#ff7a5c", ok: "#62c470",
    // chrome stays dark plastic at night: label bands, LCD bezels and dark keys sit darker than the body, never cream
    "sel-bg": "#ff6a2b", "sel-fg": "#1b1915", "chrome-bg": "#0f0e0d", "chrome-fg": "#ece6da", hot: "#ff6a2b",
    k1: "#7aa5ff", k2: "#ff7a3d", k3: "#4fbf86", k4: "#d77bd0", k5: "#e3a640", k6: "#a39c8d", "t-r": "#ff7a5c", "t-g": "#62c470", "t-y": "#f0b54a", "t-b": "#7aa5ff", "t-c": "#4fc3c9", "t-m": "#d77bd0",
    "p-surface": "#262522", "p-surface2": "#302e2a", "p-line": "#3f3c36", "p-text": "#f4efe5", "p-text2": "#d0c9ba", "p-text3": "#a39c8d", "p-acc": "#ff6a2b", "p-on-acc": "#1b1915",
    "p-disp-bg": "#45b3a1", "p-disp-fg": "#04211c", "p-disp-rgb": "0, 0, 0", "p-disp-hot": "#e2b04f", "p-disp-bad": "#ef8b6c", "p-island": "#ff7a3d",
    "glow-rgb": "255, 106, 43", "hover-bg": "rgba(255,255,255,.05)", shadow: "rgba(0,0,0,.45)" };

  const T = (pid, look, scheme, id, name, note, tk, pal) => ({ pid, pocketTheme: 1, id, name, note, by: "Collegiapp", look, scheme, builtin: true,
    tokens: Object.fromEntries(KEYS.map((k, i) => [k, tk[i]])), css: "", pal });
  // The shared ids and token values are PocketCanvas's BUILTIN, so a theme reads the same in every app
  const BUILTIN = [
    T("P9", "pocket", "light", "pocket-cream", "Cream", "Light handheld plastic, orange keys, reflective LCD", ["#e6e2d8", "#fbf9f4", "#f6f3ec", "#ebe7dd", "#d3ccbd", "#1b1915", "#4a453c", "#6a645a", "#2a2722", "#f6f3ec", "#ff5b1f", "#1b1915",
      "#9a5b00", "#c8341b", "#ffffff", "#2e7d32", "#2f6fde", "#b1bd93", "#1f2a17", "#e9b45a", "#ee8f6e", "#2f6fde", "#ff5b1f", "#2e8b57", "#b03aa8", "#c27a00", "#5b5548"], P9),
    T("P11", "pocket", "dark", "pocket-night", "Night", "Graphite plastic, orange keys, a backlit LCD for late study", ["#1a1917", "#2a2926", "#262522", "#302e2a", "#3f3c36", "#f4efe5", "#d0c9ba", "#a39c8d", "#0f0e0d", "#ece6da", "#ff6a2b", "#1b1915",
      "#f0b54a", "#ff7a5c", "#1b1915", "#62c470", "#7aa5ff", "#45b3a1", "#04211c", "#e2b04f", "#ef8b6c", "#7aa5ff", "#ff7a3d", "#4fbf86", "#d77bd0", "#e3a640", "#a39c8d"], P11),
    T("P12", "pocket", "light", "pocket-gaucho", "Gaucho", "UCSB navy bands and gold keys", ["#e3e7ec", "#fbfcfd", "#f5f7f9", "#e9edf1", "#ccd4dd", "#10202f", "#3a4a5a", "#56636f", "#003660", "#f5f7f9", "#febc11", "#10202f",
      "#8a5a00", "#c42b1c", "#ffffff", "#2a7a3b", "#1f6fb2", "#b1bd93", "#1f2a17", "#f2c75c", "#ee8f6e", "#1f6fb2", "#d9480f", "#2f8f4e", "#a23d9a", "#b7791f", "#56636f"]),
    T("P13", "pocket", "light", "pocket-pistachio", "Pistachio", "Pale green plastic with a red-orange key", ["#dfe6dc", "#f9fbf8", "#f2f6f0", "#e4ebe1", "#c7d2c3", "#172016", "#3d4a3b", "#5a6657", "#243024", "#f2f6f0", "#e8503a", "#170c09",
      "#8a5a00", "#b8321c", "#ffffff", "#2a7a3b", "#2f6fde", "#a9c0a0", "#162414", "#e9b45a", "#ee8f6e", "#2f6fde", "#e8503a", "#2e8b57", "#a23d9a", "#b7791f", "#5a6657"]),
    T("P14", "pocket", "dark", "pocket-ink", "Ink", "Blue-black plastic with a blue backlight", ["#141922", "#222a37", "#1c2330", "#252e3d", "#343f52", "#eef2f8", "#c8d0dc", "#98a3b4", "#0b0f16", "#e6ebf2", "#ff7a3d", "#1b1915",
      "#f0b54a", "#ff7a5c", "#1b1915", "#62c470", "#7aa5ff", "#6fb8e0", "#051824", "#e2b04f", "#ef8b6c", "#7aa5ff", "#ff8a4c", "#4fbf86", "#d77bd0", "#e3a640", "#98a3b4"]),
    T("P15", "standard", "light", "standard-light", "Standard", "Plain and bright: white cards, grey hairlines, one blue accent", ["#f4f4f2", "#ffffff", "#ffffff", "#f1f1ef", "#dededa", "#1c1c1b", "#444441", "#686864", "#1c1c1b", "#fafaf9", "#2b59c3", "#ffffff",
      "#8a5a00", "#c42b1c", "#ffffff", "#2a7a3b", "#0f7b8a", "#f1f1ef", "#1c1c1b", "#fbeccc", "#fbe0dc", "#2b59c3", "#d9480f", "#2f8f4e", "#a23d9a", "#b7791f", "#686864"]),
    T("P16", "standard", "dark", "standard-dark", "Standard dark", "The plain look on charcoal", ["#141516", "#1d1e20", "#1b1c1e", "#26272a", "#333539", "#ededec", "#c9c9c6", "#9a9a96", "#0c0c0d", "#ededec", "#7ea2ff", "#0f1420",
      "#e8b04a", "#ff7b6b", "#1a0d0b", "#6cc47f", "#5fc4d0", "#26272a", "#ededec", "#4a3a12", "#4d201b", "#7ea2ff", "#ff8a4c", "#5cc489", "#d58ad0", "#e3b04f", "#9a9a96"]),
    T("P17", "standard", "light", "standard-contrast", "Standard contrast", "Black on white with strong borders, for bright rooms", ["#ffffff", "#ffffff", "#ffffff", "#f0f0f0", "#767676", "#000000", "#1a1a1a", "#3d3d3d", "#000000", "#ffffff", "#0040c1", "#ffffff",
      "#6e4400", "#a8200f", "#ffffff", "#1d5c2b", "#00606b", "#f0f0f0", "#000000", "#ffe08a", "#ffc4ba", "#0040c1", "#b33900", "#1d6b36", "#8a2b83", "#7a5200", "#3d3d3d"]),
  ];
  // Gold is a fill colour (1.6:1 on Gaucho's cards), so the places that set the accent as text take a dark gold (5:1)
  BUILTIN.find((t) => t.id === "pocket-gaucho").css = ".doing-tag { color: #8a6400; }";
  // Each look's type. Pocket: T6 with fallbacks that look right on each OS before (or without) the web fonts. Standard:
  // the system's own UI font for everything, numbers included (tabular figures, no LCD face); L8 brings its own keys,
  // headers and type, so B8 F3 T6 in its style code only say what Pocket would use.
  const SYS = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const TYPES = {
    pocket: { id: "T6", name: "Space Grotesk + Doto",
      body: '"Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
      mono: '"Space Mono", ui-monospace, "SF Mono", Menlo, "Cascadia Mono", Consolas, monospace',
      num: '"Doto", ui-monospace, "SF Mono", Menlo, "Cascadia Mono", Consolas, monospace', scale: 0.95, ns: 0.74 },
    standard: { id: "system", name: "System UI", body: SYS, mono: SYS, num: SYS, scale: 1, ns: 0.8 },
  };
  // the dark theme each look falls back to at night, and the light one it returns to
  const NIGHT = { pocket: "P11", standard: "P16" }, DAY = { pocket: "P9", standard: "P15" };
  const byId = (id) => BUILTIN.find((t) => t.id === id);
  /** A theme by its key: a built-in's palette ID (P9 …) or an imported theme's id, looked up in `mine`. */
  const find = (key, mine) => BUILTIN.find((t) => t.pid === key) || (mine || []).find((t) => t.id === key) || null;
  const keyOf = (t) => t.pid || t.id;

  // ── colour maths (WCAG 2.x) ──
  const hex = (s) => { s = String(s || "").trim().toLowerCase(); if (/^#[0-9a-f]{3}$/.test(s)) s = "#" + s.slice(1).replace(/./g, "$&$&"); return /^#[0-9a-f]{6}$/.test(s) ? s : null; };
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mix = (a, b, t) => "#" + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, "0")).join("");

  // [foreground, background, minimum]
  const PAIRS = [["text", "surface", 4.5], ["text2", "surface", 4.5], ["text3", "surface", 4.5], ["text3", "bg", 4.5], ["text3", "surface2", 4.5],
    ["on-accent", "accent", 4.5], ["chrome-fg", "chrome-bg", 4.5], ["on-bad", "bad", 4.5], ["disp-fg", "disp-bg", 4.5], ["disp-fg", "disp-hot", 4.5], ["disp-fg", "disp-bad", 4.5],
    ["warn", "surface", 3], ["bad", "surface", 3], ["ok", "surface", 3]];

  /** The pairs that fall short: [{ f, b, min, r }]. */
  function checks(tk) {
    return PAIRS.map(([f, b, min]) => ({ f, b, min, r: contrast(tk[f], tk[b]) })).filter((c) => c.r < c.min);
  }
  /** Repair failing pairs by moving the foreground toward black or white, whichever the background needs. */
  function fix(theme) {
    const tk = Object.assign({}, theme.tokens);
    for (let pass = 0; pass < 3; pass++) for (const c of checks(tk)) {
      const toward = lum(tk[c.b]) > 0.18 ? "#000000" : "#ffffff";
      let t = 0; while (t < 1 && contrast(tk[c.f], tk[c.b]) < c.min) { t += 0.05; tk[c.f] = mix(theme.tokens[c.f] || tk[c.f], toward, Math.min(1, t)); }
    }
    return Object.assign({}, theme, { tokens: tk });
  }

  const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  // Theme CSS may restyle anything, but never loads anything: no @import, no url() other than data: URLs
  const safeCss = (css) => String(css || "").slice(0, 60000).replace(/@import[^;]*;?/gi, "").replace(/url\(\s*(['"]?)(?!data:)[^)]*\)/gi, "none");

  /**
   * Read a theme from anything: an object, JSON text, or a chatbot reply with prose and code fences around the JSON.
   * Accepts Collegiapp v1 theme packs too (palette.tokens with p-* names). Returns { theme, warnings, lowContrast } or { error }.
   */
  function normalize(input) {
    let o = input;
    if (typeof o === "string") {
      const s = o.indexOf("{"), e = o.lastIndexOf("}");
      if (s < 0 || e < s) return { error: "No JSON object found. Paste the whole reply, or a theme file." };
      try { o = JSON.parse(o.slice(s, e + 1)); } catch (err) { return { error: "That JSON doesn't parse: " + err.message }; }
    }
    if (!o || typeof o !== "object") return { error: "That isn't a theme." };
    let src = o.tokens || (o.palette && o.palette.tokens) || o.colors || {};
    // Collegiapp v1 names → shared names
    const V1 = { "p-surface": "surface", "p-surface2": "surface2", "p-line": "line", "p-text": "text", "p-text2": "text2", "p-text3": "text3", "p-acc": "accent", "p-on-acc": "on-accent",
      "p-disp-bg": "disp-bg", "p-disp-fg": "disp-fg", "p-disp-hot": "disp-hot", "p-disp-bad": "disp-bad" };
    src = Object.fromEntries(Object.entries(src).map(([k, v]) => [V1[k] || String(k).replace(/^--(pc-)?/, ""), v]));
    const look = o.look === "standard" || o.layout === "standard" ? "standard" : "pocket"; // a v1 pack names its look in `layout`
    const bgGuess = hex(src.bg) || hex(src.surface), sch = o.scheme || src.scheme;
    const scheme = sch === "dark" || sch === "light" ? sch : bgGuess && lum(bgGuess) < 0.2 ? "dark" : "light";
    const base = BUILTIN.find((t) => t.look === look && t.scheme === scheme) || BUILTIN[0];
    const warnings = [];
    const tokens = {};
    let missing = 0;
    for (const k of KEYS) { const v = hex(src[k]); if (v) tokens[k] = v; else { tokens[k] = base.tokens[k]; missing++; } }
    if (missing === KEYS.length) return { error: "None of the colours were readable. Tokens are hex colours like #1b1915." };
    if (missing) warnings.push(`${missing} colour${missing > 1 ? "s" : ""} missing, taken from ${base.name}.`);
    const name = String(o.name || "My theme").slice(0, 48);
    const theme = { pocketTheme: 1, id: slug(o.id || name) || "theme", name, by: String(o.by || o.author || "").slice(0, 48), note: String(o.note || o.description || "").slice(0, 120),
      look, scheme, tokens, css: safeCss(o.css) };
    if (byId(theme.id)) theme.id = "my-" + theme.id;
    const bad = checks(tokens);
    if (bad.length) warnings.push("Low contrast: " + bad.map((c) => `${c.f} on ${c.b} ${c.r.toFixed(1)}:1 (needs ${c.min})`).join(", ") + ".");
    return { theme, warnings, lowContrast: bad.length > 0 };
  }

  /** The full Collegiapp palette for a theme (THEMES.md, "How each app maps the tokens"). */
  function palette(th) {
    if (th.pal) return th.pal;
    const t = th.tokens, dark = th.scheme === "dark", trio = (h) => rgb(h).join(", ");
    return { scheme: th.scheme,
      "desk-c": t.bg, bg: t.bg, bg2: t.bg2, "panel-bg": t.surface, "p-surface": t.surface, "p-surface2": t.surface2, "p-line": t.line,
      "p-text": t.text, hi: t.text, "p-text2": t.text2, fg: t.text2, "p-text3": t.text3, dim: t.text3,
      acc: t.accent, "p-acc": t.accent, "sel-bg": t.accent, hot: t.accent, "p-island": t.accent, "p-on-acc": t["on-accent"], "sel-fg": t["on-accent"],
      "chrome-bg": t["chrome-bg"], "chrome-fg": t["chrome-fg"], warn: t.warn, bad: t.bad, "on-bad": t["on-bad"], ok: t.ok, acc2: t.acc2,
      k1: t.k1, k2: t.k2, k3: t.k3, k4: t.k4, k5: t.k5, k6: t.k6, "t-r": t.bad, "t-g": t.ok, "t-y": t.warn, "t-b": t.acc2, "t-c": t.k3, "t-m": t.k4,
      // p-disp-on: the digits on a due-soon or overdue backlight (P9 and P11 leave it to pocket.css's fixed dark inks)
      "p-disp-bg": t["disp-bg"], "p-disp-fg": t["disp-fg"], "p-disp-hot": t["disp-hot"], "p-disp-bad": t["disp-bad"], "p-disp-on": t["disp-fg"],
      "p-disp-rgb": dark ? trio(t["disp-fg"]) : "0, 0, 0", "glow-rgb": trio(t.accent),
      "hover-bg": dark ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.04)", shadow: dark ? "rgba(0,0,0,.45)" : "rgba(0,0,0,.2)" };
  }
  /** The theme as a shared-format file. */
  const file = (th) => ({ pocketTheme: 1, id: th.id, name: th.name, by: th.by || "", note: th.note || "", look: th.look, scheme: th.scheme, tokens: th.tokens, css: th.css || "" });

  /** The prompt for a chatbot. `idea` is the user's description. */
  function prompt(idea) {
    return `Make a colour theme for my Pocket apps (Collegiapp, PocketCanvas). Reply with only one JSON object, no other text.

My idea: ${idea || "surprise me, something calm I can study with for hours"}

Format:
{"pocketTheme":1,"name":"…","look":"pocket","scheme":"light","tokens":{"bg":"#…", …}}

"look" is "pocket" (a handheld device: raised keys, dark label bands, small LCD screens) or "standard" (a plain modern UI: flat surfaces and thin borders). "scheme" is "light" or "dark".

Tokens, all hex #rrggbb:
- bg: page body behind the cards; bg2: recessed fields and inputs
- surface: card fill; surface2: key faces, wells, idle pills; line: hairlines and borders
- text: titles; text2: body text; text3: meta and placeholders
- chrome-bg, chrome-fg: label bands and dark keys, and the text on them
- accent, on-accent: the single most important action and the text on it (it means "do this", so not decoration)
- warn: due soon; bad, on-bad: overdue and the text on it; ok: done
- acc2: events and secondary marks
- disp-bg, disp-fg: the LCD screen and its digits; disp-hot, disp-bad: the LCD backlight when due soon or overdue (disp-fg is drawn on both)
- k1 k2 k3 k4 k5 k6: six clearly different course colours that read on surface

Rules: text, text2 and text3 reach 4.5:1 contrast on surface and on bg. on-accent on accent, chrome-fg on chrome-bg, on-bad on bad, and disp-fg on disp-bg, disp-hot and disp-bad all reach 4.5:1. warn, bad and ok reach 3:1 on surface. No gradients and no neon; pick colours that fit the idea.`;
  }
  /** A chatbot link that opens with the prompt filled in. Any other chatbot works with Copy the prompt. */
  const BOTS = { claude: (p) => "https://claude.ai/new?q=" + encodeURIComponent(p), chatgpt: (p) => "https://chatgpt.com/?q=" + encodeURIComponent(p) };

  CA.themes = { KEYS, BUILTIN, TYPES, NIGHT, DAY, find, keyOf, all: (mine) => BUILTIN.concat(mine || []), palette, file, normalize, checks, fix, prompt, BOTS, contrast, hex, safeCss };
})();
