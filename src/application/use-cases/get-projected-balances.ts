import { billingCompetence } from "@/domain/services/card-bill.calculator";
import { cardBillsDueThrough, projectedMonthEndBalances } from "@/domain/services/projected-balance";
import type { CompetenceMonth } from "@/domain/value-objects/competence-month";
import { currentMonthInBrazil } from "@/shared/formatting/now";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

export interface ProjectedBalances {
  /** Projected total at month-end AFTER paying the month's card bills. */
  readonly totalCents: number;
  /** Per-account projected balance (account movements only — no bill subtraction). */
  readonly byAccountCents: Record<string, number>;
}

/** Per-account + total projected end-of-month balances for the browsed month. */
export async function getProjectedBalances(
  repo: FinanceRepository,
  userId: string,
  month: CompetenceMonth,
): Promise<ProjectedBalances> {
  const ws = await loadWorkspaceCached(repo, userId);
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const current = currentMonthInBrazil();

  // Wallets show "what's really mine": the personal lens (only the user's share of
  // shared expenses, reimbursement income excluded). There is no general/personal
  // toggle on this screen, so the projection is always personal.
  const byAccount = projectedMonthEndBalances(
    ws.accounts,
    ws.transactions,
    month,
    competenceOf,
    current,
    "personal",
  );
  const byAccountCents: Record<string, number> = {};
  let accountsTotal = 0;
  for (const [id, value] of byAccount) {
    byAccountCents[id] = value.cents;
    accountsTotal += value.cents;
  }
  // The headline total nets the month's card bills; per-account figures do not
  // (we can't attribute which account pays a bill), so their sum differs by the bills.
  const bills = cardBillsDueThrough(ws.transactions, current, month, competenceOf, "personal", current);
  return { totalCents: accountsTotal - bills.cents, byAccountCents };
}
