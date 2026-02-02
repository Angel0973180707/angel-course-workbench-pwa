const CACHE_NAME = "angel-course-workbench-step2-3";
const ASSETS = [
  "./","./index.html","./style.css","./app.js","./manifest.json","./sw.js",
  "./assets/icons/icon-192.png","./assets/icons/icon-512.png"
];
self.addEventListener("install",(e)=>{ e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener("activate",(e)=>{ e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k===CACHE_NAME?null:caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch",(e)=>{ e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))); });
