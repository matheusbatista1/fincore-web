import { billingCompetence } from "@/domain/services/card-bill.calculator";
import { obligationsDueThrough, projectedMonthEndBalances } from "@/domain/services/projected-balance";
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

  // Wallets show the account's REAL money (the same general lens + settlements the live
  // "saldo" uses), projected to month-end — so "fim do mês" reconciles with the balance.
  // The personal/general split is about shared-expense reporting, not account cash; using
  // "personal" here dropped person settlements and overdraft debits, making the projection
  // diverge from the saldo. There is no lens toggle on this screen.
  const byAccount = projectedMonthEndBalances(
    ws.accounts,
    ws.transactions,
    month,
    competenceOf,
    current,
    "general",
    ws.settlements,
  );
  const byAccountCents: Record<string, number> = {};
  let accountsTotal = 0;
  for (const [id, value] of byAccount) {
    byAccountCents[id] = value.cents;
    accountsTotal += value.cents;
  }
  // The headline total nets the month's obligations (card bills, boletos, loan/financing
  // parcelas); per-account figures do not (we can't attribute which account pays them),
  // so their sum differs from the total by those obligations.
  const bills = obligationsDueThrough(ws.transactions, current, month, competenceOf, "general", current);
  return { totalCents: accountsTotal - bills.cents, byAccountCents };
}
