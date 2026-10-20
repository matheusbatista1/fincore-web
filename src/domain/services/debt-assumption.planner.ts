/**
 * debt-assumption planner — "Assumir dívida": which BOOKED shares (and how much of each) move from
 * a person onto the user so that the person's outstanding drops by exactly the chosen amount.
 *
 * The person ledger is derived (shares − payments − acertos), so taking a debt over means editing
 * the rows that carry it: the person's split shrinks (or goes) and the user's own share grows by the
 * same cents. No cash moves and nothing is written off the ledger — the expense simply becomes the
 * user's, which is what both lenses then report.
 *
 * Which rows: only what is still UNCOVERED through `month`. Coverage follows the ledger's own rules
 * (a person's payment reduces its own competence month, an acerto covers the oldest open months
 * first) and, inside a month, lands on the oldest rows first (by date, then id) — so the uncovered
 * cents always sit on the newest rows of a month. Projected ("previsto") occurrences are never
 * candidates: a forecast has no row whose share could move.
 *
 * Pure domain code — no I/O, no imports outside src/domain.
 */

import type { Settlement } from "../entities/settlement";
import { type ExpenseTransaction, isExpense, isRolled, type Transaction } from "../entities/transaction";
import { type CompetenceMonth, compareMonths } from "../value-objects/competence-month";
import { computePersonMonthNets } from "./person-ledger.calculator";

/** Maps a transaction to its competence month (calendar month, or card bill due month). */
type CompetenceResolver = (tx: Transaction) => CompetenceMonth;

/** `month` = only the browsed month's pending; `all` = everything pending through it. */
export type AssumptionScope = "month" | "all";

/** One share to take over: `assumeCents` of the person's split on that row becomes the user's. */
export interface ShareAssumption {
  readonly transactionId: string;
  readonly personId: string;
  readonly assumeCents: number;
}

export interface DebtAssumptionPlan {
  /** In application order: the browsed month first, then earlier months newest first. */
  readonly items: ShareAssumption[];
  /** Σ assumeCents — the requested amount when the pending covers it, what it could cover otherwise. */
  readonly totalCents: number;
}

/** A person's share on one booked expense, with the part no payment/acerto has covered yet. */
interface UncoveredShare {
  readonly tx: ExpenseTransaction;
  readonly uncoveredCents: number;
}

const byDateThenId = (a: { tx: ExpenseTransaction }, b: { tx: ExpenseTransaction }): number =>
  a.tx.date < b.tx.date ? -1 : a.tx.date > b.tx.date ? 1 : a.tx.id < b.tx.id ? -1 : a.tx.id > b.tx.id ? 1 : 0;

/**
 * The person's uncovered booked shares per competence month through `month`: the month's net from
 * the BOOKED ledger (> 0 = still owed) is laid over the month's share rows oldest-first, so what is
 * left lands on the newest rows. Months the person does not owe in (net ≤ 0) yield nothing.
 */
function uncoveredSharesByMonth(
  personId: string,
  transactions: readonly Transaction[],
  settlements: readonly Settlement[],
  month: CompetenceMonth,
  competenceOf: CompetenceResolver,
): Map<CompetenceMonth, UncoveredShare[]> {
  const nets =
    computePersonMonthNets([], transactions, settlements, month, competenceOf, { projected: false }).get(
      personId,
    ) ?? new Map<CompetenceMonth, number>();

  // The person's booked share rows through the horizon, grouped by competence (active rows only).
  const rowsByMonth = new Map<CompetenceMonth, { tx: ExpenseTransaction; shareCents: number }[]>();
  for (const tx of transactions) {
    if (!isExpense(tx) || isRolled(tx)) continue;
    const share = tx.splits.find((s) => s.personId === personId);
    if (!share || share.shareCents <= 0) continue;
    const competence = competenceOf(tx);
    if (compareMonths(competence, month) > 0) continue;
    const list = rowsByMonth.get(competence);
    if (list) list.push({ tx, shareCents: share.shareCents });
    else rowsByMonth.set(competence, [{ tx, shareCents: share.shareCents }]);
  }

  const out = new Map<CompetenceMonth, UncoveredShare[]>();
  for (const [competence, rows] of rowsByMonth) {
    const net = nets.get(competence) ?? 0;
    if (net <= 0) continue;
    rows.sort(byDateThenId);
    // Everything the month's payments/acertos covered sits on the oldest rows; `net` is what is left.
    let covered = rows.reduce((sum, row) => sum + row.shareCents, 0) - net;
    const uncovered: UncoveredShare[] = [];
    for (const row of rows) {
      const take = Math.min(Math.max(covered, 0), row.shareCents);
      covered -= take;
      const left = row.shareCents - take;
      if (left > 0) uncovered.push({ tx: row.tx, uncoveredCents: left });
    }
    if (uncovered.length > 0) out.set(competence, uncovered);
  }
  return out;
}

/**
 * Plan the shares to take over for `amountCents`: the browsed `month` first, then (for `all`)
 * earlier months newest first; inside a month, the oldest uncovered row first. The plan stops when
 * the amount is met (`totalCents === amountCents`); when the pending is smaller, `totalCents` says
 * how much it could cover — the use case rejects such a request before planning, so this is a
 * guard, not a flow.
 */
export function planDebtAssumption(input: {
  readonly personId: string;
  readonly transactions: readonly Transaction[];
  readonly settlements: readonly Settlement[];
  readonly month: CompetenceMonth;
  readonly competenceOf: CompetenceResolver;
  readonly amountCents: number;
  readonly scope: AssumptionScope;
}): DebtAssumptionPlan {
  const byMonth = uncoveredSharesByMonth(
    input.personId,
    input.transactions,
    input.settlements,
    input.month,
    input.competenceOf,
  );
  const months =
    input.scope === "month" ? [input.month] : [...byMonth.keys()].sort((a, b) => compareMonths(b, a));

  const requested = Math.max(0, input.amountCents);
  const items: ShareAssumption[] = [];
  let remaining = requested;
  for (const m of months) {
    if (remaining === 0) break;
    for (const share of byMonth.get(m) ?? []) {
      if (remaining === 0) break;
      const assumeCents = Math.min(remaining, share.uncoveredCents);
      items.push({ transactionId: share.tx.id, personId: input.personId, assumeCents });
      remaining -= assumeCents;
    }
  }
  return { items, totalCents: requested - remaining };
}
