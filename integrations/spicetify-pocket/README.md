# Pocket for Spotify

Collegiapp's Pocket look (`CAPP1 L6 P9 B8 F3 T6`, P11 at night) as a [Spicetify](https://spicetify.app) theme. It follows [`docs/UIKit/README.md`](../../docs/UIKit/README.md): solid surfaces and Space Grotesk for everything you read, and the handheld character only where the kit puts it. Measured and tuned in the running app (Spotify 1.2.79, Spicetify 2.42) on Home, Liked Songs, an artist page, the library open and collapsed, the queue and a context menu.

| file | what it does |
|---|---|
| `Pocket/color.ini` | Two schemes: `night` (P11, the default) and `cream` (P9). Standard Spicetify keys carry the surfaces; extra keys carry the rest of the Pocket tokens (`bg`, `line`, `chrome-*`, `disp-*`, `lip` ...). |
| `Pocket/user.css` | Everything visual. Maps Spotify's Encore colour roles onto Pocket, then styles the modules, keys, list rows, cards, player bar and menus. |
| `Pocket/theme.js` | Tags the page `data-pk-scheme="light"` or `"dark"` from the scheme, so Cream gets its lighter shadows. Optional: without it the theme assumes Night. |
| `install.ps1` | Copies `Pocket/` into Spicetify's `Themes` folder, selects it and applies it. |

## Install

```powershell
.\integrations\spicetify-pocket\install.ps1
```

Add `-Scheme cream` for the light palette, or `-NoApply` to copy and select the theme without patching Spotify. Then quit Spotify from the tray and open it again. By hand: copy `Pocket/` into `%APPDATA%\spicetify\Themes\`, then:

```powershell
spicetify config current_theme Pocket color_scheme night inject_css 1 replace_colors 1 inject_theme_js 1
spicetify apply
```

Switch palette later with `spicetify config color_scheme cream` and `spicetify apply` (Marketplace's scheme picker works too). Undo with `spicetify config current_theme marketplace` and `spicetify apply`, or `spicetify restore` to remove Spicetify's patch entirely.

## What maps to what

| Pocket part | in Spotify |
|---|---|
| Device body, 16 px dot grid | The page behind the three modules, and behind the top row and the player bar |
| Module (card, ring, 2 px lip) | Your Library, the main page, the right sidebar, and the player bar (80 px tall here) |
| F3 label band | The **Your Library** header: a graphite 48 px row with the uppercase label, an orange icon and ghost keys. Collapsed, the two keys stack, centred |
| B8 keys | The green buttons and round play buttons become orange keys, Spotify's white buttons dark keys, and secondary buttons such as Follow plastic keys. Keys travel 3 px when pressed and light up on hover instead of growing |
| The one orange key | Play. Cards and page headers use the same key, and the player bar's play/pause is the main one |
| Program keys (`.nv`) | Home and custom-app links in the top row. The page you are on is the pressed key: graphite, orange icon |
| Pressed program key | A selected filter chip is graphite too |
| LCD inlay | The elapsed and total time beside the seek bar: Doto digits, dark on the reflective panel (Night: backlit teal), centred on the seek bar's line |
| Recessed field | The search field, with field corners |
| `.sel` row | A selected track or library row: 16 % accent wash and a 3 px accent edge |
| Corners | Spotify's corner tokens on the kit's scale: covers 6 px, rows, cards and keys 10 px, modules 14 px |

Header washes from the cover art are removed: Pocket draws nothing over text. Orange is only ever a fill, an edge or an icon, never text, because it fails 4.5:1 on Cream.

## Fonts

`user.css` loads Space Grotesk and Doto from Google Fonts. Offline, it falls back to Segoe UI for text and Cascadia Mono for the digits. To pin them, install both TTFs from Google Fonts.

## Alignment

Spotify sizes its parts with hashed classes, so `user.css` changes colour, corners and shadows and leaves the boxes alone. It resizes only what it fully owns: the deck (80 px, everything centred on its middle line), the LCDs (22 px, on the seek bar's centre line) and the top row's program keys. A key's lip counts toward its height: next to the 48 px search field, a program key has a 46 px face and a 2 px lip, so both share their top and bottom edges. Each sidebar's resize handle is left bare, and the library isn't clipped, because its handle sits just outside its box. On Home's shortcut tiles the play key floats over the end of the title, so titles stop 16 px short of it, even while it's hidden, and long names wrap instead of running under it. The key's ring and lip sit on its face, which Spotify fades in on hover, so nothing is left behind at rest.

To tune it, run `spicetify watch -s`: Spotify reloads every time you save `user.css` in the Themes folder. Copy your changes back to `Pocket/` here when you're done.

## Limits

- **Icons stay Spotify's.** The kit draws 9×9 pixel icons; Spotify's are SVG components with no stable hook, so swapping them would break on every update. The colours follow the theme.
- **Motion isn't touched.** Spotify's own transitions run as normal; the app's motion (M2 since 2026-11-01) stays in the app.
- **Only stable selectors.** The CSS uses Spotify's `main-*`, `Root__*` and `view-*` classes, `data-testid` and `data-encore-id`, never the hashed ones. When an update renames one, that part falls back to Spotify's look, and the colours still hold because they come from the Encore tokens. Run `spicetify apply` after Spotify updates.
- **The right sidebar and Home** use the module and token rules only, with no band of their own. Their inner layouts use hashed classes, so they follow the colours but not the shapes. Home's shortcut tiles are the exception, since they carry named `view-homeShortcutsGrid-*` classes.

## Changing a colour

Edit `Pocket/color.ini` first, then `docs/UIKit/README.md` (the tables in section 2) and the other copies listed in its section 11. `user.css` reads `--pk-*` aliases of the same values. Apart from the Night fallbacks in its token block, don't put hex in it.
