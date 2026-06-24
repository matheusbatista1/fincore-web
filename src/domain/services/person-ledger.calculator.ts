/**
 * person-ledger calculator — derives each person's ledger balance (who owes whom)
 * and ports the `applySettle` settle operation from the prototype.
 *
 * Convention (from data.js): balance > 0 means the person owes you;
 * balance < 0 means you owe them; 0 means settled.
 *
 * Ported from `Finance Pessoal/app/app.jsx`:
 *  - `txDeltas` — the `d.people` effects (lines ~53-72).
 *  - `applySettle` — the clamped settle operation (lines ~139-149).
 *
 * All money math goes through the Money value object (integer cents), so there is
 * no float drift; the prototype's `r2(x) = Math.round(x*100)/100` on Reais is the
 * equivalent of integer-cent arithmetic here.
 */

import type { Person } from "../entities/person";
import type { Settlement } from "../entities/settlement";
import type { Transaction } from "../entities/transaction";
import { isExpense, isIncome, isRolled } from "../entities/transaction";
import { Money } from "../money/money";
import {
  addMonths,
  type CompetenceMonth,
  compareMonths,
  type IsoDate,
  monthOf,
} from "../value-objects/competence-month";
import { projectRecurring } from "./recurring.projection";

/** Maps a transaction to its competence month (calendar month, or card bill due month). */
type CompetenceResolver = (tx: Transaction) => CompetenceMonth;

/** What a ledger movement originates from — a shared expense, a payment, or a settlement. */
export type LedgerSource =
  | { readonly type: "share"; readonly tx: Transaction }
  | { readonly type: "payment"; readonly tx: Transaction }
  | { readonly type: "settlement"; readonly settlement: Settlement };

/**
 * One step of the person ledger: a single change to a person's balance, with the
 * running balance after it. Emitted in accumulation order (transactions first, then
 * settlements). `signedDeltaCents` is the actual applied change (positive = they owe
 * you more = a debit; negative = a credit/payment), so summing the deltas reproduces
 * the balance exactly — including the zero-clamp on settlements.
 */
export interface LedgerMovement {
  readonly personId: string;
  readonly date: IsoDate;
  readonly competence: CompetenceMonth;
  readonly source: LedgerSource;
  readonly projected: boolean;
  readonly signedDeltaCents: number;
  readonly balanceAfterCents: number;
}

/** A transaction stamped with the date/competence/projected flag to emit on its movements. */
interface StampedTransaction {
  readonly tx: Transaction;
  readonly date: IsoDate;
  readonly competence: CompetenceMonth;
  readonly projected: boolean;
}

/**
 * Compute each person's derived ledger balance from transactions and settlements.
 *
 * Rules (mirroring `txDeltas` + `applySettle`):
 *  - Expense splits: each `split.personId` gains `split.shareCents` — they owe you
 *    their share of the shared expense. Installments with status "paga" or "futura"
 *    have NO effect (only the current/"atual" installment, or a non-installment
 *    expense, contributes), matching the prototype's early return.
 *  - Income with `fromPersonId`: that person loses `amountCents` — a payment from
 *    them abates their debt.
 *  - Settlements: reduce the outstanding balance toward zero, clamped so the
 *    balance never crosses zero (see `applySettlement`).
 *
 * Every person from `people` appears in the result, defaulting to zero.
 *
 * @returns a Map from personId to their balance as Money (cents).
 */
/**
 * Core accumulation: each expense split adds to what the person owes you; an income
 * `fromPersonId` abates it; then settlements are applied (clamped toward zero).
 *
 * `includeNonCurrentInstallments` controls installment handling:
 *  - `false` → only the current ("atual") parcela counts (paga/futura skipped). This is
 *    the all-time "current outstanding" total.
 *  - `true` → every parcela in the set counts. The caller has already scoped the set by
 *    competence month, so the future parcela that belongs to the browsed month is included
 *    (it is "futura" only relative to today, not relative to its own month).
 */
function accumulateWithMovements(
  people: readonly Person[],
  transactions: readonly StampedTransaction[],
  settlements: readonly Settlement[],
  includeNonCurrentInstallments: boolean,
): { balances: Map<string, Money>; movements: LedgerMovement[] } {
  // Seed every known person at zero so callers get a complete, stable map.
  const balances = new Map<string, Money>();
  for (const person of people) {
    balances.set(person.id, Money.zero());
  }
  const movements: LedgerMovement[] = [];

  // A person referenced only by a transaction/settlement (not in `people`) still
  // gets tracked, mirroring the prototype's `(d.people[pid] || 0)` accumulation.
  // Returns the actual applied delta so the caller can record the running balance.
  const adjust = (
    personId: string,
    delta: Money,
  ): { signedDeltaCents: number; balanceAfterCents: number } => {
    const current = balances.get(personId) ?? Money.zero();
    const next = current.add(delta);
    balances.set(personId, next);
    return { signedDeltaCents: next.cents - current.cents, balanceAfterCents: next.cents };
  };

  for (const { tx, date, competence, projected } of transactions) {
    if (isExpense(tx)) {
      // A rolled (abated) expense no longer burdens the person — the new rolled-into debt does.
      if (isRolled(tx)) continue;
      if (!includeNonCurrentInstallments) {
        const status = tx.installment?.status;
        if (status === "paga" || status === "futura") continue;
      }
      for (const split of tx.splits) {
        const { signedDeltaCents, balanceAfterCents } = adjust(
          split.personId,
          Money.fromCents(split.shareCents),
        );
        movements.push({
          personId: split.personId,
          date,
          competence,
          source: { type: "share", tx },
          projected,
          signedDeltaCents,
          balanceAfterCents,
        });
      }
    } else if (isIncome(tx) && tx.fromPersonId !== null) {
      // A payment from a person abates their debt: balance -= amount.
      const { signedDeltaCents, balanceAfterCents } = adjust(
        tx.fromPersonId,
        Money.fromCents(tx.amountCents).negate(),
      );
      movements.push({
        personId: tx.fromPersonId,
        date,
        competence,
        source: { type: "payment", tx },
        projected,
        signedDeltaCents,
        balanceAfterCents,
      });
    }
    // Transfers never touch person balances.
  }

  for (const settlement of settlements) {
    const current = balances.get(settlement.personId) ?? Money.zero();
    const next = applySettlement(current, settlement.amountCents);
    balances.set(settlement.personId, next);
    movements.push({
      personId: settlement.personId,
      date: settlement.date,
      competence: monthOf(settlement.date),
      source: { type: "settlement", settlement },
      projected: false,
      signedDeltaCents: next.cents - current.cents,
      balanceAfterCents: next.cents,
    });
  }

  return { balances, movements };
}

/**
 * Sum-only view of {@link accumulateWithMovements} — the balance map, discarding
 * movements. Callers that only need totals stamp each transaction with its calendar
 * month (the metadata is irrelevant when movements are thrown away).
 */
function accumulate(
  people: readonly Person[],
  transactions: readonly Transaction[],
  settlements: readonly Settlement[],
  includeNonCurrentInstallments: boolean,
): Map<string, Money> {
  const stamped = transactions.map((tx) => ({
    tx,
    date: tx.date,
    competence: monthOf(tx.date),
    projected: false,
  }));
  return accumulateWithMovements(people, stamped, settlements, includeNonCurrentInstallments).balances;
}

export function computePersonBalances(
  people: readonly Person[],
  transactions: readonly Transaction[],
  settlements: readonly Settlement[],
): Map<string, Money> {
  return accumulate(people, transactions, settlements, false);
}

/**
 * Per-person NET for a single month — the change a person's balance saw in `month`.
 *
 * Unlike {@link computePersonBalances} (all-time), this is the month's flow: the sum of
 * their expense shares with competence `month`, minus payments received from them in
 * `month`, then settlements dated in `month` applied toward zero (same clamp as the
 * all-time ledger, but against the month's own net). For FUTURE months (`month >
 * currentMonth`) it also folds in the projected ("previsto") recurring occurrences, so a
 * recurring shared expense still counts what the person will owe that month. Convention
 * unchanged: `> 0` they owe you, `< 0` you owe them.
 *
 * @returns a Map from personId to their month net as Money; every `people` id is present.
 */
export function computePersonBalancesForMonth(
  people: readonly Person[],
  transactions: readonly Transaction[],
  settlements: readonly Settlement[],
  month: CompetenceMonth,
  competenceOf: CompetenceResolver,
  currentMonth: CompetenceMonth,
): Map<string, Money> {
  // Real movements of the month (including an installment parcela whose competence is
  // this month, even if its status is "futura"), plus the projected recurring for future
  // months (their `.source` carries the splits / fromPersonId).
  const real = transactions.filter((t) => competenceOf(t) === month);
  const projected =
    compareMonths(month, currentMonth) > 0
      ? projectRecurring(transactions, month, competenceOf).map((p) => p.source)
      : [];
  const monthSettlements = settlements.filter((s) => monthOf(s.date) === month);
  return accumulate(people, [...real, ...projected], monthSettlements, true);
}

/**
 * Accumulated per-person balance INCLUDING projected ("previsto") recurring occurrences,
 * up to and including `throughMonth`. Real movements whose competence is ≤ the horizon,
 * plus a projected occurrence for every month up to the horizon (so a recurring shared
 * expense accrues what the person owes month after month — not just its anchor). Then
 * settlements dated ≤ the horizon are applied with the usual clamp. This is the "no total,
 * te deve…" figure; it grows as you browse further ahead.
 */
/**
 * The full per-person ledger up to and including `throughMonth`: the running balance
 * AND every movement that produced it (shared expense debits, payments, settlements),
 * incl. projected ("previsto") recurring occurrences for each month up to the horizon.
 * This is the single source of truth — {@link computePersonBalancesThrough} is just its
 * `balances`, and a statement windows `movements` by competence. Because every movement
 * carries its actual applied `signedDeltaCents`, summing the deltas reproduces the
 * balance exactly (including the settlement zero-clamp), so any window reconciles.
 */
export function computePersonLedger(
  people: readonly Person[],
  transactions: readonly Transaction[],
  settlements: readonly Settlement[],
  throughMonth: CompetenceMonth,
  competenceOf: CompetenceResolver,
): { balances: Map<string, Money>; movements: LedgerMovement[] } {
  const real: StampedTransaction[] = transactions
    .filter((t) => compareMonths(competenceOf(t), throughMonth) <= 0)
    // A real but not-yet-charged parcela ("futura") is a forecast for the statement,
    // so flag it projected for the "(previsto)" marker (it does not change the math).
    .map((t) => ({
      tx: t,
      date: t.date,
      competence: competenceOf(t),
      projected: isExpense(t) && t.installment?.status === "futura",
    }));

  let earliest: CompetenceMonth | null = null;
  for (const t of transactions) {
    const m = monthOf(t.date);
    if (earliest === null || compareMonths(m, earliest) < 0) earliest = m;
  }

  const projected: StampedTransaction[] = [];
  if (earliest !== null) {
    for (let m = earliest; compareMonths(m, throughMonth) <= 0; m = addMonths(m, 1)) {
      for (const occ of projectRecurring(transactions, m, competenceOf)) {
        // Stamp the occurrence's own month/date, not the anchor's, so a statement
        // windows each projected accrual into the month it lands in.
        projected.push({ tx: occ.source, date: occ.date, competence: m, projected: true });
      }
    }
  }

  const settsThrough = settlements.filter((s) => compareMonths(monthOf(s.date), throughMonth) <= 0);
  // `true`: count every parcela whose competence is within the horizon (the set is
  // already competence-filtered), so future parcelas accrue month after month.
  return accumulateWithMovements(people, [...real, ...projected], settsThrough, true);
}

export function computePersonBalancesThrough(
  people: readonly Person[],
  transactions: readonly Transaction[],
  settlements: readonly Settlement[],
  throughMonth: CompetenceMonth,
  competenceOf: CompetenceResolver,
): Map<string, Money> {
  return computePersonLedger(people, transactions, settlements, throughMonth, competenceOf).balances;
}

/**
 * Apply a settle of `amountCents` against `currentBalance`, ported EXACTLY from
 * the prototype's `applySettle`:
 *
 *   nb = balance > 0 ? Math.max(0, balance - amount)
 *                    : Math.min(0, balance + amount);
 *
 * In words:
 *  - If the person owes you (balance > 0), reduce the debt but never below zero.
 *  - If you owe them (balance < 0), reduce what you owe but never above zero.
 *  - If the balance is already zero, it stays zero.
 *
 * The key invariant: the balance NEVER crosses zero (it is clamped at zero).
 *
 * @param currentBalance the person's balance before settling (Money, cents).
 * @param amountCents    the settle amount in cents (typically >= 0).
 */
export function applySettlement(currentBalance: Money, amountCents: number): Money {
  const amount = Money.fromCents(amountCents);

  if (currentBalance.isPositive()) {
    // max(0, balance - amount)
    return currentBalance.subtract(amount).max(Money.zero());
  }
  if (currentBalance.isNegative()) {
    // min(0, balance + amount)
    return currentBalance.add(amount).min(Money.zero());
  }
  // Already settled — stays at zero.
  return Money.zero();
}
