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
import { isExpense, isIncome } from "../entities/transaction";
import { Money } from "../money/money";
import { type CompetenceMonth, monthOf } from "../value-objects/competence-month";

/** Maps a transaction to its competence month (calendar month, or card bill due month). */
type CompetenceResolver = (tx: Transaction) => CompetenceMonth;

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
export function computePersonBalances(
  people: readonly Person[],
  transactions: readonly Transaction[],
  settlements: readonly Settlement[],
): Map<string, Money> {
  // Seed every known person at zero so callers get a complete, stable map.
  const balances = new Map<string, Money>();
  for (const person of people) {
    balances.set(person.id, Money.zero());
  }

  // A person referenced only by a transaction/settlement (not in `people`) still
  // gets tracked, mirroring the prototype's `(d.people[pid] || 0)` accumulation.
  const adjust = (personId: string, delta: Money): void => {
    const current = balances.get(personId) ?? Money.zero();
    balances.set(personId, current.add(delta));
  };

  // ---- transaction effects (txDeltas, d.people branch) ----
  for (const tx of transactions) {
    if (isExpense(tx)) {
      // Paid ("paga") and future ("futura") installments do not affect balances;
      // only the current installment or a plain expense does. (Prototype early
      // return on parcelaStatus === 'paga' || 'futura'.)
      const status = tx.installment?.status;
      if (status === "paga" || status === "futura") continue;

      // Each split adds the person's share to what they owe you.
      for (const split of tx.splits) {
        adjust(split.personId, Money.fromCents(split.shareCents));
      }
    } else if (isIncome(tx)) {
      // A payment from a person abates their debt: balance -= amount.
      // (Income amountCents is positive; subtract it.)
      if (tx.fromPersonId !== null) {
        adjust(tx.fromPersonId, Money.fromCents(tx.amountCents).negate());
      }
    }
    // Transfers never touch person balances.
  }

  // ---- settlements ----
  // Each settlement reduces the outstanding balance toward zero, clamped so it
  // never crosses zero — exactly the `applySettle` operation.
  for (const settlement of settlements) {
    const current = balances.get(settlement.personId) ?? Money.zero();
    balances.set(settlement.personId, applySettlement(current, settlement.amountCents));
  }

  return balances;
}

/**
 * Per-person NET for a single month — the change a person's balance saw in `month`.
 *
 * Unlike {@link computePersonBalances} (all-time), this is the month's flow: the sum of
 * their expense shares whose competence is `month`, minus payments received from them in
 * `month`, then settlements dated in `month` applied toward zero (same clamp as the
 * all-time ledger, but against the month's own net). Convention is unchanged: `> 0` they
 * owe you for the month, `< 0` you owe them. Use the all-time balance for the true total.
 *
 * @returns a Map from personId to their month net as Money; every `people` id is present.
 */
export function computePersonBalancesForMonth(
  people: readonly Person[],
  transactions: readonly Transaction[],
  settlements: readonly Settlement[],
  month: CompetenceMonth,
  competenceOf: CompetenceResolver,
): Map<string, Money> {
  const balances = new Map<string, Money>();
  for (const person of people) balances.set(person.id, Money.zero());

  const adjust = (personId: string, delta: Money): void => {
    const current = balances.get(personId) ?? Money.zero();
    balances.set(personId, current.add(delta));
  };

  for (const tx of transactions) {
    if (competenceOf(tx) !== month) continue;
    if (isExpense(tx)) {
      const status = tx.installment?.status;
      if (status === "paga" || status === "futura") continue;
      for (const split of tx.splits) {
        adjust(split.personId, Money.fromCents(split.shareCents));
      }
    } else if (isIncome(tx) && tx.fromPersonId !== null) {
      adjust(tx.fromPersonId, Money.fromCents(tx.amountCents).negate());
    }
  }

  for (const settlement of settlements) {
    if (monthOf(settlement.date) !== month) continue;
    const current = balances.get(settlement.personId) ?? Money.zero();
    balances.set(settlement.personId, applySettlement(current, settlement.amountCents));
  }

  return balances;
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
