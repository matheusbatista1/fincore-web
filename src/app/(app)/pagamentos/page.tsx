import { redirect } from "next/navigation";
import { getProfileCached } from "@/application/loaders";
import { getPayments } from "@/application/use-cases/get-payments";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { PaymentsView } from "@/presentation/components/payments/payments-view";
import { todayInBrazil } from "@/shared/formatting/now";

export default async function PagamentosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [payments, profile] = await Promise.all([
    getPayments(financeRepository, user.id),
    getProfileCached(financeRepository, user.id),
  ]);

  return (
    <PaymentsView
      payments={payments}
      today={todayInBrazil()}
      autoPaymentsEnabled={profile.autoPaymentsEnabled}
    />
  );
}
