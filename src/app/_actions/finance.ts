"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { z } from "zod";
import type { FinanceRepository } from "@/application/ports/finance-repository";
import { assumePersonDebt } from "@/application/use-cases/assume-person-debt";
import { buildCommand, createTransaction } from "@/application/use-cases/create-transaction";
import { exportWorkspace } from "@/application/use-cases/export-workspace";
import { getTransactions, type TransactionListItem } from "@/application/use-cases/get-transactions";
import { importStatement } from "@/application/use-cases/import-statement";
import { materializeOccurrence } from "@/application/use-cases/materialize-occurrence";
import { materializeRecurring } from "@/application/use-cases/materialize-recurring";
import { moveTransactionBill } from "@/application/use-cases/move-transaction-bill";
import { payCardBill } from "@/application/use-cases/pay-card-bill";
import { payTransaction } from "@/application/use-cases/pay-transaction";
import { receiveIncome } from "@/application/use-cases/receive-income";
import { reconcileAutoPayments } from "@/application/use-cases/reconcile-auto-payments";
import { type ReconcileResult, reconcileWithStatement } from "@/application/use-cases/reconcile-statement";
import { rollPersonMonthDebt } from "@/application/use-cases/roll-person-month-debt";
import { settlePerson } from "@/application/use-cases/settle-person";
import { markStatementChecked, type StatementCheckSummary } from "@/application/use-cases/statement-checks";
import {
  getTransactionHistory,
  type TransactionHistoryEntry,
  watchTransactions,
} from "@/application/use-cases/transaction-history";
import { updateTransaction } from "@/application/use-cases/update-transaction";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { todayInBrazil } from "@/shared/formatting/now";
import {
  accountInputSchema,
  budgetInputSchema,
  cardBillDateInputSchema,
  cardBillDateResetSchema,
  categoryInputSchema,
  creditCardInputSchema,
  goalContributionSchema,
  goalInputSchema,
  personInputSchema,
} from "@/shared/schemas/entities";
import { importStatementSchema } from "@/shared/schemas/import";
import { reconcileStatementSchema } from "@/shared/schemas/reconcile";
import {
  assumeDebtSchema,
  createTransactionSchema,
  deleteTransactionSchema,
  materializeOccurrenceSchema,
  moveBillSchema,
  payCardBillSchema,
  payTransactionSchema,
  receiveIncomeSchema,
  rollDebtSchema,
  rollMonthDebtSchema,
  settlementInputSchema,
  settlePersonSchema,
  stopRecurringSchema,
  transactionHistorySchema,
  undoCardBillPaymentSchema,
  undoPaymentSchema,
  undoReceiveSchema,
  updateTransactionSchema,
} from "@/shared/schemas/transaction";

export type ActionState = { ok: true; count?: number } | { ok: false; error: string };

const UNAUTHORIZED: ActionState = { ok: false, error: "Sessão expirada. Entre novamente." };
const INVALID: ActionState = { ok: false, error: "Dados inválidos." };

async function currentUserId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.id ?? null;
}

/** auth → validate → run write → revalidate. */
async function withParsed<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
  run: (userId: string, input: z.infer<S>) => Promise<unknown>,
): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return INVALID;
  await run(userId, parsed.data);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** auth → run write → revalidate (no input). */
async function withUser(run: (userId: string) => Promise<unknown>): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  await run(userId);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** After the response when the platform allows it, right away otherwise: never in the write's way. */
function later(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

interface TrackOptions<T> {
  /** The write reads nothing before it writes (a delete, an undo): take the "before" reading for it. */
  readonly snapshot?: boolean;
  /** Record before answering instead of after: for the writes the app fires back to back on load. */
  readonly inline?: boolean;
  /** Whether the write changed anything; the history is left alone when it did not. */
  readonly when?: (result: T) => boolean;
}

/**
 * Runs a write that touches transactions through a watched repository and adds what it changed to
 * their history ("Histórico de alterações"). Keeping the history never fails the write, and it is
 * done once the response is on its way (see {@link watchTransactions}).
 */
async function tracked<T>(
  userId: string,
  action: string,
  write: (repo: FinanceRepository) => Promise<T>,
  options: TrackOptions<T> = {},
): Promise<T> {
  const watch = watchTransactions(financeRepository);
  if (options.snapshot) await watch.snapshot(userId);
  const result = await write(watch.repo);
  if (options.when ? options.when(result) : true) {
    if (options.inline) await watch.record(userId, action);
    else later(() => watch.record(userId, action));
  }
  return result;
}

const whenOk = (result: { readonly ok: boolean }): boolean => result.ok;

// --- transactions ---
export async function createTransactionAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = createTransactionSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const result = await tracked(userId, "create", (repo) => createTransaction(repo, userId, parsed.data), {
    when: whenOk,
  });
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateTransactionAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = updateTransactionSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  let count = 1;
  try {
    const result = await tracked(userId, "edit", (repo) => updateTransaction(repo, userId, parsed.data), {
      when: whenOk,
    });
    if (!result.ok) return { ok: false, error: result.error.message };
    count = result.value;
  } catch (error) {
    console.error("updateTransactionAction failed", error);
    return { ok: false, error: "Não foi possível atualizar o lançamento." };
  }
  revalidatePath("/", "layout");
  return { ok: true, count };
}

export async function deleteTransactionAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = deleteTransactionSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const count = await tracked(
    userId,
    "delete",
    (repo) => repo.deleteTransaction(userId, parsed.data.id, parsed.data.scope),
    { snapshot: true },
  );
  revalidatePath("/", "layout");
  return { ok: true, count };
}

export async function stopRecurringAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = stopRecurringSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  await tracked(userId, "stop-recurrence", (repo) => repo.stopRecurrence(userId, parsed.data.id), {
    snapshot: true,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Move a card charge to the previous/next bill (keeps its real date). */
export async function moveTransactionBillAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = moveBillSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const result = await tracked(
    userId,
    "bill-month",
    (repo) => moveTransactionBill(repo, userId, parsed.data.id, parsed.data.direction),
    { when: whenOk },
  );
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Pay a deferred obligation (boleto/loan/financing): it debits the chosen account on the paid
 * date, keeping the original due date and amount for history. `paidAt` defaults to today and
 * `paidAmountCents` to the full amount (a custom value settles early with a discount).
 */
export async function payTransactionAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = payTransactionSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const result = await tracked(
    userId,
    "pay",
    (repo) =>
      payTransaction(repo, userId, {
        id: parsed.data.id,
        paidAccountId: parsed.data.paidAccountId,
        ...(parsed.data.paidAt !== undefined ? { paidAt: parsed.data.paidAt } : {}),
        ...(parsed.data.paidAmountCents !== undefined
          ? { paidAmountCents: parsed.data.paidAmountCents }
          : {}),
      }),
    { when: whenOk },
  );
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Revert a payment: the obligation becomes pending again (money returns to the balance). */
export async function undoPaymentAction(raw: unknown): Promise<ActionState> {
  return withParsed(undoPaymentSchema, raw, (userId, input) =>
    tracked(userId, "undo-pay", (repo) => repo.undoPayment(userId, input.id), { snapshot: true }),
  );
}

/**
 * Receive a normal income: it credits the chosen account on the receipt date, keeping the original
 * booked date and amount for history. `receivedAt` defaults to today and `receivedAmountCents` to the
 * full amount (a custom value records a partial/different receipt). When the income is a payment from
 * a person, receiving abates that person's debt by the amount received.
 */
export async function receiveIncomeAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = receiveIncomeSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const result = await tracked(
    userId,
    "receive",
    (repo) =>
      receiveIncome(repo, userId, {
        id: parsed.data.id,
        receivedAccountId: parsed.data.receivedAccountId,
        ...(parsed.data.receivedAt !== undefined ? { receivedAt: parsed.data.receivedAt } : {}),
        ...(parsed.data.receivedAmountCents !== undefined
          ? { receivedAmountCents: parsed.data.receivedAmountCents }
          : {}),
      }),
    { when: whenOk },
  );
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Revert a receipt: the income becomes a pending receivable again (money leaves the balance). */
export async function undoReceiveAction(raw: unknown): Promise<ActionState> {
  return withParsed(undoReceiveSchema, raw, (userId, input) =>
    tracked(userId, "undo-receive", (repo) => repo.undoReceive(userId, input.id), { snapshot: true }),
  );
}

/**
 * Pay a whole card fatura: debits the chosen account by the computed bill total on the paid date.
 * The bill amount is computed server-side (never trusted from the client).
 */
export async function payCardBillAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = payCardBillSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const result = await payCardBill(financeRepository, userId, {
    cardId: parsed.data.cardId,
    competenceMonth: parsed.data.competenceMonth,
    paidAccountId: parsed.data.paidAccountId,
    ...(parsed.data.paidAt !== undefined ? { paidAt: parsed.data.paidAt } : {}),
  });
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Revert a fatura payment: the whole bill becomes pending again. */
export async function undoCardBillPaymentAction(raw: unknown): Promise<ActionState> {
  return withParsed(undoCardBillPaymentSchema, raw, (userId, input) =>
    financeRepository.undoCardBillPayment(userId, input.cardId, input.competenceMonth),
  );
}

/**
 * Auto-payments: book every due obligation/fatura as paid from the default account. Idempotent —
 * safe to fire on app load. Revalidates only when something was actually booked.
 */
export async function reconcileAutoPaymentsAction(): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  // Recorded before answering: the app fires this right after the fixed entries' pass, and each
  // one's history must be closed before the next one reads the book.
  const result = await tracked(userId, "auto-pay", (repo) => reconcileAutoPayments(repo, userId), {
    inline: true,
    when: (done) => done.paidObligations > 0,
  });
  const count = result.paidObligations + result.paidFaturas;
  if (count > 0) revalidatePath("/", "layout");
  return { ok: true, count };
}

/**
 * Materialise the recurring rules whose day has arrived into real transactions. Idempotent (the
 * watermark short-circuits a pass that already ran, and the write claims it as a lock), so it is
 * safe on every app load. Revalidates only when something was actually booked.
 */
export async function materializeRecurringAction(): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const { created } = await tracked(userId, "recurring", (repo) => materializeRecurring(repo, userId), {
    inline: true,
    when: (done) => done.created > 0,
  });
  if (created > 0) revalidatePath("/", "layout");
  return { ok: true, count: created };
}

/**
 * Book one occurrence of a recurring rule on demand, so a "previsto" can be paid/received before
 * its automatic day. Returns the new (or already existing) transaction id, which the Pagar/Receber
 * modal then settles — never the rule's anchor, whose own month must not be touched.
 */
export async function materializeOccurrenceAction(raw: unknown): Promise<ActionState & { id?: string }> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = materializeOccurrenceSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const result = await tracked(
    userId,
    "recurring",
    (repo) => materializeOccurrence(repo, userId, parsed.data),
    { when: whenOk },
  );
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidatePath("/", "layout");
  return { ok: true, id: result.value.id };
}

export async function importTransactionsAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = importStatementSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  await tracked(userId, "import", (repo) => importStatement(repo, userId, parsed.data));
  revalidatePath("/", "layout");
  return { ok: true };
}

export type TransactionHistoryState =
  | { ok: true; entries: TransactionHistoryEntry[] }
  | { ok: false; error: string };

/**
 * "Histórico de alterações": what was changed in one transaction, and when. Read-only. A failure
 * to read it (the table missing, the database away) is an answer, never an error page.
 */
export async function getTransactionHistoryAction(raw: unknown): Promise<TransactionHistoryState> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sessão expirada. Entre novamente." };
  const parsed = transactionHistorySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Este lançamento não tem histórico." };
  try {
    const entries = await getTransactionHistory(financeRepository, userId, parsed.data.id);
    return { ok: true, entries };
  } catch (error) {
    console.error("getTransactionHistoryAction failed", error);
    return { ok: false, error: "Não foi possível carregar o histórico." };
  }
}

export type ExportBackupState =
  | { ok: true; filename: string; content: string }
  | { ok: false; error: string };

/**
 * "Baixar meus dados": everything the user recorded, as one JSON document. Read-only. The text is
 * built here so the file is exactly what the server holds, not a re-serialisation of it.
 */
export async function exportBackupAction(): Promise<ExportBackupState> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sessão expirada. Entre novamente." };
  const backup = await exportWorkspace(financeRepository, userId, new Date());
  return {
    ok: true,
    filename: `fincore-backup-${todayInBrazil()}.json`,
    content: JSON.stringify(backup, null, 2),
  };
}

export type ExportTransactionsState =
  | { ok: true; filename: string; rows: TransactionListItem[] }
  | { ok: false; error: string };

/** Every transaction, oldest first, for the spreadsheet of "Baixar meus dados". Read-only. */
export async function exportTransactionsAction(): Promise<ExportTransactionsState> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sessão expirada. Entre novamente." };
  const rows = await getTransactions(financeRepository, userId);
  return { ok: true, filename: `fincore-lancamentos-${todayInBrazil()}.csv`, rows: rows.reverse() };
}

export type ReconcileActionState = { ok: true; result: ReconcileResult } | { ok: false; error: string };

/**
 * "Conferir com o extrato": compares a statement file's lines with what is booked. Read-only, so
 * nothing is revalidated.
 */
export async function reconcileStatementAction(raw: unknown): Promise<ReconcileActionState> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sessão expirada. Entre novamente." };
  const parsed = reconcileStatementSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Não consegui ler as linhas deste arquivo." };
  const result = await reconcileWithStatement(financeRepository, userId, parsed.data);
  if (!result.ok) return { ok: false, error: result.error.message };
  return { ok: true, result: result.value };
}

export type MarkCheckedState = { ok: true; check: StatementCheckSummary } | { ok: false; error: string };

/**
 * "Marcar como conferido": records that this statement was checked today. The comparison is run
 * again on the server from the same lines, so what is recorded is what the server finds.
 */
export async function markStatementCheckedAction(raw: unknown): Promise<MarkCheckedState> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sessão expirada. Entre novamente." };
  const parsed = reconcileStatementSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Não consegui ler as linhas deste arquivo." };
  const result = await markStatementChecked(financeRepository, userId, parsed.data, todayInBrazil());
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidatePath("/", "layout");
  return { ok: true, check: result.value };
}

/**
 * The settle action's state: when the payment exceeds the pending and the client sent no decision,
 * the error carries the figures so the modal can ask ("gorjeta ou crédito?") with the server's numbers.
 */
export type SettleActionState = ActionState & {
  surplus?: { owedCents: number; surplusCents: number };
};

/**
 * "Registrar pagamento": the use-case measures the person's pending (never trust the client) and
 * refuses to clip a payment above it — the surplus is either the user's gorjeta (an own income,
 * atomic with the acerto) or the person's credit (kept inside the acerto).
 */
export async function settlePersonAction(raw: unknown): Promise<SettleActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = settlePersonSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const result = await tracked(userId, "settle", (repo) => settlePerson(repo, userId, parsed.data), {
    when: whenOk,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error.message,
      ...(result.error.surplus ? { surplus: result.error.surplus } : {}),
    };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateSettlementAction(id: string, raw: unknown): Promise<ActionState> {
  return withParsed(settlementInputSchema, raw, (userId, input) =>
    financeRepository.updateSettlement(userId, id, {
      personId: input.personId,
      amountCents: input.amountCents,
      date: input.date,
      accountId: input.accountId,
      ...(input.note !== undefined ? { note: input.note } : {}),
    }),
  );
}

/** Revert a person payment (soft-delete the settlement). */
export async function deleteSettlementAction(id: string): Promise<ActionState> {
  return withUser((userId) => financeRepository.deleteSettlement(userId, id));
}

/**
 * "Rolar dívida": abate the original debt (`rolledAt` — kept for history, excluded from all
 * calculations) and create the new debt on the chosen instrument, for principal + juros, fully
 * owed by the person. Both happen atomically, so nothing is double-counted.
 */
export async function rollPersonDebtAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = rollDebtSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const r = parsed.data;

  const newAmount = r.principalCents + r.jurosCents;
  // Only card and loan can be installmented (cheque especial / own money are paid at once).
  const canInstallment = r.source === "card" || r.source === "loan";
  const installments = canInstallment && r.installments > 1 ? r.installments : 1;

  // The new expense is fully owed by the person (you fronted it): equal split, you excluded.
  const txInput = createTransactionSchema.safeParse({
    kind: "expense",
    description: r.description || "Dívida rolada",
    date: r.date,
    totalAmountCents: newAmount,
    categoryId: null,
    source: r.source,
    cardId: r.cardId,
    accountId: r.accountId,
    linkedAccountId: r.linkedAccountId,
    fixed: false,
    split: { method: "equal", meIn: false, selected: [r.personId], custom: {} },
    installment:
      installments > 1
        ? { total: installments, current: 1, includePrevious: false, includeNext: true }
        : null,
  });
  if (!txInput.success) return INVALID;

  const command = buildCommand(txInput.data);
  if (!command.ok) return { ok: false, error: command.error.message };

  await tracked(
    userId,
    "roll",
    (repo) => repo.rollPersonDebt(userId, r.originalTransactionId, command.value),
    { snapshot: true },
  );
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * "Rolar o saldo do mês" (pool roll): no specific transaction is abated. The use-case validates the
 * person's BOOKED outstanding (never trust the client), zeroes it via a cash-less rollover
 * settlement and creates the new debt (principal + juros) on a debt instrument, atomically.
 */
export async function rollPersonMonthDebtAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = rollMonthDebtSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const result = await tracked(userId, "roll", (repo) => rollPersonMonthDebt(repo, userId, parsed.data), {
    when: whenOk,
  });
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * "Assumir dívida": the use-case validates the person's BOOKED pending (never trust the client) and
 * moves their shares onto the user — no cash, no acerto; the expense becomes the user's.
 */
export async function assumePersonDebtAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = assumeDebtSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const result = await tracked(userId, "assume", (repo) => assumePersonDebt(repo, userId, parsed.data), {
    when: whenOk,
  });
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidatePath("/", "layout");
  return { ok: true, count: result.value };
}

// --- accounts ---
export async function createAccountAction(raw: unknown): Promise<ActionState> {
  return withParsed(accountInputSchema, raw, (u, i) => financeRepository.createAccount(u, i));
}
export async function updateAccountAction(id: string, raw: unknown): Promise<ActionState> {
  return withParsed(accountInputSchema, raw, (u, i) => financeRepository.updateAccount(u, id, i));
}
export async function deleteAccountAction(id: string): Promise<ActionState> {
  return withUser((u) => financeRepository.deleteAccount(u, id));
}

// --- credit cards ---
export async function createCreditCardAction(raw: unknown): Promise<ActionState> {
  return withParsed(creditCardInputSchema, raw, (u, i) => financeRepository.createCreditCard(u, i));
}
export async function updateCreditCardAction(id: string, raw: unknown): Promise<ActionState> {
  return withParsed(creditCardInputSchema, raw, (u, i) => financeRepository.updateCreditCard(u, id, i));
}
export async function deleteCreditCardAction(id: string): Promise<ActionState> {
  return withUser((u) => financeRepository.deleteCreditCard(u, id));
}

/** Override a card's closing/due day for one bill (competence month). */
export async function setCardBillDatesAction(raw: unknown): Promise<ActionState> {
  return withParsed(cardBillDateInputSchema, raw, (u, i) => financeRepository.upsertCardBillDate(u, i));
}
/** Restore a card's default closing/due day for one bill. */
export async function resetCardBillDatesAction(raw: unknown): Promise<ActionState> {
  return withParsed(cardBillDateResetSchema, raw, (u, i) =>
    financeRepository.deleteCardBillDate(u, i.cardId, i.month),
  );
}

// --- people ---
export async function createPersonAction(raw: unknown): Promise<ActionState> {
  return withParsed(personInputSchema, raw, (u, i) => financeRepository.createPerson(u, i));
}
export async function updatePersonAction(id: string, raw: unknown): Promise<ActionState> {
  return withParsed(personInputSchema, raw, (u, i) => financeRepository.updatePerson(u, id, i));
}
export async function deletePersonAction(id: string): Promise<ActionState> {
  return withUser((u) => financeRepository.deletePerson(u, id));
}

// --- categories ---
export async function createCategoryAction(raw: unknown): Promise<ActionState> {
  return withParsed(categoryInputSchema, raw, (u, i) => financeRepository.createCategory(u, i));
}
/** Like createCategoryAction but returns the created category (to select it inline at point of use). */
export async function createCategoryReturningAction(
  raw: unknown,
): Promise<
  | { ok: true; category: { id: string; name: string; color: string; icon: string } }
  | { ok: false; error: string }
> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sessão expirada. Entre novamente." };
  const parsed = categoryInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  const cat = await financeRepository.createCategory(userId, parsed.data);
  revalidatePath("/", "layout");
  return { ok: true, category: { id: cat.id, name: cat.name, color: cat.color, icon: cat.icon } };
}
export async function updateCategoryAction(id: string, raw: unknown): Promise<ActionState> {
  return withParsed(categoryInputSchema, raw, (u, i) => financeRepository.updateCategory(u, id, i));
}
export async function deleteCategoryAction(id: string): Promise<ActionState> {
  return withUser((u) => financeRepository.deleteCategory(u, id));
}

// --- budgets ---
export async function createBudgetAction(raw: unknown): Promise<ActionState> {
  return withParsed(budgetInputSchema, raw, (u, i) => financeRepository.createBudget(u, i));
}
export async function updateBudgetAction(id: string, raw: unknown): Promise<ActionState> {
  return withParsed(budgetInputSchema, raw, (u, i) => financeRepository.updateBudget(u, id, i));
}
export async function deleteBudgetAction(id: string): Promise<ActionState> {
  return withUser((u) => financeRepository.deleteBudget(u, id));
}

// --- goals ---
export async function createGoalAction(raw: unknown): Promise<ActionState> {
  return withParsed(goalInputSchema, raw, (u, i) => financeRepository.createGoal(u, i));
}
export async function updateGoalAction(id: string, raw: unknown): Promise<ActionState> {
  return withParsed(goalInputSchema, raw, (u, i) => financeRepository.updateGoal(u, id, i));
}
export async function deleteGoalAction(id: string): Promise<ActionState> {
  return withUser((u) => financeRepository.deleteGoal(u, id));
}
export async function contributeToGoalAction(id: string, raw: unknown): Promise<ActionState> {
  return withParsed(goalContributionSchema, raw, (u, i) =>
    financeRepository.contributeToGoal(u, id, i.amountCents),
  );
}
