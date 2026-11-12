"use server";

import type { ReconcileActionState } from "@/app/_actions/finance";
import { reconcileWithStatement } from "@/application/use-cases/reconcile-statement";
import { demoEnabled } from "@/infrastructure/demo/demo-flag";
import { DEMO_USER_ID, demoRepository } from "@/infrastructure/demo/demo-repository";
import { todayInBrazil } from "@/shared/formatting/now";
import { reconcileStatementSchema } from "@/shared/schemas/reconcile";

/** "Conferir extrato" for the demo: the real check, against the made-up household. */
export async function demoReconcileAction(raw: unknown): Promise<ReconcileActionState> {
  if (!demoEnabled()) return { ok: false, error: "A demonstração está desligada." };
  const parsed = reconcileStatementSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Não consegui ler as linhas deste arquivo." };
  const result = await reconcileWithStatement(demoRepository(todayInBrazil()), DEMO_USER_ID, parsed.data);
  if (!result.ok) return { ok: false, error: result.error.message };
  return { ok: true, result: result.value };
}
