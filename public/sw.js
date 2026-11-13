/*
 * FinCore service worker: push notifications only.
 *
 * It answers NO network request (there is no "fetch" handler and it keeps no cache), so it can
 * never serve a stale build: the page always talks to the server, exactly as it does with no
 * worker at all. It exists because a push can only be delivered to a service worker.
 *
 * It is registered only on a device where the person turned the notifications on (Ajustes), and
 * unregistered again when they turn them off.
 */

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Whatever an older, caching worker left behind goes away; this one stores nothing.
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

/** What is shown when the details cannot be read (no connection, the session ended). */
const FALLBACK = {
  title: "FinCore",
  body: "Você tem contas vencendo. Toque para ver.",
  url: "/dashboard",
};

/**
 * A push carries no content: the worker asks the server what to say, with the person's own
 * session. A notification is ALWAYS shown, whatever happens — a push that shows nothing makes
 * the browser (iOS first of all) withdraw the permission.
 */
async function readDigest() {
  try {
    const response = await fetch("/api/push/digest", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return FALLBACK;
    const digest = await response.json();
    if (typeof digest.title !== "string" || typeof digest.body !== "string") return FALLBACK;
    return {
      title: digest.title,
      body: digest.body,
      url: typeof digest.url === "string" && digest.url.startsWith("/") ? digest.url : FALLBACK.url,
    };
  } catch {
    return FALLBACK;
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const digest = await readDigest();
      await self.registration.showNotification(digest.title, {
        body: digest.body,
        icon: "/icons/192",
        badge: "/icons/192",
        // One notification at a time: today's replaces yesterday's if it is still there.
        tag: "fincore-digest",
        data: { url: digest.url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? FALLBACK.url, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
