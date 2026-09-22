"use client";

import { useMemo } from "react";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import {
  EditTransactionModal,
  type TxFormAccount,
  type TxFormCard,
  type TxFormCategory,
  type TxFormPerson,
} from "@/presentation/components/forms/new-transaction-dialog";
import { SettleBody } from "@/presentation/components/people/settle-person-modal";
import { DeleteScopeModal } from "@/presentation/components/transactions/delete-scope-modal";
import { InstallmentGroupModal } from "@/presentation/components/transactions/installment-group-modal";
import { PayModal } from "@/presentation/components/transactions/pay-modal";
import { ReceiveModal } from "@/presentation/components/transactions/receive-modal";
import { TxDetailModal } from "@/presentation/components/transactions/tx-detail-modal";
import { Dialog } from "@/presentation/components/ui/dialog";
import { useTxUIStore } from "@/presentation/stores/tx-ui-store";

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
  // The Settle ("Acerto") modal is opened app-wide (People profile, Visão mensal "a receber" rows)
  // via the store; it needs the accounts as a {id, label} picker.
  const settling = useTxUIStore((s) => s.settling);
  const closeSettle = useTxUIStore((s) => s.closeSettle);
  const settleAccounts = useMemo(
    () => accounts.map((a) => ({ id: a.id, label: `${a.bank} · ${a.name}` })),
    [accounts],
  );

  return (
    <>
      <TxDetailModal today={today} />
      <DeleteScopeModal transactions={transactions} />
      <InstallmentGroupModal transactions={transactions} today={today} />
      <PayModal accounts={accounts} today={today} />
      <ReceiveModal accounts={accounts} today={today} />
      <EditTransactionModal accounts={accounts} cards={cards} people={people} categories={categories} />
      <Dialog open={settling !== null} onOpenChange={(v) => !v && closeSettle()}>
        {settling && (
          <SettleBody target={settling} editing={null} accounts={settleAccounts} onDone={closeSettle} />
        )}
      </Dialog>
    </>
  );
}
