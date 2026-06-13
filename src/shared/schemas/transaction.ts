import { z } from "zod";
import { centsSchema, idSchema, isoDateSchema } from "./common";

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

const incomeInputSchema = z.object({
  kind: z.literal("income"),
  description: z.string().trim().max(120).default(""),
  date: isoDateSchema,
  note: z.string().max(280).optional(),
  amountCents: centsSchema.positive("Informe um valor maior que zero."),
  accountId: idSchema,
  fromPersonId: idSchema.nullable().default(null),
  fixed: z.boolean().default(false),
});

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
 * Editing updates a SINGLE row (for installments, only that parcela — the group
 * stays intact) and cannot change the kind, mirroring the prototype's edit mode
 * (no intent tabs, no installment/fixed toggles).
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
  split: splitParamsSchema.default({ method: "equal", meIn: true, selected: [], custom: {} }),
});

const incomeUpdateSchema = z.object({
  kind: z.literal("income"),
  id: idSchema,
  description: z.string().trim().max(120).default(""),
  date: isoDateSchema,
  note: z.string().max(280).optional(),
  amountCents: centsSchema.positive("Informe um valor maior que zero."),
  accountId: idSchema,
  fromPersonId: idSchema.nullable().default(null),
});

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

export const settlementInputSchema = z.object({
  personId: idSchema,
  amountCents: centsSchema.positive("Informe um valor maior que zero."),
  date: isoDateSchema,
  accountId: idSchema.nullable().default(null),
  note: z.string().max(280).optional(),
});
export type SettlementInput = z.infer<typeof settlementInputSchema>;
