import { Money } from "@/domain/money/money";
import { billingCompetence } from "@/domain/services/card-bill.calculator";
import { computePersonBookedBalancesThrough } from "@/domain/services/person-ledger.calculator";
import { compareMonths, monthOf } from "@/domain/value-objects/competence-month";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { todayInBrazil } from "@/shared/formatting/now";
import { err, ok, type Result } from "@/shared/result";
import { createTransactionSchema, type RollMonthDebtInput } from "@/shared/schemas/transaction";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";
import { buildCommand } from "./create-transaction";

export interface RollMonthDebtError {
  readonly code: "not_found" | "nothing_to_roll" | "over_roll" | "bad_due_month" | "invalid";
  readonly message: string;
}

/**
 * "Rolar o saldo do mês" (pool roll): zero what the person still owes through `month` via a
 * CASH-LESS rollover settlement and create the new debt (principal + juros) on a debt instrument,
 * fully owed by the person — atomically. Guards (never trust the client):
 *  - The person must have a positive BOOKED outstanding through `month` (projections are not debts,
 *    and a negative balance means YOU owe them — rolling would erase your own debt with no cash).
 *  - `principal` is capped at that outstanding (the settlement clamp would silently under-apply and
 *    the new debt would over-charge the person).
 *  - The new debt must land in a month AFTER `month`: the rollover settlement covers the OLDEST
 *    open buckets first, so an earlier-dated new debt would intercept its own settlement.
 */
export async function rollPersonMonthDebt(
  repo: FinanceRepository,
  userId: string,
  input: RollMonthDebtInput,
): Promise<Result<void, RollMonthDebtError>> {
  const ws = await loadWorkspaceCached(repo, userId);
  const person = ws.people.find((p) => p.id === input.personId);
  if (!person) return err({ code: "not_found", message: "Pessoa não encontrada." });

  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const outstanding = (
    computePersonBookedBalancesThrough(
      ws.people,
      ws.transactions,
      ws.settlements,
      input.month,
      competenceOf,
    ).get(input.personId) ?? Money.zero()
  ).cents;

  if (outstanding <= 0) {
    return err({
      code: "nothing_to_roll",
      message: "Não há saldo devedor em aberto até esse mês para rolar.",
    });
  }
  if (input.principalCents > outstanding) {
    return err({
      code: "over_roll",
      message: `Valor maior que o saldo devedor em aberto (${formatBRLAbsolute(outstanding)}).`,
    });
  }
  if (compareMonths(monthOf(input.date), input.month) <= 0) {
    return err({
      code: "bad_due_month",
      message: "O vencimento da nova dívida deve ficar num mês depois do mês rolado.",
    });
  }

  const newAmount = input.principalCents + input.jurosCents;
  const installments = input.installments > 1 ? input.installments : 1;
  // The new expense is fully owed by the person (you fronted it): equal split, you excluded.
  const txInput = createTransactionSchema.safeParse({
    kind: "expense",
    description: input.description || "Dívida rolada",
    date: input.date,
    totalAmountCents: newAmount,
    categoryId: null,
    source: input.source,
    cardId: input.cardId,
    accountId: input.accountId,
    linkedAccountId: input.linkedAccountId,
    fixed: false,
    split: { method: "equal", meIn: false, selected: [input.personId], custom: {} },
    installment:
      installments > 1
        ? { total: installments, current: 1, includePrevious: false, includeNext: true }
        : null,
  });
  if (!txInput.success) return err({ code: "invalid", message: "Dados inválidos." });

  const command = buildCommand(txInput.data);
  if (!command.ok) return err({ code: "invalid", message: command.error.message });

  await repo.rollPersonMonthDebt(
    userId,
    {
      personId: input.personId,
      amountCents: input.principalCents,
      // The roll happens TODAY: the relief lands now, and the coverage walk re-buckets it onto the
      // covered debts' competence months (all ≤ `month` < the new debt's month, by the guard above).
      date: todayInBrazil(),
      accountId: null, // cash-less: nothing was received — the debt just moved
      note: `Rolagem — ${input.description || "Dívida rolada"}`,
    },
    command.value,
  );
  return ok(undefined);
}
