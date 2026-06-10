import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDashboard } from "@/application/use-cases/get-dashboard";
import * as schema from "@/infrastructure/db/schema";
import { DrizzleFinanceRepository } from "@/infrastructure/repositories/drizzle-finance-repository";

loadEnvFile(".env.local");

const databaseUrl = process.env.DATABASE_URL ?? "";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const client = postgres(databaseUrl, { prepare: false });
const db = drizzle(client, { schema, casing: "snake_case" });
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const repo = new DrizzleFinanceRepository(db);

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected exactly one returned row");
  return row;
}

let userId = "";

beforeAll(async () => {
  const email = `app-${process.pid}-${Math.floor(performance.now())}@fincore.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "application-test-pw-123",
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("failed to create auth user");
  userId = data.user.id;
  await repo.ensureProfile(userId, email);

  // Seed via the service connection (bypasses RLS).
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

  await db.insert(schema.transactions).values({
    userId,
    kind: "income",
    description: "Salário",
    occurredOn: "2026-06-05",
    amountCents: 920_000,
    accountId: nu.id,
  });
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
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await client.end();
});

describe("getDashboard use-case", () => {
  it("derives a serializable dashboard from the persisted workspace", async () => {
    const dash = await getDashboard(repo, userId, "2026-06");

    // Total balance: Nubank 1102000 + Itaú -200000.
    expect(dash.totalBalanceCents).toBe(902_000);
    expect(dash.accounts).toHaveLength(2);

    // Card bill = 14800; utilization = 14800 / 1200000.
    expect(dash.cards).toHaveLength(1);
    expect(dash.cards[0]?.billCents).toBe(14_800);
    expect(dash.cards[0]?.utilization).toBeCloseTo(14_800 / 1_200_000, 6);

    // Only Mariana has a non-zero balance (owes 7400).
    expect(dash.people).toHaveLength(1);
    expect(dash.people[0]?.balanceCents).toBe(7_400);

    // General: income 920000, expense |−18000|+|−14800| = 32800.
    expect(dash.general.incomeCents).toBe(920_000);
    expect(dash.general.expenseCents).toBe(32_800);
    expect(dash.general.netCents).toBe(887_200);

    // Personal: expense uses myShare (18000 + 7400 = 25400); income unchanged.
    expect(dash.personal.expenseCents).toBe(25_400);
    expect(dash.personal.netCents).toBe(894_600);

    // Everything is plain JSON (no Money instances) — safe for RSC serialization.
    expect(JSON.parse(JSON.stringify(dash)).totalBalanceCents).toBe(902_000);
  });
});
