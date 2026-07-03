"use client";

import { Icon } from "@/presentation/components/ui/icon";

export type WalletsTab = "contas" | "cartoes";

/** Contas | Cartões switch atop the Carteiras page. A pure client toggle (no navigation): both tabs'
 * data is loaded up front, so switching is instant; the parent shell syncs `?tab=` shallowly so
 * /cards can still deep-link to Cartões. */
export function WalletsTabs({
  active,
  onSelect,
}: {
  active: WalletsTab;
  onSelect: (tab: WalletsTab) => void;
}) {
  return (
    <div className="view-toggle" style={{ marginBottom: 16 }}>
      <button type="button" className={active === "contas" ? "on" : ""} onClick={() => onSelect("contas")}>
        <Icon name="wallet" size={15} />
        Contas
      </button>
      <button type="button" className={active === "cartoes" ? "on" : ""} onClick={() => onSelect("cartoes")}>
        <Icon name="credit-card" size={15} />
        Cartões
      </button>
    </div>
  );
}
