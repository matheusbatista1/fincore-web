/**
 * When the transaction form should warn that a card row lands on a fatura that was already paid.
 *
 * Paying a fatura debits an account by the bill's total at that moment; the payment never follows
 * later edits. So a row placed on a paid bill sits there without ever leaving an account, and the
 * person it is split with is charged all the same. The usual cause is a mistyped date: the purchase
 * of 26/09 typed as 26/06 lands on a bill paid months ago, out of sight.
 *
 * The warning is for what the form is about to ADD to a paid bill: a new row, a row moved onto the
 * bill, or a row already there whose amount changes. Editing anything else on a row that already
 * sits on a paid bill (its category, its description) adds nothing and stays quiet.
 */

import { type CardBilling, type PaidBill, paidBillOf } from "@/domain/services/card-bill.calculator";

export interface PaidBillNoticeInput {
  /** The billing data of the card the row is on; undefined when the row is not a card row. */
  readonly billing: CardBilling | undefined;
  readonly cardId: string | null;
  readonly date: string;
  /** What the row weighs on the bill, in cents (a charge or an estorno, unsigned). */
  readonly amountCents: number;
  /** The row being edited as it stood; null when creating. */
  readonly original: {
    readonly cardId: string | null;
    /** The bill the row was filed under (its competence month); null when it was not a card row. */
    readonly billMonth: string | null;
    readonly amountCents: number;
    /** A manual bill override on the row: it keeps the row on that bill whatever the date. */
    readonly billMonthOverride: string | null;
  } | null;
}

/** The paid fatura the form is about to add weight to, or null when there is nothing to warn about. */
export function paidBillNotice(input: PaidBillNoticeInput): PaidBill | null {
  const { billing, cardId, date, amountCents, original } = input;
  if (billing === undefined || cardId === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const bill = paidBillOf(billing, date, original?.billMonthOverride ?? null);
  if (bill === null) return null;
  const unchanged =
    original !== null &&
    original.cardId === cardId &&
    original.billMonth === bill.competence &&
    original.amountCents === amountCents;
  return unchanged ? null : bill;
}
