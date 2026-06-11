import { Check, Pencil, PiggyBank, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { deleteGoalAction } from "@/app/_actions/finance";
import { getGoals } from "@/application/use-cases/get-goals";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { DeleteButton } from "@/presentation/components/forms/delete-button";
import { GoalContributeDialog } from "@/presentation/components/forms/goal-contribute-dialog";
import { GoalFormDialog } from "@/presentation/components/forms/goal-form-dialog";
import { Button } from "@/presentation/components/ui/button";
import { Money } from "@/presentation/components/ui/money";

export default async function GoalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const data = await getGoals(financeRepository, user.id);

  const newButton = (
    <GoalFormDialog
      trigger={
        <Button>
          <Plus size={18} />
          Nova meta
        </Button>
      }
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mt-1 text-text-mid">Objetivos de economia e seu progresso.</p>
        </div>
        {data.goals.length > 0 && newButton}
      </header>

      {data.goals.length > 0 && (
        <div className="rounded-lg border border-line bg-gradient-to-br from-surface-2 to-surface-1 p-6 shadow-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-faint">Guardado / Alvo</p>
          <p className="mt-2 flex items-baseline gap-2">
            <Money
              cents={data.totalSavedCents}
              withSign={false}
              className="font-display text-3xl font-semibold text-mint-500"
            />
            <span className="text-text-lo">
              de <Money cents={data.totalTargetCents} withSign={false} />
            </span>
          </p>
        </div>
      )}

      {data.goals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-2 bg-surface-1 p-10 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-purple-soft text-purple-300">
            <PiggyBank size={24} />
          </div>
          <p className="text-text-mid">Crie metas de economia e acompanhe quanto falta para alcançá-las.</p>
          <div className="mt-4 flex justify-center">{newButton}</div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.goals.map((goal) => {
            const pct = Math.round(goal.ratio * 100);
            return (
              <article key={goal.id} className="rounded-lg border border-line bg-surface-1 p-5 shadow-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate font-display text-lg font-semibold text-text-hi">
                      {goal.name}
                      {goal.reached && <Check size={16} className="shrink-0 text-mint-500" />}
                    </p>
                    <p className="mt-0.5 text-sm text-text-lo">
                      <Money cents={goal.savedCents} withSign={false} /> de{" "}
                      <Money cents={goal.targetCents} withSign={false} />
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <GoalFormDialog
                      goal={goal}
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
                      id={goal.id}
                      action={deleteGoalAction}
                      confirmMessage={`Excluir a meta ${goal.name}?`}
                    />
                  </div>
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-pill bg-surface-3">
                  <div
                    className={`h-full ${goal.reached ? "bg-mint-500" : "bg-purple-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-text-lo">
                    {goal.reached ? (
                      "Meta alcançada 🎉"
                    ) : (
                      <>
                        {pct}% · faltam <Money cents={goal.remainingCents} withSign={false} />
                      </>
                    )}
                  </span>
                  {!goal.reached && (
                    <GoalContributeDialog
                      goal={{ id: goal.id, name: goal.name }}
                      trigger={
                        <Button variant="ghost" size="sm">
                          <Plus size={15} />
                          Contribuir
                        </Button>
                      }
                    />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
