"use client";

import { useEffect } from "react";

/**
 * Keeps this device's service worker in the one state it should be in.
 *
 * The app caches nothing through a worker (an earlier caching one trapped people on stale builds),
 * so by default there is none: any worker found is a leftover and is removed, with its caches.
 *
 * The exception is a device where the person turned the notifications on (Ajustes): a push can
 * only be delivered to a worker, so that one stays — it is `public/sw.js`, which handles pushes and
 * answers no network request. It is only asked to check for a newer version of itself.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void (async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          const subscribed =
            "pushManager" in registration && (await registration.pushManager.getSubscription()) !== null;
          if (subscribed) void registration.update().catch(() => undefined);
          else void registration.unregister();
        }
      } catch {
        // Nothing to tidy up on a browser that will not say what it has.
      }
    })();
    if ("caches" in window) {
      caches
        .keys()
        .then((keys) => {
          for (const key of keys) void caches.delete(key);
        })
        .catch(() => {});
    }
  }, []);

  return null;
}
