import Link from "next/link";
import { redirect } from "next/navigation";
import { type BudgetView, getBudgets } from "@/application/use-cases/get-budgets";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { BudgetFormDialog } from "@/presentation/components/forms/budget-form-dialog";
import { CategoryIcon } from "@/presentation/components/ui/category-icon";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { monthLabel } from "@/shared/formatting/dates";
import { currentMonthInBrazil } from "@/shared/formatting/now";

function meterClass(budget: BudgetView): string {
  if (budget.over) return "danger";
  if (budget.ratio > 0.85) return "warn";
  return "";
}

export default async function BudgetsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const month = currentMonthInBrazil();
  const data = await getBudgets(financeRepository, user.id, month);
  const canCreate = data.availableCategories.length > 0;

  return (
    <div className="budgets-page">
      {data.budgets.length > 0 && (
        <div className="card card-pad rise" style={{ marginBottom: 18 }}>
          <span className="kicker">Gasto / Limite · {monthLabel(month, { long: true })}</span>
          <div
            className="fc-bignum"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 40,
              fontWeight: 600,
              color: "var(--text-hi)",
              letterSpacing: "-0.03em",
              marginTop: 6,
              lineHeight: 1,
            }}
          >
            <Money cents={data.totalSpentCents} withSign={false} />
          </div>
          <div style={{ color: "var(--text-lo)", fontSize: 13.5, marginTop: 8 }}>
            de <Money cents={data.totalLimitCents} withSign={false} /> orçados em {data.budgets.length}{" "}
            {data.budgets.length === 1 ? "categoria" : "categorias"}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Orçamentos</h3>
            <div className="ch-sub">Limites mensais por categoria</div>
          </div>
          {canCreate && (
            <BudgetFormDialog
              availableCategories={data.availableCategories}
              trigger={
                <button type="button" className="btn btn-ghost btn-sm">
                  <Icon name="plus" size={16} />
                  Novo orçamento
                </button>
              }
            />
          )}
        </div>
        <div className="card-pad" style={{ paddingTop: 6, paddingBottom: 10 }}>
          {data.budgets.length === 0 ? (
            <div style={{ color: "var(--text-lo)", padding: "16px 0" }}>
              {canCreate ? (
                "Defina limites mensais por categoria para controlar seus gastos."
              ) : (
                <>
                  Crie categorias em{" "}
                  <Link href="/settings" className="card-link">
                    Configurações
                  </Link>{" "}
                  antes de definir orçamentos.
                </>
              )}
            </div>
          ) : (
            data.budgets.map((budget) => {
              const pct = Math.min(100, Math.round(budget.ratio * 100));
              return (
                <div key={budget.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div className="row gap-3" style={{ minWidth: 0 }}>
                      <span
                        className="l-ic"
                        style={{ background: `${budget.categoryColor}22`, color: budget.categoryColor }}
                      >
                        <CategoryIcon name={budget.categoryIcon} size={18} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className="l-title">{budget.categoryName}</div>
                        <div className="l-sub">
                          <Money cents={budget.spentCents} withSign={false} /> de{" "}
                          <Money cents={budget.limitCents} withSign={false} />
                        </div>
                      </div>
                    </div>
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
                          className="icon-btn btn-sm"
                          style={{ width: 34, height: 34 }}
                          title="Editar"
                        >
                          <Icon name="pencil" size={15} />
                        </button>
                      }
                    />
                  </div>
                  <div className={`meter ${meterClass(budget)}`} style={{ marginTop: 10 }}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <div
                    className="row"
                    style={{ justifyContent: "space-between", marginTop: 6, fontSize: 12.5 }}
                  >
                    <span style={{ color: budget.over ? "var(--rose-500)" : "var(--text-lo)" }}>
                      {budget.over ? "Acima do limite" : `${pct}% usado`}
                    </span>
                    <span style={{ color: budget.over ? "var(--rose-500)" : "var(--text-lo)" }}>
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
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
