import type { ComponentProps } from "react";
import type { FinanceRepository } from "@/application/ports/finance-repository";
import { getMonthly } from "@/application/use-cases/get-monthly";
import { getProjectedCardCharges } from "@/application/use-cases/get-projected-card-charges";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getLastStatementChecks } from "@/application/use-cases/statement-checks";
import { addMonths, isValidCompetenceMonth } from "@/domain/value-objects/competence-month";
import type { WalletsShell } from "@/presentation/components/wallets/wallets-shell";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";
import { nameFromEmail } from "@/shared/formatting/profile-name";

type Param = string | string[] | undefined;
const first = (value: Param): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * Everything the Carteiras screen shows (both tabs), for one user and the month in the URL.
 * Shared by the real page and the demo, so both go through the very same code.
 *
 * @param params The page's search params: `m` (the month browsed) and `tab` (`cartoes` or not).
 * @param place Where the screen lives (its month links point back to it) and the sign-in e-mail,
 *   used for the card holder's name when the profile has none.
 */
export async function loadWallets(
  repo: FinanceRepository,
  userId: string,
  params: { readonly m?: Param; readonly tab?: Param },
  place: { readonly basePath: string; readonly email: string },
): Promise<ComponentProps<typeof WalletsShell>> {
  const initialTab = first(params.tab) === "cartoes" ? "cartoes" : "contas";
  const current = currentMonthInBrazil();
  const raw = first(params.m);
  const month = raw && isValidCompetenceMonth(raw) ? raw : current;
  const today = todayInBrazil();

  // Both tabs' data is fetched up front so the Contas↔Cartões toggle is a pure client switch (no
  // server round-trip). getWorkspaceView is React-cached and shared; the rest run in parallel.
  const workspace = await getWorkspaceView(repo, userId);
  const [monthly, transactions, projectedCharges, profile, checks] = await Promise.all([
    getMonthly(repo, userId, month),
    getTransactions(repo, userId),
    getProjectedCardCharges(repo, userId),
    repo.getProfile(userId),
    getLastStatementChecks(repo, userId),
  ]);

  return {
    initialTab,
    contas: {
      accounts: workspace.accounts,
      items: monthly.items,
      paidFlows: monthly.paidObligationFlows,
      receivedFlows: monthly.receivedIncomeFlows,
      checks,
      month,
      today,
      isCurrent: month === current,
      prevHref: `${place.basePath}?m=${addMonths(month, -1)}`,
      nextHref: `${place.basePath}?m=${addMonths(month, 1)}`,
    },
    cartoes: {
      cards: workspace.cards,
      transactions,
      projectedCharges,
      cardBillDates: workspace.cardBillDates,
      cardBillPayments: workspace.cardBillPayments,
      accounts: workspace.accounts,
      today,
      currentMonth: current,
      holderName: profile.displayName ?? nameFromEmail(place.email),
    },
  };
}
