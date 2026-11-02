# Pocket for Windows

Collegiapp's Pocket look (`CAPP1 L6 P9 B8 F3 T6`, P11 at night) carried over to Windows 11. The full redesign covers the desktop, taskbar, Start, flyouts, Settings, lock screen and system parts. It lives on a design canvas. This folder holds the parts you can apply today on stock Windows. Nothing here changes system files or the registry.

| file | what it does |
|---|---|
| `Pocket Cream.theme`, `Pocket Night.theme` | Sets the dot-grid wallpaper, the orange accent and light or dark mode. |
| `wallpapers/pocket-cream.png`, `pocket-night.png` | 3840×2160 desk: the app's 16 px dot grid, with the deck's engraving and speaker grille in the bottom-right corner. |
| `terminal-schemes.json` | Windows Terminal schemes: Pocket Cream, Pocket Night and Pocket LCD. |
| `vscode-settings.jsonc` | Recolours VS Code's built-in Light Modern and Dark Modern themes. |
| `build.py` | Regenerates the wallpapers and `.theme` files (needs Pillow). |

## 1. Theme and wallpaper

Double-click `Pocket Cream.theme` (or `Pocket Night.theme`). Windows switches the wallpaper, sets the accent to Pocket orange and picks light or dark mode. To undo, choose another theme in Settings › Personalization › Themes.

- Leave **Show accent colour on Start and taskbar** and **title bars** off. Pocket keeps orange for the one thing to do first.
- Turn **Transparency effects** off. Solid surfaces keep text readable.
- A `.theme` file points at its wallpaper by full path. If you move this folder, run `python integrations/windows-pocket/build.py` again.
- For an animated desk with an LCD clock, Do first and Now playing, use the Wallpaper Engine version in [`integrations/wallpaper-engine/`](../wallpaper-engine/README.md).

## 2. Fonts (optional)

Pocket uses Space Grotesk for text, Space Mono for labels and code, and Doto for LCD digits. All three are free on Google Fonts. Install the TTFs (right-click › Install) so Terminal and VS Code can use Space Mono. Until then, both fall back to Cascadia Mono.

## 3. Windows Terminal

Open Settings › Open JSON file. Then:

1. Add the three objects from `"schemes"` to your `"schemes"` array.
2. Merge `"profiles"."defaults"` into yours. The `{ "light", "dark" }` colour scheme follows the Windows mode in recent Terminal versions. On older versions, set `"colorScheme": "Pocket Cream"` instead.

Pocket LCD is green-screen and meant for a dedicated profile, like a focus timer or a log tail.

## 4. VS Code

Paste the keys from `vscode-settings.jsonc` into your user `settings.json`. VS Code follows the Windows mode: Light Modern gets Cream, and Dark Modern gets Night.

## 5. The taskbar, Start and flyouts

Stock Windows can't restyle the taskbar, Start or quick settings. Two third-party tools can:

- **Windhawk** restyles the real taskbar, Start, notifications and quick settings. Use [`integrations/windhawk-pocket/`](../windhawk-pocket/README.md) for a graphite deck, an orange Start key, LED dots and a Doto LCD clock. It changes colours, radii and visibility, but not the layout, so the canvas's Do first Start menu stays a design target.
- **Zebar** draws a separate HTML bar instead of the stock taskbar. The pack in [`integrations/zebar/pocket/`](../zebar/pocket/README.md) has the full key deck and LCD tray, plus Collegiapp's next class.

Both hook into Explorer or sit on top of it. Install them only if you're comfortable with that.
