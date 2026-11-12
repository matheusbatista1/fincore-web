import type { CompetenceMonth, IsoDate } from "../value-objects/competence-month";

/**
 * A record that an account's statement — or a card's fatura — was checked against the app
 * ("Conferir extrato") and marked as checked. It keeps WHEN and WHAT was covered, never the file
 * or its lines. Checks are a history: checking the same account again adds another one.
 */
export interface StatementCheck {
  readonly id: string;
  /** The account whose statement was checked; null when it was a card's fatura. */
  readonly accountId: string | null;
  /** The card whose fatura was checked; null when it was an account's statement. */
  readonly cardId: string | null;
  /** The fatura checked, by its due month. Set exactly when `cardId` is. */
  readonly competence: CompetenceMonth | null;
  /** The first and the last day of the file's lines. */
  readonly periodFrom: IsoDate;
  readonly periodTo: IsoDate;
  /** How many lines the file had. */
  readonly bankLines: number;
  /** What did not match when it was marked: lines with no entry, and entries with no line. */
  readonly bankOnly: number;
  readonly bookOnly: number;
  /** The day it was marked. */
  readonly checkedOn: IsoDate;
}
