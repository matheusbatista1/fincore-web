"use client";

import { useEffect } from "react";
import { reportClientError } from "@/presentation/lib/report-error";

/**
 * Listens for what no error boundary sees — an error thrown in an event handler, a promise nobody
 * caught — and reports it to the server log. Renders nothing; mounted once, in the root layout.
 */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent): void => reportClientError("window", event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent): void => reportClientError("promise", event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
