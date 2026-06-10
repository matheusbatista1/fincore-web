import { sql } from "drizzle-orm";
import type { Database } from "./client";

/** The transaction handle Drizzle passes to a `db.transaction(...)` callback. */
export type RlsTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Run `fn` inside a transaction scoped to `userId` so Postgres Row-Level Security
 * applies: it switches to the `authenticated` role and sets the JWT claims so
 * `auth.uid()` resolves to `userId`. The database itself then refuses any row that
 * doesn't belong to the user, regardless of application logic — defense in depth.
 *
 * Use this for ALL user-facing reads/writes. Trusted jobs (seed, migrations) use the
 * service connection directly and intentionally bypass RLS.
 */
export async function withUserContext<T>(
  database: Database,
  userId: string,
  fn: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}
