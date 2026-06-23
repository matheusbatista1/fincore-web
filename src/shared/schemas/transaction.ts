import { z } from "zod";
import { centsSchema, idSchema, isoDateSchema } from "./common";

/**
 * Which rows an edit (or delete) applies to: just this one, this + later, or the
 * whole series (installment group / recurring series).
 */
export const editScopeSchema = z.enum(["one", "forward", "all"]).default("one");
export type EditScope = z.infer<typeof editScopeSchema>;

/** Split parameters — the server re-computes shares from these (never trusts client math). */
export const splitParamsSchema = z.object({
  method: z.enum(["equal", "custom"]).default("equal"),
  meIn: z.boolean().default(true),
  selected: z.array(idSchema).default([]),
  /** personId → amount in cents (custom method only). */
  custom: z.record(idSchema, centsSchema.nonnegative()).default({}),
});
export type SplitParams = z.infer<typeof splitParamsSchema>;

/** Installment parameters — the server generates the schedule from these. */
export const installmentParamsSchema = z.object({
  total: z.number().int().min(2, "Parcelamento exige ao menos 2 parcelas.").max(420),
  current: z.number().int().min(1),
  includePrevious: z.boolean().default(false),
  includeNext: z.boolean().default(true),
});

const expenseInputSchema = z.object({
  kind: z.literal("expense"),
  description: z.string().trim().max(120).default(""),
  date: isoDateSchema,
  note: z.string().max(280).optional(),
  /** Total purchase amount in cents (positive); the server stores it as negative. */
  totalAmountCents: centsSchema.positive("Informe um valor maior que zero."),
  categoryId: idSchema.nullable().default(null),
  source: z.enum(["card", "account", "boleto", "loan", "financing", "overdraft"]),
  cardId: idSchema.nullable().default(null),
  accountId: idSchema.nullable().default(null),
  linkedAccountId: idSchema.nullable().default(null),
  fixed: z.boolean().default(false),
  split: splitParamsSchema.default({ method: "equal", meIn: true, selected: [], custom: {} }),
  installment: installmentParamsSchema.nullable().default(null),
});

/** Income lands in exactly one destination: an account OR a credit card (estorno). */
const incomeDestination = <T extends { accountId: string | null; cardId: string | null }>(v: T) =>
  (v.accountId === null) !== (v.cardId === null);
const incomeDestinationError = {
  message: "Escolha uma conta OU um cartão de crédito.",
  path: ["accountId"] as PropertyKey[],
};

const incomeInputSchema = z
  .object({
    kind: z.literal("income"),
    description: z.string().trim().max(120).default(""),
    date: isoDateSchema,
    note: z.string().max(280).optional(),
    amountCents: centsSchema.positive("Informe um valor maior que zero."),
    accountId: idSchema.nullable().default(null),
    cardId: idSchema.nullable().default(null),
    fromPersonId: idSchema.nullable().default(null),
    fixed: z.boolean().default(false),
  })
  .refine(incomeDestination, incomeDestinationError);

const transferInputSchema = z
  .object({
    kind: z.literal("transfer"),
    description: z.string().trim().max(120).default("Transferência"),
    date: isoDateSchema,
    note: z.string().max(280).optional(),
    fromAccountId: idSchema,
    toAccountId: idSchema,
    valueCents: centsSchema.positive("Informe um valor maior que zero."),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: "Escolha carteiras diferentes.",
    path: ["toAccountId"],
  });

export const createTransactionSchema = z.discriminatedUnion("kind", [
  expenseInputSchema,
  incomeInputSchema,
  transferInputSchema,
]);
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

/**
 * Editing updates a SINGLE row (for an existing installment, only that parcela —
 * the group stays intact) and cannot change the kind. A row can be turned into
 * (or out of) a **fixed** recurring entry, and a non-installment expense can be
 * **converted** into an installment schedule (`installment` set) — which replaces
 * the row with the generated parcelas.
 */
const expenseUpdateSchema = z.object({
  kind: z.literal("expense"),
  id: idSchema,
  description: z.string().trim().max(120).default(""),
  date: isoDateSchema,
  note: z.string().max(280).optional(),
  /** This row's amount in cents (positive); the server stores it as negative. */
  amountCents: centsSchema.positive("Informe um valor maior que zero."),
  categoryId: idSchema.nullable().default(null),
  source: z.enum(["card", "account", "boleto", "loan", "financing", "overdraft"]),
  cardId: idSchema.nullable().default(null),
  accountId: idSchema.nullable().default(null),
  linkedAccountId: idSchema.nullable().default(null),
  fixed: z.boolean().default(false),
  split: splitParamsSchema.default({ method: "equal", meIn: true, selected: [], custom: {} }),
  /** Set to convert this non-installment expense into an installment schedule. */
  installment: installmentParamsSchema.nullable().default(null),
  /** For a fixed/installment edit: just this row, this + later, or the whole series. */
  scope: editScopeSchema,
});

const incomeUpdateSchema = z
  .object({
    kind: z.literal("income"),
    id: idSchema,
    description: z.string().trim().max(120).default(""),
    date: isoDateSchema,
    note: z.string().max(280).optional(),
    amountCents: centsSchema.positive("Informe um valor maior que zero."),
    accountId: idSchema.nullable().default(null),
    cardId: idSchema.nullable().default(null),
    fromPersonId: idSchema.nullable().default(null),
    fixed: z.boolean().default(false),
    /** For a fixed-income edit: just this row, or the whole recurring series. */
    scope: editScopeSchema,
  })
  .refine(incomeDestination, incomeDestinationError);

const transferUpdateSchema = z
  .object({
    kind: z.literal("transfer"),
    id: idSchema,
    description: z.string().trim().max(120).default("Transferência"),
    date: isoDateSchema,
    note: z.string().max(280).optional(),
    fromAccountId: idSchema,
    toAccountId: idSchema,
    valueCents: centsSchema.positive("Informe um valor maior que zero."),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: "Escolha carteiras diferentes.",
    path: ["toAccountId"],
  });

export const updateTransactionSchema = z.discriminatedUnion("kind", [
  expenseUpdateSchema,
  incomeUpdateSchema,
  transferUpdateSchema,
]);
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

export const deleteTransactionSchema = z.object({
  id: idSchema,
  /** For installments: just this one, this + future, or the whole group. */
  scope: z.enum(["one", "forward", "all"]).default("one"),
});
export type DeleteTransactionInput = z.infer<typeof deleteTransactionSchema>;

/** Stop a fixed transaction from recurring (keeps the row). */
export const stopRecurringSchema = z.object({ id: idSchema });

/** Move a card charge to the previous/next bill. */
export const moveBillSchema = z.object({
  id: idSchema,
  direction: z.enum(["prev", "next"]),
});

export const settlementInputSchema = z.object({
  personId: idSchema,
  amountCents: centsSchema.positive("Informe um valor maior que zero."),
  date: isoDateSchema,
  accountId: idSchema.nullable().default(null),
  note: z.string().max(280).optional(),
});
export type SettlementInput = z.infer<typeof settlementInputSchema>;

/**
 * "Rolar dívida": close the person's current debt and open a new one paid via the chosen
 * instrument (card / loan / overdraft / own account), for principal + juros, on a new date.
 * Card and loan can be installmented. The server zeroes the old debt (a rollover settlement)
 * and creates the new expense (fully owed by the person).
 */
export const rollDebtSchema = z.object({
  personId: idSchema,
  principalCents: centsSchema.positive("Informe o valor da dívida."),
  jurosCents: centsSchema.nonnegative().default(0),
  date: isoDateSchema,
  source: z.enum(["card", "loan", "overdraft", "account"]),
  cardId: idSchema.nullable().default(null),
  accountId: idSchema.nullable().default(null),
  linkedAccountId: idSchema.nullable().default(null),
  installments: z.number().int().min(1).max(420).default(1),
  description: z.string().trim().max(120).default(""),
});
export type RollDebtInput = z.infer<typeof rollDebtSchema>;
