"use client";

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
  today,
}: {
  accounts: TxFormAccount[];
  cards: TxFormCard[];
  people: TxFormPerson[];
  categories: TxFormCategory[];
  today: string;
}) {
  return (
    <>
      <TxDetailModal today={today} />
      <DeleteScopeModal />
      <EditTransactionModal accounts={accounts} cards={cards} people={people} categories={categories} />
    </>
  );
}
