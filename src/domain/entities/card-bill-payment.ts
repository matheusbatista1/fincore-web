import type { CompetenceMonth, IsoDate } from "../value-objects/competence-month";

/**
 * Payment of a whole credit-card bill (fatura). A fatura is a computed aggregate (many charges),
 * not a persisted row, so its payment is its own record — keyed by the card and the bill's
 * competence (due) month, NOT a calendar month. Paying a fatura debits {@link accountId} by
 * {@link amountCents} on {@link date}: it is the ONLY way a card ever moves a live account balance
 * (individual charges are deferred). The amount is the bill total snapshotted at pay time.
 */
export interface CardBillPayment {
  readonly id: string;
  readonly cardId: string;
  /** The paid bill's competence (due) month `YYYY-MM` — the `billingCompetence` bucket. */
  readonly competence: CompetenceMonth;
  /** Amount actually paid, in cents (> 0). */
  readonly amountCents: number;
  /** Account the payment was drawn from (debited on {@link date}). */
  readonly accountId: string;
  /** The pay date. */
  readonly date: IsoDate;
  readonly note?: string;
}
