"use client";

import { useCountUp } from "@/presentation/lib/use-count-up";
import { useReducedMotion } from "@/presentation/lib/use-reduced-motion";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";

/**
 * Animated counting money value (the hero balance). Tweens from the previous
 * amount to the new one via {@link useCountUp}; honors privacy mode and
 * prefers-reduced-motion.
 */
export function CountMoney({
  cents,
  dur = 1100,
  className = "",
}: {
  cents: number;
  dur?: number;
  className?: string;
}) {
  const hidden = useUIStore((s) => s.privacy);
  const reduced = useReducedMotion();
  const value = useCountUp(cents, !hidden && !reduced, dur);
  if (hidden) return <span className={`tnum ${className}`}>R$ ••••</span>;
  return <span className={`tnum ${className}`}>{formatBRLAbsolute(Math.round(value))}</span>;
}
