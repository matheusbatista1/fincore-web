import { isExpense } from "@/domain/entities/transaction";
import { cardBillMonth, cardBillOverridesByCard } from "@/domain/services/card-bill.calculator";
import { addMonths, type CompetenceMonth } from "@/domain/value-objects/competence-month";
import { err, ok, type Result } from "@/shared/result";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

export interface MoveTransactionBillError {
  readonly code: "not_found" | "not_card";
  readonly message: string;
}

/**
 * Move a single card charge to the previous/next bill, preserving its real date.
 * Stores a per-charge override; moving back to the automatic cycle clears it.
 */
export async function moveTransactionBill(
  repo: FinanceRepository,
  userId: string,
  id: string,
  direction: "prev" | "next",
): Promise<Result<void, MoveTransactionBillError>> {
  const ws = await loadWorkspaceCached(repo, userId);
  const tx = ws.transactions.find((t) => t.id === id);
  if (!tx) return err({ code: "not_found", message: "Lançamento não encontrado." });
  if (!isExpense(tx) || tx.source !== "card" || tx.cardId === null) {
    return err({ code: "not_card", message: "Só lançamentos de cartão podem mudar de fatura." });
  }
  const card = ws.creditCards.find((c) => c.id === tx.cardId);
  if (!card) return err({ code: "not_card", message: "Cartão não encontrado." });

  const overrides = cardBillOverridesByCard(ws.cardBillDates).get(card.id);
  const natural = cardBillMonth(tx.date, card.closingDay, card.dueDay, overrides);
  const current: CompetenceMonth = tx.billMonthOverride ?? natural;
  const target = addMonths(current, direction === "next" ? 1 : -1);

  // Pinning back to the natural cycle just clears the override (keeps data clean).
  await repo.setBillMonthOverride(userId, id, target === natural ? null : target);
  return ok(undefined);
}
