"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@/presentation/components/ui/error-screen";
import { reportClientError } from "@/presentation/lib/report-error";

/** Route error boundary — prototype ErrorScreen with a reset action. What it caught is reported. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError("boundary", error, error.digest);
  }, [error]);
  return <ErrorScreen detail={error.message} onReload={reset} />;
}
