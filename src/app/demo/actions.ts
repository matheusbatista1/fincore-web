"use server";

import { z } from "zod";
import type { TransactionHistoryState } from "@/app/_actions/finance";
import { getTransactionHistory } from "@/application/use-cases/transaction-history";
import { demoEnabled } from "@/infrastructure/demo/demo-flag";
import { DEMO_USER_ID, demoRepository } from "@/infrastructure/demo/demo-repository";
import { todayInBrazil } from "@/shared/formatting/now";

/** A demo transaction's id is a made-up word, not a database id. */
const demoHistorySchema = z.object({ id: z.string().min(1).max(120) });

/** "Histórico de alterações" for the demo: a made-up history of a made-up transaction. */
export async function demoTransactionHistoryAction(raw: unknown): Promise<TransactionHistoryState> {
  if (!demoEnabled()) return { ok: false, error: "A demonstração está desligada." };
  const parsed = demoHistorySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Este lançamento não tem histórico." };
  const entries = await getTransactionHistory(demoRepository(todayInBrazil()), DEMO_USER_ID, parsed.data.id);
  return { ok: true, entries };
}
