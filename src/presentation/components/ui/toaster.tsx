"use client";

import type { CSSProperties } from "react";
import { useEffect } from "react";
import { Icon } from "@/presentation/components/ui/icon";
import { useUIStore } from "@/presentation/stores/ui-store";

const TONE: Record<string, { icon: string; style?: CSSProperties }> = {
  success: { icon: "check" },
  error: { icon: "alert-triangle", style: { background: "var(--rose-soft)", color: "var(--rose-500)" } },
  info: { icon: "info", style: { background: "var(--purple-soft)", color: "var(--purple-300)" } },
};

/**
 * Single bottom-center toast — ported 1:1 from the prototype (app.jsx `.toast`
 * with a `.ti` icon). Shows the latest queued toast; auto-dismisses in 3.2s.
 */
export function Toaster() {
  const toasts = useUIStore((s) => s.toasts);
  const current = toasts.at(-1);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => useUIStore.getState().dismissToast(current.id), 3200);
    return () => clearTimeout(timer);
  }, [current]);

  if (!current) return null;
  const tone = TONE[current.tone] ?? TONE.success;

  return (
    <output className="toast" key={current.id}>
      <span className="ti" style={tone?.style}>
        <Icon name={tone?.icon ?? "check"} size={15} />
      </span>
      {current.message}
    </output>
  );
}
