import { redirect } from "next/navigation";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { TransactionsView } from "@/presentation/components/transactions/transactions-view";
import { todayInBrazil } from "@/shared/formatting/now";

export default async function TransactionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [transactions, workspace] = await Promise.all([
    getTransactions(financeRepository, user.id),
    getWorkspaceView(financeRepository, user.id),
  ]);
  const categories = workspace.categories.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    icon: c.icon,
  }));

  return <TransactionsView transactions={transactions} categories={categories} today={todayInBrazil()} />;
}
