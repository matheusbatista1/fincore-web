"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Icon } from "@/presentation/components/ui/icon";
import type { NotifItem } from "./notifications";

/** Notificações — ported 1:1 from the prototype (extras.jsx NotificationsPanel). */
export function NotificationsPanel({ items, onClose }: { items: NotifItem[]; onClose: () => void }) {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: scrim click-to-close, 1:1 with the prototype (Escape also closes).
    <div className="popover-scrim" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stops scrim close inside the panel. */}
      <div className="popover notif" onClick={(e) => e.stopPropagation()} onKeyDown={() => {}}>
        <div className="popover-head">
          <h4>Notificações</h4>
          <span className="pill purple">{items.length}</span>
        </div>
        <div className="popover-body">
          {items.length === 0 && (
            <div style={{ padding: "18px 16px", color: "var(--text-lo)", fontSize: 13.5 }}>
              Nada por aqui — tudo em dia.
            </div>
          )}
          {items.map((it) => (
            <button
              type="button"
              key={`${it.title}-${it.sub}`}
              className="notif-item"
              onClick={() => {
                router.push(it.href);
                onClose();
              }}
            >
              <span
                className="ni-ic"
                style={{ background: `var(--${it.tone}-soft)`, color: `var(--${it.tone}-500)` }}
              >
                <Icon name={it.ic} size={17} />
              </span>
              <span className="ni-main">
                <b>{it.title}</b>
                <small>{it.sub}</small>
              </span>
              <Icon name="chevron-right" size={16} />
            </button>
          ))}
        </div>
        <button type="button" className="popover-foot" onClick={onClose}>
          Marcar todas como lidas
        </button>
      </div>
    </div>
  );
}
