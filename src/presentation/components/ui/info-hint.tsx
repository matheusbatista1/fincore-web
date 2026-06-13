"use client";

import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/presentation/components/ui/icon";

const WIDTH = 248;

/**
 * An "(i)" info button that reveals a short explanation balloon on hover
 * (desktop) and on click/focus (touch + keyboard). Closes on Escape, outside
 * click, scroll or resize. Positioned `fixed` so it escapes the modal's overflow.
 */
export function InfoHint({ children, label = "Mais informações" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipId = useId();

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const left = Math.max(10, Math.min(r.left + r.width / 2 - WIDTH / 2, window.innerWidth - WIDTH - 10));
      setPos({ top: r.bottom + 8, left });
    }
    place();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onDocPointer(e: MouseEvent) {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    }
    const close = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocPointer);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocPointer);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const balloon: CSSProperties = pos
    ? {
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: WIDTH,
        zIndex: 1100,
        background: "var(--surface-1)",
        border: "1px solid var(--line-2)",
        borderRadius: "var(--r-sm)",
        boxShadow: "var(--sh-3, 0 12px 36px rgba(0,0,0,0.4))",
        padding: "10px 12px",
        fontSize: 12.5,
        lineHeight: 1.5,
        color: "var(--text-mid)",
        fontWeight: 400,
        animation: "fc-pop 0.16s cubic-bezier(0.2, 0.7, 0.3, 1) both",
      }
    : {};

  return (
    <span style={{ display: "inline-flex", verticalAlign: "middle" }}>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          display: "inline-grid",
          placeItems: "center",
          width: 18,
          height: 18,
          marginLeft: 6,
          padding: 0,
          border: 0,
          borderRadius: "50%",
          background: "transparent",
          color: "var(--text-lo)",
          cursor: "help",
        }}
      >
        <Icon name="info" size={15} />
      </button>
      {open && pos && (
        <span id={tipId} role="tooltip" style={balloon}>
          {children}
        </span>
      )}
    </span>
  );
}
