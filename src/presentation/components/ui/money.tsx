import { cn } from "@/presentation/lib/cn";
import { formatBRL } from "@/shared/formatting/currency";

/** Renders integer cents as BRL with tabular numerals. */
export function Money({
  cents,
  withSign = true,
  className,
}: {
  cents: number;
  withSign?: boolean;
  className?: string;
}) {
  return <span className={cn("tnum", className)}>{formatBRL(cents, { withSign })}</span>;
}
