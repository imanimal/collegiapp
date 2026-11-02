# "Live activity" on the desktop

Goal: the next class and the running focus timer stay visible **outside** the app window, on stock Windows 11, on a customised Windows shell, and on macOS.

## What ships in the app (works everywhere, no setup)

| | Windows 11 | macOS |
|---|---|---|
| **Island** (`ui/island.html`, window label `island`) | 380×64 frameless, transparent, always-on-top pill; drag to move; double-click opens the app; toggled from the tray or `toggle_island` | same |
| **App icon progress** | taskbar button progress bar (`set_progress_bar`) fills through the class or focus session | dock icon progress |
| **App icon badge** | overlay icon (green dot) while something is on or starting within 15 min | dock badge text, e.g. `130A 12m` |
| **Text** | tray tooltip on hover (Windows can't draw text in the tray) | **menu-bar title** next to the tray icon: `130A 12m` / `130A 45m left` |
| **Notifications** | Windows toasts | Notification Center |

All of it is driven by one `presence` value from `crates/collegiapp-core/src/presence.rs`, recomputed every 15 s and on every change, then emitted to the UI as the `presence` event.

## Windows: going further with a custom shell (optional)

Stock Windows 11 doesn't let apps put live text in the taskbar. If you want a real status bar, these are the options, best first:

| option | what it is | fit for Collegiapp |
|---|---|---|
| **[Zebar](https://github.com/glzr-io/zebar)** (recommended) | Customisable status bars made of HTML/JS widgets; built on Tauri. Config lives in `~/.glzr/zebar/`. Pairs with GlazeWM but runs standalone. | Best: a widget is just HTML that fetches our presence JSON. Shipped: `integrations/zebar/pocket/`, the Pocket taskbar, whose Collegiapp LCD polls `http://127.0.0.1:4747/presence` every 30 s. |
| [YASB](https://github.com/amnweb/yasb) | "Yet Another Status Bar", Python + Qt, YAML/CSS config, has a generic HTTP/JSON widget | Good: point its custom widget at the same endpoint. |
| [Windhawk](https://windhawk.net/) | Mod platform for Explorer and the taskbar (e.g. taskbar styler, labels) | Restyles the stock taskbar; can't easily show our live text. Cosmetic only. |
| [Rainmeter](https://www.rainmeter.net/) | Desktop skins with a WebParser measure | Works (parse the JSON), but skins are desktop-level, not a bar. |
| Windows Widgets Board | Adaptive Cards from a packaged widget provider | Requires shipping as MSIX with a COM widget provider. Not worth it before v1. |

**Support both.** The island, taskbar progress and overlay always run. If a custom bar is installed, the widget simply adds a text readout, so nothing depends on it.

### Pocket Start (Windows' Start, replaced while Collegiapp runs)

`ui/start.html` (window label `start`, `src-tauri/src/start.rs`) is the Start board of the Pocket for Windows canvas with live data: a `›` prompt that opens apps and Settings pages or adds a task (`+ hw7 fri 5pm`), your Windows pins, the Do first list from the core's ranking, and a work deck with Settings, Files, Lock and Power (sleep, restart, shut down, sign out). It opens above the taskbar's Start key, left or centered like the taskbar, and hides when it loses focus.

- **Win key.** A low-level keyboard hook (`WH_KEYBOARD_LL`) holds every Win press back from Windows until it knows what it is. Released with nothing in between, it toggles Pocket Start, and since Windows never saw it, neither Windows' Start nor its Search opens, however fast the taps come. When another key goes down first, Win is sent on just ahead of that key, so Win+E, Win+Shift+S, Win+1 and the rest work as always; Win+L locks directly because Windows ignores a sent Win+L. Ctrl, Shift or Alt held before Win passes the whole combo through untouched. (An earlier version let Windows see the press and typed an unassigned key, 0xE8, before the release; Windows still opened its Start or Search on a second tap.) Off from the tray (**Pocket Start replaces Windows' Start**, which also turns off the Start-key hook below), from Pocket Start's Power menu (**Win key opens Pocket Start**) or from the app's search (**Use Windows' Start**); all three are the one setting, `start_win_key`. Limits: Windows doesn't send keys to a normal app's hook while an elevated window (Task Manager, an admin terminal) is in front, so Win opens Windows' Start there; during Lockdown focus the Win key opens neither.
- **Back and forward.** The mouse's side buttons, Alt+← → and a keyboard's Browser keys: back steps out like Esc (an open menu, then the search, then All apps) but never closes Start; forward retraces those steps until you type or pick a view.
- **Fallback.** Ctrl+Alt+Space toggles it (Ctrl+Option+Cmd+Space on macOS), and the tray has **Pocket Start**.
- **Apps.** `Get-StartApps` (every Start app) and `Export-StartLayout` (your pins; no admin needed on Windows 11) run once in a hidden PowerShell at launch and again after ten minutes. Apps open through Explorer (`shell:AppsFolder\<AppID>`), so they start like they do from Windows' Start. Pinning in Pocket Start saves your own list in the store; **Use Windows pins** goes back. Icons are Windows' own: the `appicon:` scheme (lib.rs) asks the shell for each app's Apps-folder icon, which is its Start shortcut's own icon when the shortcut sets one (also for apps whose AppID is their program's path) (`IShellItemImageFactory`, 64 px PNG, read once per run on one COM thread) and answers only for apps Start lists; an app without one keeps its pixel glyph.
- **Right-click.** An app's menu (`start/menu.rs`, also the menu key or Shift+F10) opens at once and fills in from `start_app_info`. Windows' own commands come from the app's Apps-folder context menu, run by canonical verb so they behave as in Windows' Start: **Open new window**, **Run as administrator** (also Ctrl+Shift+Enter), **Open file location**, **Unpin from taskbar** and **Uninstall…** (asked again in the menu first). Pocket Start adds **Pin/Unpin**, **Move left/right** for pins, **Hide from All apps** (`settings.start_hidden`; "N hidden" in All apps shows them), **Open program folder** (the .exe selected), **Open terminal here** (Windows Terminal, else PowerShell), **Copy path**, **Properties** (the program's), **Close during focus** (adds or removes the .exe on the focus blocklist, writing the built-in list out first), **Start at sign-in** (a shortcut in the Startup folder; an app that already starts from a Run entry opens Startup apps settings instead), **Add to desktop**, **Restart** and **End task** while it runs (processes of its program, or a same-named one under its folder for Squirrel apps), and **App settings** for Store apps (`ms-settings:appsfeatures-app?<family>`). Do first tasks get **Open in Collegiapp**, **Mark done** and **Copy title**.
- **The taskbar's Start key and search box.** A low-level mouse hook (`WH_MOUSE_LL`) takes a left click on either: the Start key toggles Pocket Start and the search box opens it with its prompt ready. Both are XAML buttons inside `Shell_TrayWnd` (or `Shell_SecondaryTrayWnd` on other monitors) with no window handle of their own, so the hook asks UI Automation at click time (`AutomationId` `StartButton` and `SearchButton`, one cached round trip of a few ms) instead of keeping a rectangle that a centered taskbar would move. Only presses inside a taskbar window wait for that answer, on a separate thread and for at most 120 ms; past that, or when Collegiapp isn't running, the click opens Windows' Start or Search as usual. Right-click (the Win+X menu) is untouched. The Windhawk Start key's "down" look follows Windows' Start, so it stays up while Pocket Start is open.
- **Look.** P11 Night when Windows is in dark mode (the taskbar's mode, `SystemUsesLightTheme`), P9 Cream in light mode, with the palettes from the Appearance drawer.

### Presence export (`presence.js`, shipped)

Every presence refresh (the 15 s tick and every change) rewrites `presence.js` beside the store (`%APPDATA%\io.github.imanimal.collegiapp\presence.js`, or `COLLEGIAPP_DATA`). It uses a temp file and a rename, so a reader never sees half a file. The file is the endpoint's JSON below wrapped in a call, `window.collegiappPresence && window.collegiappPresence({…});`, because a `file://` page can load a script from another folder but can't fetch a file. The JSON adds the whole Do first item, `do_first_item: { title, kind, course, color, due, est_minutes }`, plus `do_first_count` and `updated_at`. `color` is the course's palette index (1–6, the UI's `--k1`…`--k6`). Do first is the `do_first` command's ranking. A reader should treat an `updated_at` older than a few minutes as "the app isn't running". The Wallpaper Engine wallpaper (`integrations/wallpaper-engine/`) reads it. No port is opened, so websites can't read it. `presence.rs` builds it in `export_js`, which has tests.

### Presence endpoint (planned, M5)

`GET http://127.0.0.1:4747/presence` (loopback only, read-only, no auth) returns the JSON below. It must send `Access-Control-Allow-Origin: *`, because the Zebar widget fetches it from another origin.

```json
{
  "label": "CMPSC 130A Lecture", "short": "130A 12m", "detail": "in 12m · Phelp 1160",
  "kind": "class", "starts_at": "2026-11-03T17:30:00Z", "ends_at": "2026-11-03T18:45:00Z",
  "starts_in_secs": 720, "progress": null,
  "focus": { "active": false },
  "due_today": 3, "do_first": "PA3: Heaps & hash tables"
}
```

## macOS

- The menu-bar title (tray `set_title`) is the macOS equivalent of a live activity on the desktop.
- macOS 26 (Tahoe) can show an iPhone's Live Activities in the Mac menu bar through iPhone Mirroring/Continuity. Once the iPhone app (M6) starts a Live Activity for a class, a Mac signed in to the same Apple account may show it too. Verify on your machines before relying on it.

## iPhone (M6)

ActivityKit Live Activity + Dynamic Island for the current class/focus session, started locally from the synced schedule (no push server needed for local start and end; updates while backgrounded are limited without push).
