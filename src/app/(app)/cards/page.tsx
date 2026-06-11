import { Pencil, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { deleteCreditCardAction } from "@/app/_actions/finance";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { CreditCardFormDialog } from "@/presentation/components/forms/credit-card-form-dialog";
import { DeleteButton } from "@/presentation/components/forms/delete-button";
import { Button } from "@/presentation/components/ui/button";
import { CreditCardWidget } from "@/presentation/components/ui/credit-card-widget";
import { Money } from "@/presentation/components/ui/money";

function utilizationTone(ratio: number): string {
  if (ratio > 0.85) return "bg-rose-500";
  if (ratio > 0.65) return "bg-amber-500";
  return "bg-mint-500";
}

export default async function CardsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { cards } = await getWorkspaceView(financeRepository, user.id);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mt-1 text-text-mid">Faturas, limites e utilização em um só lugar.</p>
        </div>
        <CreditCardFormDialog
          trigger={
            <Button>
              <Plus size={18} />
              Novo cartão
            </Button>
          }
        />
      </header>

      {cards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-2 bg-surface-1 p-10 text-center">
          <p className="text-text-mid">Você ainda não cadastrou cartões.</p>
          <div className="mt-4 flex justify-center">
            <CreditCardFormDialog
              trigger={
                <Button>
                  <Plus size={18} />
                  Criar primeiro cartão
                </Button>
              }
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {cards.map((card) => {
            const pct = Math.min(100, Math.round(card.utilization * 100));
            return (
              <article key={card.id} className="flex flex-col gap-3">
                <CreditCardWidget
                  bank={card.bank}
                  product={card.product}
                  flag={card.flag}
                  themeKey={card.themeKey}
                  maskedNumber={card.maskedNumber}
                />
                <div className="rounded-lg border border-line bg-surface-1 p-4 shadow-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-widest text-text-faint">Fatura atual</p>
                      <Money
                        cents={card.billCents}
                        className="font-display text-2xl font-semibold text-text-hi"
                      />
                      <p className="mt-0.5 truncate text-sm text-text-lo">
                        de <Money cents={card.limitCents} withSign={false} /> · vence dia {card.dueDay}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <CreditCardFormDialog
                        card={card}
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
                        id={card.id}
                        action={deleteCreditCardAction}
                        confirmMessage={`Excluir o cartão ${card.bank} ${card.product}?`}
                      />
                    </div>
                  </div>

                  <div className="mt-3 h-2 overflow-hidden rounded-pill bg-surface-3">
                    <div
                      className={`h-full ${utilizationTone(card.utilization)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-text-lo">{pct}% do limite utilizado</p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
