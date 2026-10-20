import { Money } from "@/domain/money/money";
import { billingCompetence } from "@/domain/services/card-bill.calculator";
import {
  computePersonBalances,
  computePersonBalancesThrough,
  computePersonMonthNets,
} from "@/domain/services/person-ledger.calculator";
import { type CompetenceMonth, compareMonths } from "@/domain/value-objects/competence-month";
import { currentMonthInBrazil } from "@/shared/formatting/now";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

/** A person with both their month NET and their accumulated total (both projection-aware). */
export interface PersonMonthView {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  readonly color: string;
  /**
   * The person's NET for the browsed month AS IT STANDS TODAY (> 0 they owe you): a payment dated
   * after that month still covers it, so a settled August reads zero in August. Future months fold
   * in projected recurring shares.
   */
  readonly monthBalanceCents: number;
  /**
   * Accumulated total they owe you through the browsed month or today, whichever is later (incl.
   * projected recurring up to that horizon) — the "no total" figure, and the cap of the settle flow.
   */
  readonly totalBalanceCents: number;
  /** Real (booked) all-time balance — the settleable amount (no projection). */
  readonly realBalanceCents: number;
}

/**
 * Per-person month net + accumulated total for the People page. A past month is read through
 * TODAY's ledger, not frozen at its own month-end: the page answers "what is still pending from
 * that month?", so an acerto dated September zeroes August. The end-of-month snapshot it replaced
 * showed debts already paid as pending, and nothing the user could register would clear them,
 * since a new acerto is dated when it is registered. Future months extend the horizon to the
 * browsed month so their projections count. (The dashboard keeps its month-end snapshot: its
 * "fim do mês" pairs the people net with the balances as of that same month-end.)
 */
export async function getPeople(
  repo: FinanceRepository,
  userId: string,
  month: CompetenceMonth,
): Promise<PersonMonthView[]> {
  const ws = await loadWorkspaceCached(repo, userId);
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const current = currentMonthInBrazil();
  const horizon = compareMonths(month, current) > 0 ? month : current;

  // Per-month nets through the horizon: a later settlement is re-bucketed onto the oldest open
  // months, so the browsed month's slice already reflects payments made after it.
  const monthNets = computePersonMonthNets(ws.people, ws.transactions, ws.settlements, horizon, competenceOf);
  const totalLedger = computePersonBalancesThrough(
    ws.people,
    ws.transactions,
    ws.settlements,
    horizon,
    competenceOf,
  );
  // Real booked balance (no projection) — what the settle flow can act on.
  const realLedger = computePersonBalances(ws.people, ws.transactions, ws.settlements);

  return ws.people.map((p) => ({
    id: p.id,
    name: p.name,
    relationship: p.relationship,
    color: p.color,
    monthBalanceCents: monthNets.get(p.id)?.get(month) ?? 0,
    totalBalanceCents: (totalLedger.get(p.id) ?? Money.zero()).cents,
    realBalanceCents: (realLedger.get(p.id) ?? Money.zero()).cents,
  }));
}
