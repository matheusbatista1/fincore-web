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
  // Track the value CURRENTLY on screen (not just the last completed target). This is the tween's
  // origin, so an interrupted animation (e.g. a fast Geral↔Apenas-meu toggle) resumes from where it
  // visually froze instead of a stale "settled" point — and always reconciles to the latest target.
  const shown = useRef(target);

  useEffect(() => {
    if (!animate) {
      shown.current = target;
      setValue(target);
      return;
    }
    const from = shown.current;
    const to = target;
    if (from === to) return; // already there (nothing to animate)
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - p) ** 4;
      const v = from + (to - from) * e;
      shown.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Safety: if rAF is throttled/interrupted, still land exactly on the target.
    const safety = setTimeout(() => {
      shown.current = to;
      setValue(to);
    }, dur + 120);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
  }, [target, animate, dur]);

  return value;
}
