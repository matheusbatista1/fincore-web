"use client";

import { type ComponentProps, useState } from "react";
import { CardsView } from "@/presentation/components/cards/cards-view";
import { type WalletsTab, WalletsTabs } from "@/presentation/components/wallets/wallets-tabs";
import { WalletsView } from "@/presentation/components/wallets/wallets-view";

/**
 * Client shell for Carteiras: holds both tabs' already-loaded data and switches between Contas and
 * Cartões with local state — no server round-trip, so the toggle is instant (the old `router.push`
 * re-ran the whole RSC and re-fetched each tab). `?tab=` is kept in sync shallowly (history) so a
 * refresh or the /cards redirect still lands on the right tab.
 */
export function WalletsShell({
  initialTab,
  contas,
  cartoes,
}: {
  initialTab: WalletsTab;
  contas: ComponentProps<typeof WalletsView>;
  cartoes: ComponentProps<typeof CardsView>;
}) {
  const [tab, setTab] = useState<WalletsTab>(initialTab);

  const select = (next: WalletsTab) => {
    setTab(next);
    // Shallow URL sync — no refetch/navigation. Contas is the default, so it drops the param.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", next === "cartoes" ? "/wallets?tab=cartoes" : "/wallets");
    }
  };

  return (
    <>
      <WalletsTabs active={tab} onSelect={select} />
      {tab === "contas" ? <WalletsView {...contas} /> : <CardsView {...cartoes} />}
    </>
  );
}
