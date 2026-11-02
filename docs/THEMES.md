# Pocket themes (shared format, v1)

One small JSON file that Collegiapp and PocketCanvas both import and export, so a theme made for one works in both. It sets colours and picks one of two looks; it doesn't move regions around (Collegiapp's bigger theme pack, [THEME_FORMAT.md](THEME_FORMAT.md), still does that).

```json
{
  "pocketTheme": 1,
  "id": "matcha",
  "name": "Matcha",
  "by": "Dobson",
  "note": "Pale green plastic and a dark LCD",
  "look": "pocket",
  "scheme": "light",
  "tokens": {
    "bg": "#e4ead8", "bg2": "#fafcf6", "surface": "#f3f6ec", "surface2": "#e7ecdd", "line": "#cbd4bc",
    "text": "#18200f", "text2": "#3d4733", "text3": "#5a6450",
    "chrome-bg": "#26301c", "chrome-fg": "#f3f6ec", "accent": "#5f8f3a", "on-accent": "#ffffff",
    "warn": "#8a5a00", "bad": "#b8321c", "on-bad": "#ffffff", "ok": "#2a7a3b", "acc2": "#2f6fde",
    "disp-bg": "#2b3a22", "disp-fg": "#d8f0b0", "disp-hot": "#5a4a14", "disp-bad": "#5a2418",
    "k1": "#2f6fde", "k2": "#e8503a", "k3": "#2e8b57", "k4": "#a23d9a", "k5": "#b7791f", "k6": "#5a6450"
  },
  "css": ""
}
```

- `pocketTheme`: always `1` for this version. Readers ignore fields they don't know.
- `id`: lower-case letters, digits and dashes. An import whose id is taken gets a `my-` prefix.
- `look`: `"pocket"`, the handheld (raised keys with a lip, graphite label bands, LCD inlays, pixel icons, Space Grotesk / Doto), or `"standard"`, a plain modern UI (flat surfaces, one hairline border, small radii, system fonts, plain tabular numbers, line icons, no gradients, glow, blur cards, colour side stripes or emoji icons).
- `scheme`: `"light"` or `"dark"`; sets `color-scheme` so native controls match.
- `css`: optional extra CSS, applied after the app's own. It may restyle anything but never loads anything: apps strip `@import` and every `url()` that isn't a `data:` URL. Each app scopes it where it applies it.
- Missing tokens come from the app's built-in theme of the same look and scheme; a file with none readable is refused.

## Tokens

All `#rrggbb` (3-digit `#rgb` is accepted on import).

| token | what it paints |
|---|---|
| `bg` | the page or desk behind the cards |
| `bg2` | recessed fields and inputs |
| `surface` | card fill |
| `surface2` | key faces, wells, idle pills |
| `line` | hairlines and borders |
| `text`, `text2`, `text3` | titles; body text; meta and placeholders |
| `chrome-bg`, `chrome-fg` | label bands and dark keys, and the text on them |
| `accent`, `on-accent` | the single most important action ("do this"), and the text on it |
| `warn` | due soon |
| `bad`, `on-bad` | overdue and destructive, and the text on it |
| `ok` | done |
| `acc2` | events and secondary marks |
| `disp-bg`, `disp-fg` | the LCD and its digits |
| `disp-hot`, `disp-bad` | the LCD backlight when due soon / overdue (`disp-fg` is drawn on both) |
| `k1` … `k6` | six course colours that read on `surface` |

## Contrast

Importers check these pairs (WCAG 2.x ratios) and offer to fix failures by moving the foreground toward black or white:

| foreground | background | at least |
|---|---|---|
| `text`, `text2`, `text3` | `surface` | 4.5 |
| `text3` | `bg`, `surface2` | 4.5 |
| `on-accent` | `accent` | 4.5 |
| `chrome-fg` | `chrome-bg` | 4.5 |
| `on-bad` | `bad` | 4.5 |
| `disp-fg` | `disp-bg`, `disp-hot`, `disp-bad` | 4.5 |
| `warn`, `bad`, `ok` | `surface` | 3 |

Every built-in theme passes all of them.

## Making one with a chatbot

Each app's theme browser has **Make one with a chatbot**: describe the theme, open Claude (or ChatGPT, or copy the prompt into any chatbot), paste the reply back, and the importer reads the JSON out of it (prose and code fences around it are fine), checks the contrast and saves it. The prompt lists the tokens above and the contrast rules. PocketCanvas's is `PC.themes.prompt()` in `pocketcanvas/src/lib/themes.js`.

## How each app maps the tokens

**Collegiapp** derives its palette tokens (THEME_FORMAT.md's token reference) from these: `desk-c`, `bg` ← `bg`; `bg2` ← `bg2`; `panel-bg`, `p-surface` ← `surface`; `p-surface2` ← `surface2`; `p-line` ← `line`; `p-text`, `hi` ← `text`; `p-text2`, `fg` ← `text2`; `p-text3`, `dim` ← `text3`; `acc`, `p-acc`, `sel-bg`, `hot`, `p-island` ← `accent`; `p-on-acc`, `sel-fg` ← `on-accent`; `chrome-bg`, `chrome-fg`, `warn`, `bad`, `on-bad`, `ok`, `acc2`, `k1`–`k6` as named; `p-disp-bg`, `p-disp-fg`, `p-disp-hot`, `p-disp-bad` ← the `disp-*` tokens; `p-disp-on` ← `disp-fg` (the digits on the hot and bad backlights); `t-r` ← `bad`, `t-g` ← `ok`, `t-y` ← `warn`, `t-b` ← `acc2`, `t-c` ← `k3`, `t-m` ← `k4`; `glow-rgb` ← `accent` as `r, g, b`; `p-disp-rgb` ← `0, 0, 0` (light) or `disp-fg` (dark); `hover-bg` and `shadow` from the scheme. `look: "pocket"` is Collegiapp's rendition `L6` (Pocket) and `look: "standard"` is `L8` (Standard); the built-ins are its palettes P9, P11 and P12–P17 (`ui/js/themes.js`), and an imported theme's style-code palette is `P:<id>`. Exporting the current look writes this format.

**PocketCanvas** writes every token as `--pc-<token>` and the look and scheme as `html[data-pc-look]` / `html[data-pc-scheme]`.
