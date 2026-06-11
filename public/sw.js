/*
 * TEMPORARY kill-switch service worker.
 *
 * The previous caching SW trapped users on stale builds during active design
 * iteration (deploys "didn't show up"). This worker caches nothing: it clears
 * all caches, unregisters itself and reloads open tabs, so every load is fresh.
 * A properly versioned PWA service worker will be reintroduced once the UI is
 * stable. The browser fetches /sw.js directly (updateViaCache: none), so this
 * reaches and frees already-stuck clients on their next navigation.
 */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) client.navigate(client.url);
    })(),
  );
});
