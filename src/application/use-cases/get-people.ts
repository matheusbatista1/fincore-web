import { Money } from "@/domain/money/money";
import { billingCompetence } from "@/domain/services/card-bill.calculator";
import {
  computePersonBalances,
  computePersonBalancesForMonth,
  computePersonBalancesThrough,
} from "@/domain/services/person-ledger.calculator";
import type { CompetenceMonth } from "@/domain/value-objects/competence-month";
import { currentMonthInBrazil } from "@/shared/formatting/now";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

/** A person with both their month NET and their accumulated total (both projection-aware). */
export interface PersonMonthView {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  readonly color: string;
  /** The person's NET for the browsed month (> 0 they owe you), incl. projected for future months. */
  readonly monthBalanceCents: number;
  /** Accumulated total they owe you through the browsed month, incl. projected recurring. */
  readonly totalBalanceCents: number;
  /** Real (booked) all-time balance — the settleable amount (no projection). */
  readonly realBalanceCents: number;
}

/** Per-person month net + accumulated total (both folding in projected recurring) for the People page. */
export async function getPeople(
  repo: FinanceRepository,
  userId: string,
  month: CompetenceMonth,
): Promise<PersonMonthView[]> {
  const ws = await loadWorkspaceCached(repo, userId);
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const current = currentMonthInBrazil();

  const monthLedger = computePersonBalancesForMonth(
    ws.people,
    ws.transactions,
    ws.settlements,
    month,
    competenceOf,
    current,
  );
  const totalLedger = computePersonBalancesThrough(
    ws.people,
    ws.transactions,
    ws.settlements,
    month,
    competenceOf,
  );
  // Real booked balance (no projection) — what the settle flow can act on.
  const realLedger = computePersonBalances(ws.people, ws.transactions, ws.settlements);

  return ws.people.map((p) => ({
    id: p.id,
    name: p.name,
    relationship: p.relationship,
    color: p.color,
    monthBalanceCents: (monthLedger.get(p.id) ?? Money.zero()).cents,
    totalBalanceCents: (totalLedger.get(p.id) ?? Money.zero()).cents,
    realBalanceCents: (realLedger.get(p.id) ?? Money.zero()).cents,
  }));
}
