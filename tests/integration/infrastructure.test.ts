import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeAccountBalances } from "@/domain/services/balance.calculator";
import { computeCardBills } from "@/domain/services/card-bill.calculator";
import { computePersonBalances } from "@/domain/services/person-ledger.calculator";
import { toAccount, toCreditCard, toPerson, toTransaction } from "@/infrastructure/db/mappers";
import * as schema from "@/infrastructure/db/schema";

loadEnvFile(".env.local");

const databaseUrl = process.env.DATABASE_URL ?? "";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const client = postgres(databaseUrl, { prepare: false });
const db = drizzle(client, { schema, casing: "snake_case" });
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected exactly one returned row");
  return row;
}

// A unique email per run so re-runs don't collide on the auth user.
const email = `it-${process.pid}-${Math.floor(performance.now())}@fincore.local`;
let userId = "";

beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "integration-test-pw-123",
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("failed to create auth user");
  userId = data.user.id;
  await db.insert(schema.users).values({ id: userId, email });
});

afterAll(async () => {
  // Deleting the auth user cascades to public.users and all owned rows.
  if (userId) await admin.auth.admin.deleteUser(userId);
  await client.end();
});

describe("DB ↔ domain cycle", () => {
  it("computes account balances, card bills and the person ledger from persisted rows", async () => {
    const nu = one(
      await db
        .insert(schema.accounts)
        .values({ userId, bank: "Nubank", name: "Conta", type: "PF", openingBalanceCents: 0 })
        .returning(),
    );
    const itau = one(
      await db
        .insert(schema.accounts)
        .values({ userId, bank: "Itaú", name: "CC", type: "PF", openingBalanceCents: 0 })
        .returning(),
    );
    const card = one(
      await db
        .insert(schema.creditCards)
        .values({
          userId,
          bank: "Nubank",
          product: "Ultravioleta",
          flag: "mastercard",
          limitCents: 1_200_000,
          closingDay: 3,
          dueDay: 10,
        })
        .returning(),
    );
    const mariana = one(await db.insert(schema.people).values({ userId, name: "Mariana" }).returning());
    const group = one(
      await db
        .insert(schema.installmentGroups)
        .values({ userId, totalCount: 3, totalCents: -144_000 })
        .returning(),
    );

    // Income R$9.200 into Nubank.
    await db.insert(schema.transactions).values({
      userId,
      kind: "income",
      description: "Salário",
      occurredOn: "2026-06-05",
      amountCents: 920_000,
      accountId: nu.id,
    });
    // Account expense (Pix) R$180 from Nubank.
    await db.insert(schema.transactions).values({
      userId,
      kind: "expense",
      description: "Faxina",
      occurredOn: "2026-06-06",
      amountCents: -18_000,
      source: "account",
      accountId: nu.id,
      myShareCents: 18_000,
    });
    // Card expense R$148 split with Mariana (her share R$74).
    const pizza = one(
      await db
        .insert(schema.transactions)
        .values({
          userId,
          kind: "expense",
          description: "Pizzaria",
          occurredOn: "2026-06-10",
          amountCents: -14_800,
          source: "card",
          cardId: card.id,
          myShareCents: 7_400,
        })
        .returning(),
    );
    await db
      .insert(schema.transactionSplits)
      .values({ userId, transactionId: pizza.id, personId: mariana.id, shareCents: 7_400 });
    // Notebook 3× R$480 — only the current installment hits the bill.
    await db.insert(schema.transactions).values([
      {
        userId,
        kind: "expense",
        description: "Notebook",
        occurredOn: "2026-05-15",
        amountCents: -48_000,
        source: "card",
        cardId: card.id,
        installmentGroupId: group.id,
        parcelaNo: 1,
        parcelaTotal: 3,
        parcelaStatus: "paga",
        myShareCents: 48_000,
      },
      {
        userId,
        kind: "expense",
        description: "Notebook",
        occurredOn: "2026-06-15",
        amountCents: -48_000,
        source: "card",
        cardId: card.id,
        installmentGroupId: group.id,
        parcelaNo: 2,
        parcelaTotal: 3,
        parcelaStatus: "atual",
        myShareCents: 48_000,
      },
      {
        userId,
        kind: "expense",
        description: "Notebook",
        occurredOn: "2026-07-15",
        amountCents: -48_000,
        source: "card",
        cardId: card.id,
        installmentGroupId: group.id,
        parcelaNo: 3,
        parcelaTotal: 3,
        parcelaStatus: "futura",
        myShareCents: 48_000,
      },
    ]);
    // Transfer R$2.000 from Itaú to Nubank.
    await db.insert(schema.transactions).values({
      userId,
      kind: "transfer",
      description: "Transferência",
      occurredOn: "2026-06-09",
      amountCents: 0,
      transferFromAccountId: itau.id,
      transferToAccountId: nu.id,
      transferValueCents: 200_000,
    });

    // Read back and map to domain entities.
    const txRows = await db.select().from(schema.transactions).where(eq(schema.transactions.userId, userId));
    const splitRows = await db
      .select()
      .from(schema.transactionSplits)
      .where(eq(schema.transactionSplits.userId, userId));
    const splitsByTx = new Map<string, (typeof splitRows)[number][]>();
    for (const s of splitRows) {
      const list = splitsByTx.get(s.transactionId) ?? [];
      list.push(s);
      splitsByTx.set(s.transactionId, list);
    }
    const transactions = txRows.map((r) => toTransaction(r, splitsByTx.get(r.id) ?? []));
    const accounts = (await db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId))).map(
      toAccount,
    );
    const cards = (
      await db.select().from(schema.creditCards).where(eq(schema.creditCards.userId, userId))
    ).map(toCreditCard);
    const people = (await db.select().from(schema.people).where(eq(schema.people.userId, userId))).map(
      toPerson,
    );

    const balances = computeAccountBalances(accounts, transactions);
    const bills = computeCardBills(cards, transactions);
    const ledger = computePersonBalances(people, transactions, []);

    // Nubank: 0 + 920000 (income) − 18000 (pix) + 200000 (transfer in) = 1102000
    expect(balances.get(nu.id)?.cents).toBe(1_102_000);
    // Itaú: 0 − 200000 (transfer out) = −200000
    expect(balances.get(itau.id)?.cents).toBe(-200_000);
    // Card bill: pizza 14800 + current installment 48000 (paga/futura excluded) = 62800
    expect(bills.get(card.id)?.cents).toBe(62_800);
    // Mariana owes her R$74 share.
    expect(ledger.get(mariana.id)?.cents).toBe(7_400);
  });
});

describe("Row Level Security", () => {
  it("is enabled with an owner policy on every user-owned table", async () => {
    const tables = [
      "users",
      "accounts",
      "credit_cards",
      "people",
      "categories",
      "installment_groups",
      "transactions",
      "transaction_splits",
      "settlements",
    ];
    const rows = await db.execute<{ relname: string; rls: boolean; policies: number }>(sql`
      SELECT c.relname AS relname,
             c.relrowsecurity AS rls,
             count(p.polname)::int AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policy p ON p.polrelid = c.oid
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      GROUP BY c.relname, c.relrowsecurity
    `);
    const byName = new Map(rows.map((r) => [r.relname, r]));
    for (const table of tables) {
      const row = byName.get(table);
      expect(row, `table ${table} should exist`).toBeDefined();
      expect(row?.rls, `RLS enabled on ${table}`).toBe(true);
      expect(row?.policies ?? 0, `${table} has a policy`).toBeGreaterThanOrEqual(1);
    }
  });
});
