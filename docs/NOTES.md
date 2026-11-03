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
| insert | Quote `Mod+Shift+.`, Callout `Mod+Shift+C` (again for the next kind), Code block `Mod+Alt+C`, Table, Drawing `Mod+Shift+D`, Divider, Clear formatting `Mod+\` |

**Markdown as you type.**

- At the start of a line, these become their block: `#`, `##` and `###` headings, `- ` bullets, `1. ` numbers, `[] ` checklists, `> ` quotes, ```` ``` ```` code blocks and `---` dividers.
- These format when their closing mark is typed: `**bold**`, `*italic*`, `~~strike~~`, `==highlight==` and `` `code` ``.

**Checklists.**

- Click the box, or press `Mod+Enter` in an item, to tick it.
- The Notes view counts them.

**Paste and links.**

- Paste goes through Markdown, so a page or document keeps its headings, lists, links and emphasis but nothing the note can't hold.
- `Mod+click` opens a link.

## Drawings

Quick sketches go in the text like anything else in it: a diagram beside a definition, an arrow between two steps, a box around the answer. The Drawing key or `Mod+Shift+D` opens the drawing layer over the sheet (`ui/js/draw.js`), and Done or `Esc` puts the drawing where the cursor was, on a line of its own.

**Tools.**

| tool | key | what it does |
|---|---|---|
| Select and move | `V` | click or drag a box to pick, `Shift` adds; drag to move, arrow keys nudge (`Shift` by 10), `Delete` removes, `Mod+D` duplicates, `Mod+A` picks everything; an ink or size click recolours what's picked |
| Pen | `P` | freehand, smoothed |
| Highlighter | `H` | a wide see-through stroke |
| Eraser | `E` | removes whole strokes it touches (a pen's eraser end works with any tool) |
| Line, Arrow, Box, Ellipse | `L` `A` `R` `O` | drag; `Shift` keeps lines at 15° steps and makes squares and circles |
| Text | `T` | click and type one line; `Enter` keeps it, `Esc` drops it |

Seven inks (`1`–`7`: ink, red, orange, yellow, green, blue, purple) and three sizes (`[` and `]`). The layer has its own undo (`Mod+Z`, `Mod+Shift+Z`, `Mod+Y`). The page grows as you draw near its bottom. Done keeps the drawing cropped to its ink; Discard (twice) leaves the note as it was. While the layer is open, keys stay in it, so the app's shortcuts wait.

**Placing.** Click a drawing (or any picture) in the note to pick it. The bar under the tools then has:

- **Edit drawing** (or double-click it) reopens it in the layer;
- **In the text**, **Wrap left**, **Own line** and **Wrap right**: in the line like a word, floated with the text running beside it, or centred on its own line;
- a width slider, 5–100% of the text column;
- **Delete**.

Drag a drawing to move it anywhere in the text. Every change is one step of the editor's undo.

**Dark themes.** Ink is chosen for paper. A dark theme shows the layer and every drawing inverted, so black ink reads as white and the colours keep their hue; exports and prints keep the paper colours.

**What's stored.** A drawing is a small vector SVG (paths and text, marked `data-collegiapp="drawing"`) kept in the note's Markdown as an image with a data address: `![Drawing|center 40%](data:image/svg+xml;base64,…)`. It syncs, exports, prints, goes to the trash and comes back with the note. A sketch is usually a few kilobytes; a synced note can't pass about 900 KB, and the app warns when one gets close. Search ignores the address (only the alt text, "Drawing", counts), and the AI sees a short stand-in, `![Drawing|center 40%](drawing:1)`, that it keeps in place.

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

Inline: `**bold**`, `*italic*`, `<u>underline</u>`, `~~strike~~`, `==highlight==`, `` `code` ``, `[text](https://…)`, bare `https://` links, `![alt](https://…)` images and drawings.

An image's layout follows its alt text after a `|`: `left` or `right` (the text wraps around it), `center` (a line of its own; `centre` also reads), and a width as a percentage of the text column, as in `![Drawing|right 35%](…)`. Without them it sits in the line at its own size. An image keeps a web address or a picture's own `data:image/…` address (a drawing's is `data:image/svg+xml;base64,…`); anything else is dropped.

## Files in and out

From a note's menu, export as:

| format | how |
|---|---|
| Markdown `.md` | front matter (course, tags, dates) and the title as `#`, then the text |
| plain text `.txt` | the title, underlined, then the text without marks |
| web page `.html` | a standalone page with the print styles |
| Word `.docx` | built in the page: real headings, lists, checklists, callouts as shaded boxes, tables, links, code and drawings (a sharp PNG with the SVG inside for Word versions that take it; opening the file in Collegiapp again reads the SVG and the layout back) |
| PDF | in the app on Windows, WebView2 prints the note's print view straight to a PDF in Downloads; elsewhere the print dialog's Save as PDF |
| print `Mod+P` | the note alone, with the page's print styles (`#printArea`, `core.css`) |

Files go to Downloads under a name that never overwrites another (`src-tauri/src/export.rs`), and the toast offers Show and Open.

**Import** (the Notes view's Import key, or `Mod+K` › Import notes…) brings in `.md`, `.txt`, `.html` and `.docx` files and a `.json` backup of your notes, as new notes.
