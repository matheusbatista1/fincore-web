import { redirect } from "next/navigation";
import { deleteGoalAction } from "@/app/_actions/finance";
import { getGoals } from "@/application/use-cases/get-goals";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { DeleteButton } from "@/presentation/components/forms/delete-button";
import { GoalContributeDialog } from "@/presentation/components/forms/goal-contribute-dialog";
import { GoalFormDialog } from "@/presentation/components/forms/goal-form-dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";

export default async function GoalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const data = await getGoals(financeRepository, user.id);

  return (
    <div className="goals-page">
      {data.goals.length > 0 && (
        <div className="card card-pad rise" style={{ marginBottom: 18 }}>
          <span className="kicker">Guardado / Alvo</span>
          <div
            className="fc-bignum"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 40,
              fontWeight: 600,
              color: "var(--mint-500)",
              letterSpacing: "-0.03em",
              marginTop: 6,
              lineHeight: 1,
            }}
          >
            <Money cents={data.totalSavedCents} withSign={false} />
          </div>
          <div style={{ color: "var(--text-lo)", fontSize: 13.5, marginTop: 8 }}>
            de <Money cents={data.totalTargetCents} withSign={false} /> em {data.goals.length}{" "}
            {data.goals.length === 1 ? "meta" : "metas"}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Metas de economia</h3>
            <div className="ch-sub">Objetivos e progresso</div>
          </div>
          <GoalFormDialog
            trigger={
              <button type="button" className="btn btn-ghost btn-sm">
                <Icon name="plus" size={16} />
                Nova meta
              </button>
            }
          />
        </div>
        <div className="card-pad" style={{ paddingTop: 6, paddingBottom: 10 }}>
          {data.goals.length === 0 ? (
            <div style={{ color: "var(--text-lo)", padding: "16px 0" }}>
              Crie metas de economia e acompanhe quanto falta para alcançá-las.
            </div>
          ) : (
            data.goals.map((goal) => {
              const pct = Math.min(100, Math.round(goal.ratio * 100));
              return (
                <div key={goal.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div className="row gap-3" style={{ minWidth: 0 }}>
                      <span
                        className="l-ic"
                        style={
                          goal.reached
                            ? { background: "var(--mint-soft)", color: "var(--mint-500)" }
                            : { background: "var(--purple-soft)", color: "var(--purple-300)" }
                        }
                      >
                        <Icon name={goal.reached ? "check-circle" : "piggy-bank"} size={18} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className="l-title">{goal.name}</div>
                        <div className="l-sub">
                          <Money cents={goal.savedCents} withSign={false} /> de{" "}
                          <Money cents={goal.targetCents} withSign={false} />
                        </div>
                      </div>
                    </div>
                    <div className="row gap-2">
                      {!goal.reached && (
                        <GoalContributeDialog
                          goal={{ id: goal.id, name: goal.name }}
                          trigger={
                            <button type="button" className="btn btn-quiet btn-sm">
                              <Icon name="plus" size={15} />
                              Contribuir
                            </button>
                          }
                        />
                      )}
                      <GoalFormDialog
                        goal={goal}
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
                      <DeleteButton
                        id={goal.id}
                        action={deleteGoalAction}
                        confirmMessage={`Excluir a meta ${goal.name}?`}
                      />
                    </div>
                  </div>
                  <div className="meter" style={{ marginTop: 10 }}>
                    <span
                      style={{
                        width: `${pct}%`,
                        background: goal.reached ? "var(--mint-500)" : undefined,
                      }}
                    />
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--text-lo)" }}>
                    {goal.reached ? (
                      "Meta alcançada 🎉"
                    ) : (
                      <>
                        {pct}% · faltam <Money cents={goal.remainingCents} withSign={false} />
                      </>
                    )}
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
