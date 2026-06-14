import { redirect } from "next/navigation";
import { getMonthly } from "@/application/use-cases/get-monthly";
import { getProjectedBalances } from "@/application/use-cases/get-projected-balances";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { addMonths, isValidCompetenceMonth } from "@/domain/value-objects/competence-month";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { WalletsView } from "@/presentation/components/wallets/wallets-view";
import { currentMonthInBrazil } from "@/shared/formatting/now";

export default async function WalletsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { m } = await searchParams;
  const raw = Array.isArray(m) ? m[0] : m;
  const current = currentMonthInBrazil();
  const month = raw && isValidCompetenceMonth(raw) ? raw : current;

  const [{ accounts }, monthly, projected] = await Promise.all([
    getWorkspaceView(financeRepository, user.id),
    getMonthly(financeRepository, user.id, month),
    getProjectedBalances(financeRepository, user.id, month),
  ]);

  return (
    <WalletsView
      accounts={accounts}
      items={monthly.items}
      month={month}
      isCurrent={month === current}
      projectedTotalCents={projected.totalCents}
      projectedByAccount={projected.byAccountCents}
      prevHref={`/wallets?m=${addMonths(month, -1)}`}
      nextHref={`/wallets?m=${addMonths(month, 1)}`}
    />
  );
}
