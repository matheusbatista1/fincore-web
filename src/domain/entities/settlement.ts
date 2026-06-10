import type { IsoDate } from "../value-objects/competence-month";

/**
 * A payment that settles part or all of a person's debt (acerto). A positive
 * amount reduces what the person owes you; the person-ledger calculator clamps
 * the resulting balance so it never crosses zero.
 */
export interface Settlement {
  readonly id: string;
  readonly personId: string;
  /** Amount in cents that settles the debt (sign per the person-ledger rules). */
  readonly amountCents: number;
  readonly date: IsoDate;
  /** Account the money landed in, if it actually moved. */
  readonly accountId: string | null;
  readonly note?: string;
}
