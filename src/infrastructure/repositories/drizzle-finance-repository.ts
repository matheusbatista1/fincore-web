import { isNull } from "drizzle-orm";
import type { FinanceRepository, Workspace } from "@/application/ports/finance-repository";
import type { Database } from "../db/client";
import { toAccount, toCategory, toCreditCard, toPerson, toSettlement, toTransaction } from "../db/mappers";
import { withUserContext } from "../db/rls";
import * as schema from "../db/schema";

/**
 * Drizzle + Supabase implementation. Every read/write runs inside `withUserContext`
 * so Postgres RLS scopes rows to the user. The `Database` is injected so this stays
 * testable without importing the env-validated client.
 */
export class DrizzleFinanceRepository implements FinanceRepository {
  constructor(private readonly db: Database) {}

  async ensureProfile(userId: string, email: string): Promise<void> {
    await withUserContext(this.db, userId, async (tx) => {
      await tx
        .insert(schema.users)
        .values({ id: userId, email })
        .onConflictDoNothing({ target: schema.users.id });
    });
  }

  async loadWorkspace(userId: string): Promise<Workspace> {
    return withUserContext(this.db, userId, async (tx) => {
      // Sequential queries: they share one transaction/connection.
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
      };
    });
  }
}
