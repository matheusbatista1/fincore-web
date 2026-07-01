import { isPaid, isPayableObligation, isRolled } from "@/domain/entities/transaction";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";
import { createTransactionMapper, type TransactionListItem } from "./get-transactions";

/**
 * The Pagamentos section: the deferred obligations the user settles individually
 * (boleto/loan/financing). Split into what's still owed ("A vencer") and what has
 * already been paid ("Pagos"). Card charges are excluded — a card is settled via its
 * whole bill (fatura), not per-charge.
 */
export interface PaymentsData {
  /** Unpaid obligations, soonest due first. */
  readonly pending: TransactionListItem[];
  /** Paid obligations, most recently paid first. */
  readonly paid: TransactionListItem[];
  /** Total still owed across all pending obligations, in cents (> 0). */
  readonly pendingTotalCents: number;
}

/** Ascending by due date (soonest first), ties broken by id for stability. */
function byDueAsc(a: TransactionListItem, b: TransactionListItem): number {
  return a.date > b.date ? 1 : a.date < b.date ? -1 : a.id > b.id ? 1 : -1;
}

/** Descending by paid date (most recent first); unpaid rows sort last. */
function byPaidDesc(a: TransactionListItem, b: TransactionListItem): number {
  const pa = a.paidAt ?? "";
  const pb = b.paidAt ?? "";
  return pa < pb ? 1 : pa > pb ? -1 : a.id < b.id ? 1 : -1;
}

/** Load the user's payable obligations, grouped into pending and paid. */
export async function getPayments(repo: FinanceRepository, userId: string): Promise<PaymentsData> {
  const ws = await loadWorkspaceCached(repo, userId);
  const map = createTransactionMapper(ws);
  const payable = ws.transactions.filter((t) => isPayableObligation(t) && !isRolled(t));

  const pending = payable
    .filter((t) => !isPaid(t))
    .map(map)
    .sort(byDueAsc);
  const paid = payable
    .filter((t) => isPaid(t))
    .map(map)
    .sort(byPaidDesc);
  const pendingTotalCents = pending.reduce((s, t) => s + Math.abs(t.amountCents), 0);

  return { pending, paid, pendingTotalCents };
}
