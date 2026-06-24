import type { ParcelaStatus } from "@/domain/entities/transaction";
import { Money } from "@/domain/money/money";
import { generateInstallments } from "@/domain/services/installment.generator";
import { calculateSplit } from "@/domain/services/split.calculator";
import { dayOf, type IsoDate } from "@/domain/value-objects/competence-month";
import { err, ok, type Result } from "@/shared/result";
import type { CreateTransactionInput } from "@/shared/schemas/transaction";
import type {
  CreateTransactionCommand,
  FinanceRepository,
  NewTransactionEntry,
} from "../ports/finance-repository";

export interface CreateTransactionError {
  readonly code: "invalid_source" | "invalid_split";
  readonly message: string;
}

/** Build the persist command from raw input, recomputing splits/installments server-side. */
export function buildCommand(
  input: CreateTransactionInput,
): Result<CreateTransactionCommand, CreateTransactionError> {
  if (input.kind === "transfer") {
    const entry: NewTransactionEntry = {
      kind: "transfer",
      description: input.description || "Transferência",
      date: input.date,
      amountCents: 0,
      ...(input.note ? { note: input.note } : {}),
      transferFromAccountId: input.fromAccountId,
      transferToAccountId: input.toAccountId,
      transferValueCents: input.valueCents,
    };
    return ok({ entries: [entry] });
  }

  if (input.kind === "income") {
    // A card credit (estorno) targets a card instead of an account: it only
    // reduces the card bill, never counts as income, and carries no person/share.
    const isCardCredit = input.cardId !== null;
    const entry: NewTransactionEntry = {
      kind: "income",
      description:
        input.description ||
        (isCardCredit ? "Estorno no cartão" : input.fromPersonId ? "Pagamento recebido" : "Receita"),
      date: input.date,
      amountCents: input.amountCents,
      ...(input.note ? { note: input.note } : {}),
      accountId: isCardCredit ? null : input.accountId,
      cardId: isCardCredit ? input.cardId : null,
      fromPersonId: isCardCredit ? null : input.fromPersonId,
      isReimbursement: !isCardCredit && input.fromPersonId !== null,
      recurrenceDayOfMonth: input.fixed ? dayOf(input.date) : null,
      myShareCents: isCardCredit ? 0 : input.amountCents,
    };
    return ok({ entries: [entry] });
  }

  // --- expense ---
  if (input.source === "card" && !input.cardId) {
    return err({ code: "invalid_source", message: "Selecione um cartão." });
  }
  if (input.source === "account" && !input.accountId) {
    return err({ code: "invalid_source", message: "Selecione uma carteira." });
  }

  const sourceFields = {
    cardId: input.source === "card" ? input.cardId : null,
    accountId: input.source === "account" ? input.accountId : null,
    linkedAccountId: input.source === "card" || input.source === "account" ? null : input.linkedAccountId,
  };

  const customMap = new Map<string, Money>(
    Object.entries(input.split.custom).map(([id, value]) => [id, Money.fromCents(value)]),
  );

  // The full negative principal, then the per-parcela schedule (or one slice if not installment).
  const principal = Money.fromCents(-input.totalAmountCents);
  const schedule = input.installment
    ? generateInstallments({
        total: principal,
        count: input.installment.total,
        current: input.installment.current,
        includePrevious: input.installment.includePrevious,
        includeNext: input.installment.includeNext,
        baseDate: input.date,
      })
    : [
        {
          number: 1,
          total: 1,
          status: "atual" as ParcelaStatus,
          amount: principal,
          date: input.date as IsoDate,
        },
      ];

  const entries: NewTransactionEntry[] = [];
  for (const parcela of schedule) {
    const split = calculateSplit({
      unit: parcela.amount.abs(),
      method: input.split.method,
      meIn: input.split.meIn,
      selected: input.split.selected,
      custom: customMap,
    });
    if (!split.valid) {
      return err({ code: "invalid_split", message: split.warning ?? "Divisão inválida." });
    }
    entries.push({
      kind: "expense",
      description: input.description || "Despesa",
      date: parcela.date,
      amountCents: parcela.amount.cents,
      ...(input.note ? { note: input.note } : {}),
      categoryId: input.categoryId,
      source: input.source,
      ...sourceFields,
      myShareCents: split.myShare.cents,
      recurrenceDayOfMonth: input.fixed ? dayOf(input.date) : null,
      parcelaNo: input.installment ? parcela.number : null,
      parcelaTotal: input.installment ? parcela.total : null,
      parcelaStatus: input.installment ? parcela.status : null,
      // Zero shares carry no debt and would violate the DB's share > 0 CHECK.
      splits: [...split.shares]
        .filter(([, share]) => share.cents > 0)
        .map(([personId, share]) => ({
          personId,
          shareCents: share.cents,
        })),
    });
  }

  return ok({
    ...(input.installment
      ? { installmentGroup: { totalCount: input.installment.total, totalCents: principal.cents } }
      : {}),
    entries,
  });
}

/** Create a transaction (single, or an installment schedule), splits recomputed server-side. */
export async function createTransaction(
  repo: FinanceRepository,
  userId: string,
  input: CreateTransactionInput,
): Promise<Result<void, CreateTransactionError>> {
  const command = buildCommand(input);
  if (!command.ok) return command;
  await repo.createTransaction(userId, command.value);
  return ok(undefined);
}
