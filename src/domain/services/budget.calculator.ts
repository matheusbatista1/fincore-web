/**
 * budget calculator — derives how much of each category budget (orçamento) is
 * spent in a competence month.
 *
 * "Spent" is the absolute value of every expense booked in the month for the
 * budget's category (the full purchase amount, matching the reports breakdown).
 * Installments contribute the per-parcela amount of whichever parcelas fall in
 * the month. All math is in integer cents via {@link Money}.
 *
 * Pure domain code — no IO, no imports outside src/domain.
 */

import type { Budget } from "../entities/budget";
import type { Transaction } from "../entities/transaction";
import { isExpense } from "../entities/transaction";
import { Money } from "../money/money";
import type { CompetenceMonth } from "../value-objects/competence-month";
import { monthOf } from "../value-objects/competence-month";

/** A budget's usage within a month. */
export interface BudgetStatus {
  readonly budgetId: string;
  readonly categoryId: string;
  readonly limitCents: number;
  readonly spentCents: number;
  /** `limit − spent` (negative once over budget). */
  readonly remainingCents: number;
  /** `spent / limit` as a float for display (0 when the limit is non-positive). */
  readonly ratio: number;
  readonly over: boolean;
}

/** Sum the absolute expense per category for `month` (categoryId → Money). */
function spentByCategory(transactions: readonly Transaction[], month: CompetenceMonth): Map<string, Money> {
  const spent = new Map<string, Money>();
  for (const tx of transactions) {
    if (!isExpense(tx) || tx.categoryId === null || monthOf(tx.date) !== month) continue;
    const current = spent.get(tx.categoryId) ?? Money.zero();
    spent.set(tx.categoryId, current.add(Money.fromCents(Math.abs(tx.amountCents))));
  }
  return spent;
}

/** Compute each budget's spend/limit status for the given month. */
export function computeBudgetStatuses(
  budgets: readonly Budget[],
  transactions: readonly Transaction[],
  month: CompetenceMonth,
): BudgetStatus[] {
  const spent = spentByCategory(transactions, month);

  return budgets.map((budget) => {
    const spentMoney = spent.get(budget.categoryId) ?? Money.zero();
    const limit = Money.fromCents(budget.limitCents);
    return {
      budgetId: budget.id,
      categoryId: budget.categoryId,
      limitCents: budget.limitCents,
      spentCents: spentMoney.cents,
      remainingCents: limit.subtract(spentMoney).cents,
      ratio: budget.limitCents > 0 ? spentMoney.cents / budget.limitCents : 0,
      over: spentMoney.greaterThan(limit),
    };
  });
}
