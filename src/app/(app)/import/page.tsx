import { redirect } from "next/navigation";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { ImportWizard } from "@/presentation/components/forms/import-wizard";

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const workspace = await getWorkspaceView(financeRepository, user.id);

  return (
    <div className="flex flex-col gap-6">
      <ImportWizard
        accounts={workspace.accounts.map((a) => ({ id: a.id, bank: a.bank, name: a.name }))}
        cards={workspace.cards.map((c) => ({ id: c.id, bank: c.bank, product: c.product }))}
        categories={workspace.categories.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
