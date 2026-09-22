import { isExpense, isRolled } from "@/domain/entities/transaction";
import { recurrenceIdentity } from "@/domain/services/recurring.projection";
import { dateInMonth, type IsoDate, monthOf } from "@/domain/value-objects/competence-month";
import { todayInBrazil } from "@/shared/formatting/now";
import { err, ok, type Result } from "@/shared/result";
import { createTransactionSchema } from "@/shared/schemas/transaction";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";
import { buildCommand } from "./create-transaction";
import { occurrenceInput } from "./materialize-recurring";

export interface MaterializeOccurrenceError {
  readonly code: "not_found" | "not_recurring" | "bad_date" | "invalid";
  readonly message: string;
}

/**
 * Book ONE occurrence of a recurring rule on demand — what "Pagar" on a previsto needs.
 *
 * A forecast is not a transaction, so it cannot be paid, received or edited. Rather than let the
 * UI act on the rule's anchor (which settles the anchor's OWN month — the bug that rewrote July's
 * payments from August), this turns the chosen occurrence into a real row and hands its id back,
 * so the Pagar/Receber flow works on the row it belongs to.
 *
 * Idempotent: if the rule already has a row in that calendar month (the automatic pass ran, or the
 * user booked it by hand), its id is returned and nothing new is created. The materialisation
 * watermark is deliberately NOT moved — this is one occurrence ahead of time, not the daily pass.
 */
export async function materializeOccurrence(
  repo: FinanceRepository,
  userId: string,
  input: { readonly anchorId: string; readonly date: IsoDate },
): Promise<Result<{ id: string }, MaterializeOccurrenceError>> {
  const ws = await loadWorkspaceCached(repo, userId);
  const anchor = ws.transactions.find((t) => t.id === input.anchorId);
  if (!anchor) return err({ code: "not_found", message: "Lançamento fixo não encontrado." });
  if (anchor.kind === "transfer" || anchor.recurrence === null || isRolled(anchor)) {
    return err({ code: "not_recurring", message: "Esse lançamento não é fixo." });
  }
  if (isExpense(anchor) && anchor.installment !== null) {
    return err({ code: "not_recurring", message: "Parcelamentos não são lançados por regra." });
  }

  // Never trust the client with the date: it must be exactly where the rule falls in that month,
  // and after the anchor's own occurrence.
  const expected = dateInMonth(monthOf(input.date), anchor.recurrence.dayOfMonth);
  if (input.date !== expected || input.date <= anchor.date) {
    return err({ code: "bad_date", message: "Data fora do calendário desse lançamento fixo." });
  }

  // Already booked for that month? Hand back the existing row instead of duplicating it.
  const identity = recurrenceIdentity(anchor);
  const chargeMonth = monthOf(input.date);
  const existing = ws.transactions.find(
    (t) => !isRolled(t) && monthOf(t.date) === chargeMonth && recurrenceIdentity(t) === identity,
  );
  if (existing) return ok({ id: existing.id });

  const parsed = createTransactionSchema.safeParse(occurrenceInput(anchor, input.date));
  if (!parsed.success) return err({ code: "invalid", message: "Não foi possível lançar esse fixo." });
  const command = buildCommand(parsed.data, todayInBrazil());
  if (!command.ok) return err({ code: "invalid", message: command.error.message });

  return ok({ id: await repo.createTransactionReturningId(userId, command.value) });
}
