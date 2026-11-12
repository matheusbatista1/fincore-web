/**
 * settlement-after-edit — what editing a row does to the settlement recorded on it.
 *
 * A received income keeps its receipt apart from the row: the day the cash landed, the account it
 * landed in, the amount. A paid obligation (boleto, loan, financing) keeps its payment the same
 * way. The balance reads THOSE, not the row. So an edit that corrects the row — a mistyped value,
 * the wrong account, the wrong day — has to carry the settlement along; otherwise the list shows
 * the corrected figure while the balance keeps the old one, and nothing on screen says why.
 *
 * But a settlement that was deliberately different from the row is a fact of its own and stays:
 * an income received for another amount, in another account or on another day; an obligation
 * settled early with a discount.
 *
 * Rule, field by field: the settlement follows the edit when it mirrored the row before the edit,
 * and is kept when it did not. An edit that changes nothing changes nothing. Pure domain code.
 */

import { type ExpenseSource, isIncome, isTransfer, type Transaction } from "../entities/transaction";
import type { IsoDate } from "../value-objects/competence-month";

/** The settlement recorded on a row: an income's receipt and an obligation's payment. */
export interface RecordedSettlement {
  readonly receivedAt: IsoDate | null;
  readonly receivedAccountId: string | null;
  readonly receivedAmountCents: number | null;
  readonly paidAt: IsoDate | null;
  readonly paidAccountId: string | null;
  readonly paidAmountCents: number | null;
}

/** The fields of an edited row a settlement can depend on. */
export interface EditedRow {
  readonly date: IsoDate;
  /** Signed as stored: positive for an income, negative for an expense. */
  readonly amountCents: number;
  readonly accountId: string | null;
  readonly cardId: string | null;
  /** How an expense is paid; null for an income or a transfer. */
  readonly source: ExpenseSource | null;
}

const NONE: RecordedSettlement = {
  receivedAt: null,
  receivedAccountId: null,
  receivedAmountCents: null,
  paidAt: null,
  paidAccountId: null,
  paidAmountCents: null,
};

/** Only a boleto, a loan or a financing is paid row by row. */
const isPayableSource = (source: ExpenseSource | null): boolean =>
  source === "boleto" || source === "loan" || source === "financing";

/**
 * The settlement a row must carry after it is edited from `before` to `after`.
 *
 * `today` (`YYYY-MM-DD`) applies the booking rule where an edit turns a row into a normal income
 * or moves a received one to a day still to come: an income dated today or earlier is received on
 * its date, a later one is a pending receivable until the user confirms it.
 */
export function settlementAfterEdit(
  before: Transaction,
  after: EditedRow,
  today: IsoDate,
): RecordedSettlement {
  if (isTransfer(before)) return NONE;

  if (isIncome(before)) {
    // A card credit (estorno) is never received: it only reduces a bill.
    if (after.cardId !== null || after.accountId === null) return NONE;
    // Turned from a card credit into a normal income: booked like a new one.
    if (before.cardId !== null) {
      return after.date <= today
        ? {
            ...NONE,
            receivedAt: after.date,
            receivedAccountId: after.accountId,
            receivedAmountCents: after.amountCents,
          }
        : NONE;
    }
    const receivedAt = before.receivedAt ?? null;
    // A pending receivable stays pending: only the Receber flow receives it.
    if (receivedAt === null) return NONE;

    const dateMirrored = receivedAt === before.date;
    // Moved to a day still to come: it will be received then, as if booked for that day.
    if (dateMirrored && after.date !== before.date && after.date > today) return NONE;
    const receivedAccountId = before.receivedAccountId ?? null;
    const receivedAmountCents = before.receivedAmountCents ?? null;
    return {
      ...NONE,
      receivedAt: dateMirrored ? after.date : receivedAt,
      receivedAccountId:
        receivedAccountId === null || receivedAccountId === before.accountId
          ? after.accountId
          : receivedAccountId,
      // null already means "the row's amount"; a stored figure follows only if it was the row's.
      receivedAmountCents:
        receivedAmountCents === null || receivedAmountCents !== before.amountCents
          ? receivedAmountCents
          : after.amountCents,
    };
  }

  const paidAt = before.paidAt ?? null;
  const paidAccountId = before.paidAccountId ?? null;
  if (paidAt === null || paidAccountId === null) return NONE;
  // Once the row is a card charge or an account debit, a per-row payment means nothing.
  if (!isPayableSource(after.source)) return NONE;
  const paidAmountCents = before.paidAmountCents ?? null;
  return {
    ...NONE,
    // The day and the account of a payment are the payment's own: the row's date is its due date.
    paidAt,
    paidAccountId,
    // null already means "the row's amount"; a discount or interest (another figure) is kept.
    paidAmountCents:
      paidAmountCents === null || paidAmountCents !== Math.abs(before.amountCents)
        ? paidAmountCents
        : Math.abs(after.amountCents),
  };
}
