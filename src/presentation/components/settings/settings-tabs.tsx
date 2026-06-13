"use client";

import { type ReactNode, useState } from "react";
import { Icon } from "@/presentation/components/ui/icon";

export interface SettingsTab {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly panel: ReactNode;
}

/**
 * Top tabs for the settings page — keeps everything on /settings (no route
 * change) and just swaps the visible panel. The tab bar scrolls horizontally so
 * it stays usable on a narrow (mobile/PWA) screen.
 */
export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 18,
          overflowX: "auto",
          paddingBottom: 2,
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn btn-sm ${active === t.id ? "btn-primary" : "btn-ghost"}`}
            style={{ flex: "none" }}
            onClick={() => setActive(t.id)}
          >
            <Icon name={t.icon} size={15} />
            {t.label}
          </button>
        ))}
      </div>
      <div>{current?.panel}</div>
    </>
  );
}
