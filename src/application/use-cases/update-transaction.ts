import { Money } from "@/domain/money/money";
import { generateInstallments } from "@/domain/services/installment.generator";
import { calculateSplit } from "@/domain/services/split.calculator";
import { err, ok, type Result } from "@/shared/result";
import type { UpdateTransactionInput } from "@/shared/schemas/transaction";
import type {
  CreateTransactionCommand,
  FinanceRepository,
  NewTransactionEntry,
  UpdateTransactionCommand,
} from "../ports/finance-repository";

export interface UpdateTransactionError {
  readonly code: "invalid_source" | "invalid_split";
  readonly message: string;
}

type ExpenseUpdate = Extract<UpdateTransactionInput, { kind: "expense" }>;

/** Expense sources that can carry an installment plan (mirrors the manual form). */
const PARCELABLE = new Set(["card", "loan", "financing", "boleto"]);

/**
 * Build the in-place update command, recomputing the split server-side. Mirrors
 * the create use case, except a single row is touched and the kind is immutable.
 * `fixed` toggles the row's recurrence on/off.
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
      note: input.note || null,
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
      note: input.note || null,
      accountId: input.accountId,
      fromPersonId: input.fromPersonId,
      isReimbursement: input.fromPersonId !== null,
      myShareCents: input.amountCents,
      fixed: input.fixed,
    });
  }

  // --- expense ---
  const sourceError = validateExpenseSource(input);
  if (sourceError) return sourceError;

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
    note: input.note || null,
    categoryId: input.categoryId,
    source: input.source,
    ...expenseSourceFields(input),
    myShareCents: split.myShare.cents,
    fixed: input.fixed,
    // Zero shares carry no debt and would violate the DB's share > 0 CHECK.
    splits: [...split.shares]
      .filter(([, share]) => share.cents > 0)
      .map(([personId, share]) => ({ personId, shareCents: share.cents })),
  });
}

/**
 * Build the installment group that replaces a single (non-installment) expense
 * when the user converts it. Reuses the domain's `generateInstallments`, treating
 * this row's amount as the full purchase total split across the schedule.
 */
function buildInstallmentCommand(
  input: ExpenseUpdate,
): Result<CreateTransactionCommand, UpdateTransactionError> {
  const installment = input.installment;
  if (!installment) return err({ code: "invalid_source", message: "Parcelamento ausente." });
  if (!PARCELABLE.has(input.source)) {
    return err({ code: "invalid_source", message: "Essa origem não pode ser parcelada." });
  }
  const sourceError = validateExpenseSource(input);
  if (sourceError) return sourceError;

  const customMap = new Map<string, Money>(
    Object.entries(input.split.custom).map(([id, value]) => [id, Money.fromCents(value)]),
  );
  const principal = Money.fromCents(-input.amountCents);
  const schedule = generateInstallments({
    total: principal,
    count: installment.total,
    current: installment.current,
    includePrevious: installment.includePrevious,
    includeNext: installment.includeNext,
    baseDate: input.date,
  });

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
      ...expenseSourceFields(input),
      myShareCents: split.myShare.cents,
      parcelaNo: parcela.number,
      parcelaTotal: parcela.total,
      parcelaStatus: parcela.status,
      splits: [...split.shares]
        .filter(([, share]) => share.cents > 0)
        .map(([personId, share]) => ({ personId, shareCents: share.cents })),
    });
  }
  return ok({
    installmentGroup: { totalCount: installment.total, totalCents: principal.cents },
    entries,
  });
}

function validateExpenseSource(input: ExpenseUpdate): Result<never, UpdateTransactionError> | null {
  if (input.source === "card" && !input.cardId) {
    return err({ code: "invalid_source", message: "Selecione um cartão." });
  }
  if (input.source === "account" && !input.accountId) {
    return err({ code: "invalid_source", message: "Selecione uma carteira." });
  }
  return null;
}

function expenseSourceFields(input: ExpenseUpdate) {
  return {
    cardId: input.source === "card" ? input.cardId : null,
    accountId: input.source === "account" ? input.accountId : null,
    linkedAccountId: input.source === "card" || input.source === "account" ? null : input.linkedAccountId,
  };
}

/**
 * Update a transaction. Normally edits a single row (splits recomputed, kind
 * immutable, recurrence toggled by `fixed`). When a non-installment expense is
 * converted to an installment, the original row is replaced by the generated
 * parcelas atomically.
 */
export async function updateTransaction(
  repo: FinanceRepository,
  userId: string,
  input: UpdateTransactionInput,
): Promise<Result<void, UpdateTransactionError>> {
  if (input.kind === "expense" && input.installment) {
    const command = buildInstallmentCommand(input);
    if (!command.ok) return command;
    await repo.replaceWithInstallment(userId, input.id, command.value);
    return ok(undefined);
  }
  const command = buildCommand(input);
  if (!command.ok) return command;
  await repo.updateTransaction(userId, command.value);
  return ok(undefined);
}
