import { computeBudgetStatuses } from "@/domain/services/budget.calculator";
import type { CompetenceMonth } from "@/domain/value-objects/competence-month";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

/** A budget enriched with its category and month usage — serializable for RSC. */
export interface BudgetView {
  readonly id: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly categoryColor: string;
  readonly categoryIcon: string;
  readonly limitCents: number;
  readonly spentCents: number;
  readonly remainingCents: number;
  readonly ratio: number;
  readonly over: boolean;
}

export interface BudgetsData {
  readonly month: CompetenceMonth;
  readonly totalLimitCents: number;
  readonly totalSpentCents: number;
  readonly budgets: BudgetView[];
  /** Categories that don't yet have a budget — the options for creating one. */
  readonly availableCategories: { id: string; name: string; color: string; icon: string }[];
}

/** Load the user's budgets with their spend/limit status for `month`. */
export async function getBudgets(
  repo: FinanceRepository,
  userId: string,
  month: CompetenceMonth,
): Promise<BudgetsData> {
  const ws = await loadWorkspaceCached(repo, userId);
  const statuses = computeBudgetStatuses(ws.budgets, ws.transactions, month);
  const categoryById = new Map(ws.categories.map((c) => [c.id, c]));
  const budgetedCategoryIds = new Set(ws.budgets.map((b) => b.categoryId));

  const budgets: BudgetView[] = statuses
    .map((status) => {
      const category = categoryById.get(status.categoryId);
      return {
        id: status.budgetId,
        categoryId: status.categoryId,
        categoryName: category?.name ?? "Categoria",
        categoryColor: category?.color || "#7c5cff",
        categoryIcon: category?.icon || "tag",
        limitCents: status.limitCents,
        spentCents: status.spentCents,
        remainingCents: status.remainingCents,
        ratio: status.ratio,
        over: status.over,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);

  const availableCategories = ws.categories
    .filter((c) => !budgetedCategoryIds.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, color: c.color || "#7c5cff", icon: c.icon || "tag" }));

  return {
    month,
    totalLimitCents: budgets.reduce((sum, b) => sum + b.limitCents, 0),
    totalSpentCents: budgets.reduce((sum, b) => sum + b.spentCents, 0),
    budgets,
    availableCategories,
  };
}
