"use client";

import { Eye, EyeOff, Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  NewTransactionDialog,
  type TxFormAccount,
  type TxFormCard,
  type TxFormCategory,
  type TxFormPerson,
} from "@/presentation/components/forms/new-transaction-dialog";
import { NAV } from "@/presentation/components/shell/nav-items";
import { Button } from "@/presentation/components/ui/button";
import { useUIStore } from "@/presentation/stores/ui-store";

function titleFor(pathname: string): string {
  const item = NAV.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  return item?.label ?? "FinCore";
}

export function AppHeader({
  accounts,
  cards,
  people,
  categories,
}: {
  accounts: TxFormAccount[];
  cards: TxFormCard[];
  people: TxFormPerson[];
  categories: TxFormCategory[];
}) {
  const pathname = usePathname();
  const privacy = useUIStore((s) => s.privacy);
  const togglePrivacy = useUIStore((s) => s.togglePrivacy);
  const canCreate = accounts.length > 0 || cards.length > 0;

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-bg-1/70 px-5 backdrop-blur-lg sm:px-8">
      <h1 className="truncate font-display text-lg font-semibold text-text-hi">{titleFor(pathname)}</h1>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={togglePrivacy}
          aria-label={privacy ? "Mostrar valores" : "Ocultar valores"}
          aria-pressed={privacy}
          className="grid size-10 place-items-center rounded-sm text-text-lo transition hover:bg-surface-2 hover:text-text-hi"
        >
          {privacy ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>

        {canCreate && (
          <NewTransactionDialog
            accounts={accounts}
            cards={cards}
            people={people}
            categories={categories}
            trigger={
              <Button size="sm">
                <Plus size={16} />
                <span className="hidden sm:inline">Novo lançamento</span>
              </Button>
            }
          />
        )}
      </div>
    </header>
  );
}
