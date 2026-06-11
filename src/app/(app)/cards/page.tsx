import { redirect } from "next/navigation";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { CardsView } from "@/presentation/components/cards/cards-view";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";

export default async function CardsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ cards }, transactions] = await Promise.all([
    getWorkspaceView(financeRepository, user.id),
    getTransactions(financeRepository, user.id),
  ]);

  return (
    <CardsView
      cards={cards}
      transactions={transactions}
      today={todayInBrazil()}
      currentMonth={currentMonthInBrazil()}
    />
  );
}
