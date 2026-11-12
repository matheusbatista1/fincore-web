import { Money } from "@/domain/money/money";
import { billingCompetence } from "@/domain/services/card-bill.calculator";
import { computePersonBookedBalancesThrough } from "@/domain/services/person-ledger.calculator";
import { compareMonths, type IsoDate, monthOf } from "@/domain/value-objects/competence-month";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { monthLabel } from "@/shared/formatting/dates";
import { todayInBrazil } from "@/shared/formatting/now";
import { err, ok, type Result } from "@/shared/result";
import { createTransactionSchema, type RollMonthDebtInput } from "@/shared/schemas/transaction";
import { loadWorkspaceCached } from "../loaders";
import type { CreateTransactionCommand, FinanceRepository } from "../ports/finance-repository";
import { buildCommand } from "./create-transaction";

export interface RollMonthDebtError {
  readonly code: "not_found" | "nothing_to_roll" | "over_roll" | "bad_due_month" | "invalid";
  readonly message: string;
}

/** `2026-12-20` → `20/12/2026`. */
const fullDate = (date: IsoDate): string => date.split("-").reverse().join("/");

/**
 * "Rolar o saldo do mês" (pool roll): zero what the person still owes through `month` via a
 * rollover settlement and create the new debt, fully owed by the person — atomically.
 *
 * Where the new debt lives depends on how the user is covering the remainder:
 *  - `card` / `loan`: a new charge on a debt instrument, for principal + juros. The settlement is
 *    CASH-LESS by default (a paper-only roll); when the roll DID move real money — a Pix no crédito
 *    whose cash landed in `cashAccountId` and covered the person's share — it is account-backed
 *    instead, crediting that account as third-party money.
 *  - `account` (the user's OWN money): nothing new is charged and no account moves — the person's
 *    share already left the user's pocket through the month's own rows. The new debt is a
 *    ledger-only row (see `isLedgerOnly`): the same amount, owed on the new date. No juros (there is
 *    no lender to pass them on from — a payment above the debt is booked as gorjeta when received),
 *    no cash account, a single date.
 *
 * Guards (never trust the client):
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

  const ownMoney = input.source === "account";
  if (ownMoney && input.jurosCents > 0) {
    return err({
      code: "invalid",
      message:
        "Com o seu próprio dinheiro não há juros a repassar. Se a pessoa pagar a mais, registre como gorjeta ao receber.",
    });
  }
  if (ownMoney && input.cashAccountId !== null) {
    return err({
      code: "invalid",
      message: "Com o seu próprio dinheiro nenhuma conta recebe dinheiro na rolagem.",
    });
  }

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
  // Where the new debt will actually COUNT: a card charge lands in its bill's competence — a date
  // in September after the card's closing day bills OCTOBER. Validating the calendar month let the
  // debt slip one fatura past what the user (and this guard) meant.
  const dueCompetence =
    input.source === "card" && input.cardId !== null
      ? competenceOf({
          kind: "expense",
          id: "roll-preview",
          description: "",
          date: input.date,
          amountCents: -1,
          categoryId: null,
          source: "card",
          cardId: input.cardId,
          accountId: null,
          linkedAccountId: null,
          splits: [],
          myShareCents: 1,
          installment: null,
          recurrence: null,
          billMonthOverride: null,
        })
      : monthOf(input.date);
  if (compareMonths(dueCompetence, input.month) <= 0) {
    return err({
      code: "bad_due_month",
      message:
        input.source === "card"
          ? `Com essa data, a dívida cai na fatura de ${monthLabel(dueCompetence, { long: true })} — escolha uma data que caia numa fatura depois do mês rolado.`
          : "O vencimento da nova dívida deve ficar num mês depois do mês rolado.",
    });
  }
  if (input.cashAccountId !== null && !ws.accounts.some((a) => a.id === input.cashAccountId)) {
    return err({ code: "invalid", message: "Conta de entrada do dinheiro inválida." });
  }

  const description = input.description || "Dívida rolada";
  const command = ownMoney ? ok(ownMoneyDebt(input, description)) : instrumentDebt(input, description);
  if (!command.ok) return command;

  await repo.rollPersonMonthDebt(
    userId,
    {
      personId: input.personId,
      amountCents: input.principalCents,
      // The roll happens TODAY: the relief lands now, and the coverage walk re-buckets it onto the
      // covered debts' competence months (all ≤ `month` < the new debt's month, by the guard above).
      date: todayInBrazil(),
      // Cash-less (paper-only) unless the Pix-no-crédito money really landed in an account — then
      // the settlement credits it, counting as third-party cash (dropped from the personal lens).
      accountId: input.cashAccountId,
      // With the user's own money nothing else tells where the debt went, so the trail says when.
      note: ownMoney
        ? `Rolagem — ${description} · nova data ${fullDate(input.date)}`
        : `Rolagem — ${description}`,
    },
    command.value,
  );
  return ok(undefined);
}

/** The new debt as a charge on a debt instrument (card / loan), for principal + juros. */
function instrumentDebt(
  input: RollMonthDebtInput,
  description: string,
): Result<CreateTransactionCommand, RollMonthDebtError> {
  const installments = input.installments > 1 ? input.installments : 1;
  // The new expense is fully owed by the person (you fronted it): equal split, you excluded.
  const txInput = createTransactionSchema.safeParse({
    kind: "expense",
    description,
    date: input.date,
    totalAmountCents: input.principalCents + input.jurosCents,
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
  return command;
}

/**
 * The new debt covered with the user's own money: a ledger-only row — an own-money expense with no
 * account, entirely the person's. It is built here, not through `buildCommand`: that path is the
 * manual form's, where an own-money expense without an account is a mistake to refuse.
 */
function ownMoneyDebt(input: RollMonthDebtInput, description: string): CreateTransactionCommand {
  return {
    entries: [
      {
        kind: "expense",
        description,
        date: input.date,
        amountCents: -input.principalCents,
        // Shown on the row and on the person's statement, where it explains a debt with no purchase.
        note: `Saldo de ${monthLabel(input.month, { long: true })} adiado`,
        categoryId: null,
        source: "account",
        cardId: null,
        accountId: null,
        linkedAccountId: null,
        myShareCents: 0,
        recurrenceDayOfMonth: null,
        parcelaNo: null,
        parcelaTotal: null,
        parcelaStatus: null,
        splits: [{ personId: input.personId, shareCents: input.principalCents }],
      },
    ],
  };
}
