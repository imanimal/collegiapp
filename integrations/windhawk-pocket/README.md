# Pocket for Windows: Windhawk styles

These styles restyle the real Windows 11 shell in Collegiapp's Pocket look, as close to the design canvas as Windows allows. They cover the taskbar, Start, quick settings, notifications and the calendar. Every stock element stays where Windows puts it and only its look changes. They're settings for three free [Windhawk](https://windhawk.net) mods by m417z, so Explorer keeps working as usual and you can undo everything from Windhawk.

| file | what it does |
|---|---|
| `taskbar.yaml` | **Windows 11 Taskbar Styler.** A graphite deck fills the whole bar, with a hairline on top. Start is the orange labelled key, which sits down while Start is open. Search is a recessed field. A running app is a raised key with its icon centred on the key face, and the focused app is pressed graphite with an even orange rim. A pinned app that isn't running has no key, just its icon on the deck. There's no running bar under the icons. Keys rise 1 px under the pointer and go down 3 px when clicked. Download progress fills the key's face from left to right behind the icon in see-through orange, amber when paused and red on error, and the key keeps its look while it does. Unread badges and overlay icons sit on the icon's top-right corner. The deck carries the engraved "Pocket CA-1" and a speaker grille. The tray and clock are green LCD inlays. Menus are graphite. |
| `start-menu.yaml` | **Windows 11 Start Menu Styler.** Start is a graphite board. The search field has a `›` prompt and an Esc chip. Pinned, All apps and Recommended (shown as Do first) each get a label band with its pixel icon. Pinned apps are keys with icon wells on a card. The All list is flat rows. The footer is a work deck with a Power key. |
| `notification-center.yaml` | **Windows 11 Notification Center Styler.** Quick settings becomes a module with a Quick settings band. Toggles are keys, and a toggle that's on is a dark key with an orange glyph. Sliders are segmented LCD meters, and the footer is a work deck with an LCD battery. Media controls are keys, with an orange play on a dark key. Notifications get a band and cards. The calendar gets a band, with today shown as an LCD chip. Focus sessions, toasts and taskbar jump lists match. |
| `build_assets.py` | Renders the images in `assets/`: the Start key (normal, hover, down), the engraving and grille, the band backgrounds with their pixel icons, and small key icons. Windhawk can't add text to a stock button, so the labelled parts come in as images. |
| `apply.ps1` | Writes the YAML files into Windhawk's settings and points their `Assets` constant at `assets/`. |

Every key in all three files pushes down when clicked: the lip shrinks from 4 to 1 screen pixel and the face, with its icon or label, drops 3 px. Windhawk switches the style the moment a key's state changes, so the press is instant rather than animated.

The colours are Night (P11), which suits Windows in dark mode. The Cream values are listed under **Cream** below.

## Install

1. Install Windhawk from <https://windhawk.net>.
2. In Windhawk, open **Explore** and install **Windows 11 Taskbar Styler**, **Windows 11 Start Menu Styler** and **Windows 11 Notification Center Styler**.
3. Install the fonts from `integrations/windows-pocket` (section 2 of its README): Space Grotesk, Space Mono and Doto.
4. If your display scale isn't 125%, re-render the images at your scale (Settings › System › Display › Scale). This needs Python with Pillow:

   ```powershell
   python integrations\windhawk-pocket\build_assets.py --scale 1.5
   ```

5. Apply the styles from an elevated PowerShell, because Windhawk keeps its settings under `HKLM`:

   ```powershell
   powershell -ExecutionPolicy Bypass -File integrations\windhawk-pocket\apply.ps1
   ```

   Pass names to apply only some of them, for example `apply.ps1 taskbar start-menu`. A mod that isn't installed is skipped. To paste a file by hand instead (the mod's **Settings** tab › **Textual mode**), first change its `Assets=` line to the `file:///` address of your `assets` folder.
6. Restart the shell once so it picks up the fonts. Sign out and back in, or end **Windows Explorer**, **Start** (`StartMenuExperienceHost`) and **ShellExperienceHost** in Task Manager and let them relaunch.

After that, changes to the YAML files appear a second or two after you run `apply.ps1`, without a restart.

## Windows settings that complete the look

The styles don't change your Windows settings. These ones bring the shell closer to the canvas:

- **Taskbar alignment: Left** (Settings › Personalization › Taskbar › Taskbar behaviours) puts the Start key at the left end of the deck, as on the canvas.
- **Show recommended files in Start…** (Settings › Personalization › Start) turns on the Recommended list, which these styles show as the orange Do first module.
- **Folders** (Settings › Personalization › Start › Folders) adds Settings, File Explorer and other keys to the work deck beside Power.

## Undo

In Windhawk, open a mod and click **Disable** to turn it off, or **Remove** to uninstall it. Windows goes back to its stock look straight away.

## Cream

For Windows in light mode, render the Cream images with `build_assets.py --cream`, then change the constants at the top of each file to these values:

| constant | Night | Cream |
|---|---|---|
| `Deck` (taskbar) | `#2E2D2A` | `#EDEAE3` |
| `Field` (taskbar), `Surface` | `#262522` | `#F6F3EC` |
| `Bg` | `#1A1917` | `#E6E2D8` |
| `Bg2` | `#2A2926` | `#FBF9F4` |
| `Surface2` | `#302E2A` | `#EBE7DD` |
| `Line` | `#3F3C36` | `#D3CCBD` |
| `Text` | `#F4EFE5` | `#1B1915` |
| `Text2` | `#D0C9BA` | `#4A453C` |
| `Text3` | `#A39C8D` | `#6A645A` |
| `Accent` | `#FF6A2B` | `#FF5B1F` |
| `Chrome` | `#0F0E0D` | `#2A2722` |
| `ChromeFg` | `#ECE6DA` | `#F6F3EC` |
| `Lcd` | `#45B3A1` | `#B1BD93` |
| `LcdInk` | `#04211C` | `#1F2A17` |
| `KeyBrush` stops | `#4D4B48` → `#302E2A` | `#EEEAE2` → `#EBE7DD` |
| `ChromeBrush` stops | `#2C2B2A` → `#0F0E0D` | `#44413C` → `#2A2722` |
| `LcdBrush` stops | `#67C1B2` → `#45B3A1` | `#BFC9A6` → `#B1BD93` |

Windows colours some text and icons by its own mode. Use Cream with light mode and Night with dark mode, or that text will be hard to read. `Pocket Cream.theme` and `Pocket Night.theme` in `integrations/windows-pocket` set the mode for you.

## What Windhawk can't do

- **Live data.** Start's Do first module is Windows' Recommended list in Pocket clothing. It can't show Collegiapp's tasks, because the styles are static. While Collegiapp runs, its own Pocket Start opens instead on the Win key, the Start key and the search box, with live Do first (`docs/PLATFORM_PRESENCE.md`); these styles cover Windows' Start the rest of the time. The Start key's down look follows Windows' Start, so it stays up while Pocket Start is open.
- **Layout.** Windows decides what goes where. Start keeps its pinned grid and inline All list, quick settings keeps its pages of toggles, and the calendar keeps its month grid. The styles change size, spacing, colour and shape, and can add static pieces such as bands and labels, but they can't move elements between regions.
- **Taskbar height and icon size.** These need a separate mod, **Taskbar height and icon size**.
- **Accent colour and transparency.** **Show accent colour on Start and taskbar** and **Transparency effects** don't matter here, because these styles paint solid colours over both.

## Notes

- Windhawk stores each list as numbered values, for example `controlStyles[3].styles[1]` under `HKLM\SOFTWARE\Windhawk\Engine\Mods\<mod>\Settings`. `apply.ps1` clears the old values before writing, so removing a style from a YAML file removes it from the mod as well. It then changes the mod's `SettingsChangeTime`, which makes Windhawk reload the settings.
- The images are drawn in device pixels, so the pixel icons stay crisp. They're sized in DIPs in the YAML (for example a 38.4 px band is 48 device pixels at 125%), so they only line up exactly at the scale they were rendered for.
- Tested on Windows 11 build 26200 with Windhawk 1.7.3, Taskbar Styler 1.10, and Start Menu Styler and Notification Center Styler 1.8. Windows updates sometimes rename the elements these styles target. If something stops changing, check the mod's built-in themes for the current names.
