# Sync across devices

Collegiapp keeps your list and notes the same on your computers, your phone and the web app through **your own Firebase project** on the free Spark plan, signed in with your Google account. There's no Collegiapp server, nothing to pay, and your data goes only to your project.

- **Desktop app:** `src-tauri/src/cloud.rs`. It signs in on the web app's sign-in page in your browser (`ui/link.html`), which hands Google's answer back to the app on this computer, then it uses Firestore over REST with the system `curl`.
- **Web app** (and the phone, from the home screen): `ui/js/cloud.js` on Firebase Hosting at `https://PROJECT_ID.firebaseapp.com`. Firebase Auth and Firestore with an offline cache, so it opens and takes edits without a connection.

## What syncs

- **Every Item:** tasks, classes, events, exams, notes and jots, with their done state, snoozes, edits and deletions.
- **Courses:** each course with its color, whether it's included, its title, names and links, and deleting or merging one.
- **The look:** the Appearance drawer's theme, the Day and Night themes and when to switch, imported themes, shortcut hints, motion, sound, density, screen glass and scanlines, and the default focus level.
- **Calendar feed links:** the Canvas calendar feed and the Google secret iCal address. A device that gets a new link reads it at once; disconnecting one disconnects it everywhere (the items stay).
- **Class picks:** which Google Calendar series are lectures and sections, their courses, and the hidden ones.
- **The tray's focus level.**

These stay on each device:

- Gradescope and WeBWorK sign-ins;
- paired browsers;
- text size, the island, the desk preview and Pocket Start (Windows);
- the browser links open in, the focus blocklist and the trash size;
- AI settings (the CLIs are on each computer);
- focus stats;
- the trash.

The sample "Welcome" item never syncs.

Each device reads the feeds itself. An imported item has the same id on every device (`stable_id` in the core), so two computers reading the same Canvas feed meet on one document, and checking it off on one checks it off everywhere.

**A new computer.** Install the app and sign in: your list, notes, look, calendar links and class picks come down, and the new computer starts reading your calendars. Gradescope and WeBWorK keep their sign-ins on each device, so when your list has work from them the app points you at **Connect sources** to sign in there too. A paired browser (PocketCanvas) pairs with each computer's app on its own.

## Set up your project (once)

Everything runs through the Firebase CLI with npx, from the repo root. It isn't a build step: the web app is the same buildless `ui/`. This repo's project is `collegiapp` (set up 2026-11-02; its config is in `cloud-config.js`), so a fresh setup is only for a fork or a new project.

1. **Sign in to the CLI** with your Google account. Use a personal account: UCSB's Google Workspace may not allow new Cloud projects.

   ```bash
   npx firebase-tools login
   ```

2. **Create the project.** The ID is global, so pick one that's free (6–30 lowercase letters, digits and dashes). New projects are on Spark, the free plan; keep it there.

   ```bash
   npx firebase-tools projects:create PROJECT_ID --display-name Collegiapp
   ```

3. **Add the web app and copy its config.** The second command prints the config; put its `apiKey`, `projectId` and `appId` into [`ui/js/cloud-config.js`](../ui/js/cloud-config.js).

   ```bash
   npx firebase-tools apps:create web Collegiapp --project PROJECT_ID
   ```

   ```bash
   npx firebase-tools apps:sdkconfig web APP_ID --project PROJECT_ID
   ```

4. **Create the database** near you (`us-west2` is Los Angeles; `nam5` is the US multi-region). On a new project the Firestore API is off: `npx firebase-tools deploy --only firestore:rules --project PROJECT_ID` turns it on (and may fail until the database exists), and the API then takes a few minutes before this works:

   ```bash
   npx firebase-tools firestore:databases:create "(default)" --location us-west2 --project PROJECT_ID
   ```

5. **Turn on Google sign-in.** It needs your support email, so keep it out of the repo: save this as `firebase.json` in a folder of its own, outside the repo:

   ```json
   { "auth": { "providers": { "googleSignIn": {
     "oAuthBrandDisplayName": "Collegiapp",
     "supportEmail": "YOU@gmail.com",
     "authorizedRedirectUris": ["https://PROJECT_ID.firebaseapp.com/__/auth/handler"]
   } } } }
   ```

   Then deploy it from that folder:

   ```bash
   npx firebase-tools deploy --only auth --project PROJECT_ID --config firebase.json
   ```

   Or, in the [Firebase console](https://console.firebase.google.com): **Build › Authentication › Get started › Sign-in method › Google**, then **Enable**, pick your support email and save.
6. **Publish the rules and the web app:**

   ```bash
   npx firebase-tools deploy --only hosting,firestore:rules --project PROJECT_ID
   ```

   This publishes `ui/` ([`firebase.json`](../firebase.json)) and [`firestore.rules`](../firestore.rules), which let each Google account read and write only its own items and settings, and only with the server's write time. Publish the rules again after they change: until then the app keeps syncing items, and the Sync dialog says Firestore said no.
7. **Rebuild the desktop app** (`python tools/build_installer.py --install`). It builds in the project from `cloud-config.js`, so there's nothing to paste.
8. **Sign in on the desktop.**
   1. Choose **Sign in** in the top bar, next to search. (It's also **Sync across devices…** in Ctrl+K and under **Connect sources**.) The web app's sign-in page opens in your browser.
   2. The Sync dialog shows the app waiting for you.
   3. Choose **Sign in with Google** there and pick your account. The page hands the sign-in to the app, and the app starts a session of its own.

   Everything on this computer goes up, and you see "Synced just now". From then on the top bar's key is a cloud with a dot: green when synced, blinking while syncing, grey offline, red on an error. Click it for the details. Other computers do the same; what's already in the project comes down, and when both sides changed the same item, the later edit wins.
9. **Your phone.** Open `https://PROJECT_ID.firebaseapp.com` in Safari and choose **Share › Add to Home Screen**. Then open it from the home screen and sign in with Google. (`PROJECT_ID.web.app` sends you to the same page. The app lives on `firebaseapp.com` because that's where Google sign-in runs, so sign-in and the offline copy stay on one site.)

To try the web app locally, run `python tools/serve_ui.py` and open `http://localhost:4791`. `localhost` is an authorized domain by default; `127.0.0.1` isn't.

**What's private.** None of the config is secret: the rules decide who can read what, so committing `cloud-config.js` to a public repo is fine. A fork that ships its own app should put its own project there. The Firebase session (`cloud.session` beside the store) is the one thing to keep private, and it's never uploaded. The sign-in page sends Google's one-hour ID token only to `127.0.0.1`, on the port the app opened, with a one-time code that only the page the app opened knows. The app turns away a post without that code, and any post that names another site as its origin.

**Feed links are secrets.** Anyone with one can read that calendar. They sync by your choice, only into your settings document, which the rules let your Google account alone read; the web app's offline copy keeps them on the browsers you sign in on, like your list. To stop a leaked link working, reset it where you got it (Google: **Integrate calendar › Secret address in iCal format › Reset**) and paste the new one in Connect sources: it replaces the old one on every device.

**Another project.** In the Sync dialog, **Change project** takes a pasted config and overrides the built-in one (it's kept in `cloud.json`); saving it empty goes back to the built-in one. That project needs the web app deployed too, since the sign-in page is part of it.

## How it works

Each Item is one document at `users/{uid}/items/{item id}`:

| field | what |
|---|---|
| `j` | the Item's JSON (the Rust shape, `store.js` `itemOut`) |
| `c` | its course's JSON, when it has one (for devices from before courses synced on their own) |
| `d` | the device that wrote it |
| `s` | the server's time of the write (`REQUEST_TIME`; the rules check it) |

- **Desktop timing:**
  - Every 5 s it looks for items whose `updated_at` isn't the version it last pushed or pulled. A change waits 3 s to settle, so typing in a note goes up once.
  - Every 60 s it pulls what was written after the newest `s` it has seen. Because `s` is the server's time, a device with a wrong clock can't hide a change.
- **Order of a cycle:** pull first, merge with the core's last-write-wins (`collegiapp_core::sync::merge`: later `updated_at`, then a deletion, then the device id), then push what's newer here. So an edit made offline never overwrites a newer one made elsewhere.
- **Deletions:** a deletion that comes from another device puts the local version in the trash ("Deleted on another device"), so you can restore it.
- **Web:** it listens to the collection live and writes whole documents with the server's time. Firestore's cache holds the list, and writes made offline wait in it until there's a connection.
- **Size:** an item over 900 KB (Firestore's limit is 1 MiB a document) stays on its device.

The settings and the courses are one more document, `users/{uid}/meta/settings`, with the same `d` and `s`. Its `j` is a map from a key (`look.pal`, `gcal_hidden`, `course.cmpsc130a-f26`) to that value and the time and device of its last change (`SyncedSettings` in the core's `sync.rs`; `ui/js/cloud.js` mirrors it). A course's value is its JSON, and null once it's deleted or merged into another:

- **Stamps:** a device stamps a key when it changes there. On the desktop the store does it on every save (`Snapshot::synced_values` in `store.rs`: `Settings::synced` lists the settings, then every course); the look reaches the store through `save_look` from the Appearance drawer. A setting this device never changed that still has its default stays unstamped, so a new computer's defaults never win over what the account already has.
- **Merge:** key by key, the later stamp wins, then the greater device id. Changing the theme on one computer and the class picks on another keeps both.
- **Desktop timing:** every cycle reads the document before the items (one read) and writes it back only when this device has a newer key. A change made here starts a cycle within 5 s, like an item.
- **Courses:** a course with a key comes only from the document; an item's `c` adds a course only while the document has none for it, so a course deleted on one device doesn't come back with an older item. Reading the document before the items lets a new device take the account's courses rather than the items' older copies.
- **Web:** it listens to the document live and keeps its stamps in `localStorage`; it has the look and the courses, and passes the desktop's keys through.

### Spark limits

The free plan allows 50,000 reads, 20,000 writes and 1 GiB stored. One student's list uses a small fraction:

- **Reads:** a desktop that's open all day pulls 1,440 times, and an empty pull counts as one read; reading the settings document is one more read a pull, 2,880 a day in all.
- **Writes:** each change is one write.
- **First sync:** the first sign-in writes every item once, typically a few hundred.

## Signing out

- **Desktop:** your data stays on the computer and in your project. Signing in again (to any account) starts with a full pull.
- **Web app:** signing out also clears the browser's copy.
- **Changing project:** saving a different project in **Change project** signs out first.
- **Waiting for the browser:** while the app waits, **Open the page again** reopens the sign-in page, and **Cancel** on the page stops the wait. It gives up after 10 minutes.

## When something's wrong

The Sync dialog shows the error with the next step:

| message | fix |
|---|---|
| Turn on Google in Firebase › Authentication › Sign-in method | step 5 |
| Google's answer was for another project | the app and the web app have different projects: rebuild the app after changing `cloud-config.js`, or set the same one with **Change project** |
| Firestore said no: publish firestore.rules | step 6 |
| This project has no Firestore database yet | step 4 |
| The sign-in page is "Page not found" | the web app isn't deployed to this project: step 6 |
| The browser blocked the sign-in window (sign-in page) | allow pop-ups for the site and try again |
| Add … under Authorized domains (web) | Firebase › Authentication › Settings › Authorized domains: add the host you're opening the web app on |
| Signed out: sign in with Google again | the session was revoked (for example you removed the account in Firebase); sign in again |
| Couldn't reach Google | offline; it retries every minute and changes wait until then |
