# Collegiapp — product spec

v0.1 · 2026-10-31 · Fall 2026 (F26) · status: UI prototype + Rust core

## 0. The brief, rebuilt

> Build **Collegiapp**, a Rust (Tauri 2) desktop app for a UCSB computer-science student on Windows 11 and macOS, with an iPhone app later. It is **one always-visible "do first" surface** for everything school throws at me: class sessions from Google Calendar, assignments and links from Canvas, work posted on other sites (Gradescope, Ed/Piazza, PrairieLearn …), Shoreline club events and tickets, and anything I type in myself.
>
> - **One model, many filters.** Every assignment, exam, class, event, errand and idea is an **Item**. "Assignments", "Today", "Exams", "Classes" are saved filters over the same list, never separate screens. Esc clears every filter.
> - **Always aware.** The next class and the current focus timer live outside the window: a floating island, the Windows taskbar's progress bar and dot, the macOS menu bar, and an optional Zebar status-bar widget on Windows. Alerts fire at the right moment, and they escalate from nudge to alert to full-screen takeover.
> - **Do first, then focus.** One ranked item at a time, with the reason it's first. One key starts a focus session that can kill game launchers, block sites in Firefox, or lock the screen until the timer ends.
> - **Lazy-proof capture.** One line of natural language ("pa3 130a fri 11:59p ~4h !!") becomes a complete item. Context fills in what I leave out. A title alone is a valid item.
> - **Pick what counts.** I choose which calendar series are classes and which Canvas courses are real; excluded ones disappear everywhere.
> - **Mine everywhere, free forever.** Local-first, synced through my own Firebase Spark project, and built and released by GitHub Actions. $0/month, no servers to babysit.
> - **Themeable to the bone.** Theme packs can replace colours, components, layout, motion and sound. The default look is **retro-modern**: a clean, readable UI where the retro lives only in contained displays, keycaps and paper (three renditions). The high-effort full-screen CRT theme keeps its four renditions for people who want it.

## 1. Principles (non-negotiable)

1. **Unified.** No feature gets its own data silo. New sources become Items with a `source` record; new screens become a `View` (filter + sort + lens).
2. **Three keystrokes.** Every central action is reachable in ≤3 inputs from anywhere: add (`Q`), focus (`F`), done (`X`), any view (`1`–`0`), search or any command (`Ctrl+K`), clear filters (`Esc`), and the global quick add (`Ctrl+Shift+Space`) works even when the app is hidden.
3. **Explain the ranking.** The top item always shows *why* it's first (overdue, due in 3h, worth 15%, 2h est. vs. 4h left).
4. **Undo, don't confirm.** Destructive actions run immediately with an undo toast (Ctrl+Z; Ctrl+Shift+Z or Ctrl+Y redoes). What you delete, and what an undo throws away, waits in the Trash (50 MB by default, oldest out first) to be restored. The only confirmations are deliberate friction: the emergency phrase that ends Lockdown early, answering a takeover, and a second press to empty the Trash (nothing undoes that).
5. **Partial is fine.** Any field can be empty. Missing data is inferred (course from context, kind from words, time defaults to 23:59) or left for later.
6. **Local-first.** The app is fully usable offline; sync is a background merge, never a spinner.
7. **Escalate, never nag.** Interruptions are scheduled to task boundaries where possible and are tuned per item (`none · nudge · alert · takeover`). Skipping is allowed but logged with a reason for the weekly review.
8. **$0 and private.** No paid services, no third-party analytics, tokens stored in the OS keychain.

## 2. Data model (`crates/collegiapp-core`)

**Item** — the only thing on the list.

| field | notes |
|---|---|
| `id`, `created_at`, `updated_at`, `deleted` | UUID; tombstones for sync |
| `title` | required; everything else optional |
| `kind` | `assignment · exam · quiz · lab · reading · project · class · office_hours · event · ticket · errand · application · task · note · info` (`info`: a Canvas grade column or notice, read rather than done; Canvas work a reader isn't sure of lands as `info` in the Inbox for you to sort, `model.rs` `canvas_kind`) |
| `status` | `inbox · todo · doing · done · dropped` (new items: `todo` if they have a due date or course, else `inbox`) |
| `course` | Course id (nullable) |
| `due`, `end` | for scheduled kinds `due` is the start and `end` the end |
| `estimate_min`, `priority` (0–3), `weight` (% of grade) | feed the score |
| `tags`, `location`, `links[]` (label + url), `notes` | |
| `interrupt` | `none · nudge · alert · takeover` (scheduled kinds) |
| `snoozed_until` | hides from Do First until then |
| `source` | `{ adapter, external_id, url, kind }` e.g. `canvas`, `gcal`, `shoreline`, `gradescope`, `manual`; `kind` is what the reader last said, so a kind you change stays yours on re-import |

**Course** — `code` (CMPSC 130A), `tag` (CS130A), `aliases` (130a, cs130a, ds&a), `color`, `included`, meeting pattern, links (Canvas, Gradescope, Piazza/Ed, syllabus, Zoom), optional grade weights.

**View** — `{ name, key, query, sort, lens }`. Lenses: `list`, `week`, `courses`, `links`, `index` (teletext). Built-in views, in their first order, what you open most first (in the sidebar they're grouped as Plan, Coursework, the Classes and Notes sections, and More; drag one in the sidebar or along the key row, or Alt+Shift+arrows, to move it; the number keys follow the order, and it syncs with the look):

| key | view | query | sort |
|---|---|---|---|
| 1 | Do First | `is:open is:actionable` | score |
| 2 | Today | `is:open due<=today` | due |
| 3 | Calendar | `is:open` (week lens: Day, Week or Month) | due |
| 4 | Inbox | `status:inbox` | updated |
| 5 | Assignments | `is:open kind:work` (assignment, lab, quiz, project, reading) | due |
| 6 | Exams | `kind:exam` | due |
| 7 | Classes | courses lens, which includes calendar-series and Canvas-course selection | — |
| 8 | Notes | `kind:note` (notes lens) | updated |
| 9 | Events | `is:open kind:event,ticket,office_hours` | due |
| 0 | Links | links lens | — |
| − | Everything | `is:open` | due |

**Filter DSL** (`filter.rs`, mirrored in `ui/js/engine.js`): space-separated terms, all must match; `-` negates; comma means OR.
`kind:` (names, plurals, `hw`, `oh`, `work`, `lecture`, `section`) `course:` (`none` too) `status:` `src:` `tag:` `pri:` `is:open|done|actionable|overdue|snoozed|excluded|scheduled` `due:today|tomorrow|week|weekday|Nd|overdue|none` with `due<` `due<=` `due>` `due>=`. Only open work is overdue (`is:overdue` = `due:overdue`); a class that has started never is. Any other text matches the title, notes, place, tags, course or the kind's words ("assignments", "section"). A known key with a value it can't read is ignored and its chip is drawn dashed. The list groups by due date with finished work and past classes under Past, last.

## 3. Do First score (`score.rs`, mirrored in JS)

```
urgency    = no due → 0.15 · overdue → 1.5 · else 1 / (1 + hours_left / 24)
importance = 1 + 0.5·priority + kind_bonus + weight/20
             kind_bonus: exam .75 · project .5 · assignment/quiz/lab .3 · reading .1
crunch     = estimate / hours_left ≥ .25 → 1.5 · ≥ .10 → 1.2 · else 1
momentum   = status doing → 1.15
score      = urgency × importance × crunch × momentum
```

Only actionable kinds are ranked; classes, events and tickets feed **Up Next** instead. `N` skips to the next candidate and `Shift+N` (or **Back**) returns to the previous one, wrapping round, without changing anything.

## 4. Capture (compensating for laziness)

- **Quick add everywhere:** the `Q` dialog, the global hotkey, the island's input, the Phosphor command line, the palette, and later the Firefox toolbar button and iOS share sheet.
- **Grammar** (`quickadd.rs`): `!`/`!!`/`!!!` priority · `~2h`, `~45m` estimate · `#tag` · `@place` · a link anywhere becomes a link (glued to brackets or punctuation too, `www.…` or `github.com/…` without `https://`; named after its site, Canvas, Gradescope, Zoom, Google Docs …; a link alone names the item) · course aliases (`130a`, `cs130a`, `pstat`) · kind words (`hw4`, `pset3`, `lab`, `quiz`, `midterm`, `mt2`, `final`, `read`, `proj`, `oh`, `apply`) · dates (`today`, `tonight`, `tmr`, `fri`, `next tue`, `in 3d`, `11/12`, `nov 12`, `eod`, `eow`) · times (`5pm`, `11:59p`, `17:00`, `noon`, `midnight`). A date without a time means 23:59; a time without a date means the next occurrence. The last value of each kind wins; a course match beats a bare number (`4a` = MATH 4A, not 4 AM). `whenfree` makes the time a target: the item blocks its estimate (an hour without one) and moves to the nearest slot clear of your classes, sections, events, exams and earlier when-free blocks, earlier or later, never into the past and, once moved, within 8:00–23:00; with a day and no time it aims at 9:00 (`Draft::fit_free`, mirrored in engine.js `fitFree`). The preview says where it landed and why.
- **Smart defaults:** if a class of yours just ended, is in progress, or starts within 15 minutes, a new item with no course gets that course and a visible "auto" chip.
- **Templates:** HW · Lab · Reading · Exam prep · Email TA · Errand · Apply · Office hours; one click prefills the grammar.
- **Fill later:** the Inspector edits any field inline; nothing is required except the title.
- **Notes** (`docs/NOTES.md`): a note is an Item of kind `note` whose `notes` hold Collegiapp Markdown. Quick add has three modes (Tab switches): Item, Jot (a thought saved as a note with Enter) and List (a checklist note); `note:` at the start of quick add makes a note too. The Notes view (−) lists them as cards; the editor is a full sheet with headings, lists, checklists, quotes, callouts, code, tables, links, inline marks and drawings (a drawing layer with pen, highlighter, shapes, arrows and text; the drawing sits in the text, wrapped left or right or on its own line, at any width), and notes go out as .md, .txt, .html, .docx, PDF (saved to Downloads) or print, and come back in from .md, .txt, .html, .docx and a .json backup.
- **AI** (`docs/AI.md`): your own chatbot plan does the work, never a paid API key. In the app a chat CLI you're signed in to (Claude Code, Codex CLI or Gemini CLI) runs headless with no tools; anywhere else the prompt goes on the clipboard for the chat site. I or Mod+J (or anything typed in search) opens Ask AI; in a note the side panel formats, organizes, fixes the writing, summarizes, makes a study guide or flashcards, pulls out tasks or continues it. The AI is told the app's Markdown and quick-add rules, plus your own standing rules (notes tagged `#ai`), and answers in blocks the app applies when you click Apply: replace or insert note text, new notes, new items.
- **Paste-to-import:** paste an `.ics` URL or file (Canvas feed, Shoreline, Google secret iCal), a GOLD schedule page, or a syllabus table. The parser proposes items you can tick before they're added.
- **Planned:** Firefox "Send page to Collegiapp" (title, URL, selected text, due date detected from the page); screenshot → OCR → draft item on macOS/Windows (local OCR APIs, no cloud).

## 5. Presence, alerts and the "live activity"

| surface | Windows 11 (stock) | Windows 11 + custom shell | macOS | iPhone (later) |
|---|---|---|---|---|
| Island pill (always on top, draggable, translucent) | ✓ | ✓ | ✓ | — |
| App icon | taskbar progress bar + overlay dot | same | — (the dock icon stays plain) | — |
| Text in a system bar | tray tooltip only (Windows can't show tray text) | **Zebar** widget (M5, `integrations/zebar`) reading `http://127.0.0.1:4747/presence` | menu-bar title "130A 12m" | Live Activity + Dynamic Island |
| Notifications | toast | toast | Notification Center | push via local schedule |

- **Pocket Start** (Windows): while Collegiapp runs, a lone Win key and the taskbar's Start key and search box open its own Start (`ui/start.html`, `start.rs`) with your pins, search, quick add, the live Do first list and a right-click menu per app (run as administrator, file location, uninstall, end task, start at sign-in …); Win+anything still reaches Windows. Turning it off (the tray, Start's Power menu or the app's search) gives the Win key and Start key back to Windows' Start. Details in `docs/PLATFORM_PRESENCE.md`.
- **Presence** (`presence.rs`) = the class or event in progress (ending soonest) or the next one within 12h, else the focus timer, else the top due item.
- **Alert lead time** defaults to 10 minutes, plus a **leave-by** time computed from walking minutes between campus buildings (a small Phelps/HSSB/Girvetz/Engineering II/Library table, editable).
- **Escalation per item:** `nudge` (toast + island pulse) → `alert` (dialog with Join Zoom / On my way / Skipping…) → `takeover` (full-screen "GET UP." until answered). Skips ask for a one-tap reason (sick, recorded lecture, exam prep, other) for the weekly review.
- Details and alternatives (Windhawk, YASB, Rainmeter, Widgets Board): `docs/PLATFORM_PRESENCE.md`.

## 6. Focus and takeover (`src-tauri/src/focus.rs`)

| level | what it does | how it ends |
|---|---|---|
| **Soft** | timer in the island, Do Not Disturb, nudge if you open a blocklisted app | any time |
| **Hard** | kills blocklisted processes on start and every 2s (Steam, Discord, Riot, Epic, Battle.net, Roblox …, editable), blocks sites in Firefox | any time, logged |
| **Lockdown** | Hard + fullscreen kiosk window on top, Quit disabled | timer ends, or type the phrase *"i choose distraction"* |

- **Protected processes are never killed** (system processes, Collegiapp, terminals, editors, Firefox itself).
- **Site blocking.** The planned Collegiapp Firefox extension blocks per session and needs no admin rights. The alternative is Firefox enterprise `policies.json` `WebsiteFilter`, which needs admin and is persistent, so it's opt-in.
- `F` = 25 min on the Do First item at your default level; `Shift+F` opens setup (15/25/50/90 min, level, blocklist preview). Finishing offers "mark done", a break (5 min, 15 after every fourth completed session today) or "keep going +25".
- **Breaks** (`B`, or "Break 5/15 min" in search) are a timer between sessions, kept in the UI: nothing is closed, they end any time, count no focus minutes and show in the top bar. A Soft session ends straight into one; a Hard or Lockdown session keeps its time, so its break comes after. When one runs out, "Break over" offers Focus 25 on the item you were on (or Do First), with a system notification if the window is not in front (`break_over`).

## 7. Integrations

| source | method | auth | cost | notes |
|---|---|---|---|---|
| **Google Calendar** | Calendar API v3, events + incremental sync tokens | OAuth desktop loopback + PKCE; publish the OAuth app "In production" (Testing-mode refresh tokens expire after 7 days) | free | Use a personal Google account if UCSB's Google Workspace blocks third-party apps. Fallback: the calendar's *secret iCal address*. You pick each recurring series' role: lecture, section (discussion, lab) or not a class, and its course when the title doesn't say. Sections are class meetings of the course tagged `section`. |
| **Canvas (canvas.ucsb.edu)** | REST: courses, assignments, announcements, files; planner items | personal access token (Account › Settings) | free | Fallback: Calendar Feed ICS (no token). Per-course include/exclude; quicklinks pulled from course tabs. |
| **Gradescope** | the student pages (`/account`, `/courses/<id>`) read with your session; no API exists | sign in once in a Gradescope window inside the app (UCSB SSO works there) | free | This term's courses land in your courses (matched by code, else added with a Gradescope link); assignments become items, checked off when you submit. `src-tauri/src/gradescope.rs`, parsing in the core. |
| **WeBWorK** | a course's homework list (`/webwork2/<course>/`, WeBWorK 2.18 at UCSB) read with your session; no student API or feed exists | sign in to each course once in a WeBWorK window inside the app (its own username and password) | free | The course lands in your courses (matched by code, else added with a WeBWorK link); open sets become items due at their full-credit date. Read every 20 min to keep the session alive (WeBWorK ends it after 30 idle min); signed out, its items stay until you sign in again. `src-tauri/src/webwork.rs`, parsing in the core. |
| **Firefox: PocketCanvas** | WebExtension (MV3, `../pocketcanvas`) talking to the app on `127.0.0.1:4747` (`src-tauri/src/bridge.rs`) | pairing code: the extension asks, the app shows the code and you allow it | free | Reads Canvas, WeBWorK and Gradescope with Firefox's own sign-in (Google sign-in works there, unlike the app's sign-in windows) and sends your classes with their priority / ghost / hidden modes and all your work, undated work included, with due dates filled in from WeBWorK and Gradescope. Work it can't call work (nothing to turn in online, not on your Canvas To Do list, not in WeBWorK or Gradescope: grade columns and notices) comes in as Info, in the Inbox for you to sort unless its title reads as a grade. Items keep the feed's and readers' ids, so nothing duplicates. Also captures pages (quick add) and follows the app's focus sessions with site blocking. Import in `crates/collegiapp-core/src/pocketcanvas.rs`. |
| **Zoom** | none needed | — | free | Detects `zoom.us/j/…` links in event location/description/Canvas; "Join Zoom" opens `zoommtg://`. |
| **Shoreline** (CampusGroups) | iCal subscription for "My Events" + RSVP list | secret URL | free | Tickets are Items of kind `ticket` with QR/link, door time, location. |
| **UCSB APIs** (developer.ucsb.edu) | Dining menus/hours, Academic quarter calendar, campus events | free API key | free | Quarter dates drive week numbers, the finals countdown and pass-time reminders. |
| **SB MTD** | GTFS + GTFS-realtime | none | free | "Next 11/24X from Storke & El Colegio" in Up Next when you're off campus (later). |
| **GoGaucho / GOLD** | page capture via the extension, or paste | — | free | Course schedule import; confirm what you use GoGaucho for (open question). |
| **Gmail** (later) | Gmail API, label `collegiapp` → items | OAuth | free | "Forward to capture" without a server. |

New sites plug in as **adapters** (`fetch → [SourceRecord] → upsert Items`), implemented in Rust when the site has an API or feed, or in the Firefox extension when it doesn't.

## 8. Features tailored to UCSB + CS (beyond the brief)

**Quarter rhythm**
- Week number in the header ("WK 5/10") and a finals countdown, both from the quarter calendar.
- **Pass time + registration**: reminders for GOLD pass 1/2/3, add/drop and P/NP deadlines, and the "last day to drop without a W".
- **Weekly review (Sunday)**: what you finished, what slipped, skip reasons, focus minutes, and next week's load by day so crunch weeks are visible early.

**Classes**
- **Leave-by** times and walking minutes between buildings; a "running late" one-tap message template for lab sections.
- **Office hours** as scheduled items per course, with "go to OH" suggested when an assignment for that course is crunching.
- **Syllabus import**: paste the grading table → course grade weights → item `weight` → ranking. Grade "what do I need on the final" calculator per course.
- **Exam prep plans**: an exam can spawn study blocks (e.g. 4 × 90 min across the prior week) as linked items.

**CS-specific**
- Gradescope read in the app (signed in once); PrairieLearn/Ed captured through the extension; autograder score and late-day count shown on the item (later).
- **Late-day budget** per course (e.g. CS 130A: 3 left) shown when an item is near its deadline.
- Repo links on project items (GitHub classroom), "open in VS Code" action for a local path.
- **Interview prep track**: LeetCode/NeetCode reps as recurring low-priority tasks that fill gaps in the day; **internship pipeline** (`kind:application`) with stages (applied → OA → interview → offer) and Handshake links.

**Campus life**
- Shoreline events and tickets with "leave by" alerts; club meetings as optional classes.
- Dining: tonight's menu at De La Guerra/Carrillo/Ortega/Portola in the evening Up Next slot (UCSB Dining API).
- Library study-room booking link (LibCal), CLAS tutoring, Student Health and CAPS links in Links.
- MTD bus next-departure when the event is off campus.

**Laziness compensation**
- Snooze presets: 1 hour · **after next class** · tomorrow 9 · weekend · next week.
- Bulk triage in Inbox (`j/k` + `x`, `s`, `1`–`5`).
- Recurring templates ("weekly reading for PSTAT 120A every Mon").
- Focus streaks, kept low-key (no XP or levels: points that buy nothing are noise).

## 9. Accounts and sync

- **Identity:** Firebase Auth (Google sign-in) on the free Spark plan. The desktop app uses the Identity Toolkit REST API; the iPhone build will use the same REST API (or the Firebase iOS SDK through a plugin).
- **Storage:** Firestore, one document per Item/Course/View under `users/{uid}/…`, with security rules restricting access to the owner. Spark limits (50k reads, 20k writes, 1 GiB per day/total) are far above one student's needs. No Cloud Functions or Cloud Storage (not available on Spark).
- **Merge:** last-write-wins per document by `updated_at`, with the device id as tie-breaker; deletes are tombstones (`sync.rs`). The local JSON snapshot (SQLite later) is the source of truth; sync runs on change + every 60 s.
- **Built (2026-11):** `src-tauri/src/cloud.rs` (desktop: Google sign-in on the web app's link page in the browser, handed back to a loopback port, Identity Toolkit and Firestore over REST with the system curl) and `ui/js/cloud.js` (the web app on Firebase Hosting, also the phone's home-screen app until M6). One document per Item at `users/{uid}/items/{id}` with the server's write time, which pulls ask for; a cycle pulls first, then pushes. The courses, the look, the calendar feed links and the Google class picks sync as one settings document, merged per key; sign-ins and device-only settings stay per device. Setup and details: `docs/SYNC.md`; rules: `firestore.rules`.
- **Secrets** (Canvas token, Google refresh token) stay in the OS keychain and are never synced. The M1 calendar feed links are secrets too; they sit in the local store file and, by the user's choice (2026-11-02), sync only into their own uid-locked settings document (`docs/SYNC.md`); with the M2 tokens they move to the keychain locally.

## 10. Themes

A theme is a folder with `theme.json` (tokens, component variants, layout/rendition, effects, motion, sounds) and optional `theme.css`. See `docs/THEME_FORMAT.md`. **The final design is Pocket**, `CAPP1 L6 P9 B8 F3 T6 G2 M2 D3 C2 s4 g0 f0 n0 a0 v0 mN bN S1`: a light handheld with program keys (B8), modules with printed label bands (F3), reflective LCD inlays for countdowns, 9×9 pixel icons, location placards on classes and events (room, walk time, an LCD *leave by*), and a key deck. It moves like that hardware (M2 since 2026-11-01): keys travel and spring back, LCDs switch on in steps, rows and modules settle into place, and every input answers where it was made (`docs/UIKit/README.md` § 8). P11 Night is the same device in graphite with a backlit LCD. Opening the window turns the screen on like a CRT (a bright line opens into snow while the degauss coil hums, the picture rolls in and its hold tears and settles, the static fades as the signal locks, colour last) and closing it turns it off with the zip (the picture collapses to a bright line, the line to a dot, the dot fades on the phosphor); `fx.js` power section, `power.rs`, M0 and reduced motion switch instantly, Standard fades. Readability rules: Space Grotesk in sentence case, solid surfaces, no effects over body text, one obvious primary action per region. You get around in a **sidebar of folders** (`docs/NAVIGATION.md`): the views in groups (Plan, Coursework, More), each class with its assignments, exams, calendar and notes, your notes by class and your tags, with a path bar over the page that says where you are. Edit the sidebar to move, rename, hide, add and delete its sections and groups. It docks on the left (or the right) from 900 px and is a drawer below that; `Mod+\` hides it, its edge drags its width, and the old key row along the top is a choice in Appearance. Layouts follow the space the page has: two columns from 1100 px, Do first on top from 761 px, one scrolling column with a sticky key row and a bottom deck below that (the iPhone layout); touch screens get 44 px targets and no hover states. Every component axis has a stable ID, so a **style code** pins an exact look. The other looks (L1–L5, L7 and their palettes and parts) are frozen in `archive/looks-2026-10/` and keep their IDs.

**Standard** (L8) is the same app for people who don't want the handheld: a plain modern UI with the system font, line icons, flat keys, plain section headers and number panels instead of LCDs, on the same regions, layouts and keys (`docs/UIKit/README.md` § 13). A **theme** is a palette plus one of the two looks, in the shared Pocket theme format that PocketCanvas also reads (`docs/THEMES.md`). Eight are built in: P9 Cream, P11 Night, P12 Gaucho, P13 Pistachio and P14 Ink (Pocket), and P15 Standard, P16 Standard dark and P17 Standard contrast. The Appearance drawer's theme browser shows each as a preview card (first it asks whether to switch theme at night: off, with the system or always. Off, a click uses a theme. On, a Day and a Night slot sit over the grid, a click fills the selected one, and the slot not in effect previews on screen until you pick back or close the drawer), imports a file or pasted JSON, exports the current look, and makes new ones with a chatbot: describe it, open Claude or ChatGPT with the prompt filled in, paste the reply back, and the app checks contrast and offers to fix it before saving. Imported themes live in the saved UI state.

## 11. Architecture

```
crates/collegiapp-core   pure Rust: model, quickadd, filter, score, sync merge, ics, presence  (shared by every platform)
src-tauri                Tauri 2 shell: commands, store (JSON in %APPDATA%), tray, island window, Pocket Start
                         (Win-key hook on Windows), global shortcuts, notifications, autostart, single-instance,
                         focus enforcement,
                         signed updates from GitHub Releases
ui/                      buildless HTML/CSS/JS; runs in Tauri, a browser (tools/serve_ui.py) or as a published demo
integrations/            (planned) firefox-extension/, zebar/ widget
.github/workflows        ci.yml (fmt, clippy, test, check on win/mac) · release.yml (tauri-action → GitHub Releases + updater latest.json)
```

Inside the app the UI loads everything with `load_all` and saves edits with `save_items` (`ui/js/store.js` converts shapes); it keeps filtering and ranking locally with the JS mirror of the core. It listens for `items-changed`, `alert`, `presence` and `focus-tick`/`focus-ended`, and runs focus sessions through `start_focus`/`end_focus`. Calendar feeds are fetched in Rust with the system `curl` (Windows 10+ and macOS ship it), so the feeds carry no HTTP stack; the phone build will need its own fetcher. The desktop updater (`updater.rs`, `tauri-plugin-updater`) is the one part with its own HTTPS client: it reads `latest.json` from the latest published release, verifies the download against the public key in `tauri.conf.json`, and installs only when the user asks and no focus session is running. Notes export to Downloads through `export.rs` (PDF on Windows with WebView2's PrintToPdf); AI runs through `ai.rs`; sync through `cloud.rs`. In a plain browser the UI runs on sample data (the web demo), or, with a Firebase project in `ui/js/cloud-config.js`, as the web app on your own data (`cloud.js`).

## 12. Roadmap

| milestone | scope |
|---|---|
| **M0 (done)** | Spec, UI prototype (explored 7 renditions, then finalized Pocket with Light/Night and phone-to-desktop layouts), Rust core (65 tests), Tauri shell with island, tray, focus enforcement, CI; desktop-only parts gated so the shell compiles for iOS/Android |
| **M1 Local app (done)** | UI ↔ Tauri commands; persistence; Canvas feed + Google secret-iCal import by link (refreshed every 30 min) or .ics file, with courses found from Canvas; class picker; alerts (in-app, system notification, takeover) + island live from the core; real focus sessions |
| **M2 Sources** | Google OAuth, Canvas token API, Shoreline iCal, UCSB APIs; Zoom detection |
| **M3 Firefox** | extension: page capture adapters (Ed, GOLD), per-session site blocking, send-page (Gradescope moved into the app, 2026-11) |
| **M4 Sync** | Firebase Auth + Firestore sync between Windows and Mac, and the web app on Firebase Hosting (built 2026-11, `docs/SYNC.md`); theme packs loaded from disk |
| **M5 Presence+** | Zebar widget, macOS menu bar polish, weekly review, syllabus import |
| **M6 iPhone** | Tauri 2 iOS build of the same app and UI (already laid out for phones) + Firestore + a Swift plugin for Live Activities and widgets; Android comes almost free |

## 13. Open questions

1. ~~Final look~~: decided, Pocket `CAPP1 L6 P9 B8 F3 T6 G2 M2 D3 C2 s4 g0 f0 n0 a0 v0 mN bN S1`.
2. GoGaucho: what do you use it for? (Schedule, dining, maps?) That decides capture vs. API.
3. Does canvas.ucsb.edu let you create a personal access token? If not, we start with the Calendar Feed + extension.
4. Personal Google account or UCSB Google account for Calendar?
5. Custom Windows shell: try Zebar (recommended), or stay stock with island + taskbar?
6. Default focus level for `F`: Hard (current) or Soft?
7. Public or private GitHub repo?
