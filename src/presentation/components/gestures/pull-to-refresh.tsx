"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, type TouchEvent, useRef, useState } from "react";
import { Icon } from "@/presentation/components/ui/icon";
import { toast } from "@/presentation/stores/ui-store";

const THRESHOLD = 70;

/**
 * Pull-to-refresh — ported 1:1 from the prototype (gestures.jsx PullToRefresh).
 * On release past the threshold it refreshes the route data (router.refresh).
 * Touch-only: inert on desktop.
 */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const st = useRef({ y: 0, active: false });

  function start(e: TouchEvent) {
    const sc = window.scrollY || document.documentElement.scrollTop || 0;
    st.current = { y: e.touches[0]?.clientY ?? 0, active: sc <= 0 };
  }
  function move(e: TouchEvent) {
    if (!st.current.active || busy) return;
    const dy = (e.touches[0]?.clientY ?? 0) - st.current.y;
    if (dy > 0) setPull(Math.min(dy * 0.5, 90));
  }
  function end() {
    if (busy) return;
    if (pull > THRESHOLD) {
      setBusy(true);
      setPull(46);
      router.refresh();
      setTimeout(() => {
        toast("Atualizado");
        setBusy(false);
        setPull(0);
      }, 750);
    } else {
      setPull(0);
    }
  }

  return (
    <div onTouchStart={start} onTouchMove={move} onTouchEnd={end} style={{ position: "relative" }}>
      <div
        className="ptr"
        style={{
          opacity: pull > 8 ? 1 : 0,
          transform: `translateX(-50%) translateY(${pull - 4}px) rotate(${pull * 4}deg)`,
        }}
      >
        <Icon name="refresh-cw" size={18} className={busy ? "spin" : ""} />
      </div>
      <div
        style={{
          transform: pull ? `translateY(${pull}px)` : "none",
          transition: st.current.active && !busy ? "none" : "transform .25s",
        }}
      >
        {children}
      </div>
    </div>
  );
}
