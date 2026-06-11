"use client";

import { useEffect } from "react";

/**
 * PWA service worker is temporarily disabled during design iteration (it was
 * trapping users on stale builds). This component now actively unregisters any
 * existing worker and clears its caches so every visit gets the latest build.
 * Re-enable a versioned caching SW once the UI is stable.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        for (const reg of regs) void reg.unregister();
      })
      .catch(() => {});
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
