import type { IsoDate } from "../value-objects/competence-month";

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
}

/** Income (receita). `amountCents` is positive. */
export interface IncomeTransaction extends BaseTransaction {
  readonly kind: "income";
  readonly amountCents: number;
  readonly accountId: string;
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
