"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { buildCommand, createTransaction } from "@/application/use-cases/create-transaction";
import { importStatement } from "@/application/use-cases/import-statement";
import { moveTransactionBill } from "@/application/use-cases/move-transaction-bill";
import { payCardBill } from "@/application/use-cases/pay-card-bill";
import { payTransaction } from "@/application/use-cases/pay-transaction";
import { updateTransaction } from "@/application/use-cases/update-transaction";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
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
import {
  createTransactionSchema,
  deleteTransactionSchema,
  moveBillSchema,
  payCardBillSchema,
  payTransactionSchema,
  rollDebtSchema,
  settlementInputSchema,
  stopRecurringSchema,
  undoCardBillPaymentSchema,
  undoPaymentSchema,
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

// --- transactions ---
export async function createTransactionAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = createTransactionSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const result = await createTransaction(financeRepository, userId, parsed.data);
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
    const result = await updateTransaction(financeRepository, userId, parsed.data);
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
  const count = await financeRepository.deleteTransaction(userId, parsed.data.id, parsed.data.scope);
  revalidatePath("/", "layout");
  return { ok: true, count };
}

export async function stopRecurringAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = stopRecurringSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  await financeRepository.stopRecurrence(userId, parsed.data.id);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Move a card charge to the previous/next bill (keeps its real date). */
export async function moveTransactionBillAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = moveBillSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const result = await moveTransactionBill(financeRepository, userId, parsed.data.id, parsed.data.direction);
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
  const result = await payTransaction(financeRepository, userId, {
    id: parsed.data.id,
    paidAccountId: parsed.data.paidAccountId,
    ...(parsed.data.paidAt !== undefined ? { paidAt: parsed.data.paidAt } : {}),
    ...(parsed.data.paidAmountCents !== undefined ? { paidAmountCents: parsed.data.paidAmountCents } : {}),
  });
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Revert a payment: the obligation becomes pending again (money returns to the balance). */
export async function undoPaymentAction(raw: unknown): Promise<ActionState> {
  return withParsed(undoPaymentSchema, raw, (userId, input) =>
    financeRepository.undoPayment(userId, input.id),
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

export async function importTransactionsAction(raw: unknown): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return UNAUTHORIZED;
  const parsed = importStatementSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  await importStatement(financeRepository, userId, parsed.data);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function settlePersonAction(raw: unknown): Promise<ActionState> {
  return withParsed(settlementInputSchema, raw, (userId, input) =>
    financeRepository.createSettlement(userId, {
      personId: input.personId,
      amountCents: input.amountCents,
      date: input.date,
      accountId: input.accountId,
      ...(input.note !== undefined ? { note: input.note } : {}),
    }),
  );
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

  await financeRepository.rollPersonDebt(userId, r.originalTransactionId, command.value);
  revalidatePath("/", "layout");
  return { ok: true };
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
