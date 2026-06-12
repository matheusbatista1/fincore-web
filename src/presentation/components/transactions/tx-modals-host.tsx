"use client";

import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import {
  EditTransactionModal,
  type TxFormAccount,
  type TxFormCard,
  type TxFormCategory,
  type TxFormPerson,
} from "@/presentation/components/forms/new-transaction-dialog";
import { DeleteScopeModal } from "@/presentation/components/transactions/delete-scope-modal";
import { TxDetailModal } from "@/presentation/components/transactions/tx-detail-modal";

/**
 * Mounts the cross-screen transaction modals (detail → edit / delete-scope)
 * once in the app layout. Rows anywhere open them through the tx-ui-store.
 */
export function TxModalsHost({
  accounts,
  cards,
  people,
  categories,
  transactions,
  today,
}: {
  accounts: TxFormAccount[];
  cards: TxFormCard[];
  people: TxFormPerson[];
  categories: TxFormCategory[];
  /** Full list — used for live installment-group counts in the delete-scope modal. */
  transactions: TransactionListItem[];
  today: string;
}) {
  return (
    <>
      <TxDetailModal today={today} />
      <DeleteScopeModal transactions={transactions} />
      <EditTransactionModal accounts={accounts} cards={cards} people={people} categories={categories} />
    </>
  );
}
