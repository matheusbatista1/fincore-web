import { redirect } from "next/navigation";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { WalletsView } from "@/presentation/components/wallets/wallets-view";
import { currentMonthInBrazil } from "@/shared/formatting/now";

export default async function WalletsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ accounts }, transactions] = await Promise.all([
    getWorkspaceView(financeRepository, user.id),
    getTransactions(financeRepository, user.id),
  ]);

  return (
    <WalletsView accounts={accounts} transactions={transactions} currentMonth={currentMonthInBrazil()} />
  );
}
