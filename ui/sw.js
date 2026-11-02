/* Collegiapp web app: keeps the app's own files so it opens offline (the list itself lives in Firestore's cache,
   js/cloud.js). The page's files come from the cache and are refreshed behind it, so a deploy shows on the next open;
   the Firebase SDK and the fonts have versioned addresses and are kept once fetched. Firestore, Google sign-in and
   Firebase's /__/ pages always go to the network, and so does the desktop app's sign-in page (link.html), which only
   works online and must never be a deploy behind. Bump V to drop everything cached. */
const V = "capp-1";
const KEPT = /^(www\.gstatic\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(V).then((c) => c.add("./"))); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url), own = u.origin === self.location.origin;
  if (r.method !== "GET" || (!own && !KEPT.test(u.hostname)) || (own && (u.pathname.startsWith("/__/") || /\/(link\.html|js\/link\.js)$/.test(u.pathname)))) return;
  e.respondWith(caches.open(V).then((c) => c.match(r, { ignoreSearch: own }).then((hit) => {
    const net = fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; });
    if (hit && !own) return hit;
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  })));
});
