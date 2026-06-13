"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import {
  NewTransactionDialog,
  type TxFormAccount,
  type TxFormCard,
  type TxFormCategory,
  type TxFormPerson,
} from "@/presentation/components/forms/new-transaction-dialog";
import { titleForPath } from "@/presentation/components/shell/nav-items";
import { deriveNotifications, type NotifData } from "@/presentation/components/shell/notifications";
import { NotificationsPanel } from "@/presentation/components/shell/notifications-panel";
import {
  type SearchCard,
  SearchPalette,
  type SearchPerson,
} from "@/presentation/components/shell/search-palette";
import { Icon } from "@/presentation/components/ui/icon";

export function AppHeader({
  accounts,
  cards,
  people,
  categories,
  searchPeople,
  searchCards,
  transactions,
  notif,
}: {
  accounts: TxFormAccount[];
  cards: TxFormCard[];
  people: TxFormPerson[];
  categories: TxFormCategory[];
  searchPeople: SearchPerson[];
  searchCards: SearchCard[];
  transactions: TransactionListItem[];
  notif: NotifData;
}) {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const notifItems = deriveNotifications(notif);

  // ⌘K / Ctrl+K opens the search palette (prototype behavior).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="topbar">
      <span className="tb-title">{titleForPath(pathname)}</span>

      <button
        type="button"
        className="search"
        aria-label="Buscar"
        style={{ cursor: "text" }}
        onClick={() => setSearchOpen(true)}
      >
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
        <button
          type="button"
          className="icon-btn"
          title="Notificações"
          aria-label="Notificações"
          onClick={() => setNotifOpen((o) => !o)}
        >
          <Icon name="bell" size={19} />
          {notifItems.length > 0 && <span className="dot" />}
        </button>
        <NewTransactionDialog
          accounts={accounts}
          cards={cards}
          people={people}
          categories={categories}
          trigger={
            <button type="button" className="btn btn-primary" data-tour="new-tx">
              <Icon name="plus" size={17} />
              Novo lançamento
            </button>
          }
        />
      </div>

      {searchOpen && (
        <SearchPalette
          people={searchPeople}
          cards={searchCards}
          transactions={transactions}
          today={notif.today}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {notifOpen && <NotificationsPanel items={notifItems} onClose={() => setNotifOpen(false)} />}
    </header>
  );
}
