import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUsers } from "drizzle-orm/supabase";
import type { ModuleKey } from "@/shared/modules";
import { accountType, cardFlag, expenseSource, parcelaStatus, transactionKind } from "./enums";

// Shared audit columns (soft-delete via deletedAt).
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

// Per-user isolation: a single policy covering select/insert/update/delete, keyed
// on the row's user_id matching the authenticated user. Enables RLS on the table.
const ownerPolicy = (name: string) =>
  pgPolicy(name, {
    for: "all",
    to: authenticatedRole,
    using: sql`user_id = (select auth.uid())`,
    withCheck: sql`user_id = (select auth.uid())`,
  });

/** Thin profile row, 1:1 with Supabase auth.users. */
export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name"),
    locale: text("locale").notNull().default("pt-BR"),
    /** Optional feature modules the user has turned on (people/budgets/goals/reports). */
    enabledModules: jsonb("enabled_modules").$type<ModuleKey[]>().notNull().default(sql`'[]'::jsonb`),
    /** Set when the first-run onboarding has been completed; null = not onboarded yet. */
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    ...timestamps,
  },
  () => [
    pgPolicy("users_self", {
      for: "all",
      to: authenticatedRole,
      using: sql`id = (select auth.uid())`,
      withCheck: sql`id = (select auth.uid())`,
    }),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bank: text("bank").notNull(),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    themeKey: text("theme_key").notNull().default(""),
    openingBalanceCents: bigint("opening_balance_cents", { mode: "number" }).notNull().default(0),
    maskedNumber: text("masked_number").notNull().default(""),
    ...timestamps,
  },
  (t) => [
    index("idx_accounts_user").on(t.userId).where(sql`deleted_at IS NULL`),
    ownerPolicy("accounts_owner"),
  ],
);

export const creditCards = pgTable(
  "credit_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bank: text("bank").notNull(),
    product: text("product").notNull(),
    flag: cardFlag("flag").notNull(),
    themeKey: text("theme_key").notNull().default(""),
    maskedNumber: text("masked_number").notNull().default(""),
    limitCents: bigint("limit_cents", { mode: "number" }).notNull().default(0),
    closingDay: smallint("closing_day").notNull(),
    dueDay: smallint("due_day").notNull(),
    ...timestamps,
  },
  (t) => [
    index("idx_cards_user").on(t.userId).where(sql`deleted_at IS NULL`),
    check("chk_card_limit", sql`limit_cents >= 0`),
    check("chk_card_closing_day", sql`closing_day BETWEEN 1 AND 31`),
    check("chk_card_due_day", sql`due_day BETWEEN 1 AND 31`),
    ownerPolicy("cards_owner"),
  ],
);

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    relationship: text("relationship").notNull().default(""),
    color: text("color").notNull().default(""),
    ...timestamps,
  },
  (t) => [index("idx_people_user").on(t.userId).where(sql`deleted_at IS NULL`), ownerPolicy("people_owner")],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default(""),
    icon: text("icon").notNull().default(""),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("uq_categories_user_name").on(t.userId, t.name).where(sql`deleted_at IS NULL`),
    ownerPolicy("categories_owner"),
  ],
);

/** Groups the parcelas of one installment purchase. */
export const installmentGroups = pgTable(
  "installment_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    totalCount: smallint("total_count").notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_installment_groups_user").on(t.userId),
    check("chk_installment_total_count", sql`total_count >= 1`),
    ownerPolicy("installment_groups_owner"),
  ],
);

/** Polymorphic transaction: expense | income | transfer, plus optional recurrence. */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: transactionKind("kind").notNull(),
    description: text("description").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    note: text("note"),

    // recurrence (fixed monthly): day-of-month when set
    recurrenceDayOfMonth: smallint("recurrence_day_of_month"),

    // expense-only
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    source: expenseSource("source"),
    cardId: uuid("card_id").references(() => creditCards.id, { onDelete: "set null" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    linkedAccountId: uuid("linked_account_id").references(() => accounts.id, { onDelete: "set null" }),
    myShareCents: bigint("my_share_cents", { mode: "number" }),
    installmentGroupId: uuid("installment_group_id").references(() => installmentGroups.id, {
      onDelete: "cascade",
    }),
    parcelaNo: smallint("parcela_no"),
    parcelaTotal: smallint("parcela_total"),
    parcelaStatus: parcelaStatus("parcela_status"),

    // income-only
    fromPersonId: uuid("from_person_id").references(() => people.id, { onDelete: "set null" }),
    isReimbursement: boolean("is_reimbursement").notNull().default(false),

    // transfer-only
    transferFromAccountId: uuid("transfer_from_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    transferToAccountId: uuid("transfer_to_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    transferValueCents: bigint("transfer_value_cents", { mode: "number" }),

    ...timestamps,
  },
  (t) => [
    index("idx_tx_user_date").on(t.userId, t.occurredOn).where(sql`deleted_at IS NULL`),
    index("idx_tx_card").on(t.cardId).where(sql`card_id IS NOT NULL AND deleted_at IS NULL`),
    index("idx_tx_account").on(t.accountId).where(sql`account_id IS NOT NULL AND deleted_at IS NULL`),
    index("idx_tx_category").on(t.categoryId, t.occurredOn).where(sql`deleted_at IS NULL`),
    // At most one 'atual' installment per group.
    uniqueIndex("uq_atual_per_group")
      .on(t.installmentGroupId)
      .where(sql`parcela_status = 'atual' AND deleted_at IS NULL`),
    check("chk_expense_sign", sql`kind <> 'expense' OR amount_cents < 0`),
    check("chk_income_sign", sql`kind <> 'income' OR amount_cents > 0`),
    check("chk_transfer_zero", sql`kind <> 'transfer' OR amount_cents = 0`),
    check("chk_expense_source", sql`kind <> 'expense' OR source IS NOT NULL`),
    check("chk_card_source", sql`source IS DISTINCT FROM 'card' OR card_id IS NOT NULL`),
    check(
      "chk_transfer_fields",
      sql`kind <> 'transfer' OR (transfer_from_account_id IS NOT NULL AND transfer_to_account_id IS NOT NULL AND transfer_value_cents > 0 AND transfer_from_account_id <> transfer_to_account_id)`,
    ),
    check("chk_parcela_pair", sql`(installment_group_id IS NULL) = (parcela_no IS NULL)`),
    ownerPolicy("transactions_owner"),
  ],
);

/** One person's share of a shared expense. user_id denormalized for a fast RLS policy. */
export const transactionSplits = pgTable(
  "transaction_splits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    shareCents: bigint("share_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_split_tx_person").on(t.transactionId, t.personId),
    index("idx_splits_person").on(t.personId),
    check("chk_split_share_positive", sql`share_cents > 0`),
    ownerPolicy("transaction_splits_owner"),
  ],
);

/** Monthly spending limit per category (orçamento). At most one active budget per category. */
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    limitCents: bigint("limit_cents", { mode: "number" }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("uq_budgets_user_category").on(t.userId, t.categoryId).where(sql`deleted_at IS NULL`),
    check("chk_budget_limit_positive", sql`limit_cents > 0`),
    ownerPolicy("budgets_owner"),
  ],
);

/** A savings goal (meta de economia) with a target and the amount saved so far. */
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    targetCents: bigint("target_cents", { mode: "number" }).notNull(),
    savedCents: bigint("saved_cents", { mode: "number" }).notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("idx_goals_user").on(t.userId).where(sql`deleted_at IS NULL`),
    check("chk_goal_target_positive", sql`target_cents > 0`),
    check("chk_goal_saved_nonneg", sql`saved_cents >= 0`),
    ownerPolicy("goals_owner"),
  ],
);

/** Partial/full payment that settles a person's debt. */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    settledOn: date("settled_on", { mode: "string" }).notNull(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_settlements_person").on(t.personId),
    check("chk_settlement_amount", sql`amount_cents <> 0`),
    ownerPolicy("settlements_owner"),
  ],
);
