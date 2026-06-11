import { transactionsForMonth } from "@/domain/services/recurring.projection";
import type { CompetenceMonth } from "@/domain/value-objects/competence-month";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";
import { byDateDesc, createTransactionMapper, type TransactionListItem } from "./get-transactions";

/** A month-view row: a display transaction plus whether it is a (non-persisted) projection. */
export type MonthlyItem = TransactionListItem & { readonly projected: boolean };

export interface MonthlyTotals {
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly netCents: number;
}

/** Serializable monthly statement: realized totals, projected totals and the rows. */
export interface MonthlyData {
  readonly month: CompetenceMonth;
  /** Totals over real (booked) transactions only. */
  readonly realized: MonthlyTotals;
  /** Totals including projected recurring occurrences ("previsto"). */
  readonly projectedTotals: MonthlyTotals;
  readonly items: MonthlyItem[];
}

function sumTotals(items: readonly MonthlyItem[]): MonthlyTotals {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const item of items) {
    if (item.kind === "income") incomeCents += item.amountCents;
    else if (item.kind === "expense") expenseCents += Math.abs(item.amountCents);
  }
  return { incomeCents, expenseCents, netCents: incomeCents - expenseCents };
}

/** Build a month's statement: real transactions + projected fixed occurrences, with totals. */
export async function getMonthly(
  repo: FinanceRepository,
  userId: string,
  month: CompetenceMonth,
): Promise<MonthlyData> {
  const ws = await loadWorkspaceCached(repo, userId);
  const map = createTransactionMapper(ws);
  const { real, projected } = transactionsForMonth(ws.transactions, month);

  const realItems: MonthlyItem[] = real.map((tx) => ({ ...map(tx), projected: false }));
  const projectedItems: MonthlyItem[] = projected.map((p) => ({
    ...map(p.source),
    id: `proj:${p.source.id}:${month}`,
    date: p.date,
    parcela: null,
    shares: [],
    projected: true,
  }));

  const items = [...realItems, ...projectedItems].sort(byDateDesc);

  return {
    month,
    realized: sumTotals(realItems),
    projectedTotals: sumTotals(items),
    items,
  };
}
