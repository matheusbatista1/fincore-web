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
  /**
   * Set when this expense has been "rolled" into a new debt ("Rolar dívida"): it is kept for
   * history but ABATED — excluded from balances, obligations, totals, card bills and the person
   * ledger (the new expense takes its place). Null/absent = a normal, active expense.
   */
  readonly rolledAt?: IsoDate | null;
  /**
   * When a deferred obligation (boleto/loan/financing) has been PAID: the date the money
   * actually left the account. Set alongside {@link paidAccountId} and {@link paidAmountCents}.
   * The original {@link date} (due date) and {@link amountCents} are kept intact for tracking —
   * a paid obligation debits its paying account on `paidAt` and drops out of the pending
   * obligations. Null/absent = not yet paid. Card charges are never paid per-item (settled via
   * the whole bill), so this stays null for `source === "card"`.
   */
  readonly paidAt?: IsoDate | null;
  /** The account the payment was drawn from (debited on {@link paidAt}). Set iff paid. */
  readonly paidAccountId?: string | null;
  /**
   * The amount actually paid, in cents (> 0). May differ from `|amountCents|` when a loan or
   * financing is settled early with a discount. Defaults to `|amountCents|` when unspecified.
   */
  readonly paidAmountCents?: number | null;
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
  /**
   * When a normal income has been RECEIVED (the cash landed): the date it actually hit an account.
   * The mirror of {@link ExpenseTransaction.paidAt}. Set alongside {@link receivedAccountId} and
   * {@link receivedAmountCents}. A normal income booked with a FUTURE date is a pending receivable
   * (`receivedAt === null`) that only credits the balance / abates a person's debt once received;
   * an income dated today or earlier is received on booking. `undefined` (income not created through
   * the received flow) counts as received-on-date, so legacy/immediate income behaves unchanged.
   * Card credits (estornos) are never "received" — they only reduce a card bill. The original
   * {@link BaseTransaction.date} and {@link amountCents} stay intact for history.
   */
  readonly receivedAt?: IsoDate | null;
  /** The account the money landed in (credited on {@link receivedAt}). Set iff received. */
  readonly receivedAccountId?: string | null;
  /**
   * The amount actually received, in cents (> 0). May differ from `amountCents` when a person pays
   * you back a different value than expected. Defaults to `amountCents` when unspecified.
   */
  readonly receivedAmountCents?: number | null;
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

/**
 * A "rolled" (abated) expense: kept for history but excluded from every financial calculation
 * (balance, obligations, totals, card bills, person ledger) — the new rolled-into debt replaces it.
 */
export const isRolled = (t: Transaction): boolean =>
  isExpense(t) && t.rolledAt !== null && t.rolledAt !== undefined;

/**
 * A PAID expense: a deferred obligation that has been settled. It debits its paying account on
 * `paidAt` (see the balance calculator) and drops out of the pending obligations, while keeping
 * its original due date and amount for history.
 */
export const isPaid = (t: Transaction): boolean =>
  isExpense(t) && t.paidAt !== null && t.paidAt !== undefined;

/**
 * A "payable obligation" — a deferred expense the user settles individually via the Pay flow:
 * boleto, loan and financing. Excludes `account`/`overdraft` (those already debit a balance when
 * booked) and `card` (settled through the whole bill, never per-charge).
 */
export const isPayableObligation = (t: Transaction): t is ExpenseTransaction =>
  isExpense(t) && t.source !== "account" && t.source !== "overdraft" && t.source !== "card";

/**
 * An OVERDUE obligation: a payable obligation, not yet paid nor rolled, whose due date is strictly
 * before `today`. Surfaced as an "Atrasado" signal when automatic payments are off.
 */
export const isOverdue = (t: Transaction, today: IsoDate): boolean =>
  isPayableObligation(t) && !isPaid(t) && !isRolled(t) && t.date < today;

/**
 * The cash actually spent on an expense, in positive cents. Once a deferred obligation is PAID,
 * this is the amount that truly left the account ({@link ExpenseTransaction.paidAmountCents}) —
 * which can be LESS than the original when a loan/financing is settled early with a discount (or
 * MORE if paid with interest). Otherwise it's the original `|amountCents|`. "Gasto" totals must
 * use this so a R$500 loan settled for R$470 counts as R$470, not R$500.
 */
export function settledExpenseCents(t: ExpenseTransaction): number {
  return isPaid(t) && t.paidAmountCents != null ? t.paidAmountCents : Math.abs(t.amountCents);
}

/**
 * The user's own slice of what was actually spent on an expense, in positive cents. Scales
 * {@link ExpenseTransaction.myShareCents} by the paid/original ratio when a paid obligation settled
 * for a different amount (a discount reduces the user's share proportionally); otherwise it's the
 * plain `myShareCents`. Mirrors {@link settledExpenseCents} for the personal lens.
 */
export function settledMyShareCents(t: ExpenseTransaction): number {
  const original = Math.abs(t.amountCents);
  const paid = settledExpenseCents(t);
  if (paid === original || original === 0) return t.myShareCents;
  return Math.round((t.myShareCents * paid) / original);
}

/**
 * A "receivable" income — a normal income (lands in an account, not a card credit) that flows through
 * the Receber (receipt) mechanism. Card credits (estornos) only reduce a card bill and are never
 * received. The income analogue of {@link isPayableObligation}.
 */
export const isReceivableIncome = (t: Transaction): t is IncomeTransaction =>
  isIncome(t) && t.cardId === null;

/**
 * Whether an income's cash has been RECEIVED (landed in an account). The mirror of {@link isPaid}.
 * A normal income is received unless it was booked as a pending receivable (`receivedAt === null` —
 * e.g. a future-dated income not yet received). `receivedAt === undefined` (income not created
 * through the received flow) counts as received-on-date, so existing/immediate income is unaffected.
 * Card credits are never "received".
 */
export const isReceived = (t: Transaction): boolean => isReceivableIncome(t) && t.receivedAt !== null;

/**
 * A pending receivable: a normal income whose cash has NOT been received yet (`receivedAt === null`).
 * It does not credit the balance nor abate a person's debt until received. Card credits and
 * legacy/immediate income (undefined) are never pending.
 */
export const isPendingReceivable = (t: Transaction): t is IncomeTransaction =>
  isReceivableIncome(t) && t.receivedAt === null;

/**
 * The cash actually received from an income, in positive cents. When received for a custom amount
 * (a person paid you back a different value than expected), this is the amount that truly landed
 * ({@link IncomeTransaction.receivedAmountCents}); otherwise the original `amountCents`. Mirrors
 * {@link settledExpenseCents}. A pending receivable reports its face `amountCents` (its expected
 * value) — callers gate the cash effect on {@link isReceived} separately.
 */
export function settledIncomeCents(t: IncomeTransaction): number {
  return t.receivedAt != null && t.receivedAmountCents != null ? t.receivedAmountCents : t.amountCents;
}

/**
 * The date an income's cash lands: its receipt date when received on a specific day, else its own
 * date. Mirrors the paid-obligation effective date used by the balance calculator.
 */
export function incomeEffectiveDate(t: IncomeTransaction): IsoDate {
  return t.receivedAt ?? t.date;
}
