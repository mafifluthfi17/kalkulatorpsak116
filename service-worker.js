// Simple offline-first service worker for the PSAK 116 Lease Calculator PWA.
// Caches the app shell so the calculator still works with a weak/lost connection.

const CACHE_VERSION = "psak116-v2";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/calc-engine.js",
  "./js/journal-engine.js",
  "./js/export-excel.js",
  "./js/storage.js",
  "./vendor/exceljs.min.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
          return new Response("Offline dan berkas belum tersimpan di cache.", { status: 503 });
        });
    })
  );
});
