import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTransaction } from "@/application/use-cases/create-transaction";
import { isExpense } from "@/domain/entities/transaction";
import { computeCardBills } from "@/domain/services/card-bill.calculator";
import { computePersonBalances } from "@/domain/services/person-ledger.calculator";
import * as schema from "@/infrastructure/db/schema";
import { DrizzleFinanceRepository } from "@/infrastructure/repositories/drizzle-finance-repository";
import { createTransactionSchema } from "@/shared/schemas/transaction";

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
let cardId = "";
let personId = "";

beforeAll(async () => {
  const email = `tx-${process.pid}-${Math.floor(performance.now())}@fincore.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "create-tx-test-pw-123",
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("failed to create auth user");
  userId = data.user.id;
  await repo.ensureProfile(userId, email);
  cardId = one(
    await db
      .insert(schema.creditCards)
      .values({
        userId,
        bank: "C6",
        product: "Carbon",
        flag: "mastercard",
        limitCents: 2_500_000,
        closingDay: 8,
        dueDay: 15,
      })
      .returning(),
  ).id;
  personId = one(await db.insert(schema.people).values({ userId, name: "Mariana" }).returning()).id;
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await client.end();
});

describe("createTransaction use-case", () => {
  it("creates an installment schedule with per-parcela splits, server-recomputed", async () => {
    const input = createTransactionSchema.parse({
      kind: "expense",
      description: "Notebook",
      date: "2026-06-15",
      totalAmountCents: 100_000, // R$1.000,00 over 4×
      source: "card",
      cardId,
      split: { method: "equal", meIn: true, selected: [personId] },
      installment: { total: 4, current: 1, includePrevious: false, includeNext: true },
    });

    const result = await createTransaction(repo, userId, input);
    expect(result.ok).toBe(true);

    const ws = await repo.loadWorkspace(userId);
    const parcelas = ws.transactions
      .filter(isExpense)
      .filter((t) => t.description === "Notebook")
      .sort((a, b) => (a.installment?.number ?? 0) - (b.installment?.number ?? 0));

    // 4 parcelas: #1 atual, #2-4 futura; they sum to the principal (−100000).
    expect(parcelas).toHaveLength(4);
    const total = parcelas.reduce((sum, t) => sum + t.amountCents, 0);
    expect(total).toBe(-100_000);
    expect(parcelas.map((t) => t.installment?.status)).toEqual(["atual", "futura", "futura", "futura"]);

    // Each parcela (R$250) split equally with Mariana → R$125 each.
    const current = parcelas[0];
    if (current) {
      expect(current.amountCents).toBe(-25_000);
      expect(current.myShareCents).toBe(12_500);
      expect(current.splits[0]?.shareCents).toBe(12_500);
    }

    // Card bill counts only the current installment; Mariana owes only the current share.
    expect(computeCardBills(ws.creditCards, ws.transactions).get(cardId)?.cents).toBe(25_000);
    expect(computePersonBalances(ws.people, ws.transactions, ws.settlements).get(personId)?.cents).toBe(
      12_500,
    );
  });
});
