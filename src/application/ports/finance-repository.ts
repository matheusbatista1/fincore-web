import type { Account } from "@/domain/entities/account";
import type { Budget } from "@/domain/entities/budget";
import type { CardBillDate } from "@/domain/entities/card-bill-date";
import type { CardBillPayment } from "@/domain/entities/card-bill-payment";
import type { Category } from "@/domain/entities/category";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { Goal } from "@/domain/entities/goal";
import type { Person } from "@/domain/entities/person";
import type { Settlement } from "@/domain/entities/settlement";
import type {
  ExpenseSource,
  ParcelaStatus,
  Transaction,
  TransactionKind,
} from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import type { ModuleKey } from "@/shared/modules";
import type {
  AccountInput,
  BudgetInput,
  CategoryInput,
  CreditCardInput,
  GoalInput,
  PersonInput,
} from "@/shared/schemas/entities";

/** The user's profile + per-user settings (display name, enabled modules, onboarding state). */
export interface UserProfile {
  readonly displayName: string | null;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly enabledModules: ModuleKey[];
  readonly onboardedAt: Date | null;
  /** When on, due obligations and faturas are auto-paid from {@link defaultPayAccountId}. */
  readonly autoPaymentsEnabled: boolean;
  /** The account auto-payments debit from; null when unset. */
  readonly defaultPayAccountId: string | null;
  /** The date auto-payments were turned on (`YYYY-MM-DD`); reconciliation only books from here on. */
  readonly autoPaymentsSince: string | null;
  /** The date recurring rules were materialised through (`YYYY-MM-DD`); the next pass books every
   * occurrence dated after it, up to today. Null = start from the beginning of the current month. */
  readonly recurringMaterializedThrough: string | null;
}

/**
 * A user's full financial dataset, as domain entities. Personal-finance volumes
 * are small, so loading the whole workspace and computing in the domain layer is
 * both simple and the single source of truth (no SQL views).
 */
export interface Workspace {
  readonly accounts: Account[];
  readonly creditCards: CreditCard[];
  readonly people: Person[];
  readonly categories: Category[];
  readonly transactions: Transaction[];
  readonly settlements: Settlement[];
  readonly budgets: Budget[];
  readonly goals: Goal[];
  /** Per-bill closing/due-day overrides (one row per card+competence month). */
  readonly cardBillDates: CardBillDate[];
  /** Paid credit-card faturas (one active row per card+competence month). */
  readonly cardBillPayments: CardBillPayment[];
}

/** One transaction row to persist (a single tx, or one parcela of an installment). */
export interface NewTransactionEntry {
  readonly kind: TransactionKind;
  readonly description: string;
  readonly date: IsoDate;
  readonly amountCents: number;
  readonly note?: string;
  readonly categoryId?: string | null;
  readonly source?: ExpenseSource | null;
  readonly cardId?: string | null;
  readonly accountId?: string | null;
  readonly linkedAccountId?: string | null;
  readonly myShareCents?: number | null;
  readonly recurrenceDayOfMonth?: number | null;
  readonly parcelaNo?: number | null;
  readonly parcelaTotal?: number | null;
  readonly parcelaStatus?: ParcelaStatus | null;
  readonly fromPersonId?: string | null;
  readonly isReimbursement?: boolean;
  /** Income receipt state — set for a normal income received on booking (date ≤ today); a pending
   * (future-dated) receivable leaves these null. Mirrors the paid-obligation fields. */
  readonly receivedAt?: IsoDate | null;
  readonly receivedAccountId?: string | null;
  readonly receivedAmountCents?: number | null;
  readonly transferFromAccountId?: string | null;
  readonly transferToAccountId?: string | null;
  readonly transferValueCents?: number | null;
  readonly splits?: ReadonlyArray<{ personId: string; shareCents: number }>;
}

/** A transaction creation command: optional installment group + the entries to insert atomically. */
export interface CreateTransactionCommand {
  readonly installmentGroup?: { totalCount: number; totalCents: number };
  readonly entries: NewTransactionEntry[];
}

/**
 * An in-place update of a single transaction row. The kind is immutable and the
 * existing installment linkage is preserved (editing a parcela touches only that
 * row). `fixed` toggles the row's recurrence on/off. Splits are replaced
 * atomically with the provided set.
 */
export interface UpdateTransactionCommand {
  readonly id: string;
  readonly kind: TransactionKind;
  readonly description: string;
  readonly date: IsoDate;
  readonly amountCents: number;
  readonly note?: string | null;
  readonly categoryId?: string | null;
  readonly source?: ExpenseSource | null;
  readonly cardId?: string | null;
  readonly accountId?: string | null;
  readonly linkedAccountId?: string | null;
  readonly myShareCents?: number | null;
  /** When true the row recurs (anchored to its date's day); false clears recurrence. */
  readonly fixed?: boolean;
  readonly fromPersonId?: string | null;
  readonly isReimbursement?: boolean;
  readonly transferFromAccountId?: string | null;
  readonly transferToAccountId?: string | null;
  readonly transferValueCents?: number | null;
  readonly splits?: ReadonlyArray<{ personId: string; shareCents: number }>;
}

export interface SettlementData {
  readonly personId: string;
  readonly amountCents: number;
  readonly date: IsoDate;
  readonly accountId?: string | null;
  readonly note?: string;
}

export interface CardBillPaymentData {
  readonly cardId: string;
  readonly competenceMonth: string;
  readonly amountCents: number;
  readonly accountId: string;
  readonly paidOn: IsoDate;
  readonly note?: string;
}

/**
 * Port for reading/writing a user's finance data. Implementations enforce per-user
 * isolation via Postgres RLS (the `userId` argument scopes the auth context); every
 * write is atomic within that scope.
 */
export interface FinanceRepository {
  ensureProfile(userId: string, email: string): Promise<void>;
  /** The user's profile + settings (name, enabled modules, onboarding state). */
  getProfile(userId: string): Promise<UserProfile>;
  updateProfile(userId: string, input: { displayName: string }): Promise<void>;
  /** Persist the auto-payments preference + the account they debit from + the "enabled since" date. */
  updatePreferences(
    userId: string,
    input: {
      autoPaymentsEnabled: boolean;
      defaultPayAccountId: string | null;
      autoPaymentsSince: string | null;
    },
  ): Promise<void>;
  /** Persist (or clear) the user's avatar URL. */
  updateAvatar(userId: string, avatarUrl: string | null): Promise<void>;
  /** Persist the set of optional modules the user has turned on. */
  updateEnabledModules(userId: string, modules: ModuleKey[]): Promise<void>;
  /** Stamp the first-run onboarding as completed. */
  markOnboarded(userId: string): Promise<void>;
  /** Mark the account for deletion (a cron purges it after the grace period). */
  deactivateAccount(userId: string): Promise<void>;
  /** Clear the deletion mark (called on login — "logged in within the window, keep it"). */
  reactivateAccount(userId: string): Promise<void>;
  loadWorkspace(userId: string): Promise<Workspace>;

  createAccount(userId: string, input: AccountInput): Promise<Account>;
  updateAccount(userId: string, id: string, input: AccountInput): Promise<void>;
  deleteAccount(userId: string, id: string): Promise<void>;

  createCreditCard(userId: string, input: CreditCardInput): Promise<CreditCard>;
  updateCreditCard(userId: string, id: string, input: CreditCardInput): Promise<void>;
  deleteCreditCard(userId: string, id: string): Promise<void>;

  /** Set (upsert) a card's closing/due-day override for one competence month. */
  upsertCardBillDate(
    userId: string,
    input: { cardId: string; month: string; closingDay: number; dueDay: number },
  ): Promise<void>;
  /** Remove a card's per-month override, restoring the card's default days for that bill. */
  deleteCardBillDate(userId: string, cardId: string, month: string): Promise<void>;

  createPerson(userId: string, input: PersonInput): Promise<Person>;
  updatePerson(userId: string, id: string, input: PersonInput): Promise<void>;
  deletePerson(userId: string, id: string): Promise<void>;

  createCategory(userId: string, input: CategoryInput): Promise<Category>;
  updateCategory(userId: string, id: string, input: CategoryInput): Promise<void>;
  deleteCategory(userId: string, id: string): Promise<void>;

  createBudget(userId: string, input: BudgetInput): Promise<Budget>;
  updateBudget(userId: string, id: string, input: BudgetInput): Promise<void>;
  deleteBudget(userId: string, id: string): Promise<void>;

  createGoal(userId: string, input: GoalInput): Promise<Goal>;
  updateGoal(userId: string, id: string, input: GoalInput): Promise<void>;
  deleteGoal(userId: string, id: string): Promise<void>;
  /** Add `amountCents` to a goal's saved total atomically. */
  contributeToGoal(userId: string, id: string, amountCents: number): Promise<void>;

  /** Persist a transaction (single or installment schedule) atomically. */
  createTransaction(userId: string, command: CreateTransactionCommand): Promise<void>;
  /**
   * Update a transaction row (kind immutable) and replace its splits atomically.
   * `scope` propagates the classification fields (description, note, category,
   * payment source) to sibling rows of an installment group or recurring series:
   * `"forward"` = this + later parcelas, `"all"` = the whole series. The target
   * row always gets the full update (amount/splits); siblings only the
   * classification. Returns the number of rows touched.
   */
  updateTransaction(
    userId: string,
    command: UpdateTransactionCommand,
    scope?: "one" | "forward" | "all",
  ): Promise<number>;
  /** Soft-delete a single row and persist `command` (an installment group) in its place, atomically. */
  replaceWithInstallment(
    userId: string,
    originalId: string,
    command: CreateTransactionCommand,
  ): Promise<void>;
  /**
   * "Rolar dívida": abate the original debt (`rolledAt` — kept for history, excluded from all
   * calculations) and persist `command` (the new debt on the chosen instrument), atomically.
   */
  rollPersonDebt(userId: string, originalId: string, command: CreateTransactionCommand): Promise<void>;
  /**
   * "Rolar o saldo do mês" (pool roll): zero the person's outstanding via a cash-less rollover
   * settlement and persist `command` (the new debt on the chosen instrument), atomically. No
   * transaction is abated — the settlement's zero-clamp covers the oldest open debts first.
   */
  rollPersonMonthDebt(
    userId: string,
    settlement: SettlementData,
    command: CreateTransactionCommand,
  ): Promise<void>;
  /**
   * Persist a single-entry command and return the new transaction's id — for flows that must act
   * on the row right after creating it (paying a recurring occurrence ahead of its day).
   */
  createTransactionReturningId(userId: string, command: CreateTransactionCommand): Promise<string>;
  /**
   * Book the materialised occurrences of the user's recurring rules and advance the watermark to
   * `through`, atomically. The watermark doubles as an OPTIMISTIC LOCK: the update only applies
   * while the stored value is still behind `through`, so a second pass racing the first (app load
   * × cron) writes nothing and the rows cannot be double-booked. Returns how many were inserted
   * (0 when the lock was lost).
   */
  materializeRecurring(
    userId: string,
    through: IsoDate,
    commands: readonly CreateTransactionCommand[],
  ): Promise<number>;
  /**
   * Mark a deferred obligation (boleto/loan/financing) as PAID: it debits `paidAccountId` by
   * `paidAmountCents` on `paidAt`, while its original due date and amount stay intact for history.
   */
  payTransaction(
    userId: string,
    id: string,
    payment: { paidAt: IsoDate; paidAccountId: string; paidAmountCents: number },
  ): Promise<void>;
  /** Revert a payment: clears the paid fields so the obligation is pending again. */
  undoPayment(userId: string, id: string): Promise<void>;
  /**
   * Mark a normal income as RECEIVED: it credits `receivedAccountId` by `receivedAmountCents` on
   * `receivedAt`, while its original booked date and amount stay intact for history. When the income
   * is a payment from a person, receiving abates that person's debt by the amount received.
   */
  receiveIncome(
    userId: string,
    id: string,
    receipt: { receivedAt: IsoDate; receivedAccountId: string; receivedAmountCents: number },
  ): Promise<void>;
  /** Revert a receipt: clears the received fields so the income is a pending receivable again. */
  undoReceive(userId: string, id: string): Promise<void>;
  /** Soft-delete a transaction; for installments, `scope` decides how many. Returns the count removed. */
  deleteTransaction(userId: string, id: string, scope: "one" | "forward" | "all"): Promise<number>;
  /** Stop a fixed transaction from recurring: clears its recurrence, keeping the row. */
  stopRecurrence(userId: string, id: string): Promise<void>;
  /** Pin a card charge to a specific bill (competence month), or `null` to restore the automatic cycle. */
  setBillMonthOverride(userId: string, id: string, month: string | null): Promise<void>;

  createSettlement(userId: string, input: SettlementData): Promise<void>;
  /** Edit a settlement (amount, date, account, note) in place. */
  updateSettlement(userId: string, id: string, input: SettlementData): Promise<void>;
  /** Soft-delete a settlement (revert a person payment). */
  deleteSettlement(userId: string, id: string): Promise<void>;

  /**
   * Pay a card fatura (upsert the one active payment for its card+competence): debits the account
   * by `amountCents` on `paidOn`. Re-paying the same bill replaces the active row.
   */
  payCardBill(userId: string, input: CardBillPaymentData): Promise<void>;
  /** Revert a fatura payment: soft-delete the active payment for that card+competence. */
  undoCardBillPayment(userId: string, cardId: string, competenceMonth: string): Promise<void>;
}
