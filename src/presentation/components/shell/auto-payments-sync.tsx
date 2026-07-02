"use client";

import { useEffect, useRef } from "react";
import { reconcileAutoPaymentsAction } from "@/app/_actions/finance";

/**
 * On app load, books any due obligations/faturas as paid when automatic payments are on
 * (the primary trigger; a daily cron is the backstop). Fire-and-forget and idempotent — the
 * action revalidates the layout only when it actually booked something.
 */
export function AutoPaymentsSync({ enabled }: { enabled: boolean }) {
  const ran = useRef(false);
  useEffect(() => {
    if (!enabled || ran.current) return;
    ran.current = true;
    void reconcileAutoPaymentsAction();
  }, [enabled]);
  return null;
}
