import { Pencil, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { deleteAccountAction } from "@/app/_actions/finance";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { AccountFormDialog } from "@/presentation/components/forms/account-form-dialog";
import { DeleteButton } from "@/presentation/components/forms/delete-button";
import { Button } from "@/presentation/components/ui/button";
import { Money } from "@/presentation/components/ui/money";

export default async function WalletsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { accounts } = await getWorkspaceView(financeRepository, user.id);
  const total = accounts.reduce((sum, account) => sum + account.balanceCents, 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mt-1 text-text-mid">Saldos consolidados de todas as suas contas.</p>
        </div>
        <AccountFormDialog
          trigger={
            <Button>
              <Plus size={18} />
              Nova carteira
            </Button>
          }
        />
      </header>

      <div className="rounded-lg border border-line bg-gradient-to-br from-surface-2 to-surface-1 p-6 shadow-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-faint">
          Patrimônio em contas
        </p>
        <Money cents={total} className="mt-2 block font-display text-3xl font-semibold text-text-hi" />
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-2 bg-surface-1 p-10 text-center">
          <p className="text-text-mid">Você ainda não cadastrou carteiras.</p>
          <div className="mt-4 flex justify-center">
            <AccountFormDialog
              trigger={
                <Button>
                  <Plus size={18} />
                  Criar primeira carteira
                </Button>
              }
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface-1">
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-purple-soft text-sm font-bold text-purple-200">
                  {account.bank.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-hi">{account.bank}</p>
                  <p className="truncate text-sm text-text-lo">
                    {account.name} · {account.type}
                    {account.maskedNumber ? ` · ${account.maskedNumber}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Money
                  cents={account.balanceCents}
                  className={`mr-2 font-semibold ${account.balanceCents < 0 ? "text-rose-500" : "text-text-hi"}`}
                />
                <AccountFormDialog
                  account={account}
                  trigger={
                    <button
                      type="button"
                      className="grid size-9 place-items-center rounded-sm text-text-lo transition hover:bg-surface-2 hover:text-text-hi"
                      aria-label="Editar"
                    >
                      <Pencil size={16} />
                    </button>
                  }
                />
                <DeleteButton
                  id={account.id}
                  action={deleteAccountAction}
                  confirmMessage={`Excluir a carteira ${account.bank}? As transações são preservadas.`}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
