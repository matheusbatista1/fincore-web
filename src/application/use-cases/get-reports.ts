import { isExpense, type Transaction } from "@/domain/entities/transaction";
import { billingCompetence } from "@/domain/services/card-bill.calculator";
import { computeViewTotals } from "@/domain/services/personal-vs-general";
import { transactionsForMonth } from "@/domain/services/recurring.projection";
import {
  addMonths,
  type CompetenceMonth,
  compareMonths,
  monthsBetween,
} from "@/domain/value-objects/competence-month";
import { monthLabel } from "@/shared/formatting/dates";
import { currentMonthInBrazil } from "@/shared/formatting/now";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

/** One month's income/expense/net totals for the trend bars. */
export interface MonthBar {
  readonly month: CompetenceMonth;
  readonly label: string;
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly netCents: number;
  /** True for months after the current one — totals fold in projected ("previsto") recurring. */
  readonly projected: boolean;
}

/** One slice of the category-breakdown donut. */
export interface CategorySlice {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly valueCents: number;
}

/**
 * The window a report covers. `from → to` drives the monthly trend bars; the
 * category breakdown defaults to the latest month (`to`) but can span its own
 * window (`categoryFrom → categoryTo`) so the dashboard keeps a single-month
 * donut while the bars show six months, and the Reports screen can aggregate
 * categories over the whole chosen period. The range may extend into the future.
 */
export interface ReportRange {
  readonly from: CompetenceMonth;
  readonly to: CompetenceMonth;
  readonly categoryFrom?: CompetenceMonth;
  readonly categoryTo?: CompetenceMonth;
}

export interface ReportsData {
  readonly from: CompetenceMonth;
  readonly to: CompetenceMonth;
  /** Human label for the covered window ("Junho de 2026" or "jan – jun 2026"). */
  readonly rangeLabel: string;
  /** One bar per month in `[from, to]`, oldest → newest (general lens). */
  readonly months: MonthBar[];
  /** Same trend through the personal lens (only the user's own share). */
  readonly monthsPersonal: MonthBar[];
  /** Expense breakdown by category over the category window, largest → smallest (general lens). */
  readonly categories: CategorySlice[];
  /** Same breakdown through the personal lens (only the user's own share). */
  readonly categoriesPersonal: CategorySlice[];
  readonly totalExpenseCents: number;
  readonly totalExpensePersonalCents: number;
  /** True when the window reaches into the future, so some totals are projected ("previsto"). */
  readonly includesProjected: boolean;
  /** Human label of the future portion ("jul 2026" or "jul – set 2026"); "" when none. */
  readonly projectedLabel: string;
}

const UNCATEGORIZED_COLOR = "#8A93A6";

/** Order two months ascending. */
function ordered(a: CompetenceMonth, b: CompetenceMonth): [CompetenceMonth, CompetenceMonth] {
  return compareMonths(a, b) <= 0 ? [a, b] : [b, a];
}

/** Build the reports snapshot: a monthly income/expense trend + the category breakdown. */
export async function getReports(
  repo: FinanceRepository,
  userId: string,
  range: ReportRange,
): Promise<ReportsData> {
  const ws = await loadWorkspaceCached(repo, userId);
  // Card charges count in their bill's due month; everything else by its date's month.
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const current = currentMonthInBrazil();

  const [from, to] = ordered(range.from, range.to);
  const [catLo, catHi] = ordered(range.categoryFrom ?? to, range.categoryTo ?? to);

  // A month's transaction set: real movements always, plus the projected recurring
  // ("previsto") occurrences for FUTURE months — so reports of months ahead show the
  // fixed lançamentos. Past/current months stay real-only (actuals/history unchanged).
  const setForMonth = (month: CompetenceMonth): Transaction[] => {
    const { real, projected } = transactionsForMonth(ws.transactions, month, competenceOf);
    if (compareMonths(month, current) <= 0) return real;
    return [...real, ...projected.map((p) => p.source)];
  };

  const months: MonthBar[] = [];
  const monthsPersonal: MonthBar[] = [];
  const span = monthsBetween(from, to);
  for (let k = 0; k <= span; k++) {
    const month = addMonths(from, k);
    const set = setForMonth(month);
    const projected = compareMonths(month, current) > 0;
    const totals = computeViewTotals(set, "general");
    const totalsPersonal = computeViewTotals(set, "personal");
    months.push({
      month,
      label: monthLabel(month),
      incomeCents: totals.income.cents,
      expenseCents: totals.expense.cents,
      netCents: totals.net.cents,
      projected,
    });
    monthsPersonal.push({
      month,
      label: monthLabel(month),
      incomeCents: totalsPersonal.income.cents,
      expenseCents: totalsPersonal.expense.cents,
      netCents: totalsPersonal.net.cents,
      projected,
    });
  }

  // Category breakdown over the category window, one month at a time (so future
  // months can fold in projected expenses). General sums full (absolute) amounts;
  // personal sums only the user's own share (`myShareCents`).
  const categoryById = new Map(ws.categories.map((c) => [c.id, c]));
  const byCategory = new Map<string, number>();
  const byCategoryPersonal = new Map<string, number>();
  for (let k = 0; k <= monthsBetween(catLo, catHi); k++) {
    const month = addMonths(catLo, k);
    for (const tx of setForMonth(month)) {
      if (!isExpense(tx)) continue;
      const key = tx.categoryId ?? "__none__";
      byCategory.set(key, (byCategory.get(key) ?? 0) + Math.abs(tx.amountCents));
      // A fully-shared expense (myShareCents === 0) leaves the personal donut.
      if (tx.myShareCents > 0) {
        byCategoryPersonal.set(key, (byCategoryPersonal.get(key) ?? 0) + tx.myShareCents);
      }
    }
  }

  const toSlices = (totals: Map<string, number>): CategorySlice[] =>
    [...totals.entries()]
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

  const categories = toSlices(byCategory);
  const categoriesPersonal = toSlices(byCategoryPersonal);
  const totalExpenseCents = categories.reduce((sum, c) => sum + c.valueCents, 0);
  const totalExpensePersonalCents = categoriesPersonal.reduce((sum, c) => sum + c.valueCents, 0);

  const rangeLabel =
    from === to ? monthLabel(from, { long: true }) : `${monthLabel(from)} – ${monthLabel(to)}`;

  // Future portion of the window — the part whose totals fold in projected recurring.
  const includesProjected = compareMonths(to, current) > 0 || compareMonths(catHi, current) > 0;
  const lastFuture = compareMonths(catHi, to) > 0 ? catHi : to;
  const firstFuture = compareMonths(from, addMonths(current, 1)) > 0 ? from : addMonths(current, 1);
  const projectedLabel = !includesProjected
    ? ""
    : firstFuture === lastFuture
      ? monthLabel(firstFuture)
      : `${monthLabel(firstFuture)} – ${monthLabel(lastFuture)}`;

  return {
    from,
    to,
    rangeLabel,
    months,
    monthsPersonal,
    categories,
    categoriesPersonal,
    totalExpenseCents,
    totalExpensePersonalCents,
    includesProjected,
    projectedLabel,
  };
}
