import type { Account } from "@/domain/entities/account";
import type { Budget } from "@/domain/entities/budget";
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
 * installment/recurrence linkage is preserved (editing a parcela touches only
 * that row). Splits are replaced atomically with the provided set.
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
  /** Persist (or clear) the user's avatar URL. */
  updateAvatar(userId: string, avatarUrl: string | null): Promise<void>;
  /** Persist the set of optional modules the user has turned on. */
  updateEnabledModules(userId: string, modules: ModuleKey[]): Promise<void>;
  /** Stamp the first-run onboarding as completed. */
  markOnboarded(userId: string): Promise<void>;
  loadWorkspace(userId: string): Promise<Workspace>;

  createAccount(userId: string, input: AccountInput): Promise<Account>;
  updateAccount(userId: string, id: string, input: AccountInput): Promise<void>;
  deleteAccount(userId: string, id: string): Promise<void>;

  createCreditCard(userId: string, input: CreditCardInput): Promise<CreditCard>;
  updateCreditCard(userId: string, id: string, input: CreditCardInput): Promise<void>;
  deleteCreditCard(userId: string, id: string): Promise<void>;

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
  /** Update a single transaction row (kind immutable) and replace its splits atomically. */
  updateTransaction(userId: string, command: UpdateTransactionCommand): Promise<void>;
  /** Soft-delete a transaction; for installments, `scope` decides how many. Returns the count removed. */
  deleteTransaction(userId: string, id: string, scope: "one" | "forward" | "all"): Promise<number>;
  /** Stop a fixed transaction from recurring: clears its recurrence, keeping the row. */
  stopRecurrence(userId: string, id: string): Promise<void>;

  createSettlement(userId: string, input: SettlementData): Promise<void>;
}
