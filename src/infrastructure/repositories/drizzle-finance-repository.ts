import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type {
  CardBillPaymentData,
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
import type { IsoDate } from "@/domain/value-objects/competence-month";
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
  toCardBillPayment,
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
    receivedAt: entry.receivedAt ?? null,
    receivedAccountId: entry.receivedAccountId ?? null,
    receivedAmountCents: entry.receivedAmountCents ?? null,
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
            autoPaymentsEnabled: schema.users.autoPaymentsEnabled,
            defaultPayAccountId: schema.users.defaultPayAccountId,
            autoPaymentsSince: schema.users.autoPaymentsSince,
            recurringMaterializedThrough: schema.users.recurringMaterializedThrough,
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

  async updatePreferences(
    userId: string,
    input: {
      autoPaymentsEnabled: boolean;
      defaultPayAccountId: string | null;
      autoPaymentsSince: string | null;
    },
  ): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.users)
        .set({
          autoPaymentsEnabled: input.autoPaymentsEnabled,
          defaultPayAccountId: input.defaultPayAccountId,
          autoPaymentsSince: input.autoPaymentsSince,
          updatedAt: new Date(),
        })
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
        cardBillPaymentRows,
      ] = await Promise.all([
        tx.select().from(schema.accounts).where(isNull(schema.accounts.deletedAt)),
        tx.select().from(schema.creditCards).where(isNull(schema.creditCards.deletedAt)),
        tx.select().from(schema.people).where(isNull(schema.people.deletedAt)),
        tx.select().from(schema.categories).where(isNull(schema.categories.deletedAt)),
        tx.select().from(schema.transactions).where(isNull(schema.transactions.deletedAt)),
        tx.select().from(schema.transactionSplits),
        tx.select().from(schema.settlements).where(isNull(schema.settlements.deletedAt)),
        tx.select().from(schema.budgets).where(isNull(schema.budgets.deletedAt)),
        tx.select().from(schema.goals).where(isNull(schema.goals.deletedAt)),
        tx.select().from(schema.cardBillDates),
        tx.select().from(schema.cardBillPayments).where(isNull(schema.cardBillPayments.deletedAt)),
      ]);

      const splitsByTx = new Map<string, (typeof splitRows)[number][]>();
      for (const split of splitRows) {
        const list = splitsByTx.get(split.transactionId) ?? [];
        list.push(split);
        splitsByTx.set(split.transactionId, list);
      }
      // A fatura payment whose paying account is no longer live (soft-deleted) reverts to unpaid:
      // keeping it would free the card limit and drop the projected obligation while no account
      // reflects the debit. Accounts are soft-deleted, so the FK set-null never fires — filter here.
      const liveAccountIds = new Set(accountRows.map((a) => a.id));

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
        // Drop payments whose paying account is gone (see liveAccountIds above) — the fatura
        // reverts to unpaid so the balance, limit and projection stay consistent.
        cardBillPayments: cardBillPaymentRows
          .map(toCardBillPayment)
          .filter((p): p is NonNullable<typeof p> => p !== null && liveAccountIds.has(p.accountId)),
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
      // Accounts are soft-deleted, so the users.default_pay_account_id FK set-null never fires. If
      // this was the auto-payments account, clear it and switch auto-pay off — otherwise auto-pay
      // reads as "on" but books nothing, silently hiding the "atrasado" signal.
      await tx
        .update(schema.users)
        .set({ defaultPayAccountId: null, autoPaymentsEnabled: false, updatedAt: new Date() })
        .where(and(eq(schema.users.id, userId), eq(schema.users.defaultPayAccountId, id)));
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

  async rollPersonDebt(userId: string, originalId: string, command: CreateTransactionCommand): Promise<void> {
    // Abate the original debt (kept for history, excluded from all calculations) and create
    // the new rolled-into expense, atomically. RLS scopes the row to the user.
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.transactions)
        .set({ rolledAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.transactions.id, originalId));
      await this.insertCommand(tx, userId, command);
    });
  }

  async rollPersonMonthDebt(
    userId: string,
    settlement: SettlementData,
    command: CreateTransactionCommand,
  ): Promise<void> {
    // Pool roll: zero the person's outstanding via a cash-less rollover settlement (no account →
    // no cash moved) and create the new rolled-into debt, atomically. RLS scopes rows to the user.
    await this.run(userId, async (tx) => {
      await tx.insert(schema.settlements).values({
        userId,
        personId: settlement.personId,
        amountCents: settlement.amountCents,
        settledOn: settlement.date,
        accountId: settlement.accountId ?? null,
        note: settlement.note ?? null,
      });
      await this.insertCommand(tx, userId, command);
    });
  }

  async materializeRecurring(
    userId: string,
    through: IsoDate,
    commands: readonly CreateTransactionCommand[],
  ): Promise<number> {
    return this.run(userId, async (tx) => {
      // Claim the window first: the watermark only moves while it is still behind `through`, so a
      // concurrent pass (app load racing the daily cron) finds no row to update and inserts nothing.
      const claimed = await tx
        .update(schema.users)
        .set({ recurringMaterializedThrough: through, updatedAt: new Date() })
        .where(
          and(
            eq(schema.users.id, userId),
            or(
              isNull(schema.users.recurringMaterializedThrough),
              lt(schema.users.recurringMaterializedThrough, through),
            ),
          ),
        )
        .returning({ id: schema.users.id });
      if (claimed.length === 0) return 0;

      for (const command of commands) await this.insertCommand(tx, userId, command);
      return commands.length;
    });
  }

  async payTransaction(
    userId: string,
    id: string,
    payment: { paidAt: IsoDate; paidAccountId: string; paidAmountCents: number },
  ): Promise<void> {
    // Record the payment on a deferred obligation: it debits the paying account on `paidAt`
    // (the original occurred_on/amount stay intact for history). RLS scopes the row to the user.
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.transactions)
        .set({
          paidAt: payment.paidAt,
          paidAccountId: payment.paidAccountId,
          paidAmountCents: payment.paidAmountCents,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.transactions.id, id), isNull(schema.transactions.deletedAt)));
    });
  }

  async undoPayment(userId: string, id: string): Promise<void> {
    // Revert a payment: clear the paid fields so the obligation is pending again.
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.transactions)
        .set({ paidAt: null, paidAccountId: null, paidAmountCents: null, updatedAt: new Date() })
        .where(and(eq(schema.transactions.id, id), isNull(schema.transactions.deletedAt)));
    });
  }

  async receiveIncome(
    userId: string,
    id: string,
    receipt: { receivedAt: IsoDate; receivedAccountId: string; receivedAmountCents: number },
  ): Promise<void> {
    // Record the receipt on a normal income: it credits the receiving account on `receivedAt` (the
    // original occurred_on/amount stay intact for history). RLS scopes the row to the user.
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.transactions)
        .set({
          receivedAt: receipt.receivedAt,
          receivedAccountId: receipt.receivedAccountId,
          receivedAmountCents: receipt.receivedAmountCents,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.transactions.id, id), isNull(schema.transactions.deletedAt)));
    });
  }

  async undoReceive(userId: string, id: string): Promise<void> {
    // Revert a receipt: clear the received fields so the income is a pending receivable again.
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.transactions)
        .set({ receivedAt: null, receivedAccountId: null, receivedAmountCents: null, updatedAt: new Date() })
        .where(and(eq(schema.transactions.id, id), isNull(schema.transactions.deletedAt)));
    });
  }

  async updateTransaction(
    userId: string,
    command: UpdateTransactionCommand,
    scope: "one" | "forward" | "all" = "one",
  ): Promise<number> {
    return this.run(userId, async (tx) => {
      // Read the target's CURRENT values first — used to locate sibling rows of an
      // installment group / recurring series before the target is overwritten.
      const target = one(
        await tx
          .select({
            kind: schema.transactions.kind,
            groupId: schema.transactions.installmentGroupId,
            parcelaNo: schema.transactions.parcelaNo,
            recurrenceDayOfMonth: schema.transactions.recurrenceDayOfMonth,
            description: schema.transactions.description,
            source: schema.transactions.source,
            cardId: schema.transactions.cardId,
            accountId: schema.transactions.accountId,
            linkedAccountId: schema.transactions.linkedAccountId,
          })
          .from(schema.transactions)
          .where(and(eq(schema.transactions.id, command.id), isNull(schema.transactions.deletedAt))),
      );
      if (target.kind !== command.kind) {
        throw new Error("Transaction kind cannot change on update");
      }

      // Sibling rows that the scope propagates classification to (target excluded).
      let siblingIds: string[] = [];
      if (scope !== "one") {
        if (target.groupId) {
          const groupRows = await tx
            .select({ id: schema.transactions.id, parcelaNo: schema.transactions.parcelaNo })
            .from(schema.transactions)
            .where(
              and(
                eq(schema.transactions.installmentGroupId, target.groupId),
                isNull(schema.transactions.deletedAt),
              ),
            );
          siblingIds = groupRows
            .filter(
              (row) =>
                row.id !== command.id && (scope === "all" || (row.parcelaNo ?? 0) >= (target.parcelaNo ?? 0)),
            )
            .map((row) => row.id);
        } else if (target.recurrenceDayOfMonth !== null) {
          // A recurring series: same kind + same identity (description + payment source).
          const recurringRows = await tx
            .select({
              id: schema.transactions.id,
              description: schema.transactions.description,
              source: schema.transactions.source,
              cardId: schema.transactions.cardId,
              accountId: schema.transactions.accountId,
              linkedAccountId: schema.transactions.linkedAccountId,
            })
            .from(schema.transactions)
            .where(
              and(
                eq(schema.transactions.kind, target.kind),
                isNotNull(schema.transactions.recurrenceDayOfMonth),
                isNull(schema.transactions.deletedAt),
              ),
            );
          siblingIds = recurringRows
            .filter(
              (row) =>
                row.id !== command.id &&
                row.description === target.description &&
                row.source === target.source &&
                row.cardId === target.cardId &&
                row.accountId === target.accountId &&
                row.linkedAccountId === target.linkedAccountId,
            )
            .map((row) => row.id);
        }
      }

      // Full update of the target row (amount, splits, recurrence — as edited).
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

      // Propagate ONLY the classification fields to the siblings — never their
      // amount, share, date, parcela or recurrence.
      if (siblingIds.length > 0) {
        await tx
          .update(schema.transactions)
          .set({
            description: command.description,
            note: command.note ?? null,
            categoryId: command.categoryId ?? null,
            source: command.source ?? null,
            cardId: command.cardId ?? null,
            accountId: command.accountId ?? null,
            linkedAccountId: command.linkedAccountId ?? null,
            fromPersonId: command.fromPersonId ?? null,
            isReimbursement: command.isReimbursement ?? false,
            updatedAt: new Date(),
          })
          .where(inArray(schema.transactions.id, siblingIds));
      }

      return 1 + siblingIds.length;
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

  async setBillMonthOverride(userId: string, id: string, month: string | null): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.transactions)
        .set({ billMonthOverride: month, updatedAt: new Date() })
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

  async updateSettlement(userId: string, id: string, input: SettlementData): Promise<void> {
    // RLS scopes the row to the user; we match by id.
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.settlements)
        .set({
          personId: input.personId,
          amountCents: input.amountCents,
          settledOn: input.date,
          accountId: input.accountId ?? null,
          note: input.note ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.settlements.id, id));
    });
  }

  async deleteSettlement(userId: string, id: string): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.settlements)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.settlements.id, id));
    });
  }

  async payCardBill(userId: string, input: CardBillPaymentData): Promise<void> {
    // Upsert the one ACTIVE payment for (card, competence): soft-delete any existing active row
    // (re-pay) then insert the new one — keeps the partial unique index satisfied. RLS-scoped.
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.cardBillPayments)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.cardBillPayments.cardId, input.cardId),
            eq(schema.cardBillPayments.competenceMonth, input.competenceMonth),
            isNull(schema.cardBillPayments.deletedAt),
          ),
        );
      await tx.insert(schema.cardBillPayments).values({
        userId,
        cardId: input.cardId,
        competenceMonth: input.competenceMonth,
        amountCents: input.amountCents,
        accountId: input.accountId,
        paidOn: input.paidOn,
        note: input.note ?? null,
      });
    });
  }

  async undoCardBillPayment(userId: string, cardId: string, competenceMonth: string): Promise<void> {
    await this.run(userId, async (tx) => {
      await tx
        .update(schema.cardBillPayments)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.cardBillPayments.cardId, cardId),
            eq(schema.cardBillPayments.competenceMonth, competenceMonth),
            isNull(schema.cardBillPayments.deletedAt),
          ),
        );
    });
  }
}
