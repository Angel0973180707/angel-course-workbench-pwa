const CACHE_NAME = 'angel-course-workbench-v1.0.0';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE_NAME) ? null : caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Always try network first for GAS APIs so data stays fresh
  if (url.origin.includes('script.google.com') || url.origin.includes('googleusercontent.com')) {
    e.respondWith((async () => {
      try{
        const net = await fetch(req);
        return net;
      }catch(err){
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        return cached || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    try{
      const net = await fetch(req);
      if (net && net.ok && (req.method === 'GET')) cache.put(req, net.clone());
      return net;
    }catch(err){
      return cached || Response.error();
    }
  })());
});