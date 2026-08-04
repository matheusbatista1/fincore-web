/**
 * projected-balance — end-of-month projection: where each account lands by the end
 * of a browsed month, and the credit-card bills due along the way.
 *
 * Pure domain code — composes the balance calculator (real movements) with the
 * recurring projection (not-yet-booked "previsto" occurrences).
 */

import type { Account } from "../entities/account";
import type { CardBillPayment } from "../entities/card-bill-payment";
import type { Settlement } from "../entities/settlement";
import {
  type ExpenseTransaction,
  isCardCredit,
  isExpense,
  isIncome,
  isPendingReceivable,
  isRolled,
  settledIncomeCents,
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
import { freshOccurrence, projectRecurring, recurrenceIdentity } from "./recurring.projection";

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
  cardBillPayments: readonly CardBillPayment[] = [],
): Map<string, Money> {
  // Settlements dated through month-end credit/debit their account (cash actually moved),
  // so a person paying you keeps the projection consistent (receivable −X, account +X). A card
  // fatura payment dated through month-end debits its account (paying the bill moves real cash).
  const balances = computeAccountBalances(
    accounts,
    transactions,
    dateInMonth(month, 31),
    lens,
    settlements,
    cardBillPayments,
    competenceOf,
  );
  for (let m = fromMonth; compareMonths(m, month) <= 0; m = addMonths(m, 1)) {
    for (const occurrence of projectRecurring(transactions, m, competenceOf)) {
      // A projected FUTURE occurrence is a fresh instance — it must never inherit the anchor's
      // paid/received state, or accountDeltas would re-apply the anchor's cash effect every month.
      // For an expense, strip the paid state (a deferred obligation then debits no account). For an
      // income, forecast it as RECEIVED on the occurrence date into its booked account for the rule's
      // face amount — otherwise the new received-gate drops a not-yet-received recurring income and a
      // future salary would silently vanish from the projection.
      const src = occurrence.source;
      const fresh = freshOccurrence(src, occurrence.date);
      const forProjection = isIncome(fresh)
        ? { ...fresh, receivedAt: occurrence.date, receivedAccountId: fresh.accountId }
        : fresh;
      for (const [accountId, delta] of accountDeltas(forProjection, lens)) {
        const current = balances.get(accountId);
        if (current !== undefined) balances.set(accountId, current.add(delta));
      }
    }
  }

  // A pending receivable (a booked-but-not-yet-received income) is EXPECTED to land within the
  // projection window — forecast it as an account credit on its booked date so the fim-do-mês figure
  // still counts upcoming one-off income. The LIVE balance (computeAccountBalances above) correctly
  // excludes it until actually received; this only augments the forward projection.
  const monthEnd = dateInMonth(month, 31);
  for (const tx of transactions) {
    if (!isPendingReceivable(tx)) continue;
    if (tx.accountId === null || tx.date > monthEnd) continue;
    if (lens === "personal" && tx.isReimbursement) continue;
    const current = balances.get(tx.accountId);
    if (current !== undefined)
      balances.set(tx.accountId, current.add(Money.fromCents(settledIncomeCents(tx))));
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
  cardBillPayments: readonly CardBillPayment[] = [],
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
  // in the projected balance — counting it here too would double-subtract it. A PAID obligation
  // is excluded ONLY once its debit has actually landed in the projected balance — i.e. its
  // paidAt is on/before the browsed range's month-end (the same cutoff computeAccountBalances
  // uses). While paidAt is still AFTER that month-end (a payment dated later than the month being
  // projected), the debit isn't in the balance yet, so the obligation must still count as pending
  // — otherwise it would vanish from both the balance and the obligations and overstate the total.
  const obligationCutoff = dateInMonth(toMonth, 31);
  const debitLanded = (tx: Transaction): boolean =>
    isExpense(tx) && tx.paidAt != null && tx.paidAt <= obligationCutoff;
  // A PAID card fatura's charges (and its estornos) already left the balance on the pay date, so
  // its whole competence must drop from the pending obligations — else it's subtracted twice. Keyed
  // by `${cardId}|${competence}`, gated by the SAME month-end cutoff as debitLanded: while the
  // payment is dated after the browsed month-end, its debit hasn't landed yet, so the bill still
  // counts as pending (symmetric with debitLanded).
  const paidBillLanded = new Set<string>();
  for (const p of cardBillPayments) {
    if (p.date <= obligationCutoff) paidBillLanded.add(`${p.cardId}|${p.competence}`);
  }
  const isPaidCardBill = (tx: Transaction, due: CompetenceMonth): boolean =>
    (isExpense(tx) || isCardCredit(tx)) && tx.cardId !== null && paidBillLanded.has(`${tx.cardId}|${due}`);
  const isObligation = (tx: Transaction): tx is ExpenseTransaction =>
    isExpense(tx) &&
    tx.source !== "account" &&
    tx.source !== "overdraft" &&
    !isRolled(tx) &&
    !debitLanded(tx);

  let net = Money.zero();
  for (const tx of transactions) {
    const due = competenceOf(tx);
    if (compareMonths(due, fromMonth) < 0 || compareMonths(due, toMonth) > 0) continue;
    if (isPaidCardBill(tx, due)) continue; // whole fatura already paid → neither charge nor estorno counts
    if (isObligation(tx)) {
      net = net.add(amountFor(tx));
    } else if (isCardCredit(tx)) {
      net = net.subtract(Money.fromCents(tx.amountCents));
    }
  }

  // Projected recurring obligations, asked for by the month they BILL in: `projectRecurring`
  // resolves each occurrence through the same competence resolver as real rows, so a subscription
  // charged LAST month still shows up on the bill it falls due in. (Asking by calendar month
  // instead would miss exactly those, understating the bills owed in the current month.) Skip an
  // occurrence already covered by a real charge of the same rule, and dedupe among projections.
  if (currentMonth !== undefined) {
    const seen = new Set<string>();
    for (let m = fromMonth; compareMonths(m, toMonth) <= 0; m = addMonths(m, 1)) {
      for (const occ of projectRecurring(transactions, m, competenceOf)) {
        // A projected occurrence is a fresh, not-yet-paid instance — it must never inherit the
        // anchor's paid/rolled state. Otherwise paying THIS month's aluguel marks the anchor
        // debitLanded and every FUTURE month's projected aluguel silently vanishes from the
        // obligations, overstating "fim do mês".
        const source = freshOccurrence(occ.source, occ.date);
        if (!isObligation(source)) continue;
        const due = competenceOf(source);
        if (compareMonths(due, fromMonth) < 0 || compareMonths(due, toMonth) > 0) continue;
        if (isPaidCardBill(source, due)) continue; // a recurring charge on an already-paid fatura
        const key = `${due}|${recurrenceIdentity(source)}`;
        if (realCovered.has(key) || seen.has(key)) continue;
        seen.add(key);
        net = net.add(amountFor(source));
      }
    }
  }
  return net;
}
