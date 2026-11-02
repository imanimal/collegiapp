# Pocket bar for Zebar

The taskbar from the Pocket for Windows design (the Desktop board) as a working bar. It runs on [Zebar](https://github.com/glzr-io/zebar), a free third-party app that draws status bars from HTML. Cream by day and Night after dark, following Windows' light or dark mode.

## What's on it

From left to right:

| part | what it does |
|---|---|
| **Start** (orange key) | Opens Start. It sends Ctrl+Esc through PowerShell, so it takes about half a second. |
| **Search** | Also opens Start; type there to search. |
| **Program keys** | Your pinned apps: File explorer, Browser, Terminal, Code and Collegiapp. An LED shows while an app runs (checked with `tasklist` every 10 s, without a window). In the `bar-glazewm` widget these are your GlazeWM workspaces instead: pressed is the focused one, an LED marks one with windows. |
| **Now playing** | The current track in an LCD, with a play/pause key. It takes the engraving's place while something plays. |
| **Hidden icons** (chevron) | Opens the real tray icons inside the deck. Left and right clicks go to the app. |
| **Collegiapp LCD** | The next class and how much is due today, from Collegiapp's presence endpoint. Amber within 15 minutes of a start. Hidden until that endpoint exists (planned for M5). |
| **Tray LCD** | Network, volume and battery. Click for quick settings; scroll to change the volume. Amber at 20% battery, red at 10%. |
| **Clock LCD and bell** | Open notifications and the calendar. |

## Install

1. Install Zebar 3.3 or newer from its [releases page](https://github.com/glzr-io/zebar/releases).
2. Copy this folder into Zebar's config folder. Zebar only finds packs one level deep, so it must end up at `%USERPROFILE%\.glzr\zebar\pocket\zpack.json`:

   ```powershell
   Copy-Item -Recurse integrations\zebar\pocket "$env:USERPROFILE\.glzr\zebar\pocket"
   ```

3. Right-click Zebar's tray icon, open **Widget packs › pocket › bar**, and start it with a preset:
   - `top` runs beside the stock taskbar. Try this first; nothing else changes.
   - `bottom` takes the taskbar's place. Also turn on Settings › Personalization › Taskbar › Taskbar behaviors › **Automatically hide the taskbar**, or the two overlap. The stock taskbar still slides up when the pointer touches the bottom edge.
4. In the same menu, turn on **Run on startup**.

Step 3 also works from the command line; this starts Zebar if it isn't running:

```powershell
& "C:\Program Files\glzr.io\Zebar\zebar.exe" start-widget-preset --pack pocket --widget-name bar --preset top
```

Zebar runs the copy in `.glzr\zebar\pocket`, so copy the folder again after editing it here.

Use `bar-glazewm` instead of `bar` if you run GlazeWM. Both widgets dock to the screen edge, so maximised windows stop above or below the bar. To stop the bar, use the same tray menu or quit Zebar.

The fonts (Space Grotesk, Space Mono and Doto) load from Google Fonts and Zebar caches them for a week. If you installed them for the Windows kit, those copies are used first. Without either, the bar falls back to Segoe UI and Cascadia Mono.

## Customise

Everything lives at the top of `bar.js`:

- `THEME`: `"auto"`, `"cream"` or `"night"`.
- `PINS`: each key's `label`, `icon` (any name in `ICONS`), `open` and `exe`. `open` is handed to `explorer.exe`, so it can be a `shell:AppsFolder\<AppID>` target, a URL or a path. Run `Get-StartApps` in PowerShell to list AppIDs. Collegiapp's is `io.github.imanimal.collegiapp` when it's installed with its installer. `exe` lists the process names that light the LED.
- `ACTIONS`: what Start, the tray LCD, the clock and the bell run.

Zebar only runs commands that `zpack.json` allows under `privileges.shellCommands`, and it checks them strictly:

- `program` must equal the string in `bar.js` exactly.
- `argsRegex` is searched in the arguments joined by spaces. An empty regex allows no arguments at all.

The shipped list allows these commands, and nothing else:
- `explorer`, either with no arguments or opening a `shell:AppsFolder\` target, an `ms-settings:` or `ms-actioncenter:` link, a web address or a drive path;
- the one PowerShell command that opens Start;
- `tasklist /FO CSV /NH`.

If you add a pin that opens something else, add a matching pattern there.

The bar's height is set by the presets in `zpack.json`: the window is 74 px and the deck floats 6 px inside it.

## Preview without Zebar

Outside Zebar the bar runs on the design canvas's sample values. Serve the folder and open it:

```bash
python -m http.server 4793 --bind 127.0.0.1 --directory integrations/zebar/pocket
```

Then open `http://127.0.0.1:4793/bar.html?desk` in a short browser window, since the deck fills the window's height. Add `&theme=night` for Night, or open `bar-glazewm.html` to see workspace keys.

## Collegiapp presence

The bar polls `http://127.0.0.1:4747/presence` every 30 s, with a 2 s timeout. The response format is described in `docs/PLATFORM_PRESENCE.md`. The widget is a different origin, so the endpoint must send `Access-Control-Allow-Origin: *`. The bar reads these fields: `short`, `label`, `detail`, `starts_in_secs`, `progress`, `focus.active`, `due_today` and `do_first`.

## Limits

- Zebar only lists open windows through GlazeWM. Without it, the program keys launch apps and show whether they run, but they can't switch between windows. File explorer always opens a new window.
- This hasn't run inside Zebar yet. It's written against Zebar 3.3.1's source and its starter pack, and checked in a browser on the sample values.
- Windows doesn't document the `ms-actioncenter:` links used for quick settings and notifications. If one does nothing on your build, change it in `ACTIONS`.
