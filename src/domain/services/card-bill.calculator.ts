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

import type { CardBillDate } from "../entities/card-bill-date";
import type { CreditCard } from "../entities/credit-card";
import type { ExpenseTransaction, Transaction } from "../entities/transaction";
import { isExpense, isIncome } from "../entities/transaction";
import { Money } from "../money/money";
import {
  addMonths,
  type CompetenceMonth,
  dayOf,
  type IsoDate,
  monthOf,
} from "../value-objects/competence-month";

/** Per-fatura override of the closing/due day, keyed by the bill's competence (due) month. */
export type CardBillOverrides = ReadonlyMap<
  CompetenceMonth,
  { readonly closingDay?: number; readonly dueDay?: number }
>;

/**
 * The competence month of the bill (fatura) a card charge falls into, labelled
 * by its **due** month. A charge made after the closing day rolls into the next
 * cycle; the bill is then due in the closing month, or the month after when the
 * due day precedes the closing day (the common BR case, e.g. closes 24, due 2).
 *
 * `overrides` (keyed by competence month) pins a different closing day for a
 * single bill — only the closing day affects which fatura a charge falls in; the
 * due-day override is for display only and never moves the competence month.
 *
 * Example: closes 24, due 2 — a charge on 2026-05-26 closes 2026-06-24 and is
 * due 2026-07-02, so it belongs to the `2026-07` bill.
 */
export function cardBillMonth(
  date: IsoDate,
  closingDay: number,
  dueDay: number,
  overrides?: CardBillOverrides,
): CompetenceMonth {
  const m = monthOf(date);
  // A bill that closes in month `m` is due `dueOffset` months later (BR: closes 24, due 2 → +1).
  const dueOffset = dueDay <= closingDay ? 1 : 0;
  const candidate = addMonths(m, dueOffset);
  const closeDay = overrides?.get(candidate)?.closingDay ?? closingDay;
  const closeMonth = dayOf(date) > closeDay ? addMonths(m, 1) : m;
  return addMonths(closeMonth, dueOffset);
}

/** Group per-bill date overrides by card id, for `billingCompetence` / the cards view. */
export function cardBillOverridesByCard(
  billDates: readonly CardBillDate[],
): Map<string, Map<CompetenceMonth, { closingDay: number; dueDay: number }>> {
  const byCard = new Map<string, Map<CompetenceMonth, { closingDay: number; dueDay: number }>>();
  for (const d of billDates) {
    let inner = byCard.get(d.cardId);
    if (!inner) {
      inner = new Map();
      byCard.set(d.cardId, inner);
    }
    inner.set(d.month, { closingDay: d.closingDay, dueDay: d.dueDay });
  }
  return byCard;
}

/** A transaction's competence month: a card charge by its bill's due month, everything else by date. */
export type CompetenceResolver = (tx: Transaction) => CompetenceMonth;

/**
 * Build a competence resolver for a set of cards. Card-source expenses land in
 * the month their bill is due ({@link cardBillMonth}, honoring per-bill date
 * overrides); every other transaction (account debit, boleto, loan, financing,
 * overdraft, income, transfer) keeps the calendar month of its date.
 */
export function billingCompetence(
  cards: readonly CreditCard[],
  billDates: readonly CardBillDate[] = [],
): CompetenceResolver {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const overrides = cardBillOverridesByCard(billDates);
  return (tx) => {
    if (isExpense(tx) && tx.source === "card" && tx.cardId !== null) {
      // A manual per-charge override (moved bill) wins over the computed cycle.
      if (tx.billMonthOverride !== null) return tx.billMonthOverride;
      const card = byId.get(tx.cardId);
      if (card) return cardBillMonth(tx.date, card.closingDay, card.dueDay, overrides.get(card.id));
    }
    // A card credit (estorno) buckets into its card's bill cycle, like a charge.
    if (isIncome(tx) && tx.cardId !== null) {
      const card = byId.get(tx.cardId);
      if (card) return cardBillMonth(tx.date, card.closingDay, card.dueDay, overrides.get(card.id));
    }
    return monthOf(tx.date);
  };
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

/** Card credits (estornos) for a card: income rows whose destination is that card. */
function cardCreditTotal(cardId: string, transactions: readonly Transaction[]): Money {
  const credits = transactions
    .filter(isIncome)
    .filter((tx) => tx.cardId === cardId)
    .map((tx) => Money.fromCents(tx.amountCents));
  return Money.sum(credits);
}

/**
 * The current bill (fatura) for a single card: the sum of the absolute value of
 * every qualifying card expense, MINUS any card credits (estornos/reembolsos)
 * recorded against the card. Returns {@link Money.zero} when nothing qualifies.
 *
 * `amountCents` on an expense is stored negative; we take the absolute value, then
 * subtract credits — so a refund reduces what's owed. The result can be negative
 * (a credit balance), which callers should render as-is (clamp only meter widths).
 */
export function computeCardBill(cardId: string, transactions: readonly Transaction[]): Money {
  const qualifying = transactions
    .filter(isExpense)
    .filter((expense) => qualifiesForCurrentBill(expense, cardId))
    .map((expense) => Money.fromCents(expense.amountCents).abs());

  return Money.sum(qualifying).subtract(cardCreditTotal(cardId, transactions));
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
    if (isExpense(tx)) {
      const cardId = tx.cardId;
      // Only accumulate onto known cards; skip charges to cards we weren't asked about.
      if (cardId === null || !bills.has(cardId)) continue;
      if (!qualifiesForCurrentBill(tx, cardId)) continue;
      const current = bills.get(cardId) ?? Money.zero();
      bills.set(cardId, current.add(Money.fromCents(tx.amountCents).abs()));
    } else if (isIncome(tx) && tx.cardId !== null && bills.has(tx.cardId)) {
      // A card credit (estorno) reduces the bill.
      const current = bills.get(tx.cardId) ?? Money.zero();
      bills.set(tx.cardId, current.subtract(Money.fromCents(tx.amountCents)));
    }
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
