import type { Account } from "@/domain/entities/account";
import type { Category } from "@/domain/entities/category";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { Person } from "@/domain/entities/person";
import type { Settlement } from "@/domain/entities/settlement";
import type { Transaction } from "@/domain/entities/transaction";

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
}

/**
 * Port for reading/writing a user's finance data. Implementations enforce per-user
 * isolation via Postgres RLS (the `userId` argument scopes the auth context).
 */
export interface FinanceRepository {
  /** Create the `public.users` profile row if it doesn't exist yet (first login). */
  ensureProfile(userId: string, email: string): Promise<void>;
  /** Load every non-deleted entity owned by the user. */
  loadWorkspace(userId: string): Promise<Workspace>;
}
