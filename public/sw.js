/*
 * FinCore service worker — installable PWA with offline read.
 *
 * Strategy:
 *   - navigations: network-first, falling back to the cached page, then /offline.
 *   - hashed build assets & images: cache-first (they are content-addressed).
 * Only same-origin GET requests are handled. Auth/data is the user's own and
 * stays in their device cache; old caches are purged on activate.
 */
const CACHE = "fincore-v1";
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function cachePut(request, response) {
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(request, copy));
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Page navigations: network-first so data is fresh, with an offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => cachePut(request, response))
        .catch(() => caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL))),
    );
    return;
  }

  // Content-addressed build output and images: cache-first.
  const isStatic =
    url.pathname.startsWith("/_next/static") ||
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "font" ||
    request.destination === "image";

  if (isStatic) {
    event.respondWith(
      caches
        .match(request)
        .then((cached) => cached || fetch(request).then((response) => cachePut(request, response))),
    );
  }
});
