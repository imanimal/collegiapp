/* Collegiapp — the desktop app's sign-in (link.html; src-tauri/src/cloud.rs). The app opens this page with a loopback
   port and a one-time state in the hash. The page signs in with Google through Firebase Auth, kept in memory so the
   web app's own sign-in here is untouched, and posts the Google ID token with that state to the app on this computer,
   which starts a Firebase session of its own with it. The post is a form, so the browser lands on the app's answer
   page; a fetch to this computer would need another permission.
   PocketCanvas (../pocketcanvas src/lib/cloud.js) signs in here too, without the app: Firefox's
   identity.launchWebAuthFlow opens this page with the extension's redirect address (`ext`) and a state, and the page
   hands the token back by going to that address. Firefox catches it in the sign-in window, so it never loads anywhere,
   and only addresses in EXT are taken: each one belongs to one extension id. */
(function () {
  const cfg = window.CA_CLOUD || {}, $ = (s) => document.querySelector(s), go = $("#go"), no = $("#no");
  const h = new URLSearchParams(location.hash.slice(1)), port = +h.get("port"), state = h.get("state") || "";
  // Firefox's redirect address is https://<SHA-1 of the add-on id>.extensions.allizom.org/
  const EXT = { "https://894d0d65806358af510c1fde2652d67b6cbf90ed.extensions.allizom.org/": "PocketCanvas" };
  const ext = h.get("ext") || "", who = Object.prototype.hasOwnProperty.call(EXT, ext) ? EXT[ext] : "";
  const msg = (t, bad) => { const m = $("#msg"); m.textContent = t; m.className = bad ? "bad" : ""; };
  const stop = (t) => { go.disabled = no.disabled = true; msg(t, true); };
  if (who) {
    document.title = `Sign in ${who}`;
    $("h1").textContent = `Sign in ${who}`;
    $("main p").textContent = `${who} in Firefox asked to sign in. Choose your Google account, and ${who} keeps your settings and class choices in it, in the same account Collegiapp syncs with.`;
  }
  if (!cfg.apiKey || !cfg.projectId) return stop("This site has no Firebase project yet (ui/js/cloud-config.js).");
  if (!/^[0-9a-f]{64}$/.test(state) || !(who || (port >= 1024 && port < 65536))) return stop(ext ? "Open this page from PocketCanvas: Settings › Sync › Sign in with Google." : "Open this page from Collegiapp: Sync across devices › Sign in with Google.");

  function send(fields) {
    if (who) return location.replace(ext + "#" + new URLSearchParams(Object.assign({ state }, fields)));
    const f = document.createElement("form");
    f.method = "POST"; f.action = `http://127.0.0.1:${port}/`;
    Object.entries(Object.assign({ state }, fields)).forEach(([k, v]) => {
      const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i);
    });
    document.body.appendChild(f); f.submit();
  }
  function why(e) {
    const c = (e && e.code) || "";
    if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(c)) return "Sign-in was cancelled. Try again, or choose Cancel.";
    if (/popup-blocked/.test(c)) return "The browser blocked the sign-in window. Allow pop-ups for this site and try again.";
    if (/operation-not-allowed/.test(c)) return "Google sign-in is off for this project: turn it on in Firebase › Authentication › Sign-in method.";
    if (/network-request-failed/.test(c)) return "No connection. Try again when there is one.";
    return (e && e.message) || String(e);
  }

  // the SDK loads first, so the click opens Google's window at once (browsers block a window opened later)
  const V = "10.12.2", sdk = (m) => import(`https://www.gstatic.com/firebasejs/${V}/firebase-${m}.js`);
  let U = null, auth = null;
  Promise.all([sdk("app"), sdk("auth")]).then(([A, Au]) => {
    U = Au;
    const app = A.initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain || cfg.projectId + ".firebaseapp.com", projectId: cfg.projectId, appId: cfg.appId || undefined });
    auth = U.initializeAuth(app, { persistence: U.inMemoryPersistence, popupRedirectResolver: U.browserPopupRedirectResolver });
    go.disabled = false; go.focus();
  }).catch((e) => stop(`Couldn't load Google sign-in (${e && e.message}). Check the connection and reload.`));

  go.addEventListener("click", () => {
    go.disabled = true; msg("Choose your Google account in the window that opened…");
    const p = new U.GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" });
    U.signInWithPopup(auth, p).then((r) => {
      const c = U.GoogleAuthProvider.credentialFromResult(r);
      if (!c || !c.idToken) throw new Error("Google didn't send an ID token. Try again.");
      msg(`Signing in ${who || "the app"} as ${r.user.email}…`);
      send({ id_token: c.idToken });
    }).catch((e) => { go.disabled = false; msg(why(e), true); });
  });
  no.addEventListener("click", () => { go.disabled = no.disabled = true; send({ error: "cancelled" }); });
})();
