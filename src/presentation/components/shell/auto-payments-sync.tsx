"use client";

import { useEffect, useRef } from "react";
import { materializeRecurringAction, reconcileAutoPaymentsAction } from "@/app/_actions/finance";

/**
 * On app load, brings the user's data up to today: first the recurring rules whose day has arrived
 * become real transactions, then (when automatic payments are on) any due obligation/fatura is
 * booked as paid. This is the primary trigger; a daily cron is the backstop.
 *
 * The two run as SEPARATE requests, in order: the workspace is memoised per request, so a single
 * call would reconcile against the snapshot taken before the new rows existed. Each latches its own
 * ref — turning auto-payments on in Settings re-renders this component and must still reconcile in
 * the same session — and a failure in one never suppresses the other.
 */
export function AutoPaymentsSync({ enabled }: { enabled: boolean }) {
  const materialized = useRef(false);
  const reconciled = useRef(false);
  useEffect(() => {
    void (async () => {
      if (!materialized.current) {
        materialized.current = true;
        await materializeRecurringAction().catch(() => undefined);
      }
      if (enabled && !reconciled.current) {
        reconciled.current = true;
        await reconcileAutoPaymentsAction().catch(() => undefined);
      }
    })();
  }, [enabled]);
  return null;
}
