import { redirect } from "next/navigation";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { TransactionsView } from "@/presentation/components/transactions/transactions-view";
import { todayInBrazil } from "@/shared/formatting/now";

export default async function TransactionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const transactions = await getTransactions(financeRepository, user.id);

  return <TransactionsView transactions={transactions} today={todayInBrazil()} />;
}
