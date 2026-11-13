import type { Workspace } from "@/application/ports/finance-repository";
import type { Transaction } from "@/domain/entities/transaction";
import type { TransactionEvent } from "@/domain/entities/transaction-event";
import { addDays, type IsoDate } from "@/domain/value-objects/competence-month";

/** R$ 10,00 off a value, or half of it when it is smaller than that. */
const less = (cents: number): number => (cents > 1000 ? cents - 1000 : Math.max(1, Math.floor(cents / 2)));

/** The transaction as it was first typed: a little cheaper, and with no note yet. */
function firstVersion(tx: Transaction): Transaction {
  const { note: _note, ...rest } = tx;
  if (rest.kind === "transfer") return { ...rest, valueCents: less(rest.valueCents) };
  const sign = rest.amountCents < 0 ? -1 : 1;
  return { ...rest, amountCents: sign * less(Math.abs(rest.amountCents)) };
}

/**
 * A made-up history for a transaction of the demo household: booked on its day for a little less,
 * and corrected the day after (never later than today). Empty for a transaction the demo does not
 * have.
 */
export function demoHistory(workspace: Workspace, transactionId: string, today: IsoDate): TransactionEvent[] {
  const tx = workspace.transactions.find((candidate) => candidate.id === transactionId);
  if (tx === undefined) return [];
  const bookedOn = tx.date < today ? tx.date : today;
  const fixedOn = addDays(bookedOn, 1) < today ? addDays(bookedOn, 1) : today;
  const first = firstVersion(tx);
  return [
    {
      id: `${tx.id}:edited`,
      transactionId: tx.id,
      kind: "updated",
      action: "edit",
      before: first,
      after: tx,
      at: new Date(`${fixedOn}T21:40:00Z`),
    },
    {
      id: `${tx.id}:created`,
      transactionId: tx.id,
      kind: "created",
      action: "create",
      before: null,
      after: first,
      at: new Date(`${bookedOn}T12:05:00Z`),
    },
  ];
}
