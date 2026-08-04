"use client";

import { useEffect, useRef } from "react";
import { materializeRecurringAction, reconcileAutoPaymentsAction } from "@/app/_actions/finance";

/**
 * On app load, brings the user's data up to today: first the recurring rules whose day has arrived
 * become real transactions, then (when automatic payments are on) any due obligation/fatura is
 * booked as paid. This is the primary trigger; a daily cron is the backstop.
 *
 * The two run as SEPARATE requests, in order: the workspace is memoised per request, so a single
 * call would reconcile against the snapshot taken before the new rows existed. Both are idempotent
 * and fire-and-forget; each revalidates the layout only when it actually wrote something.
 */
export function AutoPaymentsSync({ enabled }: { enabled: boolean }) {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      await materializeRecurringAction();
      if (enabled) await reconcileAutoPaymentsAction();
    })();
  }, [enabled]);
  return null;
}
