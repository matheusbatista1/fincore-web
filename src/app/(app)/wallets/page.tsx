import { redirect } from "next/navigation";
import { getMonthly } from "@/application/use-cases/get-monthly";
import { getProjectedCardCharges } from "@/application/use-cases/get-projected-card-charges";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { addMonths, isValidCompetenceMonth } from "@/domain/value-objects/competence-month";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { CardsView } from "@/presentation/components/cards/cards-view";
import { WalletsTabs } from "@/presentation/components/wallets/wallets-tabs";
import { WalletsView } from "@/presentation/components/wallets/wallets-view";
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
  const tab = (Array.isArray(tabRaw) ? tabRaw[0] : tabRaw) === "cartoes" ? "cartoes" : "contas";

  // getWorkspaceView is React-cached and used by both tabs (accounts + cards).
  const workspace = await getWorkspaceView(financeRepository, user.id);

  if (tab === "cartoes") {
    const [transactions, projectedCharges, profile] = await Promise.all([
      getTransactions(financeRepository, user.id),
      getProjectedCardCharges(financeRepository, user.id),
      financeRepository.getProfile(user.id),
    ]);
    return (
      <>
        <WalletsTabs active="cartoes" />
        <CardsView
          cards={workspace.cards}
          transactions={transactions}
          projectedCharges={projectedCharges}
          cardBillDates={workspace.cardBillDates}
          cardBillPayments={workspace.cardBillPayments}
          accounts={workspace.accounts}
          today={todayInBrazil()}
          currentMonth={currentMonthInBrazil()}
          holderName={profile.displayName ?? nameFromEmail(user.email ?? "")}
        />
      </>
    );
  }

  const current = currentMonthInBrazil();
  const raw = Array.isArray(m) ? m[0] : m;
  const month = raw && isValidCompetenceMonth(raw) ? raw : current;
  const monthly = await getMonthly(financeRepository, user.id, month);

  return (
    <>
      <WalletsTabs active="contas" />
      <WalletsView
        accounts={workspace.accounts}
        items={monthly.items}
        paidFlows={monthly.paidObligationFlows}
        month={month}
        isCurrent={month === current}
        prevHref={`/wallets?m=${addMonths(month, -1)}`}
        nextHref={`/wallets?m=${addMonths(month, 1)}`}
      />
    </>
  );
}
