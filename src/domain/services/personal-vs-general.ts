/**
 * personal-vs-general — General vs Personal view totals (modo Geral / Apenas meu).
 *
 * Ported from the prototype's `fin` computation in `app/dashboard.jsx`:
 *
 *   generalExp  = Σ |expense.amount|                 (full expense amounts)
 *   generalInc  = Σ income.amount                    (all incomes)
 *   othersAll   = Σ over expenses of Σ shareMap[…]    (other people's shares)
 *   reimbAll    = Σ income.amount where reimbursement (refunds, not "your" income)
 *   personalExp = max(0, generalExp − othersAll)
 *   personalInc = max(0, generalInc − reimbAll)
 *
 * In this domain model:
 *  - An expense's other-people total is `|amount| − myShareCents`, so the user's
 *    own slice of each expense is exactly `myShareCents`. Summing `myShareCents`
 *    therefore yields `generalExp − othersAll` directly (and is never negative,
 *    since `myShareCents = |amount| − Σ split shares ≥ 0`).
 *  - A reimbursement is an income with `isReimbursement === true`; the personal
 *    income excludes those, i.e. it is the sum of non-reimbursement incomes.
 *
 * All money math goes through Money (integer cents) — no floats, no rounding drift.
 * Transfers never affect either view (no net effect on wealth).
 */

import type { Transaction } from "../entities/transaction";
import { isExpense, isIncome, isRolled } from "../entities/transaction";
import { Money } from "../money/money";
import type { CompetenceMonth } from "../value-objects/competence-month";
import { monthOf } from "../value-objects/competence-month";

/** Maps a transaction to its competence month; defaults to the calendar month of its date. */
type CompetenceResolver = (tx: Transaction) => CompetenceMonth;
const calendarCompetence: CompetenceResolver = (tx) => monthOf(tx.date);

/** Which lens to compute totals through. */
export type ViewMode = "general" | "personal";

/** Income, expense and net (income − expense) for one view, all as Money. */
export interface ViewTotals {
  readonly income: Money;
  readonly expense: Money;
  readonly net: Money;
}

/**
 * Compute the income/expense/net totals for the chosen view.
 *
 * @param transactions Source lançamentos (any mix of expense/income/transfer).
 * @param mode         `"general"` (everything) or `"personal"` (only your share).
 * @param month        Optional competence-month filter (`YYYY-MM`); when given,
 *                     only transactions whose competence falls in that month count.
 * @param competenceOf Maps each transaction to its competence month (default: the
 *                     calendar month of its date). Pass a card-aware resolver so
 *                     card charges count in their bill's due month.
 */
export function computeViewTotals(
  transactions: readonly Transaction[],
  mode: ViewMode,
  month?: CompetenceMonth,
  competenceOf: CompetenceResolver = calendarCompetence,
): ViewTotals {
  const inScope = month === undefined ? transactions : transactions.filter((t) => competenceOf(t) === month);

  const incomeParts: Money[] = [];
  const expenseParts: Money[] = [];

  for (const tx of inScope) {
    // A rolled (abated) expense is excluded — the new rolled-into debt counts instead.
    if (isRolled(tx)) continue;
    if (isIncome(tx)) {
      // A card credit (estorno/reembolso) only reduces a card bill — it is never
      // income in either lens.
      if (tx.cardId !== null) continue;
      // General counts every income; personal drops reimbursements (refunds).
      if (mode === "general" || !tx.isReimbursement) {
        incomeParts.push(Money.fromCents(tx.amountCents));
      }
    } else if (isExpense(tx)) {
      // General uses the full (absolute) amount; personal uses only the user's share.
      const part =
        mode === "general" ? Money.fromCents(tx.amountCents).abs() : Money.fromCents(tx.myShareCents);
      expenseParts.push(part);
    }
    // Transfers are intentionally ignored in both views.
  }

  const income = Money.sum(incomeParts);
  const expense = Money.sum(expenseParts);
  return { income, expense, net: income.subtract(expense) };
}
