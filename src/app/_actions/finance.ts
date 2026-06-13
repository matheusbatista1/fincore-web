"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { createTransaction } from "@/application/use-cases/create-transaction";
import { importStatement } from "@/application/use-cases/import-statement";
import { updateTransaction } from "@/application/use-cases/update-transaction";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import {
  accountInputSchema,
  budgetInputSchema,
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
  settlementInputSchema,
  stopRecurringSchema,
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
  try {
    const result = await updateTransaction(financeRepository, userId, parsed.data);
    if (!result.ok) return { ok: false, error: result.error.message };
  } catch (error) {
    console.error("updateTransactionAction failed", error);
    return { ok: false, error: "Não foi possível atualizar o lançamento." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
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
