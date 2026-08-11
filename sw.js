const CACHE_NAME = "kaojj-acp-static-v6";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./question-bank.js",
  ...Array.from({ length: 24 }, (_, index) => `./question-bank-${String(index + 1).padStart(2, "0")}.js`),
  "./app.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
