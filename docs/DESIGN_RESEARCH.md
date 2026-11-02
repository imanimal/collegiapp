# Design research → decisions

What the UI is built on and why. Each principle names the decision it produced.

## Navigation in "a few clicks or less"

| principle | source | decision in Collegiapp |
|---|---|---|
| **Fitts's law**: time to hit a target grows with distance / size | Fitts 1954; MacKenzie 1992 | Primary actions are big and near the top item (Focus / Done / Snooze / Next sit inside the Do First card). Vector's dock and Mainframe's F-key line put targets on screen edges, which are effectively infinite in size. |
| **Hick–Hyman law**: decision time grows with log(number of choices) | Hick 1952; Hyman 1953 | One ranked "do first" item instead of a wall of tasks, plus ten views, not dozens. The palette (`Ctrl+K`) fuzzy-searches everything else, so menus stay short. |
| **Recognition over recall** | Nielsen's 10 heuristics (1994) | Guidance modes G1 (keycaps on every button) and G2 (hold Alt to overlay every shortcut) teach keys in place; G4 coach rotates tips. |
| **Command palettes** fold every action into one searchable box | Sublime Text (2011), VS Code, Linear, Raycast | `Ctrl+K` / `/` searches views, items, courses, links and commands in one list. |
| **Pie menus** are faster and more accurate than linear menus because every option is equidistant | Callahan, Hopkins, Weiser & Shneiderman, CHI 1988 | Right-click radial menu, with item actions on a row and global actions elsewhere. |
| **Saved filters beat separate screens** | Gmail labels/search, Things "areas", Linear views | Every nav button *is* a filter query shown as removable chips; Esc clears to Everything. This is what keeps assignments, tasks and events one system. |
| **Natural-language quick entry** | Todoist Quick Add, Things Quick Entry, Fantastical | One-line grammar with live token highlighting and parse chips, so you can see what was understood before pressing Enter. |
| **Undo beats confirmation dialogs** | Raskin, *The Humane Interface* (2000); Gmail "Undo send" | No "are you sure?"; every destructive action toasts with Undo. |

## Interruptions and focus

| principle | source | decision |
|---|---|---|
| Interrupting **at task boundaries** costs less (lower resumption lag, less frustration) | Adamczyk & Bailey, CHI 2004; Iqbal & Bailey 2006 | Alerts fire with a 10-min lead so you can finish the current step; inside a focus session, class alerts queue as toasts unless the item is set to takeover. |
| **Calm technology**: information should move between the periphery and the centre of attention | Weiser & Brown 1995 | The island and taskbar progress are peripheral; escalation (nudge → alert → takeover) moves things to the centre only when it matters. |
| **Implementation intentions** ("when X, I'll do Y at Z") roughly double follow-through | Gollwitzer 1999; Gollwitzer & Sheeran 2006 meta-analysis | Every item can carry a when/where; "leave by 9:27P from Phelp 1160" turns a reminder into a plan. |
| **Self-binding / commitment devices** work when exits are costly but possible | Ariely & Wertenbroch 2002; tools like Cold Turkey, LeechBlock, Freedom | Lockdown requires typing *"i choose distraction"* to quit early. Hard mode kills launchers rather than hiding them. There is always an exit. |
| **Timeboxing** (Pomodoro, 25/5) | Cirillo | `F` = 25 min by default; 50/90 for deep work. |

## Readability first: retro-modern (L5–L7)

The full-screen CRT renditions were too hard to read for daily use: all-caps pixel fonts, glow and scanlines over body text, and many equal-weight controls. The retro-modern family keeps the character but moves it out of the way.

- **Retro is contained.** CRT glass, LCD segments and split-flap tiles appear only inside `.display` inlays (countdowns, clock, focus timer), on keycaps and on paper textures. Nothing is drawn over body text, and the screen-wide CRT effects are off by default.
- **Real UI type, sentence case.** Inter, Space Grotesk or IBM Plex Sans for text; a mono or pixel face only for numerals and filter syntax. Strings are written in sentence case at the source; classic renditions re-uppercase them with CSS.
- **One obvious next step.** Each region has a single primary button (Start focus, Add). Secondary actions are quieter, and every button shows its key.
- **Say why.** The Do First card shows its reasons as chips ("Overdue 3h", "Worth 1% of grade"), so the ranking is never a mystery.
- **Responsive by container.** Panels adapt to their own width: the Signal sidebar folds to an icon rail below 1280 px, the hero stacks under 40 em, and list rows put the due pill under the title on phones.

## The CRT look, done properly

| effect | technique (in `ui/css/crt.css`, `ui/js/fx.js`) |
|---|---|
| Rounded tube | `border-radius: 3.4% / 5%` on the screen plus inset bezel shadows; the elliptical radius matches real tubes better than a single radius. |
| Barrel distortion (C2, experimental) | SVG `feDisplacementMap` fed by a canvas-generated radial map (`u·r², v·r²` in R/G). It's real geometry, not a fake vignette. |
| Scanlines | `repeating-linear-gradient` 1px dark / 2px clear, opacity from the slider. |
| Aperture grille vs shadow mask | Trinitron-style RGB stripes (`mA`) or a dotted triad pattern (`mS`), multiplied over the image. |
| Phosphor glow + chromatic aberration | One composed `text-shadow`: glow blur layers plus ±x red/cyan offsets, so it applies to all text at once. |
| Noise, flicker, rolling bar, vignette, glass | Animated canvas noise texture, opacity flicker, a slow luminous band, a radial vignette, and a diagonal reflection. Every layer has `pointer-events: none`. |
| Power on/off, degauss | Collapse to a horizontal line then a dot; a degauss wobble with hue shift, plus synthesized WebAudio thumps (sound is off by default). |
| Accessibility | Motion levels M0–M3 (M0 = instant) and `prefers-reduced-motion` support. Body text stays at ≥ 4.5:1 contrast on every palette. |

## Renditions (layout + navigation paradigms)

Each rendition is a complete vision, not a recolour; palettes, buttons and frames can still be mixed across them.

Retro-modern (default, recommended):

- **L5 Signal** · dark dashboard. Sidebar of views and classes (an icon rail on smaller windows), the Do First card with a big Start button and a CRT-glass countdown, an Up next rail with a day timeline and agenda.
- **L6 Pocket** · handheld. Cream plastic, program keys for views, reflective LCD countdowns, and a deck of big labelled keys for Add, Focus, Done, Snooze, Next and Search.
- **L7 Ledger** · paper planner. Binder tabs for views, a green-bar sheet of work, stamp-style due tags, and a black split-flap board for countdowns and what's next.

Classic CRT:

- **L1 Phosphor** · terminal. Tree nav (views, classes, sources) on the left, a docked inspector on the right. The command line at the bottom is also quick-add (`cd /views/exams`, `ls`, or just type an item). Rows type themselves in.
- **L2 Teletext** · broadcast pages. Type a 3-digit page (100 index, 200 do first, 310 assignments, 400 classes, 600 focus, 888 help). Four Fastext colour keys (R/G/Y/B) change with context. A double-height banner and a ticker carry what's urgent.
- **L3 Mainframe** · DOS desktop. Draggable windows with drop shadows, Alt-letter menus (File/View/Item/Class/Focus/Help), an F-key status line, and F6 to cycle windows.
- **L4 Vector** · arcade HUD. A reactor ring around the Do First item fills as the deadline nears; XP, level and streak sit in the HUD; a dock replaces the nav, with the radial menu on right-click.

## Variant axes (style-code IDs)

The final pick is L6 Pocket, `CAPP1 L6 P9 B8 F3 T6 G2 M2 D3 C2 s4 g0 f0 n0 a0 v0 mN bN S1`; the live app keeps P9 Cream and adds **P11 Night**. Everything else below is archived in `archive/looks-2026-10/` with its ID unchanged.


`L1–L7` rendition (L5–L7 retro-modern) · `P1–P11` palette (green, amber, paper white, teletext, DOS blue, vector cyan, Gaucho navy/gold; P8 Slate, P9 Cream, P10 Ivory, P11 Night) · `B1–B8` buttons (bracket, reverse, keycap, bevel, vector, block; B7 soft, B8 key) · `F1–F8` frames (single, double, band, ticks, glow; F6 card, F7 module, F8 sheet) · `T1–T7` type (VT323, IBM Plex Mono, Share Tech + Orbitron, VT323 + Press Start 2P; T5 Inter + VT323 numerals, T6 Space Grotesk + Doto, T7 IBM Plex Sans + Plex Mono) · `G1–G4` guidance (keycaps, Alt tips, minimal, coach) · `M0–M3` motion · `D1–D3` density · `C0–C2` curvature · `s g f n a v` CRT sliders 0–100 · `mN/mA/mS` mask · `bG/bB/bN` bezel · `S0–S2` sound.

A full style code looks like `CAPP1 L5 P8 B7 F6 T5 G1 M2 D2 C0 s0 g60 f0 n0 a0 v0 mN bN S0` (the Signal default) or `CAPP1 L2 P4 B6 F3 T4 G4 M2 D2 C1 s45 g40 f10 n10 a35 v45 mS bG S0` (a Teletext look). Paste it into the Lab to reproduce the look exactly.
