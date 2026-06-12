/**
 * Account balance calculator.
 *
 * Computes the *live* balance of each account by applying every transaction's
 * effect to the account's opening balance. Ported faithfully from the prototype's
 * `txDeltas` (the `d.acct` effects) and `commitTx` in
 * `Finance Pessoal/app/app.jsx`.
 *
 * Per-account rules (mirroring `txDeltas`):
 *  - An installment whose status is `paga` or `futura` has NO effect at all
 *    (the prototype early-returns for those). Only `atual` installments and
 *    non-installment transactions move balances.
 *  - income → credits `accountId` by `amountCents`.
 *  - expense with `source === "account"` → debits `accountId` by `|amountCents|`.
 *  - expense paid by card OR a non-account source (boleto/loan/financing/overdraft,
 *    i.e. linked via `linkedAccountId`) → does NOT change any account balance.
 *  - transfer → `fromAccountId -= valueCents`, `toAccountId += valueCents`.
 *
 * All arithmetic goes through {@link Money} (integer cents), never floats.
 */

import type { Account } from "../entities/account";
import type { Transaction } from "../entities/transaction";
import { isExpense, isIncome, isTransfer } from "../entities/transaction";
import { Money } from "../money/money";
import type { IsoDate } from "../value-objects/competence-month";

/**
 * Whether a transaction affects account balances at all.
 *
 * Mirrors `txDeltas`' early-return: installments marked `paga` (already settled in
 * a past period) or `futura` (not yet due) are excluded; only `atual` installments
 * and transactions without installment info participate.
 */
function affectsBalance(tx: Transaction): boolean {
  if (isExpense(tx) && tx.installment !== null) {
    return tx.installment.status === "atual";
  }
  return true;
}

/**
 * Net effect of a single transaction on account balances, as a map of
 * `accountId → delta`. Accounts not touched by the transaction are absent.
 *
 * This is the direct analogue of the `d.acct` portion of the prototype's
 * `txDeltas`. Exported so callers can inspect a single transaction's impact.
 */
export function accountDeltas(tx: Transaction): Map<string, Money> {
  const deltas = new Map<string, Money>();
  if (!affectsBalance(tx)) {
    return deltas;
  }

  const credit = (accountId: string, amount: Money): void => {
    const current = deltas.get(accountId) ?? Money.zero();
    deltas.set(accountId, current.add(amount));
  };

  if (isTransfer(tx)) {
    // No net effect on total wealth: money leaves `from` and enters `to`.
    const value = Money.fromCents(tx.valueCents);
    credit(tx.fromAccountId, value.negate());
    credit(tx.toAccountId, value);
    return deltas;
  }

  if (isIncome(tx)) {
    // Income lands in its account (amountCents is positive).
    credit(tx.accountId, Money.fromCents(tx.amountCents));
    return deltas;
  }

  // Expense: only those paid directly from an account move a balance.
  // Card and linked-account sources (boleto/loan/financing/overdraft) do not.
  if (isExpense(tx) && tx.source === "account" && tx.accountId !== null) {
    // amountCents is negative for expenses; debit by its magnitude.
    credit(tx.accountId, Money.fromCents(tx.amountCents).abs().negate());
  }

  return deltas;
}

/**
 * Compute the live balance of every account: opening balance plus the net effect
 * of all transactions. Accounts with no movement keep their opening balance.
 *
 * @param accounts All accounts to report on (each seeded from `openingBalanceCents`).
 * @param transactions The full transaction history to apply.
 * @param upToDate Inclusive cutoff (`YYYY-MM-DD`): transactions dated *after* it
 *   are ignored, so a future-dated entry (e.g. a salary booked for next month)
 *   only moves the balance once its date arrives. Omit to apply the full history.
 * @returns A `Map` keyed by account id; every input account is present.
 */
export function computeAccountBalances(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  upToDate?: IsoDate,
): Map<string, Money> {
  const balances = new Map<string, Money>();

  // Seed every account from its opening balance.
  for (const account of accounts) {
    balances.set(account.id, Money.fromCents(account.openingBalanceCents));
  }

  // Apply each transaction's deltas. Deltas referencing an unknown account id
  // (e.g. an account not in `accounts`) are ignored, matching the prototype's
  // `commitTx`, which only updates accounts that exist in its list.
  const applicable = upToDate === undefined ? transactions : transactions.filter((tx) => tx.date <= upToDate);
  for (const tx of applicable) {
    for (const [accountId, delta] of accountDeltas(tx)) {
      const current = balances.get(accountId);
      if (current !== undefined) {
        balances.set(accountId, current.add(delta));
      }
    }
  }

  return balances;
}

/**
 * Convenience helper: the live balance of a single account. Returns the opening
 * balance when no transaction touches it. `upToDate` mirrors {@link computeAccountBalances}.
 */
export function computeAccountBalance(
  account: Account,
  transactions: readonly Transaction[],
  upToDate?: IsoDate,
): Money {
  const balances = computeAccountBalances([account], transactions, upToDate);
  return balances.get(account.id) ?? Money.fromCents(account.openingBalanceCents);
}
