/* Collegiapp — sync in the web app. On Firebase Hosting (docs/SYNC.md) the page signs in with Google through Firebase
   Auth and keeps the list in Firestore, in the same documents the desktop app syncs (src-tauri/src/cloud.rs): `j` the
   item's JSON in the Rust shape (store.js itemOut), `c` its course's, `d` the device and `s` the server's time of the
   write, which firestore.rules insists on. Firestore's own cache keeps the list on the phone, so the page opens and
   takes edits offline and catches up when it can. It replaces store.js's load, save and onChange and adds CA.cloud
   (status, sign in and out) for app.js's Sync dialog. The Firebase SDK comes from gstatic on first use (no bundler).
   Inside the app, or with no project in cloud-config.js, it does nothing and the page is the web demo. The web app
   lives on PROJECT.firebaseapp.com, Google sign-in's own domain, so sign-in and the offline cache stay first-party;
   PROJECT.web.app sends you there. */
(function () {
  const CA = window.CA, st = CA.store, cfg = window.CA_CLOUD;
  if (st.live || !cfg || !cfg.apiKey || !cfg.projectId) return;
  const home = cfg.projectId + ".firebaseapp.com";
  if (location.hostname === cfg.projectId + ".web.app") return location.replace("https://" + home + location.pathname + location.search + location.hash);
  // only where Google sign-in is allowed (the project's own site, and localhost for trying it); anywhere else, such as
  // 127.0.0.1 or a published demo, the page stays the demo
  if (location.hostname !== home && location.hostname !== "localhost") return;
  const V = "10.12.2", sdk = (m) => import(`https://www.gstatic.com/firebasejs/${V}/firebase-${m}.js`);
  const { itemIn, itemOut, courseIn, courseOut } = st.convert;
  const device = (() => {
    try { let d = localStorage.getItem("capp.device"); if (!d) localStorage.setItem("capp.device", (d = "web-" + st.uuid().slice(0, 8))); return d; } catch (e) { return "web"; }
  })();
  const items = new Map(), courses = new Map(), changeFns = [], statusFns = [], queue = new Map();
  const status = { configured: true, signed_in: false, signing_in: false, busy: true, email: null, project_id: cfg.projectId, last_sync: null, error: null, pending: 0, offline: false, web: true };
  let U = null, F = null, auth = null, db = null, user = null, unsub = null, flushing = false, firstDone;
  const first = new Promise((r) => (firstDone = r));
  const tell = () => { const s = Object.assign({}, status); statusFns.forEach((fn) => fn(s)); };
  const changed = () => changeFns.forEach((fn) => fn("sync"));

  // Firebase's error codes as a next step
  function why(e) {
    const c = (e && e.code) || "";
    if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(c)) return "Sign-in was cancelled.";
    if (/unauthorized-domain/.test(c)) return `Add ${location.hostname} under Firebase › Authentication › Settings › Authorized domains.`;
    if (/operation-not-allowed/.test(c)) return "Turn on Google in Firebase › Authentication › Sign-in method.";
    if (/permission-denied/.test(c)) return "Firestore said no: publish firestore.rules (docs/SYNC.md).";
    if (/network-request-failed|unavailable/.test(c)) return "No connection. Changes wait here until there is one.";
    return (e && e.message) || String(e);
  }

  const ready = Promise.all([sdk("app"), sdk("auth"), sdk("firestore")]).then(([A, Au, Fs]) => {
    U = Au; F = Fs;
    const authDomain = cfg.authDomain || home;
    const app = A.initializeApp({ apiKey: cfg.apiKey, authDomain, projectId: cfg.projectId, appId: cfg.appId || undefined });
    auth = U.getAuth(app);
    try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); } catch (e) { db = F.getFirestore(app); }
    U.getRedirectResult(auth).catch((e) => { status.error = why(e); tell(); });
    U.onAuthStateChanged(auth, listen);
  }).catch((e) => {
    status.busy = false; status.error = `Couldn't load Google sign-in (${e && e.message}). Check the connection and reload.`;
    tell(); firstDone();
  });

  // one listener on the account's items: Firestore sends what's cached at once, then every change from any device
  function listen(u) {
    if (unsub) { unsub(); unsub = null; }
    user = u; items.clear(); courses.clear();
    Object.assign(status, { signed_in: !!u, email: u ? u.email : null, signing_in: false, busy: !!u, pending: 0 });
    tell();
    if (!u) { changed(); firstDone(); return; }
    unsub = F.onSnapshot(F.collection(db, "users", u.uid, "items"), { includeMetadataChanges: true }, (snap) => {
      const ch = snap.docChanges();
      ch.forEach((c) => {
        if (c.type === "removed") { items.delete(c.doc.id); return; }
        const d = c.doc.data();
        try { const it = itemIn(JSON.parse(d.j)); items.set(it.id, it); } catch (e) { return; }
        if (d.c) try { const k = courseIn(JSON.parse(d.c)); if (!courses.has(k.id)) courses.set(k.id, k); } catch (e) { /* an unreadable course: the item keeps its id */ }
      });
      Object.assign(status, { busy: false, error: null, offline: snap.metadata.fromCache, pending: snap.docs.filter((x) => x.metadata.hasPendingWrites).length });
      if (!status.offline && !status.pending) status.last_sync = new Date().toISOString();
      tell(); if (ch.length) changed(); firstDone();
    }, (e) => { status.busy = false; status.error = why(e); tell(); firstDone(); });
  }

  function load() {
    return first.then(() => ({ items: Array.from(items.values()).filter((it) => !it.deleted), courses: Array.from(courses.values()), calendarSeries: [], settings: null, feeds: null }));
  }
  // edits made in one turn go out together; each is a whole document with the server's time
  function save(it) { queue.set(it.id, it); if (!flushing) { flushing = true; Promise.resolve().then(flush); } }
  function flush() {
    flushing = false;
    if (!user || !db) { if (queue.size) { status.error = "Sign in to save your changes."; tell(); } return; }
    const uid = user.uid;
    queue.forEach((it) => {
      const r = itemOut(it), c = it.course && courses.get(it.course);
      r.updated_by = device;
      const doc = { j: JSON.stringify(r), d: device, s: F.serverTimestamp() };
      if (c) doc.c = JSON.stringify(courseOut(c));
      F.setDoc(F.doc(db, "users", uid, "items", it.id), doc).catch((e) => { status.error = why(e); tell(); });
    });
    queue.clear();
  }

  // a popup in a browser tab; a redirect from the home-screen app, where popups don't come back
  function signIn() {
    return ready.then(() => {
      status.signing_in = true; status.error = null; tell();
      const p = new U.GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" });
      const home = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
      return home ? U.signInWithRedirect(auth, p) : U.signInWithPopup(auth, p).catch((e) => {
        if (e && /popup-blocked|operation-not-supported/.test(e.code)) return U.signInWithRedirect(auth, p);
        throw e;
      });
    }).then(() => Object.assign({}, status), (e) => { status.signing_in = false; status.error = why(e); tell(); return Object.assign({}, status); });
  }
  // signing out also clears this browser's copy of the list
  function signOut() {
    return ready.then(() => U.signOut(auth)).then(() => F.terminate(db)).then(() => F.clearIndexedDbPersistence(db)).catch(() => {}).then(() => location.reload());
  }
  function syncNow() { return ready.then(() => F.enableNetwork(db)).then(() => Object.assign({}, status), () => Object.assign({}, status)); }

  Object.assign(st, {
    cloud: true, load, save, isPending: (id) => queue.has(id),
    onChange(fn) { changeFns.push(fn); },
    saveCourse(c) { courses.set(c.id, c); return Promise.resolve(); },
    deleteCourse(id) { courses.delete(id); return Promise.resolve(); },
  });
  CA.cloud = { status: () => Object.assign({}, status), onStatus(fn) { statusFns.push(fn); }, signIn, signOut, syncNow };

  // the app's own files for offline (sw.js); the list itself is in Firestore's cache
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
