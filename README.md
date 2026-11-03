# Collegiapp

**One always-visible "do first" list for getting through UCSB.** Classes from Google Calendar, assignments from Canvas, work from Gradescope/Ed/Piazza, Shoreline events and tickets, and anything you type: one model, ranked, with focus mode and a desktop "live activity" so the next thing is never out of sight. Rust + Tauri 2: a standalone app for Windows and macOS, with the same shell set up for iPhone and Android. $0 to run.

> Status: **M1 local app.** Your items live in the Rust store and survive restarts. Connect the Canvas calendar feed and your Google Calendar's secret iCal address (Classes › Sources, or the command palette), pick which Google series are classes, and the island, alerts and Do first run on your real schedule. The UI's final design is **Pocket** (`CAPP1 L6 P9 B8 F3 T6 G2 M2 D3 C2 …`): a handheld with LCD countdowns, hardware keys and labelled modules, in Light (P9) and Night (P11). Its layouts run from phone width to wide monitors. The other looks are archived in `archive/looks-2026-10/`. The Rust core (model, quick-add parser, filters, ranking, sync merge, ICS, presence) is tested. The Tauri shell has the island window, tray, global hotkey and real focus sessions. Opened in a plain browser, the UI runs on sample data. Next is M2 (OAuth sources, Shoreline, UCSB APIs). See [docs/SPEC.md](docs/SPEC.md).

## Try the UI in a browser (no Rust needed)

```bash
python tools/serve_ui.py
```

Open http://127.0.0.1:4791/ and try:

| key | does |
|---|---|
| `Q` | quick add, e.g. `pa3 130a fri 11:59p ~4h !!` |
| `1`–`0` | views (Do first, Today, Inbox, Assignments, Exams, Week, Classes, Events, Links, Everything) |
| `Esc` | clear filters |
| `F` / `Shift+F` | focus 25 min on the top item / focus setup |
| `X` `S` `N` | done · snooze · next candidate |
| `Ctrl+K` | command palette |
| `Ctrl+.` or `F9` | **Appearance**: Light / Night, text size, density, screen glass, hints, motion and sound |
| right-click | radial menu |
| hold `Alt` | show every shortcut |

`Ctrl` `+` / `−` changes the text size anywhere. Resize the window to see the layouts: two columns from 1100 px, Do first on top from 761 px, and a one-column phone layout below that.

## Run the desktop app

Requirements: Rust stable, plus WebView2 on Windows (preinstalled on 11) or Xcode command-line tools on macOS.

```bash
cargo test -p collegiapp-core
```

```bash
cargo run -p collegiapp
```

The app embeds `ui/` when it is built, so rebuild after changing the UI.

**iPhone and Android** use the same shell: desktop-only parts (tray, island, taskbar progress, global shortcut, closing distracting apps) are compiled out, and `tauri.ios.conf.json` / `tauri.android.conf.json` set up the single window. Building them needs the Tauri CLI, the rustup targets and Xcode (iOS, on a Mac) or the Android SDK.

On Windows, if the checkout path is long the linker can hit the 260-character path limit. Set a short target dir first, e.g. `$env:CARGO_TARGET_DIR="C:\cgt"` in PowerShell.

Releases are built by GitHub Actions (`.github/workflows/release.yml`) on a `v*` tag: an `.msi`/`.exe` for Windows and a `.dmg` for macOS (unsigned, so on first launch macOS needs right-click → Open).

## Install and updates

From a release: on Windows, run the `-setup.exe` from the [latest release](https://github.com/imanimal/collegiapp/releases/latest); on a Mac (Apple Silicon or Intel, macOS 11+):

```bash
brew install --cask imanimal/tap/collegiapp
```

Without Homebrew:

```bash
curl -fsSL https://raw.githubusercontent.com/imanimal/homebrew-tap/main/install.sh | bash -s collegiapp
```

On a new computer, choose **Sign in** in the top bar: your list, notes, look, calendar links and class picks come down ([SYNC.md](docs/SYNC.md)). Gradescope, WeBWorK and PocketCanvas connect on each computer from **Connect sources**.

For Canvas in Firefox, add [PocketCanvas](https://github.com/imanimal/pocketcanvas): it reads Canvas, WeBWorK and Gradescope with your browser's sign-in (Google included) and sends your classes and work here. Connect it from its settings; Collegiapp asks you to allow it.

To have Claude write your notes from a chat, choose **Add to Claude Desktop** or **Add to Claude Code** under Assistants in **Connect sources** ([integrations/claude-desktop](integrations/claude-desktop)). Each release also carries `Collegiapp.mcpb` for Claude Desktop.

From source, build the installer and install it for your Windows user (Start menu entry and desktop shortcut, no admin prompt):

```bash
python tools/build_installer.py --install
```

The installed app checks GitHub Releases 20 s after it starts and every 6 hours. When there is a newer version it says so once (a toast, a notification, and the tray's *Check for updates* becomes *Update to x.y.z*), and it installs only when you choose *Install and restart*, never during a focus session. You can also check from the tray or the command palette.

Updates are signed. The private key is `~/.tauri/collegiapp.key` and stays out of the repo: back it up, because without it installed copies cannot accept new versions. To ship a version:

1. Bump `version` in `src-tauri/tauri.conf.json` and `Cargo.toml`.
2. Push a `v*` tag. The workflow needs the repo secret `TAURI_SIGNING_PRIVATE_KEY` (the key file's contents) and builds a draft release with `latest.json`.
3. Publish the draft. Installed apps pick it up from `releases/latest/download/latest.json`, so the repo has to be public.

`COLLEGIAPP_UPDATE_URL` points a build at another `latest.json` for testing (release builds require `https`).

## Layout

```
crates/collegiapp-core   pure Rust core (shared with the future iPhone app)
src-tauri/               Tauri 2 desktop shell
ui/                      buildless HTML/CSS/JS front end (the Pocket design)
archive/looks-2026-10/   frozen copy of every earlier look (not shipped)
docs/                    SPEC · DESIGN_RESEARCH · THEME_FORMAT · PLATFORM_PRESENCE
tools/                   serve_ui.py (dev server) · bundle_artifact.py (single-file demo)
```

## Docs

- [SPEC.md](docs/SPEC.md): the full product spec, data model, integrations, UCSB/CS features and roadmap
- [DESIGN_RESEARCH.md](docs/DESIGN_RESEARCH.md): the research behind navigation, interruptions and the CRT look
- [THEME_FORMAT.md](docs/THEME_FORMAT.md): how to write a theme pack
- [THEMES.md](docs/THEMES.md): the small theme file Collegiapp and PocketCanvas share
- [RELEASING.md](docs/RELEASING.md): publishing the apps, the extension and the Homebrew tap
- [PLATFORM_PRESENCE.md](docs/PLATFORM_PRESENCE.md): island, taskbar, menu bar, Zebar and other custom Windows shells

## Cost

$0: local-first storage, sync on Firebase's free Spark plan (M4), and CI and releases on GitHub Actions. No servers.

## License

MIT
