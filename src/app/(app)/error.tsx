"use client";

import { ErrorScreen } from "@/presentation/components/ui/error-screen";

/** Route error boundary — prototype ErrorScreen with a reset action. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen detail={error.message} onReload={reset} />;
}
