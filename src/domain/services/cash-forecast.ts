/**
 * cash-forecast — the total across accounts, day by day, from tomorrow to the end of a future month.
 *
 * It is the "fim do mês" projection ({@link projectMonthEnd}, general lens) spread over the days
 * its parts fall on, so the forecast line passes through the very figure the dashboard shows at
 * each month-end — and says, in between, WHEN the money comes and goes:
 *
 * - **scheduled**: real movements already booked for a later day, on that day;
 * - **recurring**: fixed incomes and account expenses still to come, on their day of the month;
 * - **receivable**: incomes booked but not received yet, on their date;
 * - **card-bill**: each unpaid fatura, on its due date (charges and expected fixed charges, minus
 *   estornos);
 * - **obligation**: each unpaid boleto / loan / financing parcela (booked or expected), on its date;
 * - **overdue**: those that were due before the current month — assumed paid next (tomorrow);
 * - **people**: what people still owe (or are owed) through each month — assumed settled on its
 *   last day, the cautious reading: the line does not count on money nobody has promised a date for.
 *
 * Anything dated today or earlier and still pending (a bill past its due date, a fixed entry not
 * booked yet) lands on tomorrow, marked `late`: the forecast starts from the live balance and never
 * rewrites today.
 *
 * A month-end the caller has a figure for is **anchored** on it: whatever the dated parts did not
 * explain is added on that day as an "adjustment". It is zero in every case the tests can build
 * (they anchor every month on {@link projectMonthEnd}); it exists so the line can never drift from
 * the figure the user reads beside it.
 *
 * Always the general lens: real cash, like the balances this line continues.
 */

import type { Account } from "../entities/account";
import type { CardBillDate } from "../entities/card-bill-date";
import type { CardBillPayment } from "../entities/card-bill-payment";
import type { CreditCard } from "../entities/credit-card";
import type { Person } from "../entities/person";
import type { Settlement } from "../entities/settlement";
import {
  isCardCredit,
  isExpense,
  isIncome,
  isPaid,
  isPayableObligation,
  isPendingReceivable,
  isRolled,
  settledIncomeCents,
  type Transaction,
} from "../entities/transaction";
import {
  addDays,
  addMonths,
  type CompetenceMonth,
  compareMonths,
  dateInMonth,
  daysBetween,
  type IsoDate,
  monthOf,
} from "../value-objects/competence-month";
import { accountDeltas, type BalanceMovementOrigin, forEachBalanceMovement } from "./balance.calculator";
import { computeBalanceTimeline, totalBalanceAt } from "./balance-timeline";
import { cardBillOverridesByCard } from "./card-bill.calculator";
import { computePersonMonthNetsAndSettledCash } from "./person-ledger.calculator";
import { freshOccurrence, projectRecurring, recurrenceIdentity } from "./recurring.projection";

/** Maps a transaction to its competence month (calendar month, or a card charge's bill month). */
type CompetenceResolver = (tx: Transaction) => CompetenceMonth;

export type ForecastEventKind =
  | "scheduled"
  | "recurring"
  | "receivable"
  | "card-bill"
  | "obligation"
  | "overdue"
  | "people"
  | "adjustment";

/** One thing expected to move the total on a day. */
export interface ForecastEvent {
  readonly date: IsoDate;
  /** Signed change of the total that day: money in is positive, money out negative. */
  readonly deltaCents: number;
  readonly kind: ForecastEventKind;
  /** What it is, in the user's own words where there are any: a description, "Fatura Nubank"… */
  readonly label: string;
  /** Still pending past its own date: the forecast assumes it for tomorrow, the day it is shown on. */
  readonly late: boolean;
}

export interface CashForecastInput {
  readonly accounts: readonly Account[];
  readonly creditCards: readonly CreditCard[];
  readonly cardBillDates: readonly CardBillDate[];
  readonly people: readonly Person[];
  readonly transactions: readonly Transaction[];
  readonly settlements: readonly Settlement[];
  readonly cardBillPayments: readonly CardBillPayment[];
  readonly today: IsoDate;
  /** The last month to forecast (to its last day). */
  readonly throughMonth: CompetenceMonth;
  readonly competenceOf: CompetenceResolver;
  /**
   * Month-end figures the caller already has (the general "fim do mês" of {@link projectMonthEnd}),
   * by month. The forecast is pinned on each: whatever its dated parts did not explain is added on
   * that month's last day as an "adjustment". Pass the month the screen shows a figure for; the
   * tests pass every month, and keep the adjustment at zero.
   */
  readonly anchors?: ReadonlyMap<CompetenceMonth, number>;
  /**
   * The per-person, per-month nets through a month, for the months the caller has already replayed
   * the ledger for (`computePersonMonthNetsAndSettledCash(…, month, …)`), by that month. The replay
   * is the costly part of the forecast; a dashboard has it for the month it shows.
   */
  readonly personNets?: ReadonlyMap<
    CompetenceMonth,
    ReadonlyMap<string, ReadonlyMap<CompetenceMonth, number>>
  >;
}

export interface CashForecast {
  /** The total today — where the forecast starts from. */
  readonly liveCents: number;
  /** Tomorrow: the day `dailyCents[0]` is the total of. */
  readonly startDate: IsoDate;
  /** The expected total at the end of each day, from `startDate` to the last day of `throughMonth`. */
  readonly dailyCents: number[];
  /** What moves it, oldest first. */
  readonly events: readonly ForecastEvent[];
}

const PEOPLE_LABEL = "Acertos com pessoas";
const ADJUSTMENT_LABEL = "Ajuste da projeção";

/** A deferred obligation still to be paid: not from a cash account, not rolled, with no payment at all. */
const isUnpaidObligation = (tx: Transaction): boolean =>
  isExpense(tx) && tx.source !== "account" && tx.source !== "overdraft" && !isRolled(tx) && tx.paidAt == null;

/** Forecast the total across `accounts` from tomorrow to the end of `throughMonth`. */
export function forecastCash(input: CashForecastInput): CashForecast {
  const {
    accounts,
    creditCards,
    cardBillDates,
    people,
    transactions,
    settlements,
    cardBillPayments,
    today,
    throughMonth,
    competenceOf,
  } = input;
  const currentMonth = monthOf(today);
  const tomorrow = addDays(today, 1);
  const horizonEnd = dateInMonth(throughMonth, 31);
  const liveCents = totalBalanceAt(
    computeBalanceTimeline(accounts, transactions, settlements, cardBillPayments),
    today,
  );
  if (horizonEnd < tomorrow) return { liveCents, startDate: tomorrow, dailyCents: [], events: [] };

  const reported = new Set(accounts.map((a) => a.id));
  const cardById = new Map(creditCards.map((c) => [c.id, c]));
  const inWindow = (month: CompetenceMonth): boolean =>
    compareMonths(month, currentMonth) >= 0 && compareMonths(month, throughMonth) <= 0;
  const events: ForecastEvent[] = [];
  const push = (
    date: IsoDate,
    deltaCents: number,
    kind: ForecastEventKind,
    label: string,
    late: boolean,
  ): void => {
    if (deltaCents !== 0 && date <= horizonEnd) events.push({ date, deltaCents, kind, label, late });
  };
  /** On its own date — or, once that has passed, on tomorrow: the forecast never rewrites today. */
  const add = (date: IsoDate, deltaCents: number, kind: ForecastEventKind, label: string): void => {
    const late = date < tomorrow;
    push(late ? tomorrow : date, deltaCents, kind, label, late);
  };

  // ---- scheduled: real movements already dated after today (one event per row, netted: a
  // transfer between two of the accounts moves nothing).
  const labelOf = (origin: BalanceMovementOrigin): string => {
    if (origin.kind === "transaction") return origin.transaction.description;
    if (origin.kind === "settlement") return "Acerto";
    const card = cardById.get(origin.payment.cardId);
    return card ? `Fatura ${card.bank}` : "Fatura";
  };
  const scheduled = new Map<object, { date: IsoDate; cents: number; label: string }>();
  forEachBalanceMovement(
    { transactions, settlements, cardBillPayments, lens: "general", upToDate: horizonEnd },
    (accountId) => reported.has(accountId),
    (date, _accountId, delta, origin) => {
      if (date <= today) return;
      const key =
        origin.kind === "transaction"
          ? origin.transaction
          : origin.kind === "settlement"
            ? origin.settlement
            : origin.payment;
      const entry = scheduled.get(key) ?? { date, cents: 0, label: labelOf(origin) };
      entry.cents += delta.cents;
      scheduled.set(key, entry);
    },
  );
  for (const entry of scheduled.values()) add(entry.date, entry.cents, "scheduled", entry.label);

  // ---- card bills accumulate here, by card and competence; a paid fatura has already left (or is
  // a scheduled movement, when its payment is dated ahead).
  const paidBills = new Set(cardBillPayments.map((p) => `${p.cardId}|${p.competence}`));
  const bills = new Map<string, { cardId: string; competence: CompetenceMonth; cents: number }>();
  const toBill = (cardId: string, competence: CompetenceMonth, cents: number): void => {
    const key = `${cardId}|${competence}`;
    if (paidBills.has(key)) return;
    const bill = bills.get(key) ?? { cardId, competence, cents: 0 };
    bill.cents += cents;
    bills.set(key, bill);
  };

  // ---- booked rows: obligations and card credits falling due in the window, pending receivables,
  // and what is overdue from before it.
  const realCovered = new Set<string>();
  for (const tx of transactions) {
    if (isExpense(tx) && tx.recurrence !== null)
      realCovered.add(`${competenceOf(tx)}|${recurrenceIdentity(tx)}`);

    if (isPendingReceivable(tx) && tx.accountId !== null && reported.has(tx.accountId)) {
      add(tx.date, settledIncomeCents(tx), "receivable", tx.description);
    }

    const due = competenceOf(tx);
    if (isPayableObligation(tx) && !isPaid(tx) && !isRolled(tx) && compareMonths(due, currentMonth) < 0) {
      push(tomorrow, -Math.abs(tx.amountCents), "overdue", tx.description, true);
      continue;
    }
    if (!inWindow(due)) continue;
    if (isUnpaidObligation(tx) && isExpense(tx)) {
      if (tx.source === "card" && tx.cardId !== null) toBill(tx.cardId, due, Math.abs(tx.amountCents));
      else add(tx.date, -Math.abs(tx.amountCents), "obligation", tx.description);
    } else if (isCardCredit(tx)) {
      toBill(tx.cardId, due, -tx.amountCents);
    }
  }

  // ---- the fixed entries still to come, month by month: their cash on its day, their obligations
  // on their date or their fatura. An occurrence already covered by a booked row of the same rule
  // is not counted twice (the same guard as the month-end figure).
  const seen = new Set<string>();
  for (let month = currentMonth; compareMonths(month, throughMonth) <= 0; month = addMonths(month, 1)) {
    for (const occurrence of projectRecurring(transactions, month, competenceOf)) {
      // A fresh instance: it never inherits the anchor's paid / received state.
      const fresh = freshOccurrence(occurrence.source, occurrence.date);
      // An income is forecast as received on its day, into its booked account.
      const moving = isIncome(fresh)
        ? { ...fresh, receivedAt: occurrence.date, receivedAccountId: fresh.accountId }
        : fresh;
      let cash = 0;
      for (const [accountId, delta] of accountDeltas(moving, "general")) {
        if (reported.has(accountId)) cash += delta.cents;
      }
      add(occurrence.date, cash, "recurring", fresh.description);

      if (!isUnpaidObligation(fresh) || !isExpense(fresh)) continue;
      const due = competenceOf(fresh);
      if (!inWindow(due)) continue;
      const key = `${due}|${recurrenceIdentity(fresh)}`;
      if (realCovered.has(key) || seen.has(key)) continue;
      seen.add(key);
      if (fresh.source === "card" && fresh.cardId !== null)
        toBill(fresh.cardId, due, Math.abs(fresh.amountCents));
      else add(occurrence.date, -Math.abs(fresh.amountCents), "obligation", fresh.description);
    }
  }

  // ---- each fatura on its due date.
  const overrides = cardBillOverridesByCard(cardBillDates);
  for (const bill of bills.values()) {
    const card = cardById.get(bill.cardId);
    const dueDay = overrides.get(bill.cardId)?.get(bill.competence)?.dueDay ?? card?.dueDay ?? 1;
    add(
      dateInMonth(bill.competence, dueDay),
      -bill.cents,
      "card-bill",
      card ? `Fatura ${card.bank}` : "Fatura",
    );
  }

  // ---- people: what is outstanding through each month, on its last day. Each month adds only what
  // changed since the one before, so the running sum is exactly the outstanding at that month-end.
  // The ledger is replayed per month on purpose: an advance covers the debts of ITS horizon, so the
  // months' nets of one long replay do not add up to what each month-end really shows.
  let outstandingBefore = 0;
  for (let month = currentMonth; compareMonths(month, throughMonth) <= 0; month = addMonths(month, 1)) {
    const nets =
      input.personNets?.get(month) ??
      computePersonMonthNetsAndSettledCash(people, transactions, settlements, month, competenceOf).nets;
    let outstanding = 0;
    for (const person of people) {
      for (const net of nets.get(person.id)?.values() ?? []) outstanding += net;
    }
    // Nobody promised a date, so it is never late: when today is that last day, it is tomorrow's.
    const lastDay = dateInMonth(month, 31);
    push(
      lastDay < tomorrow ? tomorrow : lastDay,
      outstanding - outstandingBefore,
      "people",
      PEOPLE_LABEL,
      false,
    );
    outstandingBefore = outstanding;
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // ---- day by day, pinned on the month-end figures the caller has.
  const dailyCents: number[] = [];
  const adjustments: ForecastEvent[] = [];
  let running = liveCents;
  let next = 0;
  let date = tomorrow;
  for (let day = daysBetween(tomorrow, horizonEnd); day >= 0; day--) {
    for (let event = events[next]; event !== undefined && event.date <= date; event = events[next]) {
      running += event.deltaCents;
      next += 1;
    }
    const month = monthOf(date);
    const anchor = date === dateInMonth(month, 31) ? input.anchors?.get(month) : undefined;
    if (anchor !== undefined && anchor !== running) {
      adjustments.push({
        date,
        deltaCents: anchor - running,
        kind: "adjustment",
        label: ADJUSTMENT_LABEL,
        late: false,
      });
      running = anchor;
    }
    dailyCents.push(running);
    date = addDays(date, 1);
  }

  const all = adjustments.length === 0 ? events : [...events, ...adjustments];
  if (adjustments.length > 0) all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { liveCents, startDate: tomorrow, dailyCents, events: all };
}
