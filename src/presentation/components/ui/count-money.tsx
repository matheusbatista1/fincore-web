"use client";

import { useEffect, useRef, useState } from "react";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";

/**
 * Animated counting money value — ported 1:1 from the prototype
 * (system.jsx CountMoney): ease-out-quart over ~1.1s, honors privacy mode and
 * prefers-reduced-motion, with a safety timeout if rAF is paused.
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
  const [value, setValue] = useState(hidden ? cents : 0);
  const ref = useRef(hidden ? cents : 0);

  useEffect(() => {
    if (hidden) {
      ref.current = cents;
      return;
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(cents);
      ref.current = cents;
      return;
    }
    const from = ref.current;
    const to = cents;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - p) ** 4;
      setValue(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else ref.current = to;
    };
    raf = requestAnimationFrame(tick);
    const safety = setTimeout(() => {
      setValue(to);
      ref.current = to;
    }, dur + 120);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
  }, [cents, hidden, dur]);

  if (hidden) return <span className={`tnum ${className}`}>R$ ••••</span>;
  return <span className={`tnum ${className}`}>{formatBRLAbsolute(Math.round(value))}</span>;
}
