import { and, eq, inArray, isNull } from "drizzle-orm";
import type {
  CreateTransactionCommand,
  FinanceRepository,
  NewTransactionEntry,
  SettlementData,
  Workspace,
} from "@/application/ports/finance-repository";
import type { Account } from "@/domain/entities/account";
import type { Budget } from "@/domain/entities/budget";
import type { Category } from "@/domain/entities/category";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { Person } from "@/domain/entities/person";
import type {
  AccountInput,
  BudgetInput,
  CategoryInput,
  CreditCardInput,
  PersonInput,
} from "@/shared/schemas/entities";
import type { Database } from "../db/client";
import {
  toAccount,
  toBudget,
  toCategory,
  toCreditCard,
  toPerson,
  toSettlement,
  toTransaction,
} from "../db/mappers";
import { type RlsTransaction, withUserContext } from "../db/rls";
import * as schema from "../db/schema";

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected a returned row but got none");
  return row;
}

/** Maps a domain entry to a transactions insert payload for the given user. */
function toTransactionValues(userId: string, entry: NewTransactionEntry, installmentGroupId: string | null) {
  return {
    userId,
    kind: entry.kind,
    description: entry.description,
    occurredOn: entry.date,
    amountCents: entry.amountCents,
    note: entry.note ?? null,
    recurrenceDayOfMonth: entry.recurrenceDayOfMonth ?? null,
    categoryId: entry.categoryId ?? null,
    source: entry.source ?? null,
    cardId: entry.cardId ?? null,
    accountId: entry.accountId ?? null,
    linkedAccountId: entry.linkedAccountId ?? null,
    myShareCents: entry.myShareCents ?? null,
    installmentGroupId,
    parcelaNo: entry.parcelaNo ?? null,
    parcelaTotal: entry.parcelaTotal ?? null,
    parcelaStatus: entry.parcelaStatus ?? null,
    fromPersonId: entry.fromPersonId ?? null,
    isReimbursement: entry.isReimbursement ?? false,
    transferFromAccountId: entry.transferFromAccountId ?? null,
    transferToAccountId: entry.transferToAccountId ?? null,
    transferValueCents: entry.transferValueCents ?? null,
  };
}

/**
 * Drizzle + Supabase implementation. Every read/write runs inside `withUserContext`
 * so Postgres RLS scopes rows to the user. The `Database` is injected so this stays
 * testable without importing the env-validated client.
 */
export class DrizzleFinanceRepository implements FinanceRepository {
  constructor(private readonly db: Database) {}

  private run<T>(userId: string, fn: (tx: RlsTransaction) => Promise<T>): Promise<T> {
    return withUserContext(this.db, userId, fn);
  }

  async ensureProfile(userId: string, email: string): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .insert(schema.users)
        .values({ id: userId, email })
        .onConflictDoNothing({ target: schema.users.id });
    });
  }

  async loadWorkspace(userId: string): Promise<Workspace> {
    return this.run(userId, async (tx) => {
      const accountRows = await tx.select().from(schema.accounts).where(isNull(schema.accounts.deletedAt));
      const cardRows = await tx.select().from(schema.creditCards).where(isNull(schema.creditCards.deletedAt));
      const peopleRows = await tx.select().from(schema.people).where(isNull(schema.people.deletedAt));
      const categoryRows = await tx
        .select()
        .from(schema.categories)
        .where(isNull(schema.categories.deletedAt));
      const txRows = await tx.select().from(schema.transactions).where(isNull(schema.transactions.deletedAt));
      const splitRows = await tx.select().from(schema.transactionSplits);
      const settlementRows = await tx.select().from(schema.settlements);
      const budgetRows = await tx.select().from(schema.budgets).where(isNull(schema.budgets.deletedAt));

      const splitsByTx = new Map<string, (typeof splitRows)[number][]>();
      for (const split of splitRows) {
        const list = splitsByTx.get(split.transactionId) ?? [];
        list.push(split);
        splitsByTx.set(split.transactionId, list);
      }

      return {
        accounts: accountRows.map(toAccount),
        creditCards: cardRows.map(toCreditCard),
        people: peopleRows.map(toPerson),
        categories: categoryRows.map(toCategory),
        transactions: txRows.map((row) => toTransaction(row, splitsByTx.get(row.id) ?? [])),
        settlements: settlementRows.map(toSettlement),
        budgets: budgetRows.map(toBudget),
      };
    });
  }

  async createAccount(userId: string, input: AccountInput): Promise<Account> {
    return this.run(userId, async (tx) =>
      toAccount(
        one(
          await tx
            .insert(schema.accounts)
            .values({ userId, ...input })
            .returning(),
        ),
      ),
    );
  }

  async updateAccount(userId: string, id: string, input: AccountInput): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.accounts)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(schema.accounts.id, id));
    });
  }

  async deleteAccount(userId: string, id: string): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx.update(schema.accounts).set({ deletedAt: new Date() }).where(eq(schema.accounts.id, id));
    });
  }

  async createCreditCard(userId: string, input: CreditCardInput): Promise<CreditCard> {
    return this.run(userId, async (tx) =>
      toCreditCard(
        one(
          await tx
            .insert(schema.creditCards)
            .values({ userId, ...input })
            .returning(),
        ),
      ),
    );
  }

  async updateCreditCard(userId: string, id: string, input: CreditCardInput): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.creditCards)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(schema.creditCards.id, id));
    });
  }

  async deleteCreditCard(userId: string, id: string): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx.update(schema.creditCards).set({ deletedAt: new Date() }).where(eq(schema.creditCards.id, id));
    });
  }

  async createPerson(userId: string, input: PersonInput): Promise<Person> {
    return this.run(userId, async (tx) =>
      toPerson(
        one(
          await tx
            .insert(schema.people)
            .values({ userId, ...input })
            .returning(),
        ),
      ),
    );
  }

  async updatePerson(userId: string, id: string, input: PersonInput): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.people)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(schema.people.id, id));
    });
  }

  async deletePerson(userId: string, id: string): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx.update(schema.people).set({ deletedAt: new Date() }).where(eq(schema.people.id, id));
    });
  }

  async createCategory(userId: string, input: CategoryInput): Promise<Category> {
    return this.run(userId, async (tx) =>
      toCategory(
        one(
          await tx
            .insert(schema.categories)
            .values({ userId, ...input })
            .returning(),
        ),
      ),
    );
  }

  async updateCategory(userId: string, id: string, input: CategoryInput): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.categories)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(schema.categories.id, id));
    });
  }

  async deleteCategory(userId: string, id: string): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx.update(schema.categories).set({ deletedAt: new Date() }).where(eq(schema.categories.id, id));
    });
  }

  async createBudget(userId: string, input: BudgetInput): Promise<Budget> {
    return this.run(userId, async (tx) =>
      toBudget(
        one(
          await tx
            .insert(schema.budgets)
            .values({ userId, ...input })
            .returning(),
        ),
      ),
    );
  }

  async updateBudget(userId: string, id: string, input: BudgetInput): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.budgets)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(schema.budgets.id, id));
    });
  }

  async deleteBudget(userId: string, id: string): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx.update(schema.budgets).set({ deletedAt: new Date() }).where(eq(schema.budgets.id, id));
    });
  }

  async createTransaction(userId: string, command: CreateTransactionCommand): Promise<void> {
    await this.run(userId, async (tx) => {
      let groupId: string | null = null;
      if (command.installmentGroup) {
        const group = one(
          await tx
            .insert(schema.installmentGroups)
            .values({ userId, ...command.installmentGroup })
            .returning({ id: schema.installmentGroups.id }),
        );
        groupId = group.id;
      }

      const inserted = await tx
        .insert(schema.transactions)
        .values(command.entries.map((entry) => toTransactionValues(userId, entry, groupId)))
        .returning({ id: schema.transactions.id });

      const splitValues = command.entries.flatMap((entry, index) => {
        const transactionId = inserted[index]?.id;
        if (transactionId === undefined || !entry.splits) return [];
        return entry.splits.map((split) => ({
          userId,
          transactionId,
          personId: split.personId,
          shareCents: split.shareCents,
        }));
      });
      if (splitValues.length > 0) {
        await tx.insert(schema.transactionSplits).values(splitValues);
      }
    });
  }

  async deleteTransaction(userId: string, id: string, scope: "one" | "forward" | "all"): Promise<number> {
    return this.run(userId, async (tx) => {
      const target = one(
        await tx
          .select({
            id: schema.transactions.id,
            groupId: schema.transactions.installmentGroupId,
            parcelaNo: schema.transactions.parcelaNo,
          })
          .from(schema.transactions)
          .where(eq(schema.transactions.id, id)),
      );

      let ids: string[] = [id];
      if (target.groupId && scope !== "one") {
        const groupRows = await tx
          .select({ id: schema.transactions.id, parcelaNo: schema.transactions.parcelaNo })
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.installmentGroupId, target.groupId),
              isNull(schema.transactions.deletedAt),
            ),
          );
        ids =
          scope === "all"
            ? groupRows.map((row) => row.id)
            : groupRows.filter((row) => (row.parcelaNo ?? 0) >= (target.parcelaNo ?? 0)).map((row) => row.id);
      }

      await tx
        .update(schema.transactions)
        .set({ deletedAt: new Date() })
        .where(inArray(schema.transactions.id, ids));
      return ids.length;
    });
  }

  async createSettlement(userId: string, input: SettlementData): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx.insert(schema.settlements).values({
        userId,
        personId: input.personId,
        amountCents: input.amountCents,
        settledOn: input.date,
        accountId: input.accountId ?? null,
        note: input.note ?? null,
      });
    });
  }
}
