/**
 * due-digest — what there is to pay around today: the list behind the daily notification.
 *
 * Three groups, each oldest first:
 *
 * - **today** and **tomorrow**: unpaid boletos, loan and financing parcelas dated that day, and
 *   every card fatura due that day that is not marked as paid and has something to pay;
 * - **overdue**: unpaid boletos / parcelas whose date passed within the last
 *   {@link OVERDUE_WINDOW_DAYS} days. After that the app still shows them as late, but a daily
 *   reminder about the same old row would only teach the reader to ignore it.
 *
 * A fatura past its due date is not listed as overdue: like everywhere else in the app, one with no
 * payment recorded is presumed paid at the bank.
 *
 * Only rows that exist count. A fixed entry is booked on its own day (before the notification
 * goes out), so it shows up under "today", not the day before.
 */

import type { CardBillDate } from "../entities/card-bill-date";
import type { CardBillPayment } from "../entities/card-bill-payment";
import type { CreditCard } from "../entities/credit-card";
import { isPaid, isPayableObligation, isRolled, type Transaction } from "../entities/transaction";
import { addDays, dateInMonth, type IsoDate, monthOf } from "../value-objects/competence-month";
import { billingCompetence, cardBillOverridesByCard, computeCardBillForMonth } from "./card-bill.calculator";

/** How many days after its date an unpaid obligation is still worth a reminder. */
export const OVERDUE_WINDOW_DAYS = 7;

/** One thing to pay. */
export interface DueItem {
  /** What it is, in the user's own words where there are any: a description, "Fatura Nubank"… */
  readonly label: string;
  /** How much, in cents (> 0). */
  readonly cents: number;
  /** The day it is (or was) due. */
  readonly date: IsoDate;
}

export interface DueDigest {
  readonly overdue: DueItem[];
  readonly today: DueItem[];
  readonly tomorrow: DueItem[];
}

export interface DueDigestInput {
  readonly creditCards: readonly CreditCard[];
  readonly cardBillDates: readonly CardBillDate[];
  readonly cardBillPayments: readonly CardBillPayment[];
  readonly transactions: readonly Transaction[];
  readonly today: IsoDate;
}

const byDateThenLabel = (a: DueItem, b: DueItem): number =>
  a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.label.localeCompare(b.label, "pt-BR");

/** What there is to pay today, tomorrow, and what is late since a few days. */
export function dueDigest(input: DueDigestInput): DueDigest {
  const { creditCards, cardBillDates, cardBillPayments, transactions, today } = input;
  const tomorrow = addDays(today, 1);
  const overdueFrom = addDays(today, -OVERDUE_WINDOW_DAYS);
  const digest: DueDigest = { overdue: [], today: [], tomorrow: [] };
  const place = (item: DueItem): void => {
    if (item.date === today) digest.today.push(item);
    else if (item.date === tomorrow) digest.tomorrow.push(item);
    else if (item.date < today && item.date >= overdueFrom) digest.overdue.push(item);
  };

  for (const tx of transactions) {
    if (!isPayableObligation(tx) || isPaid(tx) || isRolled(tx)) continue;
    place({ label: tx.description, cents: Math.abs(tx.amountCents), date: tx.date });
  }

  // A fatura is due on its card's due day of its competence month (or that month's own override).
  const competenceOf = billingCompetence(creditCards, cardBillDates);
  const overrides = cardBillOverridesByCard(cardBillDates);
  const paid = new Set(cardBillPayments.map((payment) => `${payment.cardId}|${payment.competence}`));
  const months = new Set([monthOf(today), monthOf(tomorrow)]);
  for (const card of creditCards) {
    for (const month of months) {
      const dueOn = dateInMonth(month, overrides.get(card.id)?.get(month)?.dueDay ?? card.dueDay);
      if (dueOn !== today && dueOn !== tomorrow) continue;
      if (paid.has(`${card.id}|${month}`)) continue;
      const cents = computeCardBillForMonth(card.id, transactions, month, competenceOf).cents;
      if (cents > 0) place({ label: `Fatura ${card.bank}`, cents, date: dueOn });
    }
  }

  digest.overdue.sort(byDateThenLabel);
  digest.today.sort(byDateThenLabel);
  digest.tomorrow.sort(byDateThenLabel);
  return digest;
}

/** Whether there is anything worth a notification. */
export const hasDue = (digest: DueDigest): boolean =>
  digest.overdue.length > 0 || digest.today.length > 0 || digest.tomorrow.length > 0;
