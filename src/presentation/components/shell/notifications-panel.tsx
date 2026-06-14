"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Icon } from "@/presentation/components/ui/icon";
import { useNotificationsStore } from "@/presentation/stores/notifications-store";
import type { NotifItem } from "./notifications";

/** Notificações — ported 1:1 from the prototype (extras.jsx NotificationsPanel). */
export function NotificationsPanel({ items, onClose }: { items: NotifItem[]; onClose: () => void }) {
  const router = useRouter();
  const readKeys = useNotificationsStore((s) => s.readKeys);
  const markRead = useNotificationsStore((s) => s.markRead);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const unread = items.filter((it) => !readKeys.includes(it.id)).length;

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
          <span className="pill purple">{unread}</span>
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
              key={it.id}
              className="notif-item"
              style={{ opacity: readKeys.includes(it.id) ? 0.5 : 1 }}
              onClick={() => {
                markRead(it.id);
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
        <button
          type="button"
          className="popover-foot"
          onClick={() => {
            markAllRead(items.map((it) => it.id));
            onClose();
          }}
        >
          Marcar todas como lidas
        </button>
      </div>
    </div>
  );
}
