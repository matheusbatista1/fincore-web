"use client";

import type { TouchEvent } from "react";
import { useRef } from "react";

/** Horizontal swipe handlers (month navigation) — ported 1:1 from the prototype (gestures.jsx useSwipeX). */
export function useSwipeX(onLeft: () => void, onRight: () => void) {
  const ref = useRef({ x: 0, y: 0, on: false });
  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      ref.current = { x: t.clientX, y: t.clientY, on: true };
    },
    onTouchEnd: (e: TouchEvent) => {
      if (!ref.current.on) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - ref.current.x;
      const dy = t.clientY - ref.current.y;
      ref.current.on = false;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        if (dx < 0) onLeft();
        else onRight();
      }
    },
  };
}
