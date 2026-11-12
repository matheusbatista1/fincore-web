"use client";

import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/presentation/components/ui/icon";

const WIDTH = 248;
/** Space between the button and its balloon, and between the balloon and the screen's edge. */
const GAP = 8;
const EDGE = 10;

/**
 * An "(i)" button that reveals a short explanation. Each way of pointing has its own, single rule,
 * so they never undo one another:
 *
 * - **touch**: a tap opens it; a second tap, or a tap anywhere else, closes it;
 * - **mouse**: it is open while the pointer is over the button;
 * - **keyboard**: it is open while the button has keyboard focus; Escape closes it.
 *
 * (Driving hover, focus and click through one toggle — as this used to — made a tap open and close
 * it within the same gesture: on a phone the explanation never showed.)
 *
 * The balloon is rendered in a portal on <body> so it isn't clipped — nor mis-positioned — by a
 * modal ancestor that creates a containing block via `transform`. It opens under the button, or
 * above it when there is no room below, and closes on scroll or resize.
 */
export function InfoHint({ children, label = "Mais informações" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  /** How the button was last pressed — a click alone does not say. */
  const pressedWith = useRef("mouse");
  const tipId = useId();

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const button = btnRef.current;
    const tip = tipRef.current;
    if (button && tip) {
      const r = button.getBoundingClientRect();
      const width = Math.min(WIDTH, window.innerWidth - EDGE * 2);
      const height = tip.offsetHeight;
      const left = Math.max(
        EDGE,
        Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - EDGE),
      );
      const below = r.bottom + GAP;
      const fitsBelow = below + height <= window.innerHeight - EDGE;
      setPos({ top: fitsBelow ? below : Math.max(EDGE, r.top - GAP - height), left, width });
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointerDown(e: PointerEvent) {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    }
    const close = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const balloon: CSSProperties = {
    position: "fixed",
    top: pos?.top ?? 0,
    left: pos?.left ?? 0,
    width: pos?.width ?? WIDTH,
    // Rendered once out of sight to be measured, then shown where it fits.
    visibility: pos ? "visible" : "hidden",
    zIndex: 1200,
    background: "var(--surface-1)",
    border: "1px solid var(--line-2)",
    borderRadius: "var(--r-sm)",
    boxShadow: "var(--sh-3, 0 12px 36px rgba(0,0,0,0.45))",
    padding: "10px 12px",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-mid)",
    // The balloon speaks in its own voice wherever the button sits (a kicker, a bold label…).
    fontWeight: 400,
    textAlign: "left",
    textTransform: "none",
    letterSpacing: "normal",
    whiteSpace: "normal",
    ...(pos ? { animation: "fc-pop 0.16s cubic-bezier(0.2, 0.7, 0.3, 1) both" } : {}),
  };

  return (
    <span style={{ display: "inline-flex", verticalAlign: "middle" }}>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onPointerDown={(e) => {
          pressedWith.current = e.pointerType;
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") setOpen(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setOpen(false);
        }}
        onClick={(e) => {
          // Inside a label, a row or a link, the hint is its own thing: nothing else reacts to it.
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => (pressedWith.current === "mouse" ? true : !o));
        }}
        onFocus={(e) => {
          // Keyboard focus only: a tap also focuses the button, and must not count twice.
          if (e.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
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
          color: "var(--purple-300)",
          cursor: "help",
        }}
      >
        <Icon name="info" size={15} />
      </button>
      {open &&
        createPortal(
          <span ref={tipRef} id={tipId} role="tooltip" style={balloon}>
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
