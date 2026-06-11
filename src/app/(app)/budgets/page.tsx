import { Pencil, Plus, Target } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { deleteBudgetAction } from "@/app/_actions/finance";
import { type BudgetView, getBudgets } from "@/application/use-cases/get-budgets";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { BudgetFormDialog } from "@/presentation/components/forms/budget-form-dialog";
import { DeleteButton } from "@/presentation/components/forms/delete-button";
import { Button } from "@/presentation/components/ui/button";
import { CategoryIcon } from "@/presentation/components/ui/category-icon";
import { Money } from "@/presentation/components/ui/money";
import { monthLabel } from "@/shared/formatting/dates";

function currentMonthInBrazil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);
}

function barTone(budget: BudgetView): string {
  if (budget.over) return "bg-rose-500";
  if (budget.ratio > 0.85) return "bg-amber-500";
  return "bg-mint-500";
}

export default async function BudgetsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const month = currentMonthInBrazil();
  const data = await getBudgets(financeRepository, user.id, month);
  const canCreate = data.availableCategories.length > 0;

  const newButton = (
    <BudgetFormDialog
      availableCategories={data.availableCategories}
      trigger={
        <Button>
          <Plus size={18} />
          Novo orçamento
        </Button>
      }
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-text-hi">Orçamentos</h1>
          <p className="mt-1 text-text-mid">Limites por categoria · {monthLabel(month, { long: true })}.</p>
        </div>
        {canCreate && newButton}
      </header>

      {data.budgets.length > 0 && (
        <div className="rounded-lg border border-line bg-gradient-to-br from-surface-2 to-surface-1 p-6 shadow-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-faint">Gasto / Limite</p>
          <p className="mt-2 flex items-baseline gap-2">
            <Money
              cents={data.totalSpentCents}
              withSign={false}
              className="font-display text-3xl font-semibold text-text-hi"
            />
            <span className="text-text-lo">
              de <Money cents={data.totalLimitCents} withSign={false} />
            </span>
          </p>
        </div>
      )}

      {data.budgets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-2 bg-surface-1 p-10 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-purple-soft text-purple-300">
            <Target size={24} />
          </div>
          {canCreate ? (
            <>
              <p className="text-text-mid">
                Defina limites mensais por categoria para controlar seus gastos.
              </p>
              <div className="mt-4 flex justify-center">{newButton}</div>
            </>
          ) : (
            <p className="text-text-mid">
              Crie categorias em{" "}
              <Link href="/settings" className="text-purple-300 hover:underline">
                Configurações
              </Link>{" "}
              antes de definir orçamentos.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {data.budgets.map((budget) => {
            const pct = Math.min(100, Math.round(budget.ratio * 100));
            return (
              <div key={budget.id} className="rounded-lg border border-line bg-surface-1 p-4 shadow-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-md text-white"
                      style={{ background: budget.categoryColor }}
                    >
                      <CategoryIcon name={budget.categoryIcon} size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text-hi">{budget.categoryName}</p>
                      <p className="text-sm text-text-lo">
                        <Money cents={budget.spentCents} withSign={false} /> de{" "}
                        <Money cents={budget.limitCents} withSign={false} />
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <BudgetFormDialog
                      budget={{
                        id: budget.id,
                        categoryId: budget.categoryId,
                        categoryName: budget.categoryName,
                        limitCents: budget.limitCents,
                      }}
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
                      id={budget.id}
                      action={deleteBudgetAction}
                      confirmMessage={`Remover o orçamento de ${budget.categoryName}?`}
                    />
                  </div>
                </div>

                <div className="mt-3 h-2 overflow-hidden rounded-pill bg-surface-3">
                  <div className={`h-full ${barTone(budget)}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 flex items-center justify-between text-xs">
                  <span className={budget.over ? "text-rose-500" : "text-text-lo"}>
                    {budget.over ? "Acima do limite" : `${pct}% usado`}
                  </span>
                  <span className={budget.over ? "text-rose-500" : "text-text-lo"}>
                    {budget.over ? (
                      <>
                        + <Money cents={Math.abs(budget.remainingCents)} withSign={false} />
                      </>
                    ) : (
                      <>
                        restam <Money cents={budget.remainingCents} withSign={false} />
                      </>
                    )}
                  </span>
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
