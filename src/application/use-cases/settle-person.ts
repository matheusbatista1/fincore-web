import { Money } from "@/domain/money/money";
import { billingCompetence } from "@/domain/services/card-bill.calculator";
import { computePersonBalancesThrough } from "@/domain/services/person-ledger.calculator";
import { compareMonths } from "@/domain/value-objects/competence-month";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { shortDate } from "@/shared/formatting/dates";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";
import { err, ok, type Result } from "@/shared/result";
import { createTransactionSchema, type SettlePersonInput } from "@/shared/schemas/transaction";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository, SettlementData } from "../ports/finance-repository";
import { buildCommand } from "./create-transaction";

export interface SettlePersonError {
  readonly code:
    | "not_found"
    | "invalid_account"
    | "invalid_date"
    | "surplus_without_account"
    | "surplus_undecided"
    | "invalid";
  readonly message: string;
  /** On `surplus_undecided`: the figures the client needs to ask the question with. */
  readonly surplus?: { readonly owedCents: number; readonly surplusCents: number };
}

export interface SettlePersonOutcome {
  /** Cents written to the acerto — the part that works against the person's balance. */
  readonly settledCents: number;
  /** Cents booked as the user's own income ("Gorjeta — …"). */
  readonly tipCents: number;
  /** Cents left inside the acerto above the pending — the person's credit, applied to their next share. */
  readonly creditCents: number;
}

/**
 * Register an acerto (a person paying you back, or you paying them). The repository used to be
 * written straight from the server action; this use case exists for ONE rule: a payment above what
 * the person owes is never silently clipped. The surplus has to be decided:
 *  - `credit`: the acerto keeps the full amount. The ledger clamps it at zero and applies the excess
 *    to the person's next share, and the People page shows it as "crédito" (`advanceCents`).
 *  - `tip`: the acerto is capped at the pending and the surplus is booked as the user's own income
 *    ("Gorjeta — {nome}", same account and date), atomically with it.
 * With no decision the use case refuses with the figures, so the client can ask.
 *
 * "What the person owes" is the projection-aware total the screen shows — through the browsed month
 * (`throughMonth`) or today, whichever is later — exactly as the People profile's "no total". Measuring
 * against the booked figure instead would call a payment covering a still-projected share a "sobra".
 * The rule is one-directional: when you owe the person (negative pending) the acerto is written as is.
 * A "sem conta" acerto is a baixa/perdão: no cash arrived, so a surplus makes no sense and is refused.
 */
export async function settlePerson(
  repo: FinanceRepository,
  userId: string,
  input: SettlePersonInput,
): Promise<Result<SettlePersonOutcome, SettlePersonError>> {
  const ws = await loadWorkspaceCached(repo, userId);
  const person = ws.people.find((p) => p.id === input.personId);
  if (!person) return err({ code: "not_found", message: "Pessoa não encontrada." });
  if (input.accountId !== null && !ws.accounts.some((a) => a.id === input.accountId)) {
    return err({ code: "invalid_account", message: "Conta inválida." });
  }
  const today = todayInBrazil();
  // The client caps the picker at today; re-enforce it: a future-dated acerto would apply to the
  // ledger before the cash exists, and a future-dated gorjeta would be booked as a pending receivable.
  if (input.date > today) {
    return err({ code: "invalid_date", message: "A data do acerto não pode ser futura." });
  }

  const base: SettlementData = {
    personId: person.id,
    amountCents: input.amountCents,
    date: input.date,
    accountId: input.accountId,
    ...(input.note !== undefined ? { note: input.note } : {}),
  };

  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const current = currentMonthInBrazil();
  const horizon =
    input.throughMonth !== undefined && compareMonths(input.throughMonth, current) > 0
      ? input.throughMonth
      : current;
  const owed = (
    computePersonBalancesThrough([person], ws.transactions, ws.settlements, horizon, competenceOf).get(
      person.id,
    ) ?? Money.zero()
  ).cents;

  // You paying them, or a payment within the pending: the acerto is what it always was.
  const surplus = input.amountCents - owed;
  if (owed < 0 || surplus <= 0) {
    await repo.createSettlement(userId, base);
    return ok({ settledCents: input.amountCents, tipCents: 0, creditCents: 0 });
  }

  const first = person.name.split(" ")[0] ?? person.name;
  if (input.accountId === null) {
    return err({
      code: "surplus_without_account",
      message: `Sem conta, o acerto fica limitado ao que ${first} deve (${formatBRLAbsolute(owed)}).`,
    });
  }
  if (input.surplus === undefined) {
    return err({
      code: "surplus_undecided",
      message: `${first} deve ${formatBRLAbsolute(owed)}; sobram ${formatBRLAbsolute(surplus)}. Escolha o que fazer com a sobra.`,
      surplus: { owedCents: owed, surplusCents: surplus },
    });
  }

  if (input.surplus === "credit") {
    await repo.createSettlement(userId, {
      ...base,
      note: input.note ?? `Acerto · ${formatBRLAbsolute(surplus)} de crédito`,
    });
    return ok({ settledCents: input.amountCents, tipCents: 0, creditCents: surplus });
  }

  // Gorjeta: the surplus is the user's — a plain income (no `fromPersonId`, so the ledger never sees
  // it, and both lenses count it) on the account the acerto landed in, dated like the acerto.
  const parsed = createTransactionSchema.safeParse({
    kind: "income",
    description: `Gorjeta — ${first}`,
    date: input.date,
    amountCents: surplus,
    accountId: input.accountId,
    cardId: null,
    fromPersonId: null,
    fixed: false,
    note: `Sobra do acerto de ${first} em ${shortDate(input.date)}`,
  });
  if (!parsed.success) {
    return err({ code: "invalid", message: "Não foi possível registrar a gorjeta." });
  }
  const command = buildCommand(parsed.data, today);
  if (!command.ok) return err({ code: "invalid", message: command.error.message });

  if (owed === 0) {
    // Nothing pending: there is no acerto to write (the DB refuses a zero one), only the gorjeta.
    await repo.createTransaction(userId, command.value);
    return ok({ settledCents: 0, tipCents: surplus, creditCents: 0 });
  }
  await repo.createSettlementWithTransaction(
    userId,
    {
      ...base,
      amountCents: owed,
      note:
        input.note ??
        `Recebeu ${formatBRLAbsolute(input.amountCents)} · ${formatBRLAbsolute(surplus)} de gorjeta`,
    },
    command.value,
  );
  return ok({ settledCents: owed, tipCents: surplus, creditCents: 0 });
}
