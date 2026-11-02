# Archived looks (October 2026)

A frozen copy of the UI from before the Pocket revision: all seven renditions and the full Design Lab.
**Nothing here is maintained.** It is kept so a look can be revived later, not to be edited.
The live app is `ui/`, which carries only the chosen design (Pocket, `CAPP1 L6 P9 B8 F3 T6 G2 M0 D3 C2 s4 g0 f0 n0 a0 v0 mN bN S1`).

Tauri bundles `ui/` only (`frontendDist` is `../ui`), so none of this ships.

## Run it

```bash
python tools/serve_ui.py 4792 archive/looks-2026-10/ui
```

Then open http://127.0.0.1:4792/ and press `Ctrl+.` (or `F9`) for the Design Lab. Use a port other than the live
app's 4791 so the two keep separate saved settings. Rendition links: `#signal` `#pocket` `#ledger` `#phosphor`
`#teletext` `#mainframe` `#vector`.

## What is in it

| Axis | IDs |
|---|---|
| Rendition | L1 Phosphor, L2 Teletext, L3 Mainframe, L4 Vector (full-screen CRT) · L5 Signal, L6 Pocket, L7 Ledger (retro-modern) |
| Palette | P1 green, P2 amber, P3 paper white, P4 teletext, P5 DOS blue, P6 vector cyan, P7 Gaucho navy/gold, P8 Slate, P9 Cream, P10 Ivory |
| Buttons | B1 bracket, B2 reverse, B3 keycap, B4 bevel, B5 vector, B6 block, B7 soft, B8 key |
| Frames | F1 single, F2 double, F3 band, F4 ticks, F5 glow, F6 card, F7 module, F8 sheet |
| Type | T1 VT323, T2 IBM Plex Mono, T3 Share Tech + Orbitron, T4 VT323 + Press Start 2P, T5 Inter + VT323, T6 Space Grotesk + Doto, T7 IBM Plex Sans + Plex Mono |
| Guidance | G1 keycaps, G2 Alt tips, G3 minimal, G4 coach |
| Motion · density · curve | M0–M3 · D1–D3 · C0 flat, C1 tube, C2 warped glass |

These IDs are permanent. The live app keeps the ones its design uses and adds new IDs after the highest number
here, so a style code written against this archive always means the same look.

## Reviving a look

Copy the pieces you need back into `ui/` by hand (renderer functions in `js/app.js`, layout rules in
`css/renditions.css` or `css/modern.css`, table entries in `js/lab.js`). The archive's saved-state version is
`v: 2`, and the live app discards it, so nothing leaks between them.
