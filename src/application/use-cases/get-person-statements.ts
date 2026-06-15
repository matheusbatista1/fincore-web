import { billingCompetence } from "@/domain/services/card-bill.calculator";
import { computePersonLedger, type LedgerMovement } from "@/domain/services/person-ledger.calculator";
import { type CompetenceMonth, compareMonths } from "@/domain/value-objects/competence-month";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";
import { createTransactionMapper } from "./get-transactions";

/** One line of a person's account statement, with the running balance after it. */
export interface PersonLedgerEntry {
  readonly date: string;
  readonly description: string;
  /** Where it came from — card/account label, or "Acerto" for a settlement. */
  readonly origin: string;
  /** A debit increases what they owe you; a credit (payment/settlement) reduces it. */
  readonly kind: "debit" | "credit";
  /** Positive magnitude of this movement. */
  readonly amountCents: number;
  /** Running balance after this entry (> 0 they owe you). */
  readonly balanceCents: number;
  /** Projected ("previsto") — a recurring occurrence or a not-yet-charged parcela. */
  readonly projected: boolean;
}

/** A per-person account-receivable statement over a [from, to] window. */
export interface PersonStatement {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  readonly color: string;
  /** Balance carried in from before the window (accumulated pre-period movements). */
  readonly openingCents: number;
  readonly entries: PersonLedgerEntry[];
  readonly debitTotalCents: number;
  readonly creditTotalCents: number;
  /** Closing balance — equals openingCents + debitTotal - creditTotal, and reconciles
   * with `computePersonBalancesThrough(to)` (the figure shown on the People page). */
  readonly closingCents: number;
}

export interface GetPersonStatementsRange {
  readonly from: CompetenceMonth;
  readonly to: CompetenceMonth;
}

/**
 * Build an accountant-grade "conta corrente" per person for the window `[from, to]`:
 * a carried-in opening balance, the chronological shared-expense debits and
 * payment/settlement credits (with a running balance), and a closing balance.
 *
 * Reconciliation is structural: the closing balance and every running balance come
 * from a single {@link computePersonLedger} replay through `to`, so
 * `opening + Σ(debits − credits) === closing === computePersonBalancesThrough(to)`.
 */
export async function getPersonStatements(
  repo: FinanceRepository,
  userId: string,
  range: GetPersonStatementsRange,
): Promise<PersonStatement[]> {
  const ws = await loadWorkspaceCached(repo, userId);
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const [from, to] =
    compareMonths(range.from, range.to) <= 0 ? [range.from, range.to] : [range.to, range.from];

  const { balances, movements } = computePersonLedger(
    ws.people,
    ws.transactions,
    ws.settlements,
    to,
    competenceOf,
  );

  const mapTx = createTransactionMapper(ws);
  const accountName = new Map(ws.accounts.map((a) => [a.id, `${a.bank} · ${a.name}`]));

  const originOf = (mv: LedgerMovement): string => {
    if (mv.source.type === "settlement") {
      const acc = mv.source.settlement.accountId;
      return (acc ? accountName.get(acc) : undefined) ?? "Acerto";
    }
    return mapTx(mv.source.tx).sourceLabel ?? "Outros";
  };
  const descriptionOf = (mv: LedgerMovement): string =>
    mv.source.type === "settlement" ? (mv.source.settlement.note ?? "Acerto") : mv.source.tx.description;

  // Group movements by person once.
  const byPerson = new Map<string, LedgerMovement[]>();
  for (const mv of movements) {
    const list = byPerson.get(mv.personId);
    if (list) list.push(mv);
    else byPerson.set(mv.personId, [mv]);
  }

  return ws.people.map((p) => {
    const mvs = byPerson.get(p.id) ?? [];
    let openingCents = 0;
    const period: LedgerMovement[] = [];
    for (const mv of mvs) {
      // Movements before the window fold into the opening; the rest are the period.
      if (compareMonths(mv.competence, from) < 0) openingCents += mv.signedDeltaCents;
      else if (compareMonths(mv.competence, to) <= 0) period.push(mv);
    }
    // Chronological display order — the applied deltas are fixed, so the running balance
    // reconstructed from the opening still lands exactly on the closing balance.
    period.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    let running = openingCents;
    let debitTotalCents = 0;
    let creditTotalCents = 0;
    const entries: PersonLedgerEntry[] = period.map((mv) => {
      running += mv.signedDeltaCents;
      const isDebit = mv.signedDeltaCents > 0;
      const amountCents = Math.abs(mv.signedDeltaCents);
      if (isDebit) debitTotalCents += amountCents;
      else creditTotalCents += amountCents;
      return {
        date: mv.date,
        description: descriptionOf(mv),
        origin: originOf(mv),
        kind: isDebit ? "debit" : "credit",
        amountCents,
        balanceCents: running,
        projected: mv.projected,
      };
    });

    return {
      id: p.id,
      name: p.name,
      relationship: p.relationship,
      color: p.color,
      openingCents,
      entries,
      debitTotalCents,
      creditTotalCents,
      closingCents: balances.get(p.id)?.cents ?? 0,
    };
  });
}
