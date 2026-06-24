import { isExpense, isRolled } from "@/domain/entities/transaction";
import { billingCompetence } from "@/domain/services/card-bill.calculator";
import type { CompetenceMonth } from "@/domain/value-objects/competence-month";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

/** A person's rollable debt in the browsed month — one target the "Rolar dívida" picker offers. */
export interface RollableDebt {
  readonly id: string;
  readonly personId: string;
  readonly description: string;
  /** The person's share of this expense (positive cents). */
  readonly shareCents: number;
  /** Installment position when the debt is a parcela, so the picker disambiguates siblings. */
  readonly parcela: { readonly number: number; readonly total: number } | null;
}

/**
 * The debts a person can roll in `month`: each shared expense whose competence (calendar
 * month, or card bill month) falls in the browsed month and is NOT already rolled.
 *
 * Scoping to the month is what makes "Rolar dívida" abate the parcela that actually weighs
 * on the month's "a receber". An installment loan owed by a person is many parcelas, but
 * only the one with this month's competence counts in the month net — rolling any other
 * (e.g. a future parcela) would abate nothing visible and just stack a new debt on top
 * (the double-count we are fixing). Projected ("previsto") occurrences are excluded: they
 * have no row to abate yet.
 */
export async function getRollableDebts(
  repo: FinanceRepository,
  userId: string,
  month: CompetenceMonth,
): Promise<RollableDebt[]> {
  const ws = await loadWorkspaceCached(repo, userId);
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);

  const debts: RollableDebt[] = [];
  for (const tx of ws.transactions) {
    if (!isExpense(tx) || isRolled(tx)) continue;
    if (competenceOf(tx) !== month) continue;
    for (const split of tx.splits) {
      if (split.shareCents <= 0) continue;
      debts.push({
        id: tx.id,
        personId: split.personId,
        description: tx.description,
        shareCents: split.shareCents,
        parcela: tx.installment ? { number: tx.installment.number, total: tx.installment.total } : null,
      });
    }
  }
  return debts;
}
