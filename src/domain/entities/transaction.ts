import type { CompetenceMonth, IsoDate } from "../value-objects/competence-month";

/** Discriminator for the polymorphic transaction (lançamento). */
export type TransactionKind = "expense" | "income" | "transfer";

/** How an expense was paid (forma de pagamento). */
export type ExpenseSource = "card" | "account" | "boleto" | "loan" | "financing" | "overdraft";

/** Status of a single installment within its group (parcela). */
export type ParcelaStatus = "paga" | "atual" | "futura";

/** One person's share of a shared expense (rateio). */
export interface TransactionSplit {
  readonly personId: string;
  /** What this person owes for the expense, in cents (> 0). */
  readonly shareCents: number;
}

/** Installment membership for an expense (parcelamento). */
export interface InstallmentInfo {
  /** Groups all installments of one purchase. */
  readonly groupId: string;
  /** 1-based installment number. */
  readonly number: number;
  /** Total number of installments (N). */
  readonly total: number;
  readonly status: ParcelaStatus;
}

/** Monthly recurrence marker for a fixed transaction (lançamento fixo). */
export interface RecurrenceInfo {
  /** Day of month the transaction repeats on (1–31). */
  readonly dayOfMonth: number;
}

interface BaseTransaction {
  readonly id: string;
  readonly description: string;
  readonly date: IsoDate;
  readonly note?: string;
}

/** Expense (despesa). `amountCents` is negative; for installments it is the per-parcela amount. */
export interface ExpenseTransaction extends BaseTransaction {
  readonly kind: "expense";
  readonly amountCents: number;
  readonly categoryId: string | null;
  readonly source: ExpenseSource;
  /** Set when source === "card". */
  readonly cardId: string | null;
  /** Set when source === "account" (debits the balance). */
  readonly accountId: string | null;
  /** Organizational link for boleto/loan/financing/overdraft (does NOT debit a balance). */
  readonly linkedAccountId: string | null;
  /** People sharing the expense; empty when not shared. */
  readonly splits: readonly TransactionSplit[];
  /** The user's own portion, in cents (derived: |amount| − Σ split shares). */
  readonly myShareCents: number;
  readonly installment: InstallmentInfo | null;
  readonly recurrence: RecurrenceInfo | null;
  /** Manual override pinning a card charge to a specific bill (competence month); null = automatic. */
  readonly billMonthOverride: CompetenceMonth | null;
}

/**
 * Income (receita). `amountCents` is positive. Lands in EITHER an account
 * (normal income, `accountId` set) OR a credit card (`cardId` set) — exactly one
 * of the two. A card-bound income is a **card credit** (estorno/reembolso/juros
 * devolvidos): it only reduces that card's bill and never counts as income.
 */
export interface IncomeTransaction extends BaseTransaction {
  readonly kind: "income";
  readonly amountCents: number;
  /** Destination account for a normal income; null for a card credit. */
  readonly accountId: string | null;
  /** Target card for a card credit (estorno); null for a normal income. */
  readonly cardId: string | null;
  /** When the income is a payment from a person, it abates that person's debt. */
  readonly fromPersonId: string | null;
  /** Reimbursements don't count as "your" income in the Personal view. */
  readonly isReimbursement: boolean;
  readonly recurrence: RecurrenceInfo | null;
}

/** Transfer between two of the user's own accounts (transferência). No net effect on wealth. */
export interface TransferTransaction extends BaseTransaction {
  readonly kind: "transfer";
  readonly fromAccountId: string;
  readonly toAccountId: string;
  /** Amount moved, in cents (> 0). */
  readonly valueCents: number;
}

export type Transaction = ExpenseTransaction | IncomeTransaction | TransferTransaction;

export const isExpense = (t: Transaction): t is ExpenseTransaction => t.kind === "expense";
export const isIncome = (t: Transaction): t is IncomeTransaction => t.kind === "income";
export const isTransfer = (t: Transaction): t is TransferTransaction => t.kind === "transfer";

/** A card credit (estorno/reembolso): an income whose destination is a credit card. */
export const isCardCredit = (t: Transaction): t is IncomeTransaction & { cardId: string } =>
  isIncome(t) && t.cardId !== null;
