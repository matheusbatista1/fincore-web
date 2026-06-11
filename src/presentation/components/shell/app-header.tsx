"use client";

import { usePathname } from "next/navigation";
import {
  NewTransactionDialog,
  type TxFormAccount,
  type TxFormCard,
  type TxFormCategory,
  type TxFormPerson,
} from "@/presentation/components/forms/new-transaction-dialog";
import { titleForPath } from "@/presentation/components/shell/nav-items";
import { Icon } from "@/presentation/components/ui/icon";

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
  const canCreate = accounts.length > 0 || cards.length > 0;

  return (
    <header className="topbar">
      <span className="tb-title">{titleForPath(pathname)}</span>

      <button type="button" className="search" aria-label="Buscar">
        <Icon name="search" size={17} />
        <span style={{ flex: 1, textAlign: "left", color: "var(--text-lo)", fontSize: 14 }}>
          Buscar transações, pessoas, cartões…
        </span>
        <kbd
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-lo)",
            background: "var(--surface-3)",
            border: "1px solid var(--line-2)",
            borderRadius: 6,
            padding: "2px 7px",
          }}
        >
          ⌘K
        </kbd>
      </button>

      <div className="tb-actions">
        <button type="button" className="icon-btn" aria-label="Notificações">
          <Icon name="bell" size={19} />
        </button>
        {canCreate && (
          <NewTransactionDialog
            accounts={accounts}
            cards={cards}
            people={people}
            categories={categories}
            trigger={
              <button type="button" className="btn btn-primary">
                <Icon name="plus" size={17} />
                Novo lançamento
              </button>
            }
          />
        )}
      </div>
    </header>
  );
}
