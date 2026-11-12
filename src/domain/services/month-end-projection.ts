/**
 * month-end-projection — the "fim do mês" figure: where the user's money stands at the end of a
 * month once everything due has been paid and everyone has settled.
 *
 * ONE formula, used by the dashboard's hero, by the gap explainer and as the anchor of the daily
 * forecast — so the three can never disagree:
 *
 *     accounts − obligations − overdue + people
 *
 * - **accounts**: Σ account balances at month-end — real movements dated up to it, plus the
 *   recurring ("previsto") occurrences and the pending receivables of `[currentMonth, month]`;
 * - **obligations**: what falls due in `[currentMonth, month]` outside a cash account — card bills,
 *   boletos, loan and financing parcelas (real and projected) not yet paid;
 * - **overdue**: unpaid boleto/loan/financing from BEFORE the current month. They never debited a
 *   balance and fall outside the window above, so they would silently inflate the figure. Card
 *   faturas are not included: one before the current month is presumed paid, and only these
 *   obligations carry an explicit unpaid state;
 * - **people** (general lens only): what people still owe through month-end, every pending month —
 *   the personal lens already counts only the user's own share, so there is nothing to add back.
 *
 * A past month (`month < currentMonth`) has no projection window: only its real balance and the
 * people's nets through it.
 */

import type { Account } from "../entities/account";
import type { CardBillPayment } from "../entities/card-bill-payment";
import type { Person } from "../entities/person";
import type { Settlement } from "../entities/settlement";
import { isPaid, isPayableObligation, isRolled, type Transaction } from "../entities/transaction";
import { type CompetenceMonth, compareMonths } from "../value-objects/competence-month";
import { computePersonMonthNetsAndSettledCash } from "./person-ledger.calculator";
import type { ViewMode } from "./personal-vs-general";
import { obligationsDueThrough, projectedMonthEndBalances } from "./projected-balance";

/** Maps a transaction to its competence month (calendar month, or a card charge's bill month). */
type CompetenceResolver = (tx: Transaction) => CompetenceMonth;

export interface MonthEndProjectionInput {
  readonly accounts: readonly Account[];
  readonly people: readonly Person[];
  readonly transactions: readonly Transaction[];
  readonly settlements: readonly Settlement[];
  readonly cardBillPayments: readonly CardBillPayment[];
  /** The month whose end is projected. */
  readonly month: CompetenceMonth;
  /** Today's month — where the projection window `[currentMonth, month]` starts. */
  readonly currentMonth: CompetenceMonth;
  readonly competenceOf: CompetenceResolver;
  /**
   * The per-person, per-month nets through `month`, when the caller has already replayed the ledger
   * for it (`computePersonMonthNetsAndSettledCash(…, month, …)`): that replay is the costly part of
   * this figure, and a screen that lists people needs it anyway.
   */
  readonly personNets?: ReadonlyMap<string, ReadonlyMap<CompetenceMonth, number>>;
}

/** One lens's "fim do mês", split into the dashboard's own terms. */
export interface MonthEndFigure {
  /** Σ account balances projected to month-end (real movements + forecasts). */
  readonly accountsCents: number;
  /** Deferred obligations falling due in `[currentMonth, month]` (card bills, boletos, loans). */
  readonly obligationsCents: number;
  /** Unpaid boleto/loan/financing from before the current month. */
  readonly overdueCents: number;
  /** What people owe through month-end — added in the general lens only (0 in the personal one). */
  readonly peopleCents: number;
  /** `accounts − obligations − overdue + people`. */
  readonly totalCents: number;
}

/** The "fim do mês" of `input.month` through one lens. */
export function projectMonthEnd(input: MonthEndProjectionInput, lens: ViewMode): MonthEndFigure {
  const { accounts, people, transactions, settlements, cardBillPayments, month, currentMonth, competenceOf } =
    input;

  let overdueCents = 0;
  if (compareMonths(currentMonth, month) <= 0) {
    for (const tx of transactions) {
      if (!isPayableObligation(tx) || isPaid(tx) || isRolled(tx)) continue;
      if (compareMonths(competenceOf(tx), currentMonth) >= 0) continue;
      overdueCents += lens === "general" ? Math.abs(tx.amountCents) : tx.myShareCents;
    }
  }

  // Per-person, per-month nets through `month` in ONE pass: a pre-payment re-buckets onto the debt's
  // month, so the slices stay consistent when summed (Σ of them is the outstanding at month-end).
  let peopleCents = 0;
  if (lens === "general") {
    const nets =
      input.personNets ??
      computePersonMonthNetsAndSettledCash(people, transactions, settlements, month, competenceOf).nets;
    for (const person of people) {
      for (const net of nets.get(person.id)?.values() ?? []) peopleCents += net;
    }
  }

  let accountsCents = 0;
  for (const balance of projectedMonthEndBalances(
    accounts,
    transactions,
    month,
    competenceOf,
    currentMonth,
    lens,
    settlements,
    cardBillPayments,
  ).values()) {
    accountsCents += balance.cents;
  }
  const obligationsCents = obligationsDueThrough(
    transactions,
    currentMonth,
    month,
    competenceOf,
    lens,
    currentMonth,
    cardBillPayments,
  ).cents;

  return {
    accountsCents,
    obligationsCents,
    overdueCents,
    peopleCents,
    totalCents: accountsCents - obligationsCents - overdueCents + peopleCents,
  };
}
