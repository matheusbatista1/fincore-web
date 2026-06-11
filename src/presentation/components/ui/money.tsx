"use client";

import { cn } from "@/presentation/lib/cn";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRL } from "@/shared/formatting/currency";

/** Renders integer cents as BRL with tabular numerals; hides the value in privacy mode. */
export function Money({
  cents,
  withSign = true,
  className,
}: {
  cents: number;
  withSign?: boolean;
  className?: string;
}) {
  const privacy = useUIStore((s) => s.privacy);
  return (
    <span className={cn("tnum", className)}>{privacy ? "R$ ••••" : formatBRL(cents, { withSign })}</span>
  );
}
