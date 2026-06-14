"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tweens a number from its previous value to `target` whenever `target` changes,
 * via requestAnimationFrame (ease-out-quart over `dur` ms). Seeded to `target` so
 * the server and the first client render match (no hydration flash) — the tween
 * only kicks in on later changes. Pass `animate=false` (privacy / reduced-motion)
 * to snap instantly. A safety timeout settles the value if rAF is throttled.
 */
export function useCountUp(target: number, animate = true, dur = 1100): number {
  const [value, setValue] = useState(target);
  const settled = useRef(target);

  useEffect(() => {
    if (!animate) {
      setValue(target);
      settled.current = target;
      return;
    }
    const from = settled.current;
    const to = target;
    if (from === to) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - p) ** 4;
      setValue(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else settled.current = to;
    };
    raf = requestAnimationFrame(tick);
    const safety = setTimeout(() => {
      setValue(to);
      settled.current = to;
    }, dur + 120);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
  }, [target, animate, dur]);

  return value;
}
