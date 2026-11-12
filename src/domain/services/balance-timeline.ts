/**
 * Balance timeline — the total across accounts as it moved, day by day.
 *
 * It reads the very movements {@link computeAccountBalances} sums ({@link forEachBalanceMovement}),
 * only grouped by the day they landed on instead of by account. So for any date, the total read off
 * the timeline is exactly what the account balances add up to with that date as their cutoff — one
 * pass over the history instead of one full recomputation per date.
 *
 * Always the general lens: real cash, the figure the account balances show.
 */

import type { Account } from "../entities/account";
import type { CardBillPayment } from "../entities/card-bill-payment";
import type { Settlement } from "../entities/settlement";
import type { Transaction } from "../entities/transaction";
import { Money } from "../money/money";
import { addDays, daysBetween, type IsoDate } from "../value-objects/competence-month";
import { forEachBalanceMovement } from "./balance.calculator";

/** The net change of the total on one day. */
export interface BalanceChange {
  readonly date: IsoDate;
  readonly deltaCents: number;
}

export interface BalanceTimeline {
  /** The total before any dated movement: the sum of the opening balances. */
  readonly openingCents: number;
  /**
   * One entry per day the total moved, oldest first. A day whose movements cancel out (a transfer
   * between two of the accounts, an expense refunded the same day) is absent.
   */
  readonly changes: readonly BalanceChange[];
}

/** Build the timeline of the total balance of `accounts`. */
export function computeBalanceTimeline(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  settlements: readonly Settlement[] = [],
  cardBillPayments: readonly CardBillPayment[] = [],
): BalanceTimeline {
  // Keyed by id, as the balances are: an account listed twice counts once.
  const openings = new Map<string, Money>();
  for (const account of accounts) openings.set(account.id, Money.fromCents(account.openingBalanceCents));
  const opening = Money.sum([...openings.values()]);

  const byDate = new Map<IsoDate, Money>();
  forEachBalanceMovement(
    { transactions, settlements, cardBillPayments, lens: "general" },
    (accountId) => openings.has(accountId),
    (date, _accountId, delta) => {
      byDate.set(date, (byDate.get(date) ?? Money.zero()).add(delta));
    },
  );

  const changes: BalanceChange[] = [];
  for (const [date, delta] of byDate) {
    if (!delta.isZero()) changes.push({ date, deltaCents: delta.cents });
  }
  // ISO dates sort like the calendar; one entry per day, so no two are equal.
  changes.sort((a, b) => (a.date < b.date ? -1 : 1));

  return { openingCents: opening.cents, changes };
}

/** The total at the end of `date` (every movement up to and including that day). */
export function totalBalanceAt(timeline: BalanceTimeline, date: IsoDate): number {
  let total = timeline.openingCents;
  for (const change of timeline.changes) {
    if (change.date > date) break;
    total += change.deltaCents;
  }
  return total;
}

/**
 * The total at the end of each day from `from` to `to`, both inclusive — one entry per calendar
 * day, so a day with no movement repeats the previous total. Empty when `to` is before `from`.
 */
export function dailyTotalBalances(timeline: BalanceTimeline, from: IsoDate, to: IsoDate): number[] {
  const days = daysBetween(from, to) + 1;
  if (days <= 0) return [];

  const { changes } = timeline;
  const totals: number[] = [];
  let running = timeline.openingCents;
  let next = 0;
  let date = from;
  for (let i = 0; i < days; i++) {
    // Everything dated before the window lands on its first day's total.
    for (let change = changes[next]; change !== undefined && change.date <= date; change = changes[next]) {
      running += change.deltaCents;
      next += 1;
    }
    totals.push(running);
    date = addDays(date, 1);
  }
  return totals;
}
