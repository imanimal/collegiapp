# Collegiapp for Claude

An MCP server that lets Claude Desktop, Claude Code or any MCP client write your Collegiapp notes from a chat, so you don't have to open the app. Ask Claude to "save this to my notes", "add these steps to my 130A heaps note" or "turn this plan into tasks", in a plain chat or a project, and it lands in Collegiapp. The app only has to be running, and the tray is enough. If it isn't running, the first call starts it.

| file | what it does |
|---|---|
| `server.js` | The server: plain Node, no dependencies, MCP over stdio. It talks to the app's bridge on 127.0.0.1:4747 (`src-tauri/src/bridge.rs`). |
| `manifest.json` | Makes the server a Claude Desktop extension (MCPB). The app and `tools/build_mcpb.py` stamp it with the app's version when they pack it, and the server reads its version from it. |
| `install.py` | For working on the server: adds this folder's copy to Claude Desktop's config and to Claude Code (user scope). `--remove` takes it out. |
| `test.js` | Runs the server against a fake bridge. |

## Install

The app carries the server, so you don't need this repo. In Collegiapp, open **Connect sources** (or search for "Claude") and find **Assistants**:

| key | what happens |
|---|---|
| **Add to Claude Desktop** | `Collegiapp.mcpb` goes to Downloads and opens. Claude Desktop shows its Install dialog; click **Install**. It runs the server on its own Node, so you don't need Node. If nothing opens, drag the file into Claude Desktop's Settings › Extensions. |
| **Add to Claude Code** | The server goes to `~/.collegiapp/server.js`, and the app runs `claude mcp add --scope user collegiapp` for every project. This needs Node 18 or later. Without Node or Claude Code, the command goes on your clipboard instead. |

Each release also has `Collegiapp.mcpb` for Claude Desktop (`python tools/build_mcpb.py` packs it). Adding Collegiapp again after an update gives Claude the newer server.

To work on the server itself, use the repo's copy instead, and not both at once, or Claude sees every tool twice:

```bash
python integrations/claude-desktop/install.py
```

Then quit Claude Desktop from its tray or menu bar icon and open it again. This needs Node on your PATH, and the server runs from this folder, so run the script again if you move the repo.

The first time Claude uses a tool, Collegiapp comes to the front and asks you to **Connect an assistant**. Check the code against the one Claude shows in the chat and click **Allow**. The token is kept in `~/.collegiapp/assistant.json`, one for every Claude on this computer. **Connect sources** in the app lists it under Assistants, where **Disconnect** stops it at once.

## Tools

| tool | what it does |
|---|---|
| `search_notes` | notes matching words, `#tag` or a class, pinned first, then the newest edit; each with its id, class, tags, checklist count and a preview |
| `read_note` | one note's whole text in Collegiapp Markdown |
| `create_note` | a new note, with a class, tags or a pin if you like |
| `append_to_note` | adds to the end of a note; nothing already there changes |
| `update_note` | replaces the text, or retitles, files, tags, pins or archives a note |
| `search_items` | everything on your list but notes (tasks, assignments, exams, classes, calendar events): words plus `kind:event`, `due:today`, `due<=week`, `course:130a`, `status:todo` |
| `read_item` | one item in full, with its notes and links |
| `add_item` | an event or task with exact times (`due` is the start of an event, `end` its finish) |
| `update_item` | reschedules, renames, files, tags, finishes (`status: done`) or deletes an item |
| `list_classes` | your classes, with the codes and aliases `class` takes |
| `add_tasks` | tasks in the quick-add grammar (`pa3 130a fri 11:59p ~4h !!`) |

The server tells Claude the rules of Collegiapp Markdown (`docs/NOTES.md`), the same ones Ask AI gets. Claude also reads your notes tagged `#ai` (your standing rules for AI-written notes) before it writes one.

## Safety

- **Only this computer.** The bridge listens on 127.0.0.1, and it takes nothing without a token you allowed. Websites can't reach it.
- **Nothing is lost.** When Claude replaces a note's text, changes an item or deletes one, the old version goes to the trash (Mod+K › Trash), marked "Replaced by Claude", "Changed by Claude" or "Deleted by Claude". Appending keeps everything there.
- **No deleting.** Claude can archive a note but can't delete one.
- **An open note follows along.** If the note Claude changes is open in the editor, the editor takes the new text, so closing it doesn't put the old text back.

Drawings and pasted pictures are tens of kilobytes of base64, so Claude sees them as stand-ins (`![Drawing|center 40%](drawing:1)`), as Ask AI does. The app puts the real ones back in what Claude writes.

## Claude Desktop on Windows

Claude Desktop from the Microsoft Store runs its servers inside its package, which redirects their AppData. That's why the token lives in your home folder and why the server starts Collegiapp through Explorer: a direct start would run a private copy of the app with its own data. Inside the package, `%LOCALAPPDATA%\Collegiapp` can also show a stale copy of the app, so nothing should point a Claude config at the app's exe. The Store build keeps its config in `%LOCALAPPDATA%\Claude-Data\claude_<id>\claude_desktop_config.json`, which `install.py` finds.

## Testing

```bash
node integrations/claude-desktop/test.js
```

`COLLEGIAPP_BRIDGE` (a base address) and `COLLEGIAPP_TOKEN_FILE` point the server at another bridge and token file.
