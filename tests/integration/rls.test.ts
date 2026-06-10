import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withUserContext } from "@/infrastructure/db/rls";
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

let userA = "";
let userB = "";

async function createUser(tag: string): Promise<string> {
  const email = `rls-${tag}-${process.pid}-${Math.floor(performance.now())}@fincore.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "rls-test-password-123",
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("failed to create auth user");
  await db.insert(schema.users).values({ id: data.user.id, email });
  return data.user.id;
}

beforeAll(async () => {
  userA = await createUser("a");
  userB = await createUser("b");
  // Seed one account per user via the service connection (bypasses RLS).
  await db.insert(schema.accounts).values({ userId: userA, bank: "Nubank", name: "A", type: "PF" });
  await db.insert(schema.accounts).values({ userId: userB, bank: "Itaú", name: "B", type: "PF" });
});

afterAll(async () => {
  if (userA) await admin.auth.admin.deleteUser(userA);
  if (userB) await admin.auth.admin.deleteUser(userB);
  await client.end();
});

describe("RLS isolation via withUserContext", () => {
  it("each user reads only their own rows", async () => {
    const aRows = await withUserContext(db, userA, (tx) => tx.select().from(schema.accounts));
    expect(aRows).toHaveLength(1);
    expect(aRows[0]?.userId).toBe(userA);
    expect(aRows[0]?.bank).toBe("Nubank");

    const bRows = await withUserContext(db, userB, (tx) => tx.select().from(schema.accounts));
    expect(bRows).toHaveLength(1);
    expect(bRows[0]?.userId).toBe(userB);
  });

  it("a user cannot insert a row owned by someone else (WITH CHECK)", async () => {
    await expect(
      withUserContext(db, userA, (tx) =>
        tx.insert(schema.accounts).values({ userId: userB, bank: "Spoof", name: "x", type: "PF" }),
      ),
    ).rejects.toThrow();
  });
});
