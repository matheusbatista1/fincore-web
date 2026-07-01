import { redirect } from "next/navigation";
import { getPayments } from "@/application/use-cases/get-payments";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { PaymentsView } from "@/presentation/components/payments/payments-view";
import { todayInBrazil } from "@/shared/formatting/now";

export default async function PagamentosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const payments = await getPayments(financeRepository, user.id);

  return <PaymentsView payments={payments} today={todayInBrazil()} />;
}
