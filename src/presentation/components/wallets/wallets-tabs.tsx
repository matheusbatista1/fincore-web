"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/presentation/components/ui/icon";

/** Contas | Cartões switch atop the Carteiras page (Cartões now lives here as a tab). URL-driven
 * (?tab=) so /cards can redirect straight to the Cartões view. */
export function WalletsTabs({ active }: { active: "contas" | "cartoes" }) {
  const router = useRouter();
  return (
    <div className="view-toggle" style={{ marginBottom: 16 }}>
      <button
        type="button"
        className={active === "contas" ? "on" : ""}
        onClick={() => router.push("/wallets?tab=contas")}
      >
        <Icon name="wallet" size={15} />
        Contas
      </button>
      <button
        type="button"
        className={active === "cartoes" ? "on" : ""}
        onClick={() => router.push("/wallets?tab=cartoes")}
      >
        <Icon name="credit-card" size={15} />
        Cartões
      </button>
    </div>
  );
}
