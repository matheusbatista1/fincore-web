import { z } from "zod";
import { centsSchema, competenceMonthSchema, idSchema, isoDateSchema } from "./common";

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

/**
 * Book one occurrence of a recurring rule ahead of its automatic pass — what "Pagar"/"Receber" on a
 * previsto needs, since a forecast is not a transaction and cannot be settled. The server validates
 * that `date` really is where the rule falls in that month.
 */
export const materializeOccurrenceSchema = z.object({
  /** The recurring transaction the forecast derives from. */
  anchorId: idSchema,
  /** The occurrence's own date (`YYYY-MM-DD`). */
  date: isoDateSchema,
});

/** Move a card charge to the previous/next bill. */
export const moveBillSchema = z.object({
  id: idSchema,
  direction: z.enum(["prev", "next"]),
});

/**
 * Pay a deferred obligation (boleto/loan/financing): choose the paying account, optionally the
 * paid date (defaults to today) and a custom paid amount (early settlement, e.g. a loan discount).
 * The original due date and amount are kept intact for history.
 */
export const payTransactionSchema = z.object({
  id: idSchema,
  paidAccountId: idSchema,
  paidAt: isoDateSchema.optional(),
  paidAmountCents: centsSchema.positive("Informe um valor maior que zero.").optional(),
});
export type PayTransactionInput = z.infer<typeof payTransactionSchema>;

/** Revert a payment (make the obligation pending again). */
export const undoPaymentSchema = z.object({ id: idSchema });

/**
 * Receive a normal income (the income-side mirror of {@link payTransactionSchema}): choose the
 * receiving account, optionally the receipt date (defaults to today) and a custom received amount
 * (a person paying you back a different value). The original booked date and amount stay intact.
 */
export const receiveIncomeSchema = z.object({
  id: idSchema,
  receivedAccountId: idSchema,
  receivedAt: isoDateSchema.optional(),
  receivedAmountCents: centsSchema.positive("Informe um valor maior que zero.").optional(),
});
export type ReceiveIncomeInput = z.infer<typeof receiveIncomeSchema>;

/** Revert a receipt (make the income a pending receivable again). */
export const undoReceiveSchema = z.object({ id: idSchema });

/**
 * Pay a whole card fatura: the server computes the bill total for (card, competence) and debits
 * the chosen account on the paid date (defaults to today). Card charges are settled via the bill,
 * never per-charge.
 */
export const payCardBillSchema = z.object({
  cardId: idSchema,
  competenceMonth: competenceMonthSchema,
  paidAccountId: idSchema,
  paidAt: isoDateSchema.optional(),
});

/** Revert a fatura payment (the whole bill becomes pending again). */
export const undoCardBillPaymentSchema = z.object({
  cardId: idSchema,
  competenceMonth: competenceMonthSchema,
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
  /** The original debt (transaction) being rolled — abated, then replaced by the new one. */
  originalTransactionId: idSchema,
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

/**
 * "Rolar o saldo do mês": roll what the person still owes as a POOL — no specific transaction is
 * abated. The server zeroes the outstanding via a cash-less rollover settlement (clamped, so it can
 * never overshoot) and creates the new debt (principal + juros) on the chosen instrument, fully owed
 * by the person. Matches how pooled debts are managed in practice ("she owed 3.000, paid 2.600, I
 * roll the 400"), where no single lançamento corresponds to the remainder.
 */
export const rollMonthDebtSchema = z.object({
  personId: idSchema,
  /** The browsed month whose remainder is being rolled — the server validates the outstanding
   * through it and requires the new debt to land in a LATER month (so the rollover settlement
   * covers the old debts, never the new one). */
  month: competenceMonthSchema,
  principalCents: centsSchema.positive("Informe o valor da dívida."),
  jurosCents: centsSchema.nonnegative().default(0),
  date: isoDateSchema,
  /** Pool rolls move the debt to a DEBT instrument only — `account`/`overdraft` would debit real
   * cash at roll time, but a pool roll moves no money ("sem dinheiro trocando de mãos"). */
  source: z.enum(["card", "loan"]),
  /** When the roll DID move real money — a Pix no crédito whose cash landed in an account (and was
   * used to cover the person's share) — the rollover settlement is account-backed: it credits this
   * account and counts as third-party money (dropped from the personal lens). Null = paper-only. */
  cashAccountId: idSchema.nullable().default(null),
  cardId: idSchema.nullable().default(null),
  accountId: idSchema.nullable().default(null),
  linkedAccountId: idSchema.nullable().default(null),
  installments: z.number().int().min(1).max(420).default(1),
  description: z.string().trim().max(120).default(""),
});
export type RollMonthDebtInput = z.infer<typeof rollMonthDebtSchema>;
