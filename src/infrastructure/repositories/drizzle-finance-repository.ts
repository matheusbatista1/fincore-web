import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
  CreateTransactionCommand,
  FinanceRepository,
  NewTransactionEntry,
  SettlementData,
  UpdateTransactionCommand,
  UserProfile,
  Workspace,
} from "@/application/ports/finance-repository";
import type { Account } from "@/domain/entities/account";
import type { Budget } from "@/domain/entities/budget";
import type { Category } from "@/domain/entities/category";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { Goal } from "@/domain/entities/goal";
import type { Person } from "@/domain/entities/person";
import { type ModuleKey, sanitizeModules } from "@/shared/modules";
import type {
  AccountInput,
  BudgetInput,
  CategoryInput,
  CreditCardInput,
  GoalInput,
  PersonInput,
} from "@/shared/schemas/entities";
import type { Database } from "../db/client";
import {
  toAccount,
  toBudget,
  toCardBillDate,
  toCategory,
  toCreditCard,
  toGoal,
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

  async getProfile(userId: string): Promise<UserProfile> {
    const row = await this.run(userId, async (tx) =>
      one(
        await tx
          .select({
            displayName: schema.users.displayName,
            email: schema.users.email,
            avatarUrl: schema.users.avatarUrl,
            enabledModules: schema.users.enabledModules,
            onboardedAt: schema.users.onboardedAt,
          })
          .from(schema.users)
          .where(eq(schema.users.id, userId)),
      ),
    );
    return { ...row, enabledModules: sanitizeModules(row.enabledModules) };
  }

  async updateProfile(userId: string, input: { displayName: string }): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.users)
        .set({ displayName: input.displayName, updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    });
  }

  async updateAvatar(userId: string, avatarUrl: string | null): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.users)
        .set({ avatarUrl, updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    });
  }

  async updateEnabledModules(userId: string, modules: ModuleKey[]): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.users)
        .set({ enabledModules: sanitizeModules(modules), updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    });
  }

  async markOnboarded(userId: string): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.users)
        .set({ onboardedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    });
  }

  async deactivateAccount(userId: string): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.users)
        .set({ deactivatedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    });
  }

  async reactivateAccount(userId: string): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.users)
        .set({ deactivatedAt: null, updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    });
  }

  async loadWorkspace(userId: string): Promise<Workspace> {
    return this.run(userId, async (tx) => {
      // Pipelined on the single RLS-scoped transaction connection (one network
      // flight) instead of nine sequential round-trips.
      const [
        accountRows,
        cardRows,
        peopleRows,
        categoryRows,
        txRows,
        splitRows,
        settlementRows,
        budgetRows,
        goalRows,
        cardBillDateRows,
      ] = await Promise.all([
        tx.select().from(schema.accounts).where(isNull(schema.accounts.deletedAt)),
        tx.select().from(schema.creditCards).where(isNull(schema.creditCards.deletedAt)),
        tx.select().from(schema.people).where(isNull(schema.people.deletedAt)),
        tx.select().from(schema.categories).where(isNull(schema.categories.deletedAt)),
        tx.select().from(schema.transactions).where(isNull(schema.transactions.deletedAt)),
        tx.select().from(schema.transactionSplits),
        tx.select().from(schema.settlements),
        tx.select().from(schema.budgets).where(isNull(schema.budgets.deletedAt)),
        tx.select().from(schema.goals).where(isNull(schema.goals.deletedAt)),
        tx.select().from(schema.cardBillDates),
      ]);

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
        goals: goalRows.map(toGoal),
        cardBillDates: cardBillDateRows.map(toCardBillDate),
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

  async upsertCardBillDate(
    userId: string,
    input: { cardId: string; month: string; closingDay: number; dueDay: number },
  ): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .insert(schema.cardBillDates)
        .values({ userId, ...input })
        .onConflictDoUpdate({
          target: [schema.cardBillDates.cardId, schema.cardBillDates.month],
          set: { closingDay: input.closingDay, dueDay: input.dueDay, updatedAt: new Date() },
        });
    });
  }

  async deleteCardBillDate(userId: string, cardId: string, month: string): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .delete(schema.cardBillDates)
        .where(and(eq(schema.cardBillDates.cardId, cardId), eq(schema.cardBillDates.month, month)));
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

  async createGoal(userId: string, input: GoalInput): Promise<Goal> {
    return this.run(userId, async (tx) =>
      toGoal(
        one(
          await tx
            .insert(schema.goals)
            .values({ userId, ...input })
            .returning(),
        ),
      ),
    );
  }

  async updateGoal(userId: string, id: string, input: GoalInput): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.goals)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(schema.goals.id, id));
    });
  }

  async deleteGoal(userId: string, id: string): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx.update(schema.goals).set({ deletedAt: new Date() }).where(eq(schema.goals.id, id));
    });
  }

  async contributeToGoal(userId: string, id: string, amountCents: number): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.goals)
        .set({ savedCents: sql`${schema.goals.savedCents} + ${amountCents}`, updatedAt: new Date() })
        .where(eq(schema.goals.id, id));
    });
  }

  /** Insert a create command (optional installment group + entries + splits) within a tx. */
  private async insertCommand(
    tx: RlsTransaction,
    userId: string,
    command: CreateTransactionCommand,
  ): Promise<void> {
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
  }

  async createTransaction(userId: string, command: CreateTransactionCommand): Promise<void> {
    await this.run(userId, (tx) => this.insertCommand(tx, userId, command));
  }

  async replaceWithInstallment(
    userId: string,
    originalId: string,
    command: CreateTransactionCommand,
  ): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.transactions)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.transactions.id, originalId));
      await this.insertCommand(tx, userId, command);
    });
  }

  async updateTransaction(userId: string, command: UpdateTransactionCommand): Promise<void> {
    await this.run(userId, async (tx) => {
      const existing = one(
        await tx
          .select({ kind: schema.transactions.kind })
          .from(schema.transactions)
          .where(and(eq(schema.transactions.id, command.id), isNull(schema.transactions.deletedAt))),
      );
      if (existing.kind !== command.kind) {
        throw new Error("Transaction kind cannot change on update");
      }

      await tx
        .update(schema.transactions)
        .set({
          description: command.description,
          occurredOn: command.date,
          amountCents: command.amountCents,
          note: command.note ?? null,
          categoryId: command.categoryId ?? null,
          source: command.source ?? null,
          cardId: command.cardId ?? null,
          accountId: command.accountId ?? null,
          linkedAccountId: command.linkedAccountId ?? null,
          myShareCents: command.myShareCents ?? null,
          fromPersonId: command.fromPersonId ?? null,
          isReimbursement: command.isReimbursement ?? false,
          transferFromAccountId: command.transferFromAccountId ?? null,
          transferToAccountId: command.transferToAccountId ?? null,
          transferValueCents: command.transferValueCents ?? null,
          // `fixed` toggles recurrence on/off, anchored to the (possibly new) date's day.
          recurrenceDayOfMonth: command.fixed ? Number.parseInt(command.date.slice(8, 10), 10) : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.transactions.id, command.id));

      await tx.delete(schema.transactionSplits).where(eq(schema.transactionSplits.transactionId, command.id));
      if (command.splits && command.splits.length > 0) {
        await tx.insert(schema.transactionSplits).values(
          command.splits.map((split) => ({
            userId,
            transactionId: command.id,
            personId: split.personId,
            shareCents: split.shareCents,
          })),
        );
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

  async stopRecurrence(userId: string, id: string): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.transactions)
        .set({ recurrenceDayOfMonth: null, updatedAt: new Date() })
        .where(eq(schema.transactions.id, id));
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
