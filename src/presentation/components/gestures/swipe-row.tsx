"use client";

import { type ReactNode, type TouchEvent, useRef, useState } from "react";
import { Icon } from "@/presentation/components/ui/icon";

/**
 * Swipe-to-action row (mobile) — ported 1:1 from the prototype
 * (gestures.jsx SwipeRow): swiping left reveals Editar / Excluir.
 */
export function SwipeRow({
  onOpen,
  onEdit,
  onDelete,
  children,
}: {
  onOpen?: () => void;
  onEdit?: (() => void) | null;
  onDelete?: (() => void) | null;
  children: ReactNode;
}) {
  const [off, setOff] = useState(0);
  const st = useRef({ x: 0, base: 0, drag: false, moved: false });
  const width = onEdit && onDelete ? 128 : 64;

  function start(e: TouchEvent) {
    st.current = { x: e.touches[0]?.clientX ?? 0, base: off, drag: true, moved: false };
  }
  function move(e: TouchEvent) {
    if (!st.current.drag) return;
    const x = e.touches[0]?.clientX ?? 0;
    let nx = st.current.base + (x - st.current.x);
    if (Math.abs(x - st.current.x) > 6) st.current.moved = true;
    nx = Math.max(-width, Math.min(0, nx));
    setOff(nx);
  }
  function end() {
    st.current.drag = false;
    setOff(off < -width / 2 ? -width : 0);
  }
  function fgClick() {
    if (st.current.moved) return;
    if (off !== 0) {
      setOff(0);
      return;
    }
    onOpen?.();
  }

  return (
    <div className="swipe-row">
      <div className="swipe-actions">
        {onEdit && (
          <button
            type="button"
            className="sa-edit"
            onClick={() => {
              setOff(0);
              onEdit();
            }}
          >
            <Icon name="pencil" size={18} />
            Editar
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="sa-del"
            onClick={() => {
              setOff(0);
              onDelete();
            }}
          >
            <Icon name="trash-2" size={18} />
            Excluir
          </button>
        )}
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag surface; the row content handles keyboard access. */}
      <div
        className="swipe-fg"
        style={{
          transform: `translateX(${off}px)`,
          transition: st.current.drag ? "none" : "transform .22s",
          background: "var(--surface-1)",
        }}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
        onClick={fgClick}
        onKeyDown={() => {}}
      >
        {children}
      </div>
    </div>
  );
}
