# AI

Collegiapp's AI runs on **your own chatbot plan**, never a paid API key:

- **In the app:** a chat CLI you're signed in to runs headless on this computer (`src-tauri/src/ai.rs`).
- **Elsewhere** (the web app, or without a CLI): the prompt goes on your clipboard, the chat site opens, and you paste the reply back.

Either way, the reply comes back as changes you look at and apply with a click.

## Where you ask

| where | how |
|---|---|
| anywhere | `I` or `Mod+J` opens **Ask AI**. Anything typed in search also offers "Ask AI: …". |
| in a note | the AI side panel, with presets: Format, Organize, Fix writing, Summarize, Study guide, Flashcards, Pull out tasks, Continue. The note (or the selection) is the context. |
| without a note | presets: Plan my day, What first?, Draft notes on…, Brain dump → tasks, New note… |

**Context.** You choose what goes with the prompt: the note or the selection, your open items, today's schedule. Nothing else leaves the app.

## Which AI

| tool | plan | what runs |
|---|---|---|
| Claude Code | Claude Pro or Max | `claude -p` with `--tools ""`, no session, settings, hooks, MCP servers, slash commands or CLAUDE.md files; the app's rules as the whole system prompt (from a file); model Default, Sonnet, Opus or Haiku |
| Codex CLI | ChatGPT Plus or Pro | `codex exec` in a read-only sandbox, prompt on stdin |
| Gemini CLI | your Google account | `gemini`, prompt on stdin |

**How a CLI runs:**

- It runs in an empty folder, with the prompt on stdin.
- The app removes API-key variables from its environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` and the like), so the CLI answers on the plan it's signed in with, never on metered API billing.
- The reply streams into the panel as it's written (`ai-chunk` events). **Stop** ends the run and its whole process tree.
- The app finds the CLIs on PATH and in the usual install folders (`~/.local/bin`, `~/.claude/local`, Bun, Volta, Scoop, npm's global folder, nvm).

**Without a CLI** (or in the web app), choose Claude, ChatGPT or Gemini:

1. The full prompt, rules included, is copied to the clipboard and the site opens (with the prompt in the address where the site takes one).
2. Paste the chat's reply back into the panel.

## What the AI knows

`RULES` in `ui/js/ai.js` tells the AI:

- **How to reply:** a few plain sentences, then blocks the app can apply.
- **Collegiapp Markdown:** the only formatting a note holds (`docs/NOTES.md`), with sentence-case headings and short paragraphs.
- **Drawings:** a note's drawings go out as numbered stand-ins, `![Drawing|center 40%](drawing:1)`, instead of their tens of kilobytes of base64 (`CA.ai.pack`). The AI keeps them where they belong and can't make new ones; `CA.ai.parse` puts the real drawings back in what it returns.
- **The quick-add grammar:** for the tasks it writes, including `whenfree`.

**Your standing instructions** are notes tagged `#ai`. Write them like any note ("Use Cornell headings for lecture notes", "Always end with a summary table"); they're added to every request as the user's own rules and sync with your notes. Collegiapp Markdown still limits what they can ask for.

## What comes back

The reply says what was done. The changes come as blocks, and each shows as a preview with **Apply**:

| block | applies as |
|---|---|
| `:::replace` | the note's whole new text (format, organize, fix); facts, links, numbers, dates and checkbox states are kept |
| `:::insert` | text replacing the selection, or at the cursor |
| `:::note Title` | a new note (any number of them) |
| `:::items` | new tasks, one per line in the quick-add grammar |

Every apply is one undo step: `Ctrl+Z` puts the note back as it was, and the undone AI version goes to the trash.

## From Claude Desktop

The other way round, Claude can write your notes from its own chats and projects without the app open in front of you: `integrations/claude-desktop` is an MCP server for Claude Desktop and Claude Code (`python integrations/claude-desktop/install.py` adds it to both). It reaches the running app over the bridge (`src-tauri/src/bridge.rs`, `/v1/notes` and `/v1/classes`, with the core's `notes.rs` doing the work) and can search, read, create, append to, retitle, file, tag, pin and archive notes, list classes and add tasks in the quick-add grammar. It never deletes.

- **Allowing it.** The first call asks you in the app (**Connect an assistant**, with a code Claude also shows). **Connect sources** lists it under Assistants, with **Disconnect**.
- **The same rules.** The server tells Claude Collegiapp Markdown and the quick-add grammar, and to follow your `#ai` notes. Drawings go out as `drawing:N` stand-ins and come back as the real ones, as above.
- **Nothing lost.** Text Claude replaces goes to the trash ("Replaced by Claude"). A note open in the editor takes Claude's change instead of saving over it, and a toast says what Claude changed.
