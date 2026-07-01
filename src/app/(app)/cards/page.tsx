import { redirect } from "next/navigation";
import { getProjectedCardCharges } from "@/application/use-cases/get-projected-card-charges";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { CardsView } from "@/presentation/components/cards/cards-view";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";
import { nameFromEmail } from "@/shared/formatting/profile-name";

export default async function CardsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ cards, cardBillDates, cardBillPayments, accounts }, transactions, projectedCharges, profile] =
    await Promise.all([
      getWorkspaceView(financeRepository, user.id),
      getTransactions(financeRepository, user.id),
      getProjectedCardCharges(financeRepository, user.id),
      financeRepository.getProfile(user.id),
    ]);
  const holderName = profile.displayName ?? nameFromEmail(user.email ?? "");

  return (
    <CardsView
      cards={cards}
      transactions={transactions}
      projectedCharges={projectedCharges}
      cardBillDates={cardBillDates}
      cardBillPayments={cardBillPayments}
      accounts={accounts}
      today={todayInBrazil()}
      currentMonth={currentMonthInBrazil()}
      holderName={holderName}
    />
  );
}
