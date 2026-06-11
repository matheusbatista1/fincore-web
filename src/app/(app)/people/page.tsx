import { redirect } from "next/navigation";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { PeopleView } from "@/presentation/components/people/people-view";
import { todayInBrazil } from "@/shared/formatting/now";

export default async function PeoplePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ people }, transactions] = await Promise.all([
    getWorkspaceView(financeRepository, user.id),
    getTransactions(financeRepository, user.id),
  ]);

  return <PeopleView people={people} transactions={transactions} today={todayInBrazil()} />;
}
