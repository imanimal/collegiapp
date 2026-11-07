# Pocket for Wallpaper Engine

An animated version of the Pocket desk, as a [Wallpaper Engine](https://store.steampowered.com/app/431960/) web wallpaper. It's the same 16 px dot grid as `windows-pocket/wallpapers/`, made live, with the widgets from the Pocket for Windows canvas's desktop. It sits beside the Windhawk Pocket taskbar without repeating anything on it. The Start key, the "Pocket CA-1" engraving and grille, and the tray stay on the taskbar. Nothing is drawn in the strip above it.

| file | what it does |
|---|---|
| `project.json` | The Wallpaper Engine project: a `web` wallpaper with audio processing turned on, and its properties. |
| `index.html`, `wallpaper.css`, `wallpaper.js` | The wallpaper. It has no dependencies, and its tokens and parts come from the canvas (P9 Cream, P11 Night). |
| `feed.js` | Where Collegiapp's presence export lives. It's empty here; `install.py` writes the real address into the installed copy. |
| `install.py` | Copies the wallpaper into Wallpaper Engine's `projects/myprojects/collegiapp-pocket`, writes `feed.js`, adds the fonts and draws `preview.jpg`. |

## Install

```bash
python integrations/wallpaper-engine/install.py
```

The script finds Wallpaper Engine in your Steam libraries. It copies Doto, Space Grotesk and Space Mono from your installed fonts so the wallpaper looks the same offline. It also takes the thumbnail with headless Edge or Chrome. In Wallpaper Engine, open **Installed** and pick **Collegiapp Pocket**. If it isn't listed yet, restart Wallpaper Engine. Run the script again after changing the wallpaper, then pick the wallpaper again to reload it.

## What moves

- **The desk.** Each minute, a ripple runs out from the clock through the dot grid. On the hour, two ripples run. A click on the desktop starts one where you clicked. Under the cursor, the dots swell like a lens and settle about 2 seconds after the mouse stops. Every ripple is ink-coloured. Orange stays for Do first.
- **Collegiapp's window.** On Windows, the app draws its dot grid at the wallpaper's cell size and phase, so where its window sits on the desktop, the dots run on without a seam. It stays opaque, so desktop icons don't show through.
- **The clock.** An LCD shows the date, the time with a blinking colon, the quarter's week and a bar that sweeps once a minute. Turn it off under **Clock** if the taskbar clock is enough.
- **Do first.** This is Collegiapp's top item, the same one as the app's Do first. It shows the course chip in the course's colour, the kind and due time, and "1 of N". The countdown LCD turns amber when the work is close and red when it's late, using the app's urgency rule. While it's amber or red, every fifth minute's ripple is orange and starts from the module. When Collegiapp isn't running, the module shows what you typed in **Do first when Collegiapp isn't running**, with its optional course and due time (`2026-11-02 23:59`). Leave that empty to hide the module. Turn off **Do first from Collegiapp** to keep your tasks off the screen, for example while screen sharing.
- **This week.** The days run Monday to Sunday, with today on an LCD chip and finals days in red. A meter shows the quarter's weeks 1–10 plus finals. Under it, today runs from 7a to 11p with a now line.
- **Now playing.** This module appears while sound is playing. A dot-matrix spectrum follows Wallpaper Engine's audio. The track, artist and progress appear when Wallpaper Engine's media integration is on (Settings › General).

## How Do first gets here

Collegiapp rewrites `presence.js` beside its store every 15 seconds and after every change. On Windows, that's `%APPDATA%\io.github.imanimal.collegiapp\presence.js`, or the `COLLEGIAPP_DATA` folder when set. The wallpaper loads that file from disk every 15 seconds. A page on `file://` can load a script from another folder but can't fetch a file, so the export is JSON wrapped in a `collegiappPresence(…)` call. No port is opened, so websites can't read your tasks. If the export is more than 3 minutes old, the wallpaper treats the app as stopped. The library thumbnail is drawn without your Do first. The format is in `docs/PLATFORM_PRESENCE.md`.

## The quarter

Weeks are counted from **First day of classes**. A quarter that starts mid-week, like Fall on a Thursday, begins in week 0. Weeks 1–10 are classes, and finals run from the Saturday before week 11. Set the next quarter's name and first day when it starts.

## Trying it in a browser

Open `index.html` directly. The query string takes the same properties, for example `index.html?theme=night&layout=center&dofirst=HW%205&dofirstdue=2026-11-02%2023:59`. `?preview` draws the square library thumbnail.
