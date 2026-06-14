/**
 * card-bill.calculator — current credit-card bill (fatura) per card.
 *
 * Ported from the prototype's `txDeltas` (the `d.card` effect) in
 * `Finance Pessoal/app/app.jsx`:
 *
 *   if (tx.parcelaStatus === 'paga' || tx.parcelaStatus === 'futura') return d;  // skip
 *   if (tx.amount < 0 && tx.card) d.card[tx.card] += Math.abs(tx.amount);        // charge
 *
 * In other words, the current bill of a card is the sum of |amount| over every
 * **expense** charged to that card (source === "card", cardId set) whose
 * installment status qualifies for the current cycle:
 *   - a non-installment card expense always counts, in full;
 *   - an installment expense counts ONLY when its parcela status is "atual";
 *     "paga" (already billed) and "futura" (not yet billed) are excluded.
 *
 * All arithmetic flows through {@link Money} (integer cents) so there is no
 * float drift — the prototype's r2() on Reais is replaced by exact cent math.
 */

import type { CreditCard } from "../entities/credit-card";
import type { ExpenseTransaction, Transaction } from "../entities/transaction";
import { isExpense } from "../entities/transaction";
import { Money } from "../money/money";
import {
  addMonths,
  type CompetenceMonth,
  dayOf,
  type IsoDate,
  monthOf,
} from "../value-objects/competence-month";

/**
 * The competence month of the bill (fatura) a card charge falls into, labelled
 * by its **due** month. A charge made after the closing day rolls into the next
 * cycle; the bill is then due in the closing month, or the month after when the
 * due day precedes the closing day (the common BR case, e.g. closes 24, due 2).
 *
 * Example: closes 24, due 2 — a charge on 2026-05-26 closes 2026-06-24 and is
 * due 2026-07-02, so it belongs to the `2026-07` bill.
 */
export function cardBillMonth(date: IsoDate, closingDay: number, dueDay: number): CompetenceMonth {
  const closeMonth = addMonths(monthOf(date), dayOf(date) > closingDay ? 1 : 0);
  return addMonths(closeMonth, dueDay <= closingDay ? 1 : 0);
}

/**
 * Does this expense count toward the current bill of `cardId`?
 *
 * An expense qualifies when it is paid by card, charged to the given card, and
 * either has no installment plan or its current installment is "atual".
 */
function qualifiesForCurrentBill(expense: ExpenseTransaction, cardId: string): boolean {
  // Must be a card charge on the target card.
  if (expense.source !== "card" || expense.cardId !== cardId) return false;

  // Non-installment card expenses count in full.
  if (expense.installment === null) return true;

  // Only the "atual" installment of a purchase hits the current bill;
  // "paga" was billed in a past cycle and "futura" in a later one.
  return expense.installment.status === "atual";
}

/**
 * The current bill (fatura) for a single card: the sum of the absolute value of
 * every qualifying card expense. Returns {@link Money.zero} when nothing
 * qualifies (unknown card, no charges, only paid/future installments, etc.).
 *
 * `amountCents` on an expense is stored negative; we take the absolute value so
 * the bill is a non-negative amount owed.
 */
export function computeCardBill(cardId: string, transactions: readonly Transaction[]): Money {
  const qualifying = transactions
    .filter(isExpense)
    .filter((expense) => qualifiesForCurrentBill(expense, cardId))
    .map((expense) => Money.fromCents(expense.amountCents).abs());

  return Money.sum(qualifying);
}

/**
 * The current bill for every supplied card, keyed by card id. Every card in
 * `cards` is present in the result (cards with no qualifying charges map to
 * {@link Money.zero}); the map insertion order follows `cards`.
 *
 * Expenses charged to a card not present in `cards` are ignored, matching the
 * prototype where unknown card ids simply have no card to update.
 */
export function computeCardBills(
  cards: readonly CreditCard[],
  transactions: readonly Transaction[],
): Map<string, Money> {
  const bills = new Map<string, Money>();

  // Seed every known card with zero so callers get a total entry per card.
  for (const card of cards) {
    bills.set(card.id, Money.zero());
  }

  for (const tx of transactions) {
    if (!isExpense(tx)) continue;
    const cardId = tx.cardId;
    // Only accumulate onto known cards; skip charges to cards we weren't asked about.
    if (cardId === null || !bills.has(cardId)) continue;
    if (!qualifiesForCurrentBill(tx, cardId)) continue;

    const current = bills.get(cardId) ?? Money.zero();
    bills.set(cardId, current.add(Money.fromCents(tx.amountCents).abs()));
  }

  return bills;
}

/**
 * Card utilization: the bill as a fraction of the card's credit limit.
 *
 * Returns a ratio in [0, Infinity): e.g. 0.5 means the bill uses half the
 * limit, 1 means it equals the limit, and > 1 means the limit is exceeded.
 * A non-positive limit yields 0 when the bill is zero and Infinity otherwise,
 * avoiding division by zero / NaN. The result is a plain number (a ratio, not
 * an amount) and is intentionally not Money.
 */
export function cardUtilization(bill: Money, card: CreditCard): number {
  const limit = card.limitCents;
  if (limit <= 0) return bill.isZero() ? 0 : Number.POSITIVE_INFINITY;
  return bill.cents / limit;
}
