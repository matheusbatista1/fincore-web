import { billingCompetence } from "@/domain/services/card-bill.calculator";
import { transactionsForMonth } from "@/domain/services/recurring.projection";
import type { CompetenceMonth } from "@/domain/value-objects/competence-month";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";
import { byDateDesc, createTransactionMapper, type TransactionListItem } from "./get-transactions";

/** A month-view row: a display transaction plus whether it is a (non-persisted) projection. */
export type MonthlyItem = TransactionListItem & {
  readonly projected: boolean;
  /**
   * For a projected ("previsto") row, the real anchor transaction the projection
   * derives from — so clicking it can open/edit/delete the recurring rule. Null
   * on real rows.
   */
  readonly anchor: TransactionListItem | null;
};

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
    // A card credit (estorno, income with a cardId) only reduces a card bill — it
    // is shown on the Cards screen, not counted as monthly income.
    if (item.kind === "income" && item.cardId === null) incomeCents += item.amountCents;
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
  // Card charges count in their bill's due month; everything else by its date's month.
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const { real, projected } = transactionsForMonth(ws.transactions, month, competenceOf);

  const realItems: MonthlyItem[] = real.map((tx) => ({ ...map(tx), projected: false, anchor: null }));
  const projectedItems: MonthlyItem[] = projected.map((p) => {
    const anchor = map(p.source);
    return {
      ...anchor,
      id: `proj:${p.source.id}:${month}`,
      date: p.date,
      parcela: null,
      shares: [],
      projected: true,
      // The real, persisted source row — opening this lets the user edit/delete the rule.
      anchor,
    };
  });

  const items = [...realItems, ...projectedItems].sort(byDateDesc);

  return {
    month,
    realized: sumTotals(realItems),
    projectedTotals: sumTotals(items),
    items,
  };
}
