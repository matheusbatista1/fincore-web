import { redirect } from "next/navigation";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { ReconcileView } from "@/presentation/components/reconcile/reconcile-view";
import { currentMonthInBrazil } from "@/shared/formatting/now";

/**
 * "Conferir extrato": the user picks an account (or a card) and a statement file; the screen says
 * what matches, what the app is missing and what the app has that the bank does not. `?conta=` /
 * `?cartao=` preselect the target (the link from a wallet or a card).
 */
export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<{ conta?: string | string[]; cartao?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { conta, cartao } = await searchParams;
  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;
  const workspace = await getWorkspaceView(financeRepository, user.id);
  const accountId = workspace.accounts.find((a) => a.id === first(conta))?.id;
  const cardId = workspace.cards.find((c) => c.id === first(cartao))?.id;

  return (
    <ReconcileView
      accounts={workspace.accounts.map((a) => ({ id: a.id, bank: a.bank, name: a.name }))}
      cards={workspace.cards.map((c) => ({ id: c.id, bank: c.bank, product: c.product }))}
      currentMonth={currentMonthInBrazil()}
      {...(accountId ? { initialAccountId: accountId } : {})}
      {...(cardId ? { initialCardId: cardId } : {})}
    />
  );
}
