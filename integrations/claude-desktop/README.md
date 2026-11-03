# Collegiapp for Claude

An MCP server that lets Claude Desktop, Claude Code or any MCP client write your Collegiapp notes from a chat, so you don't have to open the app. Ask Claude to "save this to my notes", "add these steps to my 130A heaps note" or "turn this plan into tasks", in a plain chat or a project, and it lands in Collegiapp. The app only has to be running, and the tray is enough. If it isn't running, the first call starts it.

| file | what it does |
|---|---|
| `server.js` | The server: plain Node, no dependencies, MCP over stdio. It talks to the app's bridge on 127.0.0.1:4747 (`src-tauri/src/bridge.rs`). |
| `install.py` | Adds the server to Claude Desktop's config and to Claude Code (user scope). `--remove` takes it out. |
| `manifest.json` | The same server as a Claude Desktop extension (MCPB), for packing with `npx @anthropic-ai/mcpb pack integrations/claude-desktop`. |
| `test.js` | Runs the server against a fake bridge. |

## Install

```bash
python integrations/claude-desktop/install.py
```

Then quit Claude Desktop from its tray or menu bar icon and open it again. You need Node 18 or later on your PATH. The server runs from this folder, so run the script again if you move the repo.

The first time Claude uses a tool, Collegiapp comes to the front and asks you to **Connect an assistant**. Check the code against the one Claude shows in the chat and click **Allow**. The token is kept in `~/.collegiapp/assistant.json`, one for every Claude on this computer. **Connect sources** in the app lists it under Assistants, where **Disconnect** stops it at once.

## Tools

| tool | what it does |
|---|---|
| `search_notes` | notes matching words, `#tag` or a class, pinned first, then the newest edit; each with its id, class, tags, checklist count and a preview |
| `read_note` | one note's whole text in Collegiapp Markdown |
| `create_note` | a new note, with a class, tags or a pin if you like |
| `append_to_note` | adds to the end of a note; nothing already there changes |
| `update_note` | replaces the text, or retitles, files, tags, pins or archives a note |
| `list_classes` | your classes, with the codes and aliases `class` takes |
| `add_tasks` | tasks in the quick-add grammar (`pa3 130a fri 11:59p ~4h !!`) |

The server tells Claude the rules of Collegiapp Markdown (`docs/NOTES.md`), the same ones Ask AI gets. Claude also reads your notes tagged `#ai` (your standing rules for AI-written notes) before it writes one.

## Safety

- **Only this computer.** The bridge listens on 127.0.0.1, and it takes nothing without a token you allowed. Websites can't reach it.
- **Nothing is lost.** When Claude replaces a note's text, the old version goes to the trash (Mod+K › Trash), marked "Replaced by Claude". Appending keeps everything there.
- **No deleting.** Claude can archive a note but can't delete one.
- **An open note follows along.** If the note Claude changes is open in the editor, the editor takes the new text, so closing it doesn't put the old text back.

Drawings and pasted pictures are tens of kilobytes of base64, so Claude sees them as stand-ins (`![Drawing|center 40%](drawing:1)`), as Ask AI does. The app puts the real ones back in what Claude writes.

## Claude Desktop on Windows

Claude Desktop from the Microsoft Store runs its servers inside its package, which redirects their AppData. That's why the token lives in your home folder and why the server starts Collegiapp through Explorer: a direct start would run a private copy of the app with its own data. The Store build also keeps its config in `%LOCALAPPDATA%\Claude-Data\claude_<id>\claude_desktop_config.json`, which `install.py` finds.

## Testing

```bash
node integrations/claude-desktop/test.js
```

`COLLEGIAPP_BRIDGE` (a base address) and `COLLEGIAPP_TOKEN_FILE` point the server at another bridge and token file.
