/* Angel Course Workbench v1 - sw.js (safe offline shell) */
const CACHE = "angel-course-wb-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Network-first for GAS API (cross-origin)
  if (url.origin !== location.origin) {
    e.respondWith(fetch(req).catch(() => new Response("offline", { status: 503 })));
    return;
  }

  // Cache-first for same-origin assets
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const cached = await c.match(req);
    if (cached) return cached;
    const fresh = await fetch(req);
    if (fresh && fresh.ok) c.put(req, fresh.clone());
    return fresh;
  })());
});
