/**
 * Installment-schedule generator (parcelamento).
 *
 * Ports the prototype's `submitTx` "else if (inst)" branch (app.jsx ~L90-110)
 * combined with split.jsx's per-parcela unit computation (`unit = r2(A / N)`).
 *
 * The prototype computes every parcela as `round(total / N)` independently, so
 * the N parcelas may not add back to the original purchase total (rounding
 * drift of up to a few cents). Here we instead allocate the full principal
 * across the N installments with {@link Money.allocate}, which preserves every
 * cent — the N parcelas always sum EXACTLY to the principal. We then return
 * only the slice the caller asked for (`[start..end]`). See `assumptions` in
 * the task notes for the rationale.
 *
 * Pure: no IO, no framework imports; all money math goes through {@link Money}.
 */

import type { ParcelaStatus } from "../entities/transaction";
import { Money } from "../money/money";
import type { IsoDate } from "../value-objects/competence-month";
import { addMonths, dateInMonth, dayOf, monthOf } from "../value-objects/competence-month";

/** Input describing the purchase to be split into installments. */
export interface InstallmentInput {
  /** The full purchase amount (negative for an expense). */
  readonly total: Money;
  /** Total number of installments, N (>= 1). */
  readonly count: number;
  /** The current (1-based) installment number, `atual` (1..N). */
  readonly current: number;
  /** Whether to also emit the already-paid installments before `current`. */
  readonly includePrevious: boolean;
  /** Whether to also emit the future installments after `current`. */
  readonly includeNext: boolean;
  /** Base date of the `current` installment; later parcelas step by month. */
  readonly baseDate: IsoDate;
}

/** One generated installment (parcela). `amount` keeps the sign of `total`. */
export interface GeneratedInstallment {
  /** 1-based installment number. */
  readonly number: number;
  /** Total number of installments (N). */
  readonly total: number;
  /** Status relative to `current`: paga (<), atual (===), futura (>). */
  readonly status: ParcelaStatus;
  /** This parcela's amount (slice of the principal; sign preserved). */
  readonly amount: Money;
  /** This parcela's date, month-stepped from `baseDate` and end-of-month clamped. */
  readonly date: IsoDate;
}

/**
 * Generate the installment schedule for a purchase.
 *
 * The amounts are computed over the FULL N-installment plan so they sum to the
 * principal exactly, then only the installments in `[start..end]` are returned,
 * where `start = includePrevious ? 1 : current` and `end = includeNext ? N : current`.
 */
export function generateInstallments(input: InstallmentInput): GeneratedInstallment[] {
  const { total, count, current, includePrevious, includeNext, baseDate } = input;

  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`generateInstallments: count must be a positive integer, received ${count}`);
  }
  if (!Number.isInteger(current) || current < 1 || current > count) {
    throw new RangeError(
      `generateInstallments: current must be an integer in [1, ${count}], received ${current}`,
    );
  }

  // Allocate the principal evenly across all N installments. `allocate` keeps
  // every cent (largest-remainder method) and preserves the sign, so the N
  // parts sum back to `total` exactly — improving on the prototype's drift.
  const parcelas = total.allocate(new Array<number>(count).fill(1));

  // The competence month and day-of-month of the `current` installment.
  const baseMonth = monthOf(baseDate);
  const baseDay = dayOf(baseDate);

  const start = includePrevious ? 1 : current;
  const end = includeNext ? count : current;

  const result: GeneratedInstallment[] = [];
  for (let i = start; i <= end; i += 1) {
    const status: ParcelaStatus = i < current ? "paga" : i === current ? "atual" : "futura";
    // Each installment is one month apart from `current`; the day is clamped to
    // the target month's last day (e.g. day 31 in February).
    const date = dateInMonth(addMonths(baseMonth, i - current), baseDay);
    // `parcelas` is 0-indexed; installment `i` (1-based) lives at index i-1.
    const amount = parcelas[i - 1] ?? Money.zero();
    result.push({ number: i, total: count, status, amount, date });
  }

  return result;
}
