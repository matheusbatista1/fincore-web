/*
 * FinCore service worker — installable PWA with offline read.
 *
 * Update strategy (important): bump CACHE on every release-worthy change. On
 * activate we skipWaiting + claim clients and purge every other cache, so a new
 * deploy takes over immediately instead of trapping users on a stale build.
 * The client (ServiceWorkerRegister) reloads once on controllerchange.
 *
 * Caching:
 *   - navigations: network-first (always fresh online), falling back to the
 *     cached page, then /offline.
 *   - hashed build assets & images: cache-first (content-addressed).
 * Only same-origin GET requests are handled.
 */
const CACHE = "fincore-v2";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .catch(() => {}),
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

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => cachePut(request, response))
        .catch(() => caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL))),
    );
    return;
  }

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
