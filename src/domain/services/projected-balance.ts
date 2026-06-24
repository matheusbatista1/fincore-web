/**
 * projected-balance — end-of-month projection: where each account lands by the end
 * of a browsed month, and the credit-card bills due along the way.
 *
 * Pure domain code — composes the balance calculator (real movements) with the
 * recurring projection (not-yet-booked "previsto" occurrences).
 */

import type { Account } from "../entities/account";
import type { Settlement } from "../entities/settlement";
import {
  type ExpenseTransaction,
  isCardCredit,
  isExpense,
  isRolled,
  type Transaction,
} from "../entities/transaction";
import { Money } from "../money/money";
import {
  addMonths,
  type CompetenceMonth,
  compareMonths,
  dateInMonth,
} from "../value-objects/competence-month";
import { accountDeltas, computeAccountBalances } from "./balance.calculator";
import type { ViewMode } from "./personal-vs-general";
import { projectRecurring, recurrenceIdentity } from "./recurring.projection";

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
  lens: ViewMode = "general",
  settlements: readonly Settlement[] = [],
): Map<string, Money> {
  // Settlements dated through month-end credit/debit their account (cash actually moved),
  // so a person paying you keeps the projection consistent (receivable −X, account +X).
  const balances = computeAccountBalances(accounts, transactions, dateInMonth(month, 31), lens, settlements);
  for (let m = fromMonth; compareMonths(m, month) <= 0; m = addMonths(m, 1)) {
    for (const occurrence of projectRecurring(transactions, m, competenceOf)) {
      for (const [accountId, delta] of accountDeltas(occurrence.source, lens)) {
        const current = balances.get(accountId);
        if (current !== undefined) balances.set(accountId, current.add(delta));
      }
    }
  }
  return balances;
}

/**
 * Net total of the deferred obligations DUE within `[fromMonth, toMonth]` — everything
 * paid NOT from a cash account (so not already in the account balance): card bills,
 * boletos, loan and financing parcelas. Sums those expenses (minus card credits/estornos)
 * whose competence falls in the range. Subtracted from the projected balance to get
 * "what's left after paying the month's bills". Account-source AND overdraft (cheque
 * especial) expenses are excluded here because they already reduced the projected account
 * balance (overdraft debits its linked account — see {@link accountDeltas}).
 *
 * When `currentMonth` is given, recurring obligations (e.g. subscriptions on the card,
 * a recurring boleto) are also **projected** into the future months and re-dated to their
 * occurrence date, symmetric with the projected income/expense in the account balance.
 */
export function obligationsDueThrough(
  transactions: readonly Transaction[],
  fromMonth: CompetenceMonth,
  toMonth: CompetenceMonth,
  competenceOf: CompetenceResolver,
  lens: ViewMode = "general",
  currentMonth?: CompetenceMonth,
): Money {
  if (compareMonths(fromMonth, toMonth) > 0) return Money.zero();

  const amountFor = (tx: Transaction & { readonly amountCents: number; readonly myShareCents: number }) =>
    lens === "personal" ? Money.fromCents(tx.myShareCents) : Money.fromCents(tx.amountCents).abs();

  // Bill (competence) months already occupied by a REAL recurring charge, keyed by the
  // recurring rule's identity — so a projected occurrence of the same rule landing in the
  // same bill is NOT double-counted on top of the booked charge. (A recurring CARD charge's
  // calendar month differs from its bill month, which is exactly why the calendar-based
  // dedupe inside `projectRecurring` misses it here.)
  const realCovered = new Set<string>();
  for (const tx of transactions) {
    if (isExpense(tx) && tx.recurrence !== null) {
      realCovered.add(`${competenceOf(tx)}|${recurrenceIdentity(tx)}`);
    }
  }

  // Overdraft (cheque especial) is excluded: it debits its linked account, so it is already
  // in the projected balance — counting it here too would double-subtract it.
  const isObligation = (tx: Transaction): tx is ExpenseTransaction =>
    isExpense(tx) && tx.source !== "account" && tx.source !== "overdraft" && !isRolled(tx);

  let net = Money.zero();
  for (const tx of transactions) {
    const due = competenceOf(tx);
    if (compareMonths(due, fromMonth) < 0 || compareMonths(due, toMonth) > 0) continue;
    if (isObligation(tx)) {
      net = net.add(amountFor(tx));
    } else if (isCardCredit(tx)) {
      net = net.subtract(Money.fromCents(tx.amountCents));
    }
  }

  // Projected recurring obligations: project by CHARGE month (calendar) so each monthly
  // charge is captured, then bucket by its bill competence. Skip an occurrence whose bill is
  // already covered by a real charge of the same rule, and dedupe projections among
  // themselves, so nothing is counted twice.
  if (currentMonth !== undefined) {
    const seen = new Set<string>();
    for (let m = currentMonth; compareMonths(m, toMonth) <= 0; m = addMonths(m, 1)) {
      for (const occ of projectRecurring(transactions, m)) {
        const source = occ.source;
        if (!isObligation(source)) continue;
        const due = competenceOf({ ...source, date: occ.date });
        if (compareMonths(due, fromMonth) < 0 || compareMonths(due, toMonth) > 0) continue;
        const key = `${due}|${recurrenceIdentity(source)}`;
        if (realCovered.has(key) || seen.has(key)) continue;
        seen.add(key);
        net = net.add(amountFor(source));
      }
    }
  }
  return net;
}
