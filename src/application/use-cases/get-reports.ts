import { isExpense } from "@/domain/entities/transaction";
import { billingCompetence } from "@/domain/services/card-bill.calculator";
import { computeViewTotals } from "@/domain/services/personal-vs-general";
import { addMonths, type CompetenceMonth } from "@/domain/value-objects/competence-month";
import { monthLabel } from "@/shared/formatting/dates";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

/** One month's income/expense/net totals for the trend bars. */
export interface MonthBar {
  readonly month: CompetenceMonth;
  readonly label: string;
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly netCents: number;
}

/** One slice of the category-breakdown donut. */
export interface CategorySlice {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly valueCents: number;
}

export interface ReportsData {
  readonly month: CompetenceMonth;
  readonly monthLabel: string;
  /** Trailing 6 months ending at `month`, oldest → newest. */
  readonly months: MonthBar[];
  /** Expense breakdown by category for `month`, largest → smallest. */
  readonly categories: CategorySlice[];
  readonly totalExpenseCents: number;
}

const UNCATEGORIZED_COLOR = "#8A93A6";
const TRAILING_MONTHS = 6;

/** Build the reports snapshot: a 6-month income/expense trend + the month's category breakdown. */
export async function getReports(
  repo: FinanceRepository,
  userId: string,
  anchorMonth: CompetenceMonth,
): Promise<ReportsData> {
  const ws = await loadWorkspaceCached(repo, userId);
  // Card charges count in their bill's due month; everything else by its date's month.
  const competenceOf = billingCompetence(ws.creditCards);

  const months: MonthBar[] = [];
  for (let i = TRAILING_MONTHS - 1; i >= 0; i--) {
    const month = addMonths(anchorMonth, -i);
    const totals = computeViewTotals(ws.transactions, "general", month, competenceOf);
    months.push({
      month,
      label: monthLabel(month),
      incomeCents: totals.income.cents,
      expenseCents: totals.expense.cents,
      netCents: totals.net.cents,
    });
  }

  // Category breakdown for the anchor month (full expense amounts, absolute).
  const categoryById = new Map(ws.categories.map((c) => [c.id, c]));
  const byCategory = new Map<string, number>();
  for (const tx of ws.transactions) {
    if (!isExpense(tx) || competenceOf(tx) !== anchorMonth) continue;
    const key = tx.categoryId ?? "__none__";
    byCategory.set(key, (byCategory.get(key) ?? 0) + Math.abs(tx.amountCents));
  }

  const categories: CategorySlice[] = [...byCategory.entries()]
    .map(([id, valueCents]) => {
      const category = id === "__none__" ? null : categoryById.get(id);
      return {
        id,
        name: category?.name ?? "Sem categoria",
        color: category?.color || UNCATEGORIZED_COLOR,
        valueCents,
      };
    })
    .sort((a, b) => b.valueCents - a.valueCents);

  const totalExpenseCents = categories.reduce((sum, c) => sum + c.valueCents, 0);

  return {
    month: anchorMonth,
    monthLabel: monthLabel(anchorMonth, { long: true }),
    months,
    categories,
    totalExpenseCents,
  };
}
