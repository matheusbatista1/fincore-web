import { redirect } from "next/navigation";
import { getStatement } from "@/application/use-cases/get-statement";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { TransactionsView } from "@/presentation/components/transactions/transactions-view";
import { todayInBrazil } from "@/shared/formatting/now";

export default async function TransactionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { executed, future } = await getStatement(financeRepository, user.id);

  return <TransactionsView executed={executed} future={future} today={todayInBrazil()} />;
}
