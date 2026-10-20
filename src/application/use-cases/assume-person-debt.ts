import { Money } from "@/domain/money/money";
import { billingCompetence } from "@/domain/services/card-bill.calculator";
import { planDebtAssumption } from "@/domain/services/debt-assumption.planner";
import {
  computePersonBookedBalancesThrough,
  computePersonMonthNets,
} from "@/domain/services/person-ledger.calculator";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { shortDate } from "@/shared/formatting/dates";
import { todayInBrazil } from "@/shared/formatting/now";
import { err, ok, type Result } from "@/shared/result";
import type { AssumeDebtInput } from "@/shared/schemas/transaction";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

export interface AssumeDebtError {
  readonly code: "not_found" | "nothing_to_assume" | "over_assume" | "invalid";
  readonly message: string;
}

/**
 * "Assumir dívida": take over what a person still owes through `month` — their uncovered booked
 * shares move onto the user (each affected row's split shrinks or goes, its own share grows by the
 * same cents, and a dated note keeps the trail). No cash moves and no acerto is written: the person's
 * balance drops and the expense becomes the user's, which is what both lenses then report.
 * Guards (never trust the client):
 *  - The person must have a positive BOOKED pending — the browsed month's net for `month`, the
 *    outstanding through it for `all`. Projections are not debts: a forecast has no row to move.
 *  - `amountCents` is capped at that pending, and the plan must place every cent on a real row.
 */
export async function assumePersonDebt(
  repo: FinanceRepository,
  userId: string,
  input: AssumeDebtInput,
): Promise<Result<number, AssumeDebtError>> {
  const ws = await loadWorkspaceCached(repo, userId);
  const person = ws.people.find((p) => p.id === input.personId);
  if (!person) return err({ code: "not_found", message: "Pessoa não encontrada." });

  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const capCents =
    input.scope === "month"
      ? (computePersonMonthNets([person], ws.transactions, ws.settlements, input.month, competenceOf, {
          projected: false,
        })
          .get(person.id)
          ?.get(input.month) ?? 0)
      : (
          computePersonBookedBalancesThrough(
            [person],
            ws.transactions,
            ws.settlements,
            input.month,
            competenceOf,
          ).get(person.id) ?? Money.zero()
        ).cents;

  if (capCents <= 0) {
    return err({
      code: "nothing_to_assume",
      message:
        input.scope === "month"
          ? "Não há nada em aberto dessa pessoa nesse mês."
          : "Não há saldo devedor em aberto até esse mês.",
    });
  }
  if (input.amountCents > capCents) {
    return err({
      code: "over_assume",
      message: `Valor maior que o que está em aberto (${formatBRLAbsolute(capCents)}).`,
    });
  }

  const plan = planDebtAssumption({
    personId: person.id,
    transactions: ws.transactions,
    settlements: ws.settlements,
    month: input.month,
    competenceOf,
    amountCents: input.amountCents,
    scope: input.scope,
  });
  if (plan.items.length === 0 || plan.totalCents !== input.amountCents) {
    return err({
      code: "invalid",
      message: "Não foi possível distribuir o valor entre as despesas em aberto.",
    });
  }

  const first = person.name.split(" ")[0] ?? person.name;
  const count = await repo.assumePersonShares(
    userId,
    plan.items,
    `Assumido de ${first} em ${shortDate(todayInBrazil())}`,
  );
  return ok(count);
}
