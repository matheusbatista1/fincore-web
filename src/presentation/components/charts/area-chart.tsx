"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/presentation/lib/use-reduced-motion";

interface AreaPoint {
  readonly label: string;
  readonly valueCents: number;
}

const W = 720;
const H = 220;
const P = 8;

/**
 * Tweens a numeric series from its previous values to `target` (ease-out-quart),
 * re-rendering each frame. Snaps when reduced motion is requested or the array
 * length changes (a length change would warp the x-axis). The effect keys on a
 * value-signature so it does not restart mid-tween on incidental re-renders.
 */
function useTweenedSeries(target: number[], animate: boolean, dur = 1200): number[] {
  const sig = target.join("|");
  const targetRef = useRef(target);
  targetRef.current = target;
  const settled = useRef(target);
  const [vals, setVals] = useState(target);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `sig` is the value-signature trigger; the latest array is read via `targetRef` so the tween doesn't restart on incidental re-renders.
  useEffect(() => {
    const from = settled.current;
    const to = targetRef.current;
    if (!animate || from.length !== to.length) {
      setVals(to);
      settled.current = to;
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      // ease-in-out-cubic — distributes the motion so the curve flows rather than snaps.
      const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
      setVals(
        to.map((v, i) => {
          const f = from[i] ?? v;
          return f + (v - f) * e;
        }),
      );
      if (p < 1) raf = requestAnimationFrame(tick);
      else settled.current = to;
    };
    raf = requestAnimationFrame(tick);
    const safety = setTimeout(() => {
      setVals(to);
      settled.current = to;
    }, dur + 120);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
  }, [sig, animate, dur]);

  return vals;
}

/** Smooth area sparkline (net worth over months). The curve morphs as the data changes. */
export function AreaChart({ data }: { data: AreaPoint[] }) {
  const reduced = useReducedMotion();
  const vals = useTweenedSeries(
    data.map((d) => d.valueCents),
    !reduced,
  );

  if (data.length < 2) {
    return (
      <div className="grid h-full min-h-32 place-items-center text-sm text-text-lo">Sem histórico ainda.</div>
    );
  }

  // Use the animated values for both the scale and the points so the whole chart
  // reshapes smoothly. Fall back to the raw value if the tween array is shorter.
  const animated = data.map((d, i) => vals[i] ?? d.valueCents);
  const rawMin = Math.min(...animated);
  const rawMax = Math.max(...animated);
  const min = rawMin === rawMax ? rawMin - 1 : rawMin * (rawMin < 0 ? 1.04 : 0.96);
  const max = rawMin === rawMax ? rawMax + 1 : rawMax * (rawMax < 0 ? 0.96 : 1.02);

  const x = (i: number) => P + (i * (W - P * 2)) / (data.length - 1);
  const y = (v: number) => H - 28 - ((v - min) / (max - min)) * (H - 48);
  const pts = animated.map((v, i) => [x(i), y(v)] as const);

  const line = pts
    .map((p, i) => {
      if (i === 0) return `M ${p[0]} ${p[1]}`;
      const prev = pts[i - 1] ?? p;
      const cx = (prev[0] + p[0]) / 2;
      return `C ${cx} ${prev[1]} ${cx} ${p[1]} ${p[0]} ${p[1]}`;
    })
    .join(" ");
  const last = pts[pts.length - 1] ?? [0, 0];
  const area = `${line} L ${x(data.length - 1)} ${H - 8} L ${x(0)} ${H - 8} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="spark" aria-hidden="true">
      <defs>
        <linearGradient id="fc-area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7C5CFF" stopOpacity="0.42" />
          <stop offset="1" stopColor="#7C5CFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fc-area-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#9B79FF" />
          <stop offset="1" stopColor="#7C5CFF" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1="0"
          x2={W}
          y1={28 + f * (H - 48)}
          y2={28 + f * (H - 48)}
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="1"
        />
      ))}
      <path d={area} fill="url(#fc-area-fill)" />
      <path d={line} fill="none" stroke="url(#fc-area-line)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="5" fill="#9B79FF" stroke="#0C0A12" strokeWidth="3" />
      {data.map((d, i) => (
        <text key={d.label} x={x(i)} y={H - 4} fontSize="12" fill="#6F6985" textAnchor="middle">
          {d.label}
        </text>
      ))}
    </svg>
  );
}
