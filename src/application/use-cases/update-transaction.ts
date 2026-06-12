import { Money } from "@/domain/money/money";
import { calculateSplit } from "@/domain/services/split.calculator";
import { err, ok, type Result } from "@/shared/result";
import type { UpdateTransactionInput } from "@/shared/schemas/transaction";
import type { FinanceRepository, UpdateTransactionCommand } from "../ports/finance-repository";

export interface UpdateTransactionError {
  readonly code: "invalid_source" | "invalid_split";
  readonly message: string;
}

/**
 * Build the update command, recomputing the split server-side. Mirrors the
 * create use case, except: a single row is touched (for installments, only this
 * parcela), the kind is immutable and recurrence/installment flags are kept.
 */
function buildCommand(
  input: UpdateTransactionInput,
): Result<UpdateTransactionCommand, UpdateTransactionError> {
  if (input.kind === "transfer") {
    return ok({
      id: input.id,
      kind: "transfer",
      description: input.description || "Transferência",
      date: input.date,
      amountCents: 0,
      note: input.note ?? null,
      transferFromAccountId: input.fromAccountId,
      transferToAccountId: input.toAccountId,
      transferValueCents: input.valueCents,
    });
  }

  if (input.kind === "income") {
    return ok({
      id: input.id,
      kind: "income",
      description: input.description || (input.fromPersonId ? "Pagamento recebido" : "Receita"),
      date: input.date,
      amountCents: input.amountCents,
      note: input.note ?? null,
      accountId: input.accountId,
      fromPersonId: input.fromPersonId,
      isReimbursement: input.fromPersonId !== null,
      myShareCents: input.amountCents,
    });
  }

  // --- expense ---
  if (input.source === "card" && !input.cardId) {
    return err({ code: "invalid_source", message: "Selecione um cartão." });
  }
  if (input.source === "account" && !input.accountId) {
    return err({ code: "invalid_source", message: "Selecione uma carteira." });
  }

  const split = calculateSplit({
    unit: Money.fromCents(input.amountCents),
    method: input.split.method,
    meIn: input.split.meIn,
    selected: input.split.selected,
    custom: new Map(Object.entries(input.split.custom).map(([id, value]) => [id, Money.fromCents(value)])),
  });
  if (!split.valid) {
    return err({ code: "invalid_split", message: split.warning ?? "Divisão inválida." });
  }

  return ok({
    id: input.id,
    kind: "expense",
    description: input.description || "Despesa",
    date: input.date,
    amountCents: -input.amountCents,
    note: input.note ?? null,
    categoryId: input.categoryId,
    source: input.source,
    cardId: input.source === "card" ? input.cardId : null,
    accountId: input.source === "account" ? input.accountId : null,
    linkedAccountId: input.source === "card" || input.source === "account" ? null : input.linkedAccountId,
    myShareCents: split.myShare.cents,
    splits: [...split.shares].map(([personId, share]) => ({ personId, shareCents: share.cents })),
  });
}

/** Update a single transaction row, splits recomputed server-side (kind immutable). */
export async function updateTransaction(
  repo: FinanceRepository,
  userId: string,
  input: UpdateTransactionInput,
): Promise<Result<void, UpdateTransactionError>> {
  const command = buildCommand(input);
  if (!command.ok) return command;
  await repo.updateTransaction(userId, command.value);
  return ok(undefined);
}
