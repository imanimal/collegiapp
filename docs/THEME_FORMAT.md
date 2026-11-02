# Theme pack format (v1)

A theme can replace **everything visual**: colours, fonts, component styles, region layout, motion and sounds. Themes live in `themes/<id>/` (bundled) or `%APPDATA%\io.github.imanimal.collegiapp\themes\<id>\` / `~/Library/Application Support/io.github.imanimal.collegiapp/themes/<id>/` (user). The Design Lab's **Export theme pack** writes a valid `theme.json` for the current look. (The live app now ships two looks, Pocket (L6) and Standard (L8), in the built-in themes P9, P11 and P12–P17; the Lab with every other rendition is in `archive/looks-2026-10/`. The format below still describes all of them.)

**For colours alone, use the shared Pocket theme format in [THEMES.md](THEMES.md)**: one small JSON file that Collegiapp and PocketCanvas both import and export, and the one the Appearance drawer's theme browser reads and writes. It also reads v1 packs (their `palette.tokens` and `layout`), but this bigger format is only needed for fonts, layouts, motion and sounds.

```
themes/crt-teletext-gaucho/
  theme.json        required: metadata, tokens, component variants, layout, effects, motion, sounds
  theme.css         optional: any extra CSS, scoped under .screen[data-theme="<id>"]
  fonts/            optional: woff2 files referenced from theme.css
  sounds/           optional: .ogg/.wav overriding synthesized sounds
```

## `theme.json`

```jsonc
{
  "format": 1,
  "id": "crt-teletext-gaucho",
  "name": "Teletext · Gaucho",
  "extends": "crt-teletext",          // inherit everything not listed
  "styleCode": "CAPP1 L2 P7 B6 F3 T4 G4 M2 D2 C1 s45 g40 f10 n10 a35 v45 mS bG S0",

  "layout": "teletext",               // signal | pocket | ledger | phosphor | teletext | mainframe | vector | <custom>
  "family": "crt",                    // "modern" (retro-modern: clean UI, retro only in displays) | "crt" (full-screen CRT)
  "palette": {
    "id": "P7",
    "tokens": {                        // every token is a CSS custom property (--name)
      "bg": "#001a33", "bg2": "#00284d", "panel-bg": "#001a33", "desk-c": "#001426",
      "fg": "#fbe7b5", "dim": "#7590ad", "hi": "#febc11",
      "acc": "#febc11", "acc2": "#4fc3d6", "warn": "#febc11", "bad": "#ef5645", "ok": "#2bb8a8",
      "sel-bg": "#febc11", "sel-fg": "#001426", "chrome-bg": "#febc11", "chrome-fg": "#001426",
      "hover-bg": "rgba(254,200,80,.09)", "hot": "#003660", "shadow": "rgba(0,0,0,.8)",
      "glow-rgb": "254, 200, 80",
      "k1": "#febc11", "k2": "#4fc3d6", "k3": "#ef5645", "k4": "#2bb8a8", "k5": "#dce1e5", "k6": "#f7d774",
      "t-r": "#ef5645", "t-g": "#2bb8a8", "t-y": "#febc11", "t-b": "#5f9be0", "t-c": "#4fc3d6", "t-m": "#dce1e5"
    }
  },
  "typography": { "body": "\"VT323\", monospace", "display": "\"Press Start 2P\", monospace", "mono": "\"VT323\", monospace",
                  "numerals": "\"Press Start 2P\", monospace", "scale": 1.3, "displayScale": 0.5, "numeralScale": 1 },
  "components": { "button": "block", "frame": "band" },   // or "custom" + rules in theme.css
  "guidance": "coach",                                      // keycaps | alt-tips | minimal | coach
  "density": "cozy",                                        // compact | cozy | roomy
  "motion": { "level": 2, "multiplier": 1 },
  "effects": {
    "crt": { "curvature": "tube", "scanlines": 0.45, "glow": 0.4, "flicker": 0.1, "noise": 0.1,
             "aberration": 0.35, "vignette": 0.45, "mask": "shadow-mask" },
    "bezel": "graphite"
  },
  "sounds": { "level": 0 }
}
```

## Token reference

| token | used for |
|---|---|
| `bg`, `bg2`, `panel-bg`, `desk-c` | screen background, raised surfaces, panel fill, area outside panels |
| `fg`, `dim`, `hi` | body text, secondary text and rules, emphasis (titles, countdowns) |
| `acc`, `acc2` | primary accent, secondary accent (focus/doing) |
| `warn`, `bad`, `ok` | due soon, overdue/destructive, done |
| `sel-bg`, `sel-fg`, `hover-bg` | selected row, its text, hover wash |
| `chrome-bg`, `chrome-fg` | menu bars, headers, primary buttons |
| `glow-rgb` | phosphor glow colour as `r, g, b` (used inside `rgba()`) |
| `k1`–`k6` | course colours (a course's `color` picks one) |
| `t-r t-g t-y t-b t-c t-m` | the six teletext/Fastext colours, used by `data-tone` buttons |
| `font-body`, `font-display`, `font-scale`, `display-scale`, `fs-base`, `pad`, `gap`, `rowpad`, `m` | typography, spacing and the motion multiplier (`--m`, 0 = no animation) |
| `p-surface`, `p-surface2`, `p-line` | retro-modern: card and raised surfaces, hairlines (derived from `bg`/`fg` when absent) |
| `p-text`, `p-text2`, `p-text3` | retro-modern: primary, secondary and tertiary text |
| `p-acc`, `p-on-acc` | retro-modern: primary button fill and the text on it |
| `p-disp-bg`, `p-disp-fg`, `p-disp-rgb` | retro-modern: the display inlays (CRT glass, LCD, split-flap) and their glow colour |
| `p-disp-hot`, `p-disp-bad` | Pocket: the LCD backlight when something is due soon / overdue (the hero countdown and *leave by* chips) |
| `p-disp-on` | the digits on those backlights (default: fixed dark inks) |
| `on-bad` | text and icons on a `bad` fill |
| `p-island` | accent used by the desktop island and taskbar presence |
| `scheme` | `"light"` or `"dark"`; sets `color-scheme` so native controls match |

## Components and layouts

- **Built-in component variants** are classes on `.screen`: `bset-b1…b8` (buttons), `fset-f1…f8` (frames). Retro-modern bundled ids are prefixed `rm-` (e.g. `rm-signal`), classic ones `crt-`. A theme can set `"button": "custom"` and style `.screen[data-theme=id] .btn` itself.
- **Layouts** are CSS grid templates over fixed regions: `#top #nav #now #sched #list #insp #ticker #bottom`. A custom layout is just a `theme.css` block:

```css
.screen[data-theme="my-theme"] .content {
  grid-template: "top top" auto "now list" minmax(0, 1fr) "bottom bottom" auto / 22em minmax(0, 1fr);
}
.screen[data-theme="my-theme"] #nav, .screen[data-theme="my-theme"] #sched { display: none; }
```

- **Animations** use `calc(var(--m) * <duration>)`, so the motion slider and `prefers-reduced-motion` keep working. Row entrance is `--row-in` (e.g. `typeIn`, `beamIn`, `zoomIn`, or your own `@keyframes`).

## Rules

1. A theme only changes presentation. It cannot run scripts (JS hooks may come later behind an explicit permission).
2. Every effect layer must keep `pointer-events: none`.
3. Body text must keep ≥ 4.5:1 contrast against `bg`; the loader warns if it doesn't.
4. Unknown keys are ignored, so older apps can load newer themes.
