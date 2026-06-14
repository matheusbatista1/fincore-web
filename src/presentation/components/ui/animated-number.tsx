"use client";

import { useCountUp } from "@/presentation/lib/use-count-up";
import { useReducedMotion } from "@/presentation/lib/use-reduced-motion";

/**
 * Tweens an arbitrary number from its previous value to `value` and renders it via
 * `format` — for non-currency figures like the trend percentage. Snaps when the
 * user prefers reduced motion.
 */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const animated = useCountUp(value, !reduced);
  return <span className={className}>{format(animated)}</span>;
}
