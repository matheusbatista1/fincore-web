"use client";

import { cn } from "@/presentation/lib/cn";
import { useCountUp } from "@/presentation/lib/use-count-up";
import { useReducedMotion } from "@/presentation/lib/use-reduced-motion";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRL } from "@/shared/formatting/currency";

/**
 * Like {@link Money}, but the value counts (tweens) from the previous amount to
 * the new one whenever `cents` changes — used where the number adapts on month
 * navigation or the Geral/Apenas-meu toggle. Masks in privacy mode and snaps when
 * the user prefers reduced motion.
 */
export function AnimatedMoney({
  cents,
  withSign = true,
  className,
}: {
  cents: number;
  withSign?: boolean;
  className?: string;
}) {
  const privacy = useUIStore((s) => s.privacy);
  const reduced = useReducedMotion();
  const value = useCountUp(cents, !privacy && !reduced);
  if (privacy) return <span className={cn("tnum", className)}>R$ ••••</span>;
  return <span className={cn("tnum", className)}>{formatBRL(Math.round(value), { withSign })}</span>;
}
