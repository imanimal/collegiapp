# Notes

A note is an Item like everything else on the list: kind `note`, with a title and its document in **Collegiapp Markdown** in `notes`. Notes search, filter, undo, sync (`docs/SYNC.md`) and go to the trash like any item.

- `ui/js/notes.js` turns Markdown into the editor's HTML and the editor's DOM back into Markdown, and handles the files a note goes out as and comes in from.
- `ui/js/editor.js` is the editor.
- `ui/js/app.js` owns the Notes lens, the sheet around the editor and the capture modes.

## Capture: speed first

| how | what you get |
|---|---|
| `Shift+Q` (or Jot in quick add) | **Jot**: type a thought and press Enter. It's saved as a note; the first line is the title. Mod+Enter saves and opens it. |
| quick add → Tab → **List** | a checklist note, one item per line. Mod+Enter saves; Shift+Mod+Enter saves and opens it. |
| `note: …`, `idea: …` or `jot: …` at the start of quick add | a note with that title (the quick-add grammar's rule 0). |
| `W` / `Shift+W` | a new note / a new checklist in the full editor. |
| `−` | the Notes view. |

In quick add, Tab moves between Item, Jot and List.

## The Notes view

The Notes view (`−`, query `is:open kind:note`, newest edit first) shows notes as cards with a preview and checklist progress.

- **Pinned:** a pinned note carries the tag `pinned` and sits first.
- **Archived:** archiving marks a note done, and the Done view keeps it.
- **Filtering:** the filter bar works on notes as on anything else. `#tag`, a course, or any words from the title or text narrow the cards.

## The editor

The editor is a sheet over the screen with the page centred. The title is the note's own field. The toolbar groups and their keys:

| group | tools |
|---|---|
| edit | Undo `Mod+Z`, Redo `Mod+Shift+Z` (the editor's own typing history) |
| block | Text `Mod+Alt+0`, Heading 1–3 `Mod+Alt+1`–`3` |
| inline | Bold `Mod+B`, Italic `Mod+I`, Underline `Mod+U`, Strikethrough `Mod+Shift+X`, Highlight `Mod+Shift+H`, Inline code `Mod+E`, Link `Mod+K` |
| list | Bulleted `Mod+Shift+8`, Numbered `Mod+Shift+7`, Checklist `Mod+Shift+9`, Indent `Tab`, Outdent `Shift+Tab` |
| insert | Quote `Mod+Shift+.`, Callout `Mod+Shift+C` (again for the next kind), Code block `Mod+Alt+C`, Table, Divider, Clear formatting `Mod+\` |

**Markdown as you type.**

- At the start of a line, these become their block: `#`, `##` and `###` headings, `- ` bullets, `1. ` numbers, `[] ` checklists, `> ` quotes, ```` ``` ```` code blocks and `---` dividers.
- These format when their closing mark is typed: `**bold**`, `*italic*`, `~~strike~~`, `==highlight==` and `` `code` ``.

**Checklists.**

- Click the box, or press `Mod+Enter` in an item, to tick it.
- The Notes view counts them.

**Paste and links.**

- Paste goes through Markdown, so a page or document keeps its headings, lists, links and emphasis but nothing the note can't hold.
- `Mod+click` opens a link.

## Collegiapp Markdown

This is the only formatting a note holds. The editor writes nothing else, and the AI is told the same rules (`ui/js/ai.js`).

| block | Markdown |
|---|---|
| headings | `# `, `## `, `### ` (three levels) |
| paragraphs | a blank line between them; a single newline is a line break |
| lists | `- ` bullets, `1. ` numbers, `- [ ] ` / `- [x] ` checklist items; nest any of them by indenting two spaces |
| quote | `> ` |
| callout | a quote whose first line is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]` or `[!WARNING]` |
| code | fenced with ```` ``` ````, an optional language after the opening fence |
| divider | `---` |
| table | `\| pipes \|` with a `\| --- \|` line under the header row (`:---:` centres, `---:` right-aligns) |

Inline: `**bold**`, `*italic*`, `<u>underline</u>`, `~~strike~~`, `==highlight==`, `` `code` ``, `[text](https://…)`, bare `https://` links, `![alt](https://…)` images.

## Files in and out

From a note's menu, export as:

| format | how |
|---|---|
| Markdown `.md` | front matter (course, tags, dates) and the title as `#`, then the text |
| plain text `.txt` | the title, underlined, then the text without marks |
| web page `.html` | a standalone page with the print styles |
| Word `.docx` | built in the page: real headings, lists, checklists, callouts as shaded boxes, tables, links and code |
| PDF | in the app on Windows, WebView2 prints the note's print view straight to a PDF in Downloads; elsewhere the print dialog's Save as PDF |
| print `Mod+P` | the note alone, with the page's print styles (`#printArea`, `core.css`) |

Files go to Downloads under a name that never overwrites another (`src-tauri/src/export.rs`), and the toast offers Show and Open.

**Import** (the Notes view's Import key, or `Mod+K` › Import notes…) brings in `.md`, `.txt`, `.html` and `.docx` files and a `.json` backup of your notes, as new notes.
