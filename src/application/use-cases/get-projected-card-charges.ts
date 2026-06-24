import { isExpense, isRolled } from "@/domain/entities/transaction";
import { projectRecurring } from "@/domain/services/recurring.projection";
import { addMonths, type CompetenceMonth } from "@/domain/value-objects/competence-month";
import { currentMonthInBrazil } from "@/shared/formatting/now";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";
import { createTransactionMapper, type TransactionListItem } from "./get-transactions";

/**
 * A projected ("previsto") future card charge: a display row derived from a recurring
 * card rule, plus its real anchor so the Cards screen can open/edit/stop the rule.
 */
export type ProjectedCardCharge = TransactionListItem & {
  readonly projected: true;
  /** The real, persisted recurring transaction this projection derives from. */
  readonly anchor: TransactionListItem;
};

/** How many calendar months ahead to project (enough to cover ~1 year of future bills). */
const HORIZON_MONTHS = 14;

/**
 * Projected recurring CARD charges over the coming months, so the Cards screen can show the
 * fixed lançamentos that will land on the current open bill and future bills (and let the
 * user manipulate the rule). Each occurrence keeps its real CALENDAR date so the view buckets
 * it into the right bill via `cardBillMonth(date)` — projecting straight into a bill month
 * would misdate it (a card charge's calendar month differs from its bill month).
 *
 * Dedup is inherited from {@link projectRecurring}: a rule already booked (real) in a
 * calendar month emits no projection there, so a real charge is never shadowed.
 */
export async function getProjectedCardCharges(
  repo: FinanceRepository,
  userId: string,
): Promise<ProjectedCardCharge[]> {
  const ws = await loadWorkspaceCached(repo, userId);
  const map = createTransactionMapper(ws);
  const current = currentMonthInBrazil() as CompetenceMonth;

  const out: ProjectedCardCharge[] = [];
  // Project by CALENDAR month (default resolver) from the current month forward.
  for (let k = 0; k <= HORIZON_MONTHS; k++) {
    const month = addMonths(current, k);
    for (const occ of projectRecurring(ws.transactions, month)) {
      const source = occ.source;
      // Only card charges (subscriptions etc.); skip rolled/abated rules.
      if (!isExpense(source) || source.source !== "card" || source.cardId === null) continue;
      if (isRolled(source)) continue;
      const anchor = map(source);
      out.push({
        ...anchor,
        id: `proj:${source.id}:${month}`,
        date: occ.date,
        parcela: null,
        shares: [],
        projected: true,
        anchor,
      });
    }
  }
  return out;
}
