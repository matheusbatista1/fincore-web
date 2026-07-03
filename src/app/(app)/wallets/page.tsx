import { redirect } from "next/navigation";
import { getMonthly } from "@/application/use-cases/get-monthly";
import { getProjectedCardCharges } from "@/application/use-cases/get-projected-card-charges";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { addMonths, isValidCompetenceMonth } from "@/domain/value-objects/competence-month";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { WalletsShell } from "@/presentation/components/wallets/wallets-shell";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";
import { nameFromEmail } from "@/shared/formatting/profile-name";

export default async function WalletsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[]; tab?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { m, tab: tabRaw } = await searchParams;
  const initialTab = (Array.isArray(tabRaw) ? tabRaw[0] : tabRaw) === "cartoes" ? "cartoes" : "contas";
  const current = currentMonthInBrazil();
  const raw = Array.isArray(m) ? m[0] : m;
  const month = raw && isValidCompetenceMonth(raw) ? raw : current;
  const today = todayInBrazil();

  // Both tabs' data is fetched up front so the Contas↔Cartões toggle is a pure client switch (no
  // server round-trip). getWorkspaceView is React-cached and shared; the rest run in parallel.
  const workspace = await getWorkspaceView(financeRepository, user.id);
  const [monthly, transactions, projectedCharges, profile] = await Promise.all([
    getMonthly(financeRepository, user.id, month),
    getTransactions(financeRepository, user.id),
    getProjectedCardCharges(financeRepository, user.id),
    financeRepository.getProfile(user.id),
  ]);

  return (
    <WalletsShell
      initialTab={initialTab}
      contas={{
        accounts: workspace.accounts,
        items: monthly.items,
        paidFlows: monthly.paidObligationFlows,
        month,
        isCurrent: month === current,
        prevHref: `/wallets?m=${addMonths(month, -1)}`,
        nextHref: `/wallets?m=${addMonths(month, 1)}`,
      }}
      cartoes={{
        cards: workspace.cards,
        transactions,
        projectedCharges,
        cardBillDates: workspace.cardBillDates,
        cardBillPayments: workspace.cardBillPayments,
        accounts: workspace.accounts,
        today,
        currentMonth: current,
        holderName: profile.displayName ?? nameFromEmail(user.email ?? ""),
      }}
    />
  );
}
