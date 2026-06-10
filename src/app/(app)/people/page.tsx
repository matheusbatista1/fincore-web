import { Handshake, Pencil, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { deletePersonAction } from "@/app/_actions/finance";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { DeleteButton } from "@/presentation/components/forms/delete-button";
import { PersonFormDialog } from "@/presentation/components/forms/person-form-dialog";
import { SettlePersonDialog } from "@/presentation/components/forms/settle-person-dialog";
import { Button } from "@/presentation/components/ui/button";
import { Money } from "@/presentation/components/ui/money";

export default async function PeoplePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { people, accounts } = await getWorkspaceView(financeRepository, user.id);
  const settleAccounts = accounts.map((a) => ({ id: a.id, bank: a.bank, name: a.name }));
  const toReceive = people.filter((p) => p.balanceCents > 0).reduce((s, p) => s + p.balanceCents, 0);
  const toPay = people.filter((p) => p.balanceCents < 0).reduce((s, p) => s + Math.abs(p.balanceCents), 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-text-hi">Pessoas</h1>
          <p className="mt-1 text-text-mid">Quem te deve, quem você deve e despesas compartilhadas.</p>
        </div>
        <PersonFormDialog
          trigger={
            <Button>
              <Plus size={18} />
              Nova pessoa
            </Button>
          }
        />
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface-1 p-5 shadow-2">
          <p className="text-xs uppercase tracking-widest text-text-faint">A receber</p>
          <Money
            cents={toReceive}
            withSign={false}
            className="font-display text-2xl font-semibold text-mint-500"
          />
        </div>
        <div className="rounded-lg border border-line bg-surface-1 p-5 shadow-2">
          <p className="text-xs uppercase tracking-widest text-text-faint">Você deve</p>
          <Money
            cents={toPay}
            withSign={false}
            className="font-display text-2xl font-semibold text-rose-500"
          />
        </div>
      </div>

      {people.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-2 bg-surface-1 p-10 text-center">
          <p className="text-text-mid">Você ainda não cadastrou pessoas.</p>
          <div className="mt-4 flex justify-center">
            <PersonFormDialog
              trigger={
                <Button>
                  <Plus size={18} />
                  Adicionar pessoa
                </Button>
              }
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface-1">
          {people.map((person) => {
            const settled = person.balanceCents === 0;
            const owesYou = person.balanceCents > 0;
            return (
              <div key={person.id} className="flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold text-on-purple"
                    style={{ background: person.color || "#7c5cff" }}
                  >
                    {person.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text-hi">{person.name}</p>
                    <p className="truncate text-sm text-text-lo">
                      {person.relationship || (settled ? "quitado" : owesYou ? "te deve" : "você deve")}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Money
                    cents={Math.abs(person.balanceCents)}
                    withSign={false}
                    className={`mr-2 font-semibold ${settled ? "text-text-lo" : owesYou ? "text-mint-500" : "text-rose-500"}`}
                  />
                  {!settled && (
                    <SettlePersonDialog
                      person={{ id: person.id, name: person.name, balanceCents: person.balanceCents }}
                      accounts={settleAccounts}
                      trigger={
                        <button
                          type="button"
                          className="grid size-9 place-items-center rounded-sm text-text-lo transition hover:bg-mint-soft hover:text-mint-500"
                          aria-label="Quitar"
                        >
                          <Handshake size={16} />
                        </button>
                      }
                    />
                  )}
                  <PersonFormDialog
                    person={person}
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
                    id={person.id}
                    action={deletePersonAction}
                    confirmMessage={`Excluir ${person.name}?`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
