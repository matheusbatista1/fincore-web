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
 *  - expense with `source === "overdraft"` (cheque especial) → debits its
 *    `linkedAccountId` (the overdraft is drawn from that account; the balance may
 *    go negative).
 *  - expense paid by card OR the other linked sources (boleto/loan/financing) →
 *    does NOT change any account balance.
 *  - transfer → `fromAccountId -= valueCents`, `toAccountId += valueCents`.
 *  - a settlement with an `accountId` credits/debits that account by its cash
 *    effect (see {@link computeAccountBalances}); settlements without an account are
 *    pure ledger entries.
 *
 * All arithmetic goes through {@link Money} (integer cents), never floats.
 */

import type { Account } from "../entities/account";
import type { CardBillPayment } from "../entities/card-bill-payment";
import type { Settlement } from "../entities/settlement";
import type { Transaction } from "../entities/transaction";
import {
  isExpense,
  isIncome,
  isPaid,
  isPayableObligation,
  isRolled,
  isTransfer,
} from "../entities/transaction";
import { Money } from "../money/money";
import type { IsoDate } from "../value-objects/competence-month";
import { computePersonBalances } from "./person-ledger.calculator";
import type { ViewMode } from "./personal-vs-general";

/**
 * Whether a transaction affects account balances at all.
 *
 * Mirrors `txDeltas`' early-return: installments marked `paga` (already settled in
 * a past period) or `futura` (not yet due) are excluded; only `atual` installments
 * and transactions without installment info participate.
 */
function affectsBalance(tx: Transaction): boolean {
  // A rolled (abated) expense is excluded from balances — the new rolled-into debt replaces it.
  if (isRolled(tx)) return false;
  // A paid deferred obligation always moves cash on its paid date, regardless of installment
  // status — you can settle a `futura` parcela early and it must debit the paying account.
  if (isExpense(tx) && isPaid(tx)) return true;
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
 *
 * The `lens` defaults to `"general"` (real money movement — the live balance
 * everywhere). The `"personal"` lens estimates "what's really mine": a shared
 * expense debits only `myShareCents` (the rest is owed back by others) and
 * reimbursement income is ignored (it's a refund, not your money). Card/linked
 * expenses still never touch an account balance in either lens.
 */
export function accountDeltas(tx: Transaction, lens: ViewMode = "general"): Map<string, Money> {
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
    // Income lands in its account (amountCents is positive). A card credit
    // (estorno) has no account — it only reduces a card bill, never a balance.
    if (tx.accountId !== null) {
      // Personal lens drops reimbursements: money others pay you back is not "yours".
      if (lens === "personal" && tx.isReimbursement) return deltas;
      credit(tx.accountId, Money.fromCents(tx.amountCents));
    }
    return deltas;
  }

  // Expense: account-source debits its account; overdraft (cheque especial) is drawn
  // from its linked account and debits it too (the balance can go negative). Card and
  // the other linked sources (boleto/loan/financing) never move a balance.
  if (isExpense(tx)) {
    // A paid deferred obligation (boleto/loan/financing) debits its paying account by the amount
    // actually paid, on its paid date. The effective-date cutoff in computeAccountBalances gates
    // this by `paidAt` (which may differ from the due date). Card charges are settled through the
    // whole bill, never per-charge, so `isPayableObligation` keeps them out.
    const paidAccountId = tx.paidAccountId ?? null;
    if (isPaid(tx) && isPayableObligation(tx) && paidAccountId !== null) {
      const paidCents = tx.paidAmountCents ?? Math.abs(tx.amountCents);
      // Personal debits only the user's own share when the obligation is shared; otherwise the
      // full amount paid (loans/financing/taxes are essentially never split).
      const magnitude =
        lens === "personal" && tx.splits.length > 0
          ? Money.fromCents(tx.myShareCents)
          : Money.fromCents(paidCents);
      credit(paidAccountId, magnitude.negate());
      return deltas;
    }
    const debitAccountId =
      tx.source === "account" ? tx.accountId : tx.source === "overdraft" ? tx.linkedAccountId : null;
    if (debitAccountId !== null) {
      // General debits the full magnitude; personal debits only the user's own share.
      const magnitude =
        lens === "personal" ? Money.fromCents(tx.myShareCents) : Money.fromCents(tx.amountCents).abs();
      credit(debitAccountId, magnitude.negate());
    }
  }

  return deltas;
}

/**
 * The date a transaction's account effect lands on. A paid deferred obligation moves cash on its
 * `paidAt` (which may differ from the due date it's still filed under); everything else uses its
 * own date. Used to gate the balance cutoff in {@link computeAccountBalances}.
 */
function balanceEffectiveDate(tx: Transaction): IsoDate {
  return isExpense(tx) && tx.paidAt != null ? tx.paidAt : tx.date;
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
  lens: ViewMode = "general",
  settlements: readonly Settlement[] = [],
  cardBillPayments: readonly CardBillPayment[] = [],
): Map<string, Money> {
  const balances = new Map<string, Money>();

  // Seed every account from its opening balance.
  for (const account of accounts) {
    balances.set(account.id, Money.fromCents(account.openingBalanceCents));
  }

  // Apply each transaction's deltas. Deltas referencing an unknown account id
  // (e.g. an account not in `accounts`) are ignored, matching the prototype's
  // `commitTx`, which only updates accounts that exist in its list.
  const applicable =
    upToDate === undefined ? transactions : transactions.filter((tx) => balanceEffectiveDate(tx) <= upToDate);
  for (const tx of applicable) {
    for (const [accountId, delta] of accountDeltas(tx, lens)) {
      const current = balances.get(accountId);
      if (current !== undefined) {
        balances.set(accountId, current.add(delta));
      }
    }
  }

  // A settlement that names an account moves real cash: when the person owed you
  // (positive ledger balance) it credits the account; when you owed them it debits it.
  // The direction follows the person's transaction-derived balance sign (settlements
  // only reduce toward zero, never flip it). Personal lens drops it — the cash is a
  // reimbursement of others' shares, not "your" money (mirrors reimbursement income).
  if (lens === "general" && settlements.length > 0) {
    const personBalances = computePersonBalances([], transactions, []);
    for (const s of settlements) {
      if (s.accountId === null) continue;
      if (upToDate !== undefined && s.date > upToDate) continue;
      const current = balances.get(s.accountId);
      if (current === undefined) continue;
      const owedToYou = !(personBalances.get(s.personId) ?? Money.zero()).isNegative();
      const cash = owedToYou ? s.amountCents : -s.amountCents;
      balances.set(s.accountId, current.add(Money.fromCents(cash)));
    }
  }

  // A card fatura payment debits its account by the amount paid, on its pay date. Card charges
  // never touch a live balance (they defer to the whole bill), so this is the ONLY place a card
  // moves an account. Applied in BOTH lenses — a fatura is the user's own money and card charges
  // are not lens-split at the account level (unlike settlements, which the personal lens drops).
  for (const p of cardBillPayments) {
    if (upToDate !== undefined && p.date > upToDate) continue;
    const current = balances.get(p.accountId);
    if (current === undefined) continue;
    balances.set(p.accountId, current.subtract(Money.fromCents(p.amountCents)));
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
