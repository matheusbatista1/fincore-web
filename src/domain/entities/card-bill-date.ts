import type { CompetenceMonth } from "../value-objects/competence-month";

/**
 * A per-bill override of a card's closing/due day for one competence (fatura)
 * month. The card's `closingDay`/`dueDay` are the defaults applied every month;
 * a `CardBillDate` pins different days for a single bill (e.g. the month the bank
 * closed early) without changing the default for the other months. Keyed by the
 * bill's competence month (its due month — how the cards screen navigates bills).
 */
export interface CardBillDate {
  readonly cardId: string;
  readonly month: CompetenceMonth;
  readonly closingDay: number;
  readonly dueDay: number;
}
