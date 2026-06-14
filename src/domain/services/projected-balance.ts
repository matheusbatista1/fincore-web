/**
 * projected-balance — end-of-month projection: where each account lands by the end
 * of a browsed month, and the credit-card bills due along the way.
 *
 * Pure domain code — composes the balance calculator (real movements) with the
 * recurring projection (not-yet-booked "previsto" occurrences).
 */

import type { Account } from "../entities/account";
import { isCardCredit, isExpense, type Transaction } from "../entities/transaction";
import { Money } from "../money/money";
import {
  addMonths,
  type CompetenceMonth,
  compareMonths,
  dateInMonth,
} from "../value-objects/competence-month";
import { accountDeltas, computeAccountBalances } from "./balance.calculator";
import { projectRecurring } from "./recurring.projection";

/** Maps a transaction to its competence month (calendar month, or card bill due month). */
type CompetenceResolver = (tx: Transaction) => CompetenceMonth;

/**
 * Per-account balance projected to the END of `month`: every real movement dated
 * up to month-end, plus the recurring ("previsto") occurrences of each month in
 * `[fromMonth, month]` (so navigating to a future month accumulates the recurring
 * of the months in between, not just the target). Past months (`month < fromMonth`)
 * get only the real historical balance. This is account movement only — credit-card
 * bills are handled separately by {@link cardBillsDueThrough}.
 */
export function projectedMonthEndBalances(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  month: CompetenceMonth,
  competenceOf: CompetenceResolver,
  fromMonth: CompetenceMonth,
): Map<string, Money> {
  const balances = computeAccountBalances(accounts, transactions, dateInMonth(month, 31));
  for (let m = fromMonth; compareMonths(m, month) <= 0; m = addMonths(m, 1)) {
    for (const occurrence of projectRecurring(transactions, m, competenceOf)) {
      for (const [accountId, delta] of accountDeltas(occurrence.source)) {
        const current = balances.get(accountId);
        if (current !== undefined) balances.set(accountId, current.add(delta));
      }
    }
  }
  return balances;
}

/**
 * Net total of the credit-card bills (faturas) DUE within `[fromMonth, toMonth]`:
 * the sum of card charges minus card credits (estornos) whose bill due month falls
 * in the range. Used to subtract from the projected balance — "what's left after
 * paying the month's bills". Considers real charges (a recurring charge on a card
 * is rare and intentionally not projected here).
 */
export function cardBillsDueThrough(
  transactions: readonly Transaction[],
  fromMonth: CompetenceMonth,
  toMonth: CompetenceMonth,
  competenceOf: CompetenceResolver,
): Money {
  if (compareMonths(fromMonth, toMonth) > 0) return Money.zero();
  let net = Money.zero();
  for (const tx of transactions) {
    const due = competenceOf(tx);
    if (compareMonths(due, fromMonth) < 0 || compareMonths(due, toMonth) > 0) continue;
    if (isExpense(tx) && tx.source === "card") {
      net = net.add(Money.fromCents(tx.amountCents).abs());
    } else if (isCardCredit(tx)) {
      net = net.subtract(Money.fromCents(tx.amountCents));
    }
  }
  return net;
}
