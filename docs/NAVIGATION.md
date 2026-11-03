# Navigation: the sidebar

Collegiapp's places are a **sidebar of folders**: the views, each class with its work and notes, your notes and your tags. It docks on the left by default. You can move it to the right, hide it, drag its edge to resize it, or go back to the old row of view keys along the top. The code is the sidebar section of `ui/js/app.js` (`sideTree`, `mSide`, `mPath`, `sideGo`), with styles in `pocket.css` § sidebar and `standard.css`.

## Why a sidebar

The key row had three problems:

- It held eleven views, and on most screens it scrolled sideways, so some places sat out of sight.
- A class's work, its exams and its notes lived in three different views behind filters, with no way to see them together.
- Nothing told you where you were once a chip or a search had narrowed a view.

Apps that hold a lot of places solved this the same way, and they agree on most of the details:

| what we looked at | what it says | what we took |
|---|---|---|
| Apple HIG, sidebars | A sidebar is for top-level navigation through a hierarchy. Keep the hierarchy shallow, let people hide the sidebar, and let them choose what's in it. | Three levels at most: section, folder, file. It hides. You reorder the Views. |
| W3C ARIA APG, tree navigation | A navigation tree uses one Tab stop, ↑ ↓ to move, → ← to unfold, step in and step out, Home and End, Enter to open, and marks the current page. | `role="tree"` with a roving tabindex, `aria-expanded`, `aria-level` and `aria-selected`. Letters stay the app's shortcuts. |
| VS Code, custom layout | The side bar moves to either side, toggles with one shortcut and resizes by dragging its edge. | `data-side` left or right, `Mod+\`, and a grip on the inner edge. |
| Notion | `Mod+\` toggles the sidebar. Pages nest as a tree: clicking a page opens it, and only its arrow folds it. | The same shortcut. Clicking a folder opens it and unfolds it; the arrow only folds. |
| Linear (2024 and 2025 changelogs) | The sidebar is personal: reorder items, hide some, fold sections. | Views drag to reorder, and the number keys follow. Sections fold, and what's open is remembered. |
| Material 3: navigation drawer and rail | Docked beside the content on wide screens, a modal drawer over a scrim on narrow ones. M3 Expressive (2025) folds the drawer into an expandable rail. | It docks at 900 px and wider. Below that it's a drawer over a scrim, and Esc or the scrim shuts it. |
| Obsidian forum, sidebar sizing | People want to resize it with the keyboard too, not just the mouse. | The grip is focusable: ← → resize it, Home and End jump to the narrowest and widest, Enter hides it. |

## How it works

**The tree.** Each part is a filter or lens over the one item list (`docs/SPEC.md`), never a separate store.

- **Views:** your views in your order, numbered 1–0 and −, with live counts. Done comes last.
- **Classes:** one folder per included class, plus Personal. A class folder opens its open items and holds:
  - Assignments and Exams, whose files are the items themselves
  - Calendar: the week, showing that class only
  - Notes
- **Notes:** pinned notes first, then a folder per class, then "No class". The + key writes a new note.
- **Tags:** every tag on an open item, by count. This section starts folded.

A folder lists its first 12 files, then an "N more" row that opens the folder.

**Clicking:**

- **A folder** opens its list in the page and unfolds. Clicking the folder you're in again folds it. Its arrow only folds.
- **A file** opens its folder with the item's details showing, or opens the note.
- **The place you're in** is a graphite key, like a latched program key. When you arrive somewhere, its folders unfold to show it, once, so you can still fold them afterwards.

**The path bar** replaces the key row, so the page always says where you are: `Classes › CMPSC 130A › Assignments`. Every step except the last takes you back up that far. When chips or a search narrow the list, the bar says "filtered", and **Clear** puts the whole folder back. The list's title follows the path ("CMPSC 130A · Assignments").

**Size and place.** It docks beside the page when the screen is 900 px or wider; narrower, it's a drawer over the page:

- **The drawer** stays open while you unfold folders, and shuts when you open a view or a file.
- **Hiding it:** `Mod+\` toggles it, as do the Folders key in the path bar, its band's hide key, and dragging the edge well past its narrowest width.
- **Width:** drag the edge between 200 and 440 px. A double-click puts back the usual 17 em.
- **Side:** the band's arrow key moves it to the other edge. So do Appearance › Navigation and the palette.

**The page.** The page lays out in the room the sidebar leaves it: `.main` is a container named `screen`, so the page's width breakpoints, such as two columns from 1100 px, count only the page's own width. Dialogs in `#layer` still answer to the whole screen.

**On a desktop window,** the sidebar's band drags the window like the top bar does. On a Mac, with the sidebar docked on the left, the traffic lights sit over the sidebar's top instead of the top bar's.

## Keys

| key | does |
|---|---|
| `Mod+\` | show or hide the sidebar (with it off, turns it on) |
| ↑ ↓ · Home End | move through the tree |
| → ← | unfold or step in · fold or step out |
| Enter · Space | open (a section folds) |
| Esc | back to the page, or shut the drawer |
| Alt+Shift+↑ ↓ | move the focused view (or your view) up or down |
| 1–0, − | open a view by its place, as before |

## What's saved where

- **On every device (the look, synced):** `CA.ui.nav`, which is `"side"` (the default) or `"top"` for the key row, and `CA.ui.side`, which is `"left"` or `"right"`. They travel as `look.nav` and `look.side` (`docs/SYNC.md`).
- **On this device only:** the width, whether the sidebar is hidden, and which folders are open, all in localStorage `capp.side`. A phone and a desktop want different widths.

## Sources

- Apple Human Interface Guidelines: [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)
- W3C WAI-ARIA Authoring Practices: [Tree view pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/), [Navigation treeview example](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/examples/treeview-navigation/)
- Visual Studio Code: [Custom layout](https://code.visualstudio.com/docs/editor/custom-layout), [User interface](https://code.visualstudio.com/docs/editing/getting-started/userinterface)
- Linear changelog: [New sidebar (2019)](https://linear.app/changelog/2019-11-11-new-sidebar), [Personalized sidebar (2024)](https://linear.app/changelog/2024-12-18-personalized-sidebar), [Favorites](https://linear.app/docs/favorites)
- Material 3 through SAP Fiori for Android: [Navigation drawer](https://www.sap.com/design-system/fiori-design-android/v25-4/components/m3-standard-components/navigation-drawer/usage), [Navigation rail](https://www.sap.com/design-system/fiori-design-android/v26-4/components/m3-standard-components/navigation-rail/usage); 9to5Google, [Material 3 Expressive navigation](https://9to5google.com/2025/05/14/material-3-expressive-navigation/)
- Notion's shortcuts, including `Mod+\`: [cheat sheet](https://super3.super.site/blog/100-notion-keyword-shortcuts-cheat-sheet-for-mac-and-windows)
- Obsidian forum: [a hotkey for resizing the sidebar](https://forum.obsidian.md/t/please-add-hotkey-for-resizing-sidebar/80663)
