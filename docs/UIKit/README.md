# Pocket UI kit

The parts Collegiapp is built from, the rules for using them, and where each one lives in the code. Pocket (L6) is the final design (`CAPP1 L6 P9 B8 F3 T6 G2 M2 D3 C2 s4 g0 f0 n0 a0 v0 mN bN S1`), in **P9 Cream** (light) and **P11 Night** (dark). **Standard** (L8, section 13) is the same app with the handheld taken out: a plain modern UI on the same regions and layouts. Eight built-in themes (P9, P11–P17) each pick one of the two looks, and the theme browser imports more (section 6, *Theme browser*).

- **This file** is the reference: tokens, type, icons, components, layouts, motion, writing, and a checklist for new parts.
- **[`index.html`](index.html)** is the live sheet. It loads the real `ui/css/pocket.css` and draws the real pixel icons from `ui/js/app.js`, so it always shows what ships. Open the file in a browser (no server needed), or serve the repository root (`python -m http.server 4798 --bind 127.0.0.1`) and go to http://127.0.0.1:4798/docs/UIKit/. It has a theme switch (every built-in theme, so both looks) and a key-legend switch, and the responsive specimens have a drag handle at their bottom-right corner so you can watch them fold.

The code is the source of truth. If this kit and `pocket.css` disagree, `pocket.css` is right and this file needs updating.

## 1. Principles

| rule | what it means in practice |
|---|---|
| **Readability first** | Body text is Space Grotesk in sentence case on a solid surface. Nothing is drawn over it: no glow, scanlines, gradients or textures. |
| **Retro is contained** | The handheld character lives in four places only: LCD inlays (`.display`), B8 keys, F3 label bands and 9×9 pixel icons. Standard (L8) leaves all four out. |
| **One obvious next step** | Each region has at most one orange (`.primary`) key. Everything else is a plain key, a dark key or a ghost. |
| **Say why** | Rankings and states explain themselves: reasons as chips, due states as words ("in 3h", "2h overdue"), never colour alone. |
| **Undo, don't confirm** | Destructive actions run at once and toast with Undo. The only deliberate friction is the Lockdown exit phrase and answering a takeover. |
| **Few clicks** | Every central action is a key on screen and a keyboard key (Q, F, X, S, N, 1–0, Ctrl+K, Esc). |
| **Follow the room** | Layouts follow the screen container and components follow their region (container queries), not the window. |

## 2. Colour

Palettes are defined once, in `ui/js/themes.js`: P9 and P11 written out in full, the others derived from a theme's 27 shared tokens by `palette()` (the mapping in [`docs/THEMES.md`](../THEMES.md)). `ui/js/lab.js` writes every value as a custom property on `:root` and sets `data-scheme="light|dark"` and `data-look="pocket|standard"`. `ui/css/pocket.css` derives the short names components use (`--surface`, `--text`, `--accent` …) from the palette's `p-*` values.

**Use the Pocket names below in components.** The older theme-format tokens (`--fg`, `--dim`, `--hi`, `--acc`, `--sel-*`, `--hot`, `--hover-bg`, `--shadow`, `--t-*`, `--glow-rgb`) stay in the palettes for theme packs (`docs/THEME_FORMAT.md`) and the CRT layer; new Pocket parts don't read them.

### Surfaces and text

| token | used for | P9 Cream | P11 Night |
|---|---|---|---|
| `--bg` | the device body behind modules (with the 16 px dot grid) | `#e6e2d8` | `#1a1917` |
| `--bg2` | recessed things: inputs, filter box, location banner, quick-add field | `#fbf9f4` | `#2a2926` |
| `--surface` | module and card fill | `#f6f3ec` | `#262522` |
| `--surface-2` | key faces, wells, idle pills, week columns | `#ebe7dd` | `#302e2a` |
| `--line` | hairlines, key rings and lips, dividers | `#d3ccbd` | `#3f3c36` |
| `--text` | titles and anything you must read first | `#1b1915` | `#f4efe5` |
| `--text-2` | body text, key labels on plain keys | `#4a453c` | `#d0c9ba` |
| `--text-3` | meta, placeholders, idle icons | `#6a645a` | `#a39c8d` |
| `--chrome-bg` / `--chrome-fg` | label bands, dark keys, LCD bezels, the pressed program key | `#2a2722` / `#f6f3ec` | `#0f0e0d` / `#ece6da` |
| `--desk-c` | the page outside the screen; the window's `theme-color` | `#e6e2d8` | `#141311` |

### Accent and states

| token | used for | P9 | P11 |
|---|---|---|---|
| `--accent` | the one primary key, the Do first band, selection, focus rings, icons on bands | `#ff5b1f` | `#ff6a2b` |
| `--on-accent` | text on accent | `#1b1915` | `#1b1915` |
| `--accent-soft` | 16 % accent wash: selected row, active chip, live strip, today's week column | derived | derived |
| `--warn` | due soon, priority marks | `#9a5b00` | `#f0b54a` |
| `--warn-ink` | "due soon" text on its own wash (`.duepill.soon`, the quick-add "auto" hint): `--warn` 75 % mixed with `--text` | derived | derived |
| `--bad` | overdue, destructive, alert band, takeover | `#c8341b` | `#ff7a5c` |
| `--on-bad` | text and glyphs on a `--bad` fill (alert band, the pressed close key) | `#fff` | `#1b1915` |
| `--ok` | done (swipe hint) | `#2e7d32` | `#62c470` |
| `--acc2` | events on the timeline, course tokens in the quick-add highlight | `#2f6fde` | `#7aa5ff` |

Orange means "this is the thing to do". Don't use it for decoration, links or a second action in the same region.

### LCD

| token | used for | P9 (reflective) | P11 (backlit) |
|---|---|---|---|
| `--disp-bg` / `--disp-fg` | every LCD inlay, the logo, today's week chip | `#b1bd93` / `#1f2a17` | `#45b3a1` / `#04211c` |
| `--disp-hot` | LCD backlight when something is due soon (`.display.hot`) | `#e9b45a` | `#e2b04f` |
| `--disp-bad` | LCD backlight when overdue or late (`.display.bad`, `.lb-leave.late`) | `#ee8f6e` | `#ef8b6c` |
| `--p-island` | island ring, countdown and presence accent | `#ff7a3d` | `#ff7a3d` |

### Course colours

A course's `color` (1–6) picks `--k1`…`--k6`. Components read it as `--kc`, which `kc(course)` in app.js sets inline (`style="--kc: var(--k2)"`): the dot in `.cchip` and `.chip.course`, the bar in agenda rows, the left edge of week items, course cards and location banners.

| | k1 | k2 | k3 | k4 | k5 | k6 |
|---|---|---|---|---|---|---|
| P9 | `#2f6fde` | `#ff5b1f` | `#2e8b57` | `#b03aa8` | `#c27a00` | `#5b5548` |
| P11 | `#7aa5ff` | `#ff7a3d` | `#4fbf86` | `#d77bd0` | `#e3a640` | `#a39c8d` |

Course colour is always a dot, bar or edge next to the course code, never the text colour of a title.

### Contrast

Body text must keep at least 4.5:1. Measured pairs (WCAG 2.x):

| pair | P9 | P11 |
|---|---|---|
| `--text` on `--surface` | 15.8 | 13.4 |
| `--text-2` on `--surface` | 8.6 | 9.3 |
| `--text-3` on `--surface` / `--surface-2` / `--bg` | 5.3 / 4.7 / 4.5 | 5.6 / 5.0 / 6.4 |
| `--on-accent` on `--accent` | 5.7 | 6.1 |
| `--chrome-fg` on `--chrome-bg` | 13.4 | 15.5 |
| `--disp-fg` on `--disp-bg` | 7.5 | 6.6 |
| LCD text on `hot` / `bad` backlight | 8.9 / 7.6 | 8.5 / 7.5 |
| `--warn` / `--bad` / `--ok` on `--surface` | 4.9 / 4.8 / 4.6 | 8.3 / 6.0 / 7.0 |
| `.duepill.hot` / `.over`: `--bg2` on `--warn` / `--bad` | 5.2 / 5.0 | 7.9 / 5.7 |
| `.duepill.soon`: `--warn-ink` on its 14 % wash, on a card / a selected row | 5.6 / 4.8 | 6.9 / 5.5 |
| `--on-bad` on `--bad` (alert band) | 5.3 | 6.9 |

Two traps these rules avoid. `--bg` is too dark to sit on Cream's `--warn` and `--bad` fills (about 4.1:1), so solid pills use `--bg2`. White on Night's coral `--bad` is 2.6:1, so anything drawn on a `--bad` fill uses `--on-bad`. Pocket Start's `.pill` repeats the due pill rules in px.

### Built-in themes

A theme is a palette plus a look. Cream and Night are Pocket's own; the rest share their token values and ids with PocketCanvas's built-ins, so a theme reads the same in every Pocket app. IDs are permanent.

| ID | theme | look | scheme | shared id | note |
|---|---|---|---|---|---|
| P9 | Cream | Pocket | light | `pocket-cream` | light handheld plastic, orange keys, reflective LCD |
| P11 | Night | Pocket | dark | `pocket-night` | graphite plastic, orange keys, a backlit LCD for late study |
| P12 | Gaucho | Pocket | light | `pocket-gaucho` | UCSB navy bands and gold keys |
| P13 | Pistachio | Pocket | light | `pocket-pistachio` | pale green plastic with a red-orange key |
| P14 | Ink | Pocket | dark | `pocket-ink` | blue-black plastic with a blue backlight |
| P15 | Standard | Standard | light | `standard-light` | plain and bright: white cards, grey hairlines, one blue accent |
| P16 | Standard dark | Standard | dark | `standard-dark` | the plain look on charcoal |
| P17 | Standard contrast | Standard | light | `standard-contrast` | black on white with strong borders, for bright rooms |

P12–P17 get their palette from `palette()`, which also sets `--on-bad` and `--p-disp-on` (the digits on a warning backlight: P9 and P11 keep pocket.css's fixed dark inks there, the others draw `disp-fg`, as the shared format says). Their pairs (WCAG 2.x):

| pair | P12 | P13 | P14 | P15 | P16 | P17 |
|---|---|---|---|---|---|---|
| `--text` / `--text-2` on `--surface` | 15.4 / 8.5 | 15.3 / 8.6 | 14.0 / 10.1 | 17.1 / 9.8 | 14.6 / 10.3 | 21.0 / 17.4 |
| `--text-3` on `--surface` / `--surface-2` / `--bg` | 5.7 / 5.2 / 5.0 | 5.5 / 5.0 / 4.7 | 6.2 / 5.4 / 6.9 | 5.6 / 4.9 / 5.1 | 6.0 / 5.3 / 6.5 | 10.9 / 9.5 / 10.9 |
| `--on-accent` on `--accent` | 9.8 | 5.2 | 6.8 | 6.3 | 7.4 | 8.4 |
| `--chrome-fg` on `--chrome-bg` | 11.5 | 12.6 | 16.0 | 16.3 | 16.7 | 21.0 |
| `--disp-fg` on `--disp-bg` / `hot` / `bad` | 7.5 / 9.3 / 6.3 | 8.3 / 8.6 / 6.8 | 8.3 / 9.1 / 7.4 | 15.1 / 14.6 / 13.6 | 12.7 / 9.4 / 11.7 | 18.4 / 16.3 / 13.9 |
| `--warn` / `--bad` / `--ok` on `--surface` | 5.5 / 5.3 / 5.0 | 5.4 / 5.5 / 4.9 | 8.6 / 6.1 / 7.2 | 5.9 / 5.7 / 5.3 | 8.7 / 6.7 / 8.0 | 8.4 / 7.3 / 8.0 |
| `--on-bad` on `--bad` | 5.7 | 6.0 | 6.8 | 5.7 | 7.5 | 7.3 |
| `.duepill.hot` / `.over`: `--bg2` on `--warn` / `--bad` | 5.8 / 5.5 | 5.7 / 5.7 | 7.8 / 5.6 | 5.9 / 5.7 | 8.5 / 6.6 | 8.4 / 7.3 |
| `.duepill.soon` on a card / a selected row | 6.0 / 5.6 | 5.9 / 4.9 | 7.2 / 5.6 | 6.4 / 5.1 | 7.4 / 5.7 | 9.1 / 7.0 |

One thing the shared tokens don't promise: `--accent` as text. Gaucho's gold on its surface is 1.6:1 (Cream's orange is 2.8:1), so accent stays a fill, an icon or a ring, never body text. Gaucho's own CSS gives the one place that does set it as text (`.doing-tag`) a dark gold, `#8a6400` (5:1).

### Elevation

| name | recipe | used on |
|---|---|---|
| card | `--card-shadow`: 1 px `--line` ring, 2 px lip, soft 10/24 px shadow | modules, Pocket Start cards |
| key | 1 px dark ring, 3 px lip below, 5/10 px shadow; pressed: `translateY(3px)` and no lip | `.btn` (B8) |
| program key | 1 px ring and 2 px lip; pressed 2 px | `.nv`, `.wk` |
| recessed | inset 1 px `--line` ring plus a 2 px inner top shadow | search, filter box, fields, LCDs (deeper), window-key slot |
| drop | `--drop`: 24/60 px shadow plus a ring | dialogs, toasts, floating inspector |
| scrim | `--scrim` with `backdrop-filter: blur(3px)` | behind dialogs |

Night uses darker lips (`#0b0a09`) and heavier shadows; `pocket.css` switches them under `:root[data-scheme="dark"]`.

## 3. Type

Three families, each with one job. `lab.js` sets them (T6, `TYPES.pocket` in themes.js) with OS fallbacks; Standard uses the system UI font for all three (section 13); `ui/fonts/fonts.css` holds local copies when vendored, and Google Fonts serves them otherwise.

| family | token | job |
|---|---|---|
| **Space Grotesk** 400–700 | `--font-ui` (`--font-body`) | everything you read: titles, body, key labels, chips |
| **Space Mono** 400/700 | `--font-mono` | key legends (`kbd`), counts in bands, LCD labels, room codes, filter chips, timeline scale, the focus log |
| **Doto** 600–900 | `--font-num` | LCD numerals only: countdowns, the clock, the logo "C", the island countdown |

Doto runs large, so its sizes are multiplied by `--num-scale` (0.74): write `font-size: calc(2.7em * var(--num-scale))`. Add `.num` (tabular figures) to any number that ticks.

### Size

Everything is in `em` of `--fs`, so text size, density and screen size scale together.

- `--fs0 = --fs-base × --font-scale (0.95) × --zoom`. Density sets `--fs-base`: D1 14 px, D2 16 px, **D3 18 px** (final). `--zoom` is the user's text size (90–150 %, Ctrl/⌘ + and −).
- `--fs` is fluid: `clamp(--fs0, --fs0 × .8 + .3vw, --fs0 × 1.18)`, so large monitors grow up to 18 %. Windows 780 px tall or less shrink it to 0.9×.
- Fixed px is allowed only for hairlines, shadows, key lips and icon pixel rounding.

### Ramp

| role | class | size · weight | notes |
|---|---|---|---|
| Do first title | `.hero-t` | 1.6 em · 700 | −0.015 em tracking, `text-wrap: balance`; 1.4 em in a narrow module, 1.3 em on phones |
| Focus task | `.fo-task` | 1.5 em · 700 | |
| Inspector title | `.f-title` | 1.35 em · 700 | editable in place |
| Up next title | `.nx-t` | 1.2 em · 700 | |
| View name | `.crumb .v` | 1.15 em · 700 | |
| Body | `.content` | 1 em · 400 | line-height 1.45, colour `--text-2` |
| Row title | `.m-t` | 0.98 em · 500 | one line with ellipsis; wraps on phones |
| Key label | `.btn` | 0.92 em · 600 | |
| Meta | `.meta-row`, `.m-meta` | 0.86 / 0.82 em | parts joined by `·` |
| Group header | `.grp` | 0.8 em · 600 | count in mono, rule to the right |
| Band label | `.ph .pt` | 0.78 em · 700 | CSS uppercase, 0.11 em tracking |
| LCD label | `.d-lbl` | 0.74 em · 700 mono | CSS uppercase, 0.08 em tracking |
| LCD number | `.d-num` | 2.7 em × 0.74 · 800 Doto | `.display.big`: 6.4 em × 0.74 |

Write strings in sentence case in the source. Uppercase comes only from CSS, and only in band labels, LCD labels, room codes, Alt key tips, the radial hub and the deck engraving. The focus log is the one place written in capitals on purpose: it is the device's terminal voice.

## 4. Spacing and shape

| density | `--fs-base` | `--pad` | `--gap` | `--rowpad` |
|---|---|---|---|---|
| D1 Compact | 14 px | .45 em | .5 em | .04 em |
| D2 Cozy | 16 px | .6 em | .7 em | .18 em |
| **D3 Roomy** (final) | 18 px | .8 em | .9 em | .32 em |

- Regions sit `--gap` apart (columns `--gap × 1.15`). Module bodies pad `.85em 1em 1em`. Rows pad `--rowpad + .24em` top and bottom.
- Very wide screens keep a 116 em measure, centred; the dot grid still fills the window.

| radius | value | used on |
|---|---|---|
| `--radius` | 14 px | modules, the deck |
| `--btn-r` | 10 px | keys |
| 9–10 px | | program keys, search, rows, filter box, live strip, location banner, course cards, toasts |
| 8 px | | inputs, segmented controls, focus log |
| 5–7 px | | LCDs, course chips, agenda rows, week items, counts |
| 99 px | | chips, due pills, reason chips, the focus pill, the timeline |

## 5. Icons

Every icon is a 9×9 bitmap in `PIX` in `ui/js/app.js`: nine rows joined by `|`, where `#` is a lit pixel and `.` is off. `ic(name, cls)` turns it into an SVG of crisp rectangles that fills with `currentColor`. The sheet draws all of them. In Standard, `ic()` draws the same name from `LINE` instead: a 24 px line icon (2 px round strokes, `.i.ln`, the set PocketCanvas uses), sized and coloured by the same rules; `ic(name, cls, "pocket")` forces the bitmap.

- **Size in whole 9 px steps.** `.i` is 1.1 em rounded to the nearest 9 px (18, 27, 36 px), so every icon pixel covers whole screen pixels. `.i.big` is 2.4 em (empty states). Location, agenda and fact icons are 1.25 em; window keys and checkmarks 0.9 em.
- **Colour comes from context.** `--accent` on label bands and on the pressed program key, `--text-3` on idle program keys and facts, inherited everywhere else.
- **Icons sit next to a word.** Icon-only buttons (window keys, close, checkboxes) carry `title` and `aria-label`; the SVG itself is `aria-hidden`.
- **View icons are keyed by view id:** `now today inbox work exams week classes events links all`. The rest: `done search plus focus play check clock next prev pin go ext lab help filter ticket flag flame building walk bell close video trash wmin wmax wrest sun moon draw pick erase line arrow box oval` (`sun` and `moon` mark the Day and Night theme slots; `draw` is the editor's Drawing key and `pick` to `oval` are the drawing layer's tools).

To add one, draw it on a 9×9 grid with 1 px strokes and no diagonals thinner than a pixel, add it to `PIX`, draw its line version on a 24 grid in `LINE`, and use `ic("name")`. Pocket Start (`start.js`) and the Windhawk assets (`build_assets.py`) draw from their own copies; add it there too if they need it.

## 6. Components

Every component is a class in `pocket.css`. Keys need `.bset-b8` and modules need `.fset-f3` on an ancestor; the app puts both on `#screen`. Markup below is trimmed to the classes that matter; app.js renders the real thing.

### Keys (B8)

```html
<button class="btn primary lg">{play}Start focus · 25 min<kbd>F</kbd></button>
<button class="btn">{check}Done<kbd>X</kbd></button>
<button class="btn dark">{focus}Focus 25<kbd>F</kbd></button>
<button class="btn ghost">Details</button>
```

| variant | use |
|---|---|
| `.btn` | any action: a raised plastic key that travels 3 px when pressed and springs back past the top when let go (`--press`, `.ack`); its keyboard key presses it too (`.down`) |
| `.primary` | the one main action of a region (orange) |
| `.dark` | a second strong action, set apart from the primary (Focus on the deck); its icon turns orange |
| `.ghost` | quiet actions (Details, Clear, Close) and keys inside a band |
| `.lg` / `.sm` | the hero action / keys in bands and dense rows |
| `[disabled]` | 45 % opacity, no press |

- Label is a verb, optionally with its object: "Add", "Snooze", "Start focus · 25 min", "Install and restart".
- The `kbd` legend shows only under guidance G1 (`#screen[data-guide="g1"]`). With G2, the final setting, holding Alt overlays a `.tip` on every element with `data-hint`.
- Focus ring: 2 px `--accent`, offset 2 px. Touch screens get a 44 px minimum height.

### Program keys

The view row (`.mnav` > `.nkeys` + `.nfoot`). Every view is a saved filter, so a program key is a filter, not a page.

```html
<button class="nv on" role="tab" aria-selected="true">{now}<span class="lb">Do first</span><span class="ct">5</span><kbd>1</kbd></button>
```

- `.on` is the pressed key: graphite with an orange icon and count; at night it gets an orange rim.
- `.ct` is a live count, used only on Do first, Today, Inbox and Exams.
- `.mod` appends "· filtered" when you've changed the view's query.
- The row is a horizontal strip (section 9): it scrolls sideways with the wheel or a drag, fades only at an edge with more past it, and a render brings the current key into view; on phones it sticks below the top bar.
- The order is yours (`CA.ui.tabs`, synced with the look) and the number keys follow it: the first key is 1, the tenth 0, the eleventh −. Hold a key and drag it (a mouse drags straight away where the row fits, after a quarter-second hold where it scrolls; touch long-presses), or Alt+Shift+← → (⌥⇧ on a Mac) moves the current view's key. While it moves the key is `.lift` (a step up with an accent rim; an inset accent ring in Standard) in a `.sorting` row, and the others slide aside. Esc puts it back; the palette has **Put the view keys back in order**.

### Sidebar and path bar

The places as folders (`docs/NAVIGATION.md`): `#side` > `.panel.sd` (an F3 module: the graphite band "Folders" with the side and hide keys, then `.sd-tree`, then `.sd-foot` with calendars, trash, appearance and help) and `.sd-grip` on its inner edge. `#nav` holds the `.pathbar` instead of the key row.

```html
<div class="sd-row on" role="treeitem" aria-level="3" aria-expanded="true" aria-selected="true" style="--lvl:1" data-act="sdGo" data-node="c:cs130a:work">
  <span class="sd-tw" data-act="sdFold" data-node="c:cs130a:work">{tw}</span>{work}<span class="sd-l">Assignments</span><span class="sd-n">2</span></div>
```

- `.sd-sec` is a section (Views, Classes, Notes, Tags): the module's printed label, uppercase in Pocket and sentence case in Standard; it only folds.
- `.sd-row.on` is the place you're in: graphite like a pressed program key, with an orange icon and count (an orange rim at night; a solid chrome row in Standard). Indent is `--lvl` × 1.05 em.
- `.sd-tw` turns its 9×9 triangle a quarter (`rotate`) when the folder is open. A class shows `.sd-dot` in its colour; a count is `.sd-n`; a file's due day is `.sd-d` (`.late` in `--bad`); a pinned note has `.sd-pin`; done items strike through.
- `.sd-sort` holds the Views rows; dragging one (a mouse straight away, touch with a long-press) makes it `.lift` in a `.sorting` group, like a program key.
- `.sd-grip` is a 12 px band in the gap beside the page (22 px on touch) with an accent line on hover, focus and drag; it's a focusable `role="separator"` (← → resize, Home, End, Enter hides).
- `#content[data-sd]`: `dock`, `over` (a drawer with `sideInL`/`sideInR` over `.sd-scrim`), `off` or `none` (the key row instead); `data-side` and `--side-w` place and size it.
- `.pathbar`: `.sd-show` (the Folders key, only while the sidebar isn't docked), then `.pb-path` of `.pb-b` steps (buttons), `.pb-sep` › and the `.pb-cur` place (`aria-current="page"`); then `.pb-f` "filtered" and Clear when chips or a search narrowed it.

### Window keys

`.winkeys` > `.wk` × 3 (`wmin`, `wmax`/`wrest`, `close`) in a recessed slot, at the end of the top bar on Windows and Linux. Close turns `--bad` when pressed. macOS keeps its traffic lights instead.

### Search, focus pill and top bar

- `.search`: a recessed field-shaped button that opens the palette: icon, placeholder text, `Ctrl K` legend. Below 50 em it collapses to its icon.
- `.fpill`: the running focus timer in the top bar, an accent-washed pill.
- `.cloudkey`: the sync key after search (`cloudKey()` in app.js), shown wherever the data is real (the app, the web app). `data-st` is its state:
  - `out`: signed out. An accent-tinted key labelled "Sign in" at every width; one click starts the sign-in and opens the Sync dialog.
  - `wait`: the browser sign-in is open. "Signing in", with the cloud blinking in steps.
  - `ok`, `busy`, `off`, `bad`: signed in. The cloud alone with a `.ck-dot`: `--ok`, the accent blinking in steps, `--text-3` offline, `--bad` on an error. The title says the account and the last sync, and a click opens the Sync dialog.

  It stays in the one-column layout, where the other top bar keys move to the deck.
- `.mtop`: brandmark (`.logo` LCD "C" + name), `.crumb` (date and quarter context), search, the sync key, Focus, Add, LCD clock, window keys. The clock hides below 64 em, key labels below 34 em (except "Sign in").

### Modules (F3)

A card with a printed label band. Every region is one.

```html
<div class="panel">
  <div class="ph"><span class="pt">{clock}Up next</span><span class="sp"></span><span class="cnt">Mon, Nov 2</span></div>
  <div class="pb">…</div>
</div>
```

- The band is graphite (`--chrome-bg`), with the pixel icon in orange and the count in mono on the right. Region modules end in a small engraved grille.
- **Do first is the only orange band** (`#now .ph`). Alerts get a red band (`.alertbox`).
- Keys inside a band are `.btn.ghost.sm` and take the band's colour.
- A module never scrolls sideways; `.pb` scrolls vertically and becomes plain flow on phones.

### LCD inlay

The device's display: a reflective panel with a dot-matrix texture, inset in a graphite bezel.

```html
<div class="display hot">
  <span class="d-lbl">Due in</span>
  <span class="d-num num">2:14:08</span>
  <span class="d-sub">Today 11:59 PM · ~4h of work</span>
  <span class="d-bar"><i style="width:72%"></i></span>
</div>
```

| variant | use |
|---|---|
| `.display` | countdowns and times (the hero, Up next, alerts, updates) |
| `.hot` | amber backlight: urgent (the hero above 70 % urgency) |
| `.bad` | red backlight: overdue, takeover |
| `.big` | the focus timer and the takeover countdown |
| `.clock` | the one-line clock in the top bar |

Only numbers and their short labels go on an LCD. Countdowns read `MM:SS` or `H:MM:SS` under a day, `3D 4H` beyond, and `NOW` at zero (`cdText` in app.js). Never put body text on one; `.d-sub` holds at most one short line.

### Location banner

A departures placard for anything with a place: course-colour stub, building icon behind a dashed tear line, building name, room code in mono, walk time, and an LCD **Leave by** chip that turns red as `.late` ("Leave now").

```html
<div class="locban" style="--kc: var(--k1)">{building}
  <span class="lb-main"><span class="lb-name">Phelps Hall</span><span class="lb-room">PHELP 1160</span></span>
  <span class="lb-trip">{walk}<span>9 min walk from home</span></span>
  <span class="lb-leave"><span class="lb-k">Leave by</span><b class="num">9:18 AM</b></span>
</div>
```

Below 24 em the chip drops under the trip line. Zoom-only places use the `video` icon.

### List rows

```html
<div class="row mrow sel" style="--kc: var(--k1)">
  <button class="chk">{check}</button>
  <span class="m-main"><span class="m-t">PA3: heaps and hash tables</span>
    <span class="m-meta"><span><span class="cdot"></span>CMPSC 130A</span><span>Assignment</span><span>~4h</span><span>Canvas</span></span></span>
  <span class="m-pri p2">!!</span>
  <span class="m-due"><span class="duepill hot">in 2h</span><span class="m-abs">Today 11:59 PM</span></span>
</div>
```

| state | look |
|---|---|
| `.sel` | accent wash and a 3 px accent edge |
| `.done` | filled orange check, struck-through title |
| `.cls` (classes, events) | a clock or ticket icon instead of the check, lighter title |
| `.doing` | an orange "In progress" tag before the title |
| `.new` | an accent flash after quick add |
| `.completing` | slides out right when checked |
| `[data-swipe]` | lifted, tinted `--ok` (done) or `--warn` (snooze) with a hint beside it |
| `.m-sort` in `.m-main` | Canvas work Collegiapp couldn't sort (Info in the Inbox): "Is it" and `.chip`s for Homework, Exam, the kind the title hints at, and Just info; a pick sets the kind and moves it to to do |

Rows group under `.grp` headers (Overdue, Today, Tomorrow …) when sorted by due date. Below 24 em the due pill moves under the title.

### Due pill

`.duepill` + state: none ("Mon"), `.soon` (within 24 h, `--warn-ink` on a 14 % wash), `.hot` (within 3 h, solid `--warn`), `.over` ("2h overdue", solid `--bad`), `.live` (a class happening now, accent). Solid fills take `--bg2` text. The words carry the meaning; colour only reinforces it.

### Chips

| class | use |
|---|---|
| `.chip` / `.chip.on` | toggles: quick filters, calendar series, sources, snooze reasons |
| `.chip.course` | quick filter for a course, with its colour dot |
| `.fbox .chip` | an active filter term in mono, removable (`×`); `.bad` (dashed, `--text-2`) is a term the filter couldn't read, which it ignores |
| `.cchip` | a course code with its dot; `.cchip.none` reads "Personal" |
| `.why-chip` | a Do first reason ("Due in 3h", "Worth 15% of grade"); one line, extra chips hide |
| `.pc` | a quick-add parse chip ("Course **CMPSC 130A**"), `.course` adds the colour edge, `<i>` marks an inferred value |
| `.seg` > `.chip` | a segmented control (estimate, priority, status, alert, focus length) |
| `.prio` | priority with a flag icon in `--warn`, `.p3` in `--bad` |

### Fields

- Inputs, selects and textareas inside `.screen` get the field style: `--bg2` fill, 1 px `--line`, 8 px radius, a 2 px accent outline on focus. On touch screens they are at least 16 px so iOS never zooms.
- `.fbox`: the filter box, a recessed box holding term chips and an input; the terms wrap onto more lines rather than scroll, so every active filter stays in sight. Focus draws a 2 px accent ring.
- `.qstrip`: the quick filters under it, a horizontal strip (section 9). A `kind:` chip swaps the view's kind instead of narrowing to nothing.
- `.qa-wrap`: the command line (quick add, palette, feed links): an orange `+` or `>` prompt in mono, a large input, a key at the end. Below it `.qa-parse` holds parse chips and `.qa-hl` the token highlight (`.tk-course`, `.tk-date`, `.tk-estimate`, `.tk-priority`, `.tk-tag` …).
- `.fgrid`: label/field pairs in the inspector (6.4 em labels).

### Up next parts

- `.live`: the "Now:" strip with a pinging dot (`.ldot`, a four-frame radar ping; static at M0).
- `.nx-head`: title, facts and a small LCD side by side; stacked below 26 em.
- `.timeline`: today from 7 AM to midnight, class blocks in accent, events in `--acc2`, a `.nowln` needle lit like the beam (it flickers as it steps a minute, `.blip`); `.tl-scale` labels in mono.
- `.agenda` > `.ag`: time, course bar, title and place.

### Lenses

- **Calendar** (key 6, view id `week`): `.calbar` on top, a `.seg` of Day · Week · Month (Day is the default), `‹` `›` keys (`[` `]`) around a `.cal-t` LCD of the range, and **Today** once you've paged away. Every mode shows the list's items, so the filter bar narrows them.
- **Day** (`.dv-head`, `.dayv` > `.dv-grid` > `.dv-hr`, `.dv-col` > `.dv-ev` and `.dv-flag` > `.dv-fi`, then `.dv-past`, `.dv-now` > `.dv-nt`, `.dv-gap`): one day hour by hour, like a phone calendar.
  - **Grid and placement:** everything placed in time sits at `--t` (hours since midnight) times `--hh` (an hour's height, 3.4 em; 3 em under 30 em) and keeps the grid's font size, so its em means the same everywhere. Text sizes go on the spans inside.
  - **Head:** the day ("Today", "Tomorrow", "In 3 days"), the date, what's booked and how much is due, and an LCD counting down to the next thing (Starts in / Due in, hot under 30 min) or, during one, to its end.
  - **Hours:** each `.dv-hr` row is a button that starts quick add at that hour ("today 3pm"). The current hour's label is bold.
  - **Blocks** (`.dv-ev`): classes, events, exams and anything with an end, side by side where they overlap (`--lane`/`--lanes`).
    - Classes are outlined, when-free plans hatched with a dashed edge, exams red.
    - Past blocks fade to 50 %, and the one in progress is ringed with a stepped dot.
    - A block is a size container, and its lines (`.dv-eb`) take the layout its height has room for, whole lines only, never squeezed: each on its own row with "when" at the bottom (the name on two lines from 5.85 em); time, name, then place beside "when" (under 4.8 em); name over time · place · when (under 3.8 em); one row of time, name and when (under 2.6 em, without the time in a lane under 24 em).
    - Today, each block says "in 1h 20m", "ends in 25m" or "ended 2h ago" (`[data-rel]`).
  - **Deadlines** (`.dv-flag`): a dashed accent rule at the due time, with cards under it (over it after 22:30, `.up`): the time, the title, the course, the time left and "start by" from the estimate. Overdue flags are red (`.late`).
  - **Now:** the past is shaded, the accent now line (lit with the CRT's glow, like the beam, and flickering as it steps a minute) carries the time in the gutter, and the free stretch to the next block is bracketed in green with "2h 10m free until …". `updateCountdowns` moves all three each second.
  - **Opening and paging:** the view opens scrolled to now (today), its first thing, or 8 AM, once per day shown. The week header and a month's day number open that day.
- **Month** (`.month` > `.mhd`, `.mday` > `.md-n`, `.mi`, `.mmore`, `.mdots`): a Sunday-first grid; days of other months fade, past day numbers dim, today gets the accent wash and an LCD number. A cell lists exams, then deadlines, then classes (time in mono, course-colour edge, classes outlined, exams bold red), three at most, else two and "+n more". The day number and "+n more" open that week. Under 42 em cells show course dots instead.
- **Week** (`.week` > `.wcol` > `.wi`): seven columns from today or the day you paged to, today washed in accent with an LCD day chip; columns scroll sideways below 60 em and stack below 30 em. Items show time and course in mono, with a course-colour left edge; classes are outlined, exams bold red.
- **Classes** (`.cgrid` > `.ccard`): course cards with a thick course-colour edge, link keys and Items / Edit / Exclude; meetings read "MW 9:30 …" for lectures and "Section F 13:00 …" for sections. `.excluded` cards fade with a dashed edge.
  Below them `.cadd` holds **Add a course** (the course dialog: code, name, course page). The Google picker `.calmap` lists each series with its times and a `.cal-pick`: a `.seg` of Lecture · Section · Not a class and, once it's a class, a `.cal-course` select for its course. Under 34em the picker stacks.
- **Links** (`.lgrid` > `.lgroup`): the same card holding link keys with the `ext` icon.

### Notes

- **Notes lens** (`.nbar`, `.ngrid` > `.ncard` > `.nc-top`, `.nc-t`, `.nc-img`, `.nc-p`, `.nc-bar`, `.nc-tags`, `.nc-when`; `.nc-pin`, `.nc-ck`): notes as cards with a preview. A note's first drawing shows under its title (`.nc-img`, at most 6.5 em tall). A checklist's progress is a segmented meter (`.nc-bar`). Pinned notes come first with a pin.
- **Editor sheet** (`.nsheet` > `.ns-bar` with `.ns-tools` and `.ns-g` groups, `.ns-page` > `.ns-title` and `.ned`, `.ns-side`, `.ns-foot`): nearly the whole screen, the page centred in it.
  - **Toolbar:** `.ns-tools` is a strip that scrolls like the others (`bindStrips`). The link and table controls appear as a strip under it while they're needed.
  - **Page:** `.ned` draws exactly what the note holds and what prints (`docs/NOTES.md`). A checklist item's box is its left padding.
  - **Pictures and drawings:** an `img` in `.ned`, `.ai-doc` or `.ai-msg` sits in the line, or by `data-place` floats `left` or `right` with the text wrapping, or takes a `center` line; `data-w` is its width as a share of the column. The picked one (`.picked`) has a 2 px accent ring 3 px out, and the bar under the tools holds its controls: Edit drawing, a `.ns-seg` of place chips, the `.ns-imgw` width slider and Delete. In a dark scheme drawings (`img[src^="data:image/svg+xml"]`) are inverted, so black ink reads white.
  - **Drawing layer** (`.ns-draw`, `ui/js/draw.js`): covers the sheet with its own `.ph` band (Discard, Done), a `.ns-tools.dr-tools` strip (tools with `.on`, ink keys with a `.dr-dot` swatch, size keys with a `.dr-w` dot, undo, redo, clear), `.dr-scroll` > `.dr-page` (the same width as `.ns-page`, so a drawing goes in at its drawn size) > `.dr-box` on a dot grid, holding `svg.dr-cv`, the `svg.dr-ui` overlay (`.dr-sel` dashed box around the selection, `.dr-marq` the drag box) and `.dr-in` for text; then a `.ns-foot` of keys. The cursor follows the tool (`data-tool`). In a dark scheme the canvas, text field and swatches are inverted with the drawings.
  - **Narrower screens:** the AI side panel overlays the page, and the sheet fills the screen on phones.
- **Capture modes** (`.qa-mode`): a `.seg` of Item · Jot · List above the quick-add box. Jot and List type into a textarea.

### AI

- **Ask AI dialog and side panel** (`.ai`, `.ai-top`, `.ai-tool` cards, `.ai-share` for context, `.ai-opt` presets, `.ai-out`, `.ai-msg`, `.ai-act` > `.ai-ah` + `.ai-pre`, `.ai-paste`, `.ai-err`): pick the AI, choose what to share, pick a preset or type the request.
  - **Reply:** it streams into `.ai-out`.
  - **Changes:** each block of changes is an `.ai-act` with a preview and **Apply** (then "Applied").
  - **Thinking:** `.ai-dots`, three pixels lit in turn, stepped like an LCD, until the first words come.
  - **Writing:** the part being written ends in a teletype's blinking block cursor (`.tty`; a thin caret in Standard), and a finished reply rings the carriage's bell (`CA.sound.ding`).

### Sync

The top bar's `.cloudkey` (above) opens it. The Sync dialog reuses the Connect sources parts (`.feeds` > `.feed`, `.qa-wrap`, `.feed-st`). It shows the account, an `#cloudSt` status line ("Synced 2m ago · 3 to upload") and Sync now / Sign out; signed out, Sign in with Google (Open the page again while the browser waits). In the app, **Change project** takes another project's pasted config in a `textarea.ta`.

While it syncs, a modem's send and receive lights (`.modem`, SD and RD) flicker beside the status at their own uneven rates, and the result prints when they go out; Sync now plays a cut-short handshake (`CA.sound.modem`). In Connect sources, a source that failed starts its status with `.nosig`: a red LCD "No signal" tag whose text rolls through and locks, like a picture losing its vertical hold (a plain red tag in Standard).

### Inspector

The details panel (`.insp`): an editable title, `.fgrid` fields, segmented controls, the location banner, link keys, the link box, notes, `.srcinfo` (where it came from), and `.acts` pinned to the bottom. Each of the item's links is a `.lk`: its key (opens it) and a ghost `.lk-x` close key (takes it off); the course's first link follows as a ghost key. Under them `.fbox.lnk` (links icon, `#lnkIn`): a link pasted there, or Enter on a typed one, goes on the item, and so does a link pasted into the title, or anywhere while the panel is open. Wide screens: it covers the Do first / Up next column. Mid widths and non-list lenses: a 28 em drawer at the right. Phones: a bottom sheet.

### Theme browser

The Theme section of the Appearance drawer (`themeSec()` in `lab.js`, styles in `lab.css`). Imported themes are kept in the saved state (`CA.ui.themes`). The data is the day theme (`pal`), the night theme (`nightPal`) and when to switch (`night`: `off`, `auto` with the system, `on` always).

```html
<span class="thm-q" id="thmQ">Switch theme at night</span>
<div class="opts" role="group" aria-labelledby="thmQ"><button class="opt" data-lab="night" data-v="off">Off</button><button class="opt on" data-lab="night" data-v="auto">With the system</button><button class="opt" data-lab="night" data-v="on">Always</button></div>
<div class="thm-slots" role="tablist" aria-label="Day or night theme">
  <button class="slot on" role="tab" id="slot-day" data-slot="day" aria-selected="true" tabindex="0">
    <span class="slot-h"><svg class="i">sun</svg><span>Day</span><span class="slot-now">Now</span></span>
    <span class="thm-pv" style="--pv-…">…</span><span class="slot-n">Gaucho</span>
  </button>
  <button class="slot" role="tab" id="slot-night" data-slot="night" aria-selected="false" tabindex="-1">…</button>
</div>
<div class="thm-pick"><h4 id="thmPick">Pick a day theme</h4></div>
<div class="thm-grid" role="tabpanel" id="thmPanel" aria-labelledby="thmPick">
  <div class="thm on" data-pv="pocket">
    <button class="thm-use" data-thm="P12" aria-pressed="true">
      <span class="thm-pv" style="--pv-bg:… --pv-surface:… --pv-chrome-bg:… --pv-accent:… --pv-disp-bg:…"><span class="pv-card">…</span></span>
      <span class="thm-n"><span class="thm-nm">Gaucho</span></span><span class="thm-m"><b>P12</b> · Pocket · light</span>
    </button>
  </div>
  <div class="thm" data-pv="pocket">… <span class="thm-n"><span class="thm-nm">Night</span><span class="thm-mark" role="img" aria-label="Night theme"><svg class="i">moon</svg></span></span> …</div>
</div>
```

- **The question comes first.** "Switch theme at night" (`.thm-q`) over Off · With the system · Always, with a line on what the answer means. It decides whether there are two themes at all, so it sits above the grid.
- **Off is one theme.** No slots and no day or night marks anywhere: the heading reads "Pick a theme", `.on` is the theme in use and a click on a card uses it.
- **On adds two slots** (`.thm-slots`, a tablist): Day (`sun`) and Night (`moon`), each showing its theme's preview and name; the one in effect wears `.slot-now` ("Now"). Exactly one is selected (`.on`, a pressed key in Pocket and a solid chrome tab in Standard, like `.nv.on`), by default the one in effect. Arrow keys move between them, Home and End go to Day and Night. The grid is the tabpanel: its heading (`.thm-pick`) follows the selection ("Pick a night theme"), a click puts that theme in the selected slot (its preview pops, `.pop`), the selected slot's theme has the ring and the other slot's theme a quiet `.thm-mark` (9 px pixel icon; 13 px line icon in Standard). `.thm-grid` cards draw each `.thm-pv` from that theme's own tokens (a card with its header, a number panel, two text lines, the key); `data-pv="standard"` draws the plain header, on cards and slots alike.
- **A click always shows something.** Selecting the slot that isn't in effect paints its theme on screen as a preview (`shown()` in `lab.js`, with "Preview · Day is on now" by the heading). Nothing is saved for it: the saved state and the island's `capp.tokens` keep the theme in effect, Pocket Start's `capp.palettes` are written from the saved setting too, and the preview ends when you select the other slot again, change when to switch, or close the drawer.
- Any theme can go in either slot, of either look or scheme: what the slots show is what you get. **Switch light / night** in search flips between them, putting its look's dark or light theme (P11/P16, P9/P15) in the slot when it holds the same scheme.
- **Import a file** or paste JSON: the shared format (`docs/THEMES.md`) or a Collegiapp v1 theme pack; it goes in the selected slot. **Export** downloads the theme on screen (the selected slot's) in the shared format; **Copy JSON** copies the same text. Imported themes have a **Delete** key (`.thm-del`).
- **Make one with a chatbot** (`#thmMake`): a description field, **Open Claude** (`claude.ai/new?q=…`) and **Open ChatGPT** (`chatgpt.com/?q=…`) through the app's own link opener (`open_link`), **Copy the prompt**, and a field for the reply. The JSON is read out of the reply (prose and code fences are fine) and checked against THEMES.md's contrast pairs; a failing theme waits in `#thmMsg` for **Fix contrast and save** (moves each failing foreground toward black or white) or **Save as it is**.
- Style codes name an imported theme `P:<id>`; only the file carries it to another machine.

### Overlays

| part | class | notes |
|---|---|---|
| Dialog | `.dialog.panel` (`.sm` 30 em) | a module with a band: title, hint in the count slot, a ghost close key. Phones drop it from the top so the keyboard never covers the input. |
| Palette and pick lists | `.pal-res` > `.pal-sec`, `.pal-it` (`.on`) | used by search, snooze and help |
| Toast | `.toast` | message, then Undo or one action; at most four, bottom right (above the deck on phones). An undo toast offers Redo, and Trash when the undo threw a version away |
| Trash | `.trash` > `.display`, `.pal-res` of `.pal-it` (`.tr-t`: title over why · when · course), `.row2` (limit) | an LCD of its size against the limit, rows restore on click or 1–9, Empty takes a second press |
| Radial menu | `.radial` > `.ring`, `.hub`, `.rb` (`--x`, `--y`: the spoke's direction) | right-click or long-press; item actions on a row. Keys sit on an ellipse (3 × 4 em) and grow outward from the hub, so long labels never cover it; `openRadial` measures the menu and slides it inside the content |
| Key tips | `.tips` > `.tip` | graphite mono labels with an orange ring, shown while Alt is held |
| Empty state | `.m-empty` | big faded icon, a bold line, one sentence, then actions |

### Focus and takeover

Full-screen overlays (`.ov.full`) on the dot grid: `.fo-top` status line, `.fo-task`, a `.display.big` timer, a 24-segment `.meter`, the `.fo-log` terminal on an LCD, and keys. A takeover adds "Get up." in `--bad` at 4 em, a red LCD and the location banner, and stays until answered. The alert dialog is `.dialog.alertbox` with the red band.

### Key deck

`.deck`: the device's bottom row. Add (primary), Focus 25 (dark), Done, Snooze, Next, Search, then the engraved "Collegiapp CA-1" and a speaker grille. Windows at least 900 px tall turn the keys into legend keys (symbol over label, like a calculator). Below 52 em the keys share the width; on phones the deck sticks to the bottom like a tab bar and drops Next.

### Island

The always-on-top live activity (`ui/island.html`, 380×64): a graphite pill with an orange progress ring, the label and a Doto countdown. It sits at 60% opacity and comes up to full while the pointer is over it. The desk preview draws the same thing with `.island`. It is always dark, whatever the palette.

## 7. Layout

`#screen` is a named container (`container: screen / inline-size`), so layouts follow the room the app has: an open Appearance drawer, split view and iPad Slide Over all count. Width breakpoints are `@container screen`; heights use `@media`.

`#content` holds `#side` (the sidebar) and `.main`, which is a container named `screen` too, so the page (`#page`) lays out in the room the sidebar leaves it; dialogs in `#layer` still answer to the whole screen.

Regions: `#side` (sidebar), `#top` (top bar), `#nav` (path bar, or program keys), `#now` (Do first), `#sched` (Up next), `#list`, `#insp` (floating), `#bottom` (deck).

| screen width | layout |
|---|---|
| **≥ 1100 px** | Two columns (1 : 1.3): Do first over Up next on the left, the list on the right. |
| **761–1099 px** | Windows taller than 960 px: Do first spans the top; Up next and the list share the row below (1 : 1.35). Up to 960 px tall: Do first over Up next on the left, the list on the right (1 : 1.25), because spanning left the list a sliver (14 px at 800×600). |
| **≤ 760 px** | One scrolling column like an iPhone: the path bar (or key row) sticks under the top bar, the deck sticks to the bottom, the inspector is a sheet. Up next keeps only what's next, where, and when to leave. |
| non-list lens | `data-wide="1"`: the list takes the whole width; Do first and Up next hide. |

| window height | change |
|---|---|
| ≥ 900 px (and ≥ 761 px wide) | legend keys on the deck |
| ≤ 780 px | type ×0.9, tighter rows and modules, no coach line |
| ≤ 640 px | no reasons line, timeline scale, agenda or quarter context |

Component container breakpoints (in `em` of the region): top bar 64 / 50 / 34; Do first 52 (LCD above the title) and 36 (ghost keys hide); Up next head 26; location banner 24; list rows 30 and 24; week 60 and 30; deck 66 and 52.

Desktop frames: on Windows and Linux the top bar is the title bar (`html[data-frame="own"]`, drag after 4 px, double-click maximizes) and stays pinned in the one-column layout. On macOS (`data-frame="mac"`) the top bar starts 66 px in, after the traffic lights.

## 8. Motion

The final design ships with **M2: full motion** (it was M0 until 2026-11-01). Pocket moves like the hardware it draws, and every input answers where it was made: keys travel and spring back, LCDs switch in steps, pixel icons wipe and shake a pixel at a time, modules and rows settle like parts clicking into place.

| level | `--m` |
|---|---|
| M0 Off | 0 |
| M1 Subtle | 0.7 |
| **M2 Full** (final) | 1 |
| M3 Lively | 1.15 |

**Rules**

- Write durations as `calc(var(--m) * 220ms + 1ms)`. The extra millisecond keeps `animationend` firing at M0. Easing tokens: `--ease` (settle), `--ease-back` (spring, stamp), `--ease-in` (leave).
- **LCDs never tween.** Anything on a `.display`, `.lb-leave`, `.logo` or the focus log animates with `steps()`: a power-on flicker (`lcdOn`), a backlight flash, a bar filling a segment at a time, a blink.
- **Pixel icons move in whole pixels**: a 9-step wipe (`pxWipe`), a 2 px shake (`nope`, `bell`). Never rotate or scale them smoothly.
- **Anything that loops is stepped** (the live dot, a blinking zero, the takeover alarm, the log cursor). C2's warp filter repaints the whole screen on every frame of a smooth loop. `html[data-motion="0"]` runs every animation once, so loops stop at M0.
- **The tube's moments go in the gaps.** A channel change, tape tracking, the OSD and degauss play over something already happening (a lens switch, an undo, a session starting or ending) and never hold it up or take input. They're short, one at a time (a new one replaces the last), never during power, and each run varies a little. Nothing flashes: brightness only eases, nothing larger than a line blinks, and the OSD fades rather than flickers. Don't add more where an input already answers with its own motion.
- `prefers-reduced-motion: reduce` turns all of it off (`CA.motion.m()` is 0, and the CSS clamps to 1 ms).
- app.js and motion.js only add classes; every animation lives in pocket.css's motion section.

**How it's wired** (`ui/js/motion.js`, `CA.motion`). Every render replaces markup, so continuity comes from keys:

- Parts carry `data-k` (rows by item id, `g:` day groups, `hero:` / `next:` / `live:` cards, `w:` week items, `c:` class cards, quick-add chips). `keep()` before a render and `settle()` after it: parts that moved glide from where they were (FLIP, 280 ms), parts that left play their exit on their old element put back in place (a ghost, `.gone.x-<kind>`), parts that arrived play `.come-drop` / `.come-up` / `.come-r` / `.come-l` and their LCDs boot.
- The action says what happened (`S.fx` in app.js): `exit: { id: "done" | "swipe" | "snooze" | "del" | "out" }`, `flip`, `skip` (1 for Next, -1 for Back). A render for a tick or a resize moves nothing.
- `ack(el, cls)`: a one-shot class that comes off when its animation ends. `press()`: a keyboard key pushes its on-screen twins (`data-hint`) down for a beat. `leave()`: an overlay, the details, the radial menu or the Appearance drawer closing plays its exit on a clone. `texts()` / `counts()`: `data-n` numbers roll up or down, `data-fx="print"` labels print. `burst()`: pixel confetti. `count()`: an LCD number counting up. `swap()`: a View Transition of the whole screen.

**Vocabulary**

| class | on | what it does |
|---|---|---|
| `.ack` | keys, program keys, chips, window keys, rows | released: the key springs back past the top (`keyUp`, `--press` 1 → −.35 → 0); a program key's LED flickers on; a selected row's bar grows |
| `.down` | keys | held down by its keyboard key for 90 ms |
| `.boot` | `.display` | segments flicker on over a backlight flash; its bar fills in 12 steps |
| `.blink` | countdowns | at `NOW`, once a second; a passed "leave by" blinks too |
| `.bump` (`data-dir`) | counts, priority | rolls up or down the way the number moved, 3 frames |
| `.print` | band labels | prints left to right, 8 frames |
| `.nope` | keys, LCDs, quick-add box | refused: a 2 px shake and a low buzz (`CA.sound.nope`); an LCD flashes red, the quick-add box rings red |
| `.stamp` / `.strike` | a row's check / title | done in place: the check stamps and its tick wipes in, the title is struck through |
| `.saved` | details fields | a green ring fading out |
| `.swap` | details body | the details now show another item |
| `.blip` | now lines | the beam steps to the next minute: a stepped flicker |
| `.pop` / `.flash` | quick-add chips | the grammar recognized something new / a value changed |
| `.x-done` `.x-swipe` `.x-snooze` `.x-del` `.x-skip` `.x-back` `.x-out` | ghosts | done slides right with a stamp and strike; swiped carries on from the finger; snoozed slides left; deleted switches off like the tube (it collapses to a line lit in the glow colour, which shrinks to its middle and fades, a few frames at a time); skipped (Do first) slides left as the next comes in from the right, and Back is the mirror |

**Inventory**

- Power (`fx.js` power section, `.crt` in crt.css, `sound.js` `crtOn`/`crtOff`): the window opens like a tube TV turning on.
  - **On:** a bright line opens into snow while the degauss coil hums, the picture rolls in, its hold tears and settles, the static fades as the signal locks, and colour comes last (0.76 s at Full).
  - **Off:** closing plays the zip. The picture collapses to a bright line, the line to a dot, and the dot fades on the phosphor (0.82 s). The window hides (`power.rs`) at 0.66 s, while the dot is still fading, so nothing hangs on it.
  - **Warm:** back on within a minute of going off, the tube is still warm, so it skips the snow and the hum and the line opens straight into the picture (0.34 s), with only the relay's click and the whine.
  - **Rules:** brightness and colour run on a veil's backdrop-filter so C2's warp is untouched, and the layer never takes pointer events. M0 and reduced motion switch at once; Standard fades.
- Boot: starts as the static begins to clear (380 ms into power-on), so the modules settle in through the last of the snow one after another (50 ms apart) and take their colour as the burst locks; then their LCDs and the logo flicker on, with the boot chirp (done at about 1.3 s). Theme packs keep the CRT power-on (`.powering-on`).
- Between programmes (`fx.js` blips, the same `.crt` layer shown by `.crt-blip` over the live picture; Pocket only):
  - **Channel change:** changing lens (list, calendar, classes, links, notes) retunes only the list: the new picture comes in soft and grey under fine static (`.crt-snow.soft`, blended soft-light so it textures the picture without lighting it) and sharpens and swings up a few pixels into place as its colour locks (0.44 s). `CH n` and the channel's name show on the set's OSD: a channel is a lens, so every list tab is CH 1 Tasks, then CH 2 Calendar, CH 3 Classes, CH 4 Links and CH 5 Notes (`.crt-osd`, phosphor-green dot matrix). Its brightness never jumps: the first version, a hard cut under bright full-screen snow, strobed.
  - **Tape search:** undo rewinds and redo fast-forwards, like a VCR (0.24 to 0.3 s, then 0.09 s back to play; the OSD lingers a quarter second after). The transport clunks in and the picture jolts, then judders a pixel at a time and loses some colour. Two or three search bars sweep up (rewind) or down (fast-forward): grey noise with soft edges, a bright leading edge, rows smeared sideways and white dropouts, over a smear of the picture itself (`.crt-band`, a backdrop blur). Head-switching noise frays the bottom lines. The OSD shows ◀◀ Rew or ▶▶ FF over a tape counter (the session as a recording, from when the app opened) that spins back or on by 2 to 9 s, and the wind stays: undo twice and the counter really is further back. With sound on, the clunk, the reel motor and the tape hiss (`CA.sound.tape`) replace the undo beep. Not over a dialog.
  - **Tape deck:** a focus session starting shows ▶ Play on the OSD, and ending shows ■ Stop.
  - **Degauss:** the picture wobbles and its colours swirl through purity blotches that die away with the coil's hum (0.9 s), on transforms and the veil so C2's warp stays on. **Degauss the screen** in search runs it, and so does shaking the window by its top bar (four turns of 30 px within 0.9 s), the way moving a tube magnetizes it.
- Keys: 60 ms down, 240 ms spring back. Focus rings close in from 6 px.
- Lists: rows deal in at 18 ms apart (capped at 12) when the list changes; done, snooze, delete and undo keep the list in place and only the rows that moved glide. Undo drops the item back in with a flash. Swipes tick at the threshold (with an 8 ms vibration) and spring back if let go early.
- Done: pixels burst from the key that was pressed; clearing the last Do first item plays a four-note fanfare and a bigger burst.
- Do first and Up next: a new card rises in as the old one leaves (done lifts away, snoozed sinks, Next slides left, Back slides right).
- Overlays: the scrim fades in and out, dialogs rise (drop from the top on phones), a closing dialog fades down; a dialog replacing another fades under it. The snooze options deal in. The details rise over Do first, slide in as a drawer where they cover the list, and rise as a sheet on phones; each leaves the way it came.
- Focus: its parts come up one after another, the LCD boots, the meter fills segment by segment, the log has a blinking block cursor, the last minute turns the LCD amber with a beep; the summary counts the minutes up and bursts. ▶ Play and ■ Stop show on the OSD as a session starts and ends. Takeover's "Get up." slams in and keeps flashing; an alert's band flashes and its bell rings.
- Toasts: a new toast pushes the others up; an undo toast drains a bar for the time it has left and holds while hovered; nudges and update notices ring their bell.
- Light ↔ Night: the whole device redraws top to bottom in 14 steps, like an LCD refresh. Changing lens is a channel change (above); Standard crossfades the screen in 200 ms.
- Touch: a long press draws a ring that fills toward the radial menu (timed to the real 520 ms, so it doesn't scale).
- Island: the pill pops in, a new label rolls up, the LCD flickers on when it turns amber and blinks at `NOW`. Pocket Start: each open, the board rises and its parts deal in top to bottom while the tiles flicker on.
- Effect layers (`.fx`, the C2 warp, `.display::after`), ghosts and bursts keep `pointer-events: none`.

## 9. Interaction

- **Hover** styles live only inside `@media (hover: hover)`, so touch screens never stick in a hover state.
- **Touch** (`@media (pointer: coarse)`): keys, program keys, search and the focus pill are at least 44 px; chips 36 px; segments 34 px; rows 3.3 em; checkboxes 1.75 em. Key legends and the coach line hide. Swipe a row right past 90 px for done, left for snooze; long-press (520 ms) opens the radial menu.
- **Horizontal strips** (`.nkeys`, `.qstrip`, a narrow `.week`; `bindStrips()` in app.js): scrollbars are hidden, so a mouse must still get past the edge. The wheel scrolls them sideways until the end, then the page; a drag pans them (`.panning`) without pressing the chip it started on; an edge fades only while there's more past it (`data-more="l r"`); a render keeps each strip where it was. The week keeps the wheel vertical while its list can scroll. A new strip joins `STRIPS` in app.js and the `:is()` mask rules in pocket.css.
- **Nothing clipped without a way to it**: every region, dialog and sheet that can outgrow its box scrolls inside itself at every size (on phones `.pb` stops scrolling for the column, so `.dialog .pb` and `.insp .pb` scroll again). Truncated text ends in an ellipsis; anything else that overflows is a strip.
- **Keyboard**: every key on screen has a keyboard key, and `data-hint` names it for the Alt overlay. `:focus-visible` always shows the 2 px accent ring.
- **Selection**: chrome (keys, chips, bands, LCDs, the deck) isn't selectable; titles, notes and fields are.
- **Guidance**: G1 legends on every key; **G2** (final) hold Alt for tips; G3 none; G4 a rotating coach line under the deck and a pulse on the primary key.

## 10. Writing

- Sentence case everywhere: "Start focus · 25 min", "Connect sources", "Nothing to do first."
- Join parts with ` · ` (a middle dot with spaces).
- Times: `9:30 AM`. Days: "Today", "Tomorrow", "Mon", then "Mon, Nov 3". Relative: "in 3h", "2h overdue", "ends in 12:04".
- Keys are verbs. Toasts say what happened, then offer Undo: "Done · PA3: heaps and hash tables".
- Empty states say what's missing in one bold line, explain in one sentence, and offer the next action.
- Say why something is first, late or hidden ("4 open items hidden from 2 excluded Canvas courses · manage").

## 11. Beyond the main window

The same device appears in other surfaces. Each one repeats the palette, because it can't load `lab.js`:

| surface | files | how it gets the palette |
|---|---|---|
| Island | `ui/island.html` | `localStorage["capp.tokens"]`, written by lab.js; P9 defaults inline |
| Pocket Start | `ui/start.html`, `ui/js/start.js`, `ui/css/start.css` | `localStorage["capp.palettes"]`: the day and night palettes (whatever themes are in the slots) under the keys `P9` and `P11`, picked by Windows' light/dark mode. It follows **Switch theme at night**: with the system it gets both slots, Off the day theme under both keys, Always the night theme under both; sized in px like the canvas |
| Appearance drawer | `ui/css/lab.css` | the live tokens |
| Windows shell | `integrations/windhawk-pocket/*.yaml`, `build_assets.py` | Night values written into the YAML; Cream values in its README |
| Windows theme, Terminal, VS Code | `integrations/windows-pocket/` | values in `build.py` and the JSON files |
| Zebar bar | `integrations/zebar/pocket/bar.css` | its own copy |
| Spotify (Spicetify) | `integrations/spicetify-pocket/Pocket/color.ini`, `user.css` | both palettes in `color.ini`; `user.css` reads them as `--pk-*` with Night fallbacks |

**When a palette value changes**, change `ui/js/themes.js` first (the sheet, [`index.html`](index.html), reads it), then the copies: `ui/css/core.css` `:root` (P9 first paint), the `var(--p-*, …)` fallbacks in `pocket.css` and `start.css`, `island.html`'s defaults, this file's tables, and the integrations above. A new built-in theme takes the next P number; if PocketCanvas ships it too, its tokens match PocketCanvas's `BUILTIN`.

## 12. Adding or changing a part

1. Build it from existing parts first: a module, keys, chips, an LCD, a row. A new part needs a new kind of information, not a new look.
2. Use the Pocket tokens (`--surface`, `--text-2`, `--accent` …), never hex. Check it in Cream and Night, and in Standard and Standard dark: if it has a band, a lip, an LCD, a stripe or a mono label, give it a plain version in `standard.css` (section 13).
3. Size in `em`. Adapt with `@container (…em)` on its region; touch the screen layouts only in the `@container screen` blocks.
4. Put hover in `@media (hover: hover)` and touch sizes in `@media (pointer: coarse)`.
5. Scale every animation by `--m`. Step anything on an LCD and anything that loops. If a render replaces it, give it a `data-k` so it glides, enters and leaves instead of blinking (section 8).
6. Write strings in sentence case; give icon-only buttons `title` and `aria-label`; give actions a `data-hint` key.
7. At most one `.primary` per region. Orange means "do this".
8. Keep body text at 4.5:1 or better in both palettes: on a `--bad` fill use `--on-bad`, on a solid `--warn` or `--bad` pill use `--bg2`, and for warn-coloured text on a warn wash use `--warn-ink`.
9. Add it to `index.html` and to section 6 here. If it takes a new variant ID (style code), use the next free number and never renumber.
10. Rebuild (`cargo build -p collegiapp`) and check it in the running app at ≥ 1100, ~900 and ≤ 760 px wide, each at a tall and a short height (e.g. 1920×1080, 1366×650, 1000×1100, 800×600, 375×812, 320×568): nothing clipped, every strip reachable by wheel, drag and touch, every dialog scrolls.

Don't: add effects over text, a second accent colour, all-caps source strings, new fonts, or a look from `archive/looks-2026-10/` unless asked.

## 13. Standard (L8)

The same app with the handheld taken out, for people who want a plain modern UI. It is a theme's look (`"look": "standard"`), so it comes with P15, P16, P17 or any imported Standard theme, and it shares everything structural with Pocket: regions, layouts and every `@container` / `@media` rule, motion classes (scaled by `--m`), keyboard, Alt tips, strips, the inspector. `ui/css/standard.css` (after `pocket.css`) restyles parts, only under `html[data-look="standard"]`, so Pocket is untouched.

| Pocket (L6) | Standard (L8) |
|---|---|
| Space Grotesk, Space Mono, Doto | the system UI font for everything (`TYPES.standard` in themes.js: `system-ui`, Segoe UI Variable, SF); numbers are plain tabular figures; `code` and the theme JSON keep a monospace |
| 9×9 pixel icons (`PIX`) | 24 px line icons, 2 px round strokes (`LINE` in app.js, `.i.ln`), the same names |
| B8 keys: lip, travel, gradient face | flat keys with one hairline; primary is the accent fill, dark is the chrome fill, ghost has none; a press darkens, nothing moves |
| F3 graphite (and orange) label bands, grille | a plain header: sentence-case title in `--text`, a hairline under it; Do first's icon is the accent; an alert's header is `--bad` with a 1 px `--bad` ring |
| LCD inlays: bezel, dot texture, Doto, power-on flicker | a number panel on `--disp-bg` with a hairline, system numerals at 600, no texture or flicker; `.hot` / `.bad` change its fill |
| course-colour stubs and stripes (week items, month items, agenda bar, course cards, location banner, selected row) | a course-colour dot; the selected row is the accent wash alone |
| program keys on lips | flat tabs; the current one is a solid `--chrome-bg` tab |
| the sidebar as a module | flush with the window's edge on `--surface-2`, a hairline toward the page, sentence-case section labels, the current place a solid `--chrome-bg` row |
| 14 / 10 px radii, 99 px pills | 8 px cards, 6 px keys, chips and pills, 4 px small parts |
| dot grid, C1/C2 glass, scanlines, blurred scrims and sticky bars | solid `--bg`; the effect layers are off (`fx.apply` gets flat settings; the C settings stay for Pocket and the drawer hides Screen glass); no `backdrop-filter` anywhere |
| deck engraving, speaker grille, legend keys on tall windows | a plain toolbar card, one-line keys at every height |
| Light ↔ Night redraws top-down in steps | a 220 ms fade |

Rules on top of section 12: no gradients, glow, glass or blur cards, no coloured side stripes, no emoji icons; one hairline per surface; radii 6–8 px.
