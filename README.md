# Collegiapp

Everything for college, everywhere, all in one app.

Pulls in your classes from Google Calendar and your work from Canvas, Gradescope, WeBWorK, Ed and Piazza. You don't have to type anything in or keep it organized yourself.

It also works with AI. Connect Claude and you can say "add my CS midterm on Friday" or "write up today's lecture notes", and it lands in the app.

Runs on Windows and macOS. Your list stays on your computer and syncs between devices when you sign in.

## Install

**Windows:** download the `-setup.exe` from the [latest release](https://github.com/imanimal/collegiapp/releases/latest).

**Mac:**

```bash
brew install --cask imanimal/tap/collegiapp
```

The app updates itself. It asks before installing and never interrupts a focus session.

## Get set up

1. Open **Connect sources** and add Canvas, Google Calendar and Gradescope.
2. To use Claude, choose **Add to Claude Desktop** or **Add to Claude Code** under Assistants.
3. On another computer, choose **Sign in** and your list comes with you.

Using Firefox? [PocketCanvas](https://github.com/imanimal/pocketcanvas) sends your Canvas classes and assignments straight to Collegiapp.

## Shortcuts

| key | does |
|---|---|
| `Q` | quick add, e.g. `pa3 130a fri 11:59p` |
| `F` | focus on the top item for 25 minutes |
| `X` / `S` | done / snooze |
| `Ctrl+K` | search and commands |
| hold `Alt` | show every shortcut |

## Build from source

```bash
cargo run -p collegiapp
```

Needs Rust. To try just the interface with sample data, run `python tools/serve_ui.py` and open http://127.0.0.1:4791/. Releases are covered in [docs/RELEASING.md](docs/RELEASING.md), and the full design in [docs/SPEC.md](docs/SPEC.md).

## License

MIT
