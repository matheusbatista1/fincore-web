/**
 * month-end-gap.explainer — WHY the dashboard's two "fim do mês" figures differ.
 *
 * The general figure is cash + receivables: the account balances at month-end, minus the bills
 * still due, plus what people owe. The personal figure counts only the user's own slice of
 * everything and leaves people out. For an ordinary shared expense the two AGREE: the general lens
 * pays the other person's share (cash or bill) and gets it back (receivable, then payment), while
 * the personal lens never saw that share. So the gap is never "what people still owe" — it is the
 * sum of the places where that pairing breaks:
 *
 *  - money received with no debt left to cover (an acerto above the debt: the person's credit);
 *  - a debt written off without cash (a "sem conta" acerto);
 *  - a payment still to come, counted as expected cash on top of the debt it will pay;
 *  - a paid fatura whose amount no longer matches its rows (they changed after paying). An estorno
 *    alone opens no gap: it lowers the user's own slice (see `faturaPersonalDebit`);
 *  - a share the ledger charges that no cost in the general lens carries (an old fatura with no
 *    payment record, a forecast in a month the cash projection does not reach), or the reverse.
 *
 * The module replays the SAME calculators the dashboard uses, once per lens, and pairs every
 * entity's lens difference with what the person ledger holds for it. The pairing is exhaustive, so
 * `Σ items === gap`; `unexplainedCents` is measured against the real calculators and stays 0 unless
 * one of them changes without this module following. Pure domain code — no IO.
 */

import type { Account } from "../entities/account";
import type { CardBillPayment } from "../entities/card-bill-payment";
import type { Person } from "../entities/person";
import type { Settlement } from "../entities/settlement";
import {
  type ExpenseTransaction,
  type IncomeTransaction,
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
import { Money } from "../money/money";
import {
  addMonths,
  type CompetenceMonth,
  compareMonths,
  dateInMonth,
  type IsoDate,
} from "../value-objects/competence-month";
import { accountDeltas, balanceEffectiveDate, faturaPersonalDebit } from "./balance.calculator";
import { computeCardBillForMonth } from "./card-bill.calculator";
import {
  computePersonAdvances,
  computePersonBalances,
  computePersonLedger,
  computePersonMonthNetsAndSettledCash,
} from "./person-ledger.calculator";
import type { ViewMode } from "./personal-vs-general";
import { obligationsDueThrough, projectedMonthEndBalances } from "./projected-balance";
import { freshOccurrence, projectRecurring, recurrenceIdentity } from "./recurring.projection";

/** Maps a transaction to its competence month (calendar month, or a card charge's bill month). */
type CompetenceResolver = (tx: Transaction) => CompetenceMonth;

export interface MonthEndGapInput {
  readonly accounts: readonly Account[];
  readonly people: readonly Person[];
  readonly transactions: readonly Transaction[];
  readonly settlements: readonly Settlement[];
  readonly cardBillPayments: readonly CardBillPayment[];
  /** The browsed month whose "fim do mês" is explained. */
  readonly month: CompetenceMonth;
  /** Today's month — where the projection window `[currentMonth, month]` starts. */
  readonly currentMonth: CompetenceMonth;
  readonly competenceOf: CompetenceResolver;
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

/** Why an entity moves the general figure away from the personal one. */
export type GapReason =
  /** An account-backed acerto above what the person owed: cash came in, no debt was left to cover. */
  | "advance"
  /** The mirror: the user paid a person back more than was owed. */
  | "overpaid-person"
  /** An acerto with no (known) account — a baixa/perdão: the receivable shrank, no cash moved. */
  | "writeoff"
  /** An acerto whose cash direction disagrees with the balance it was applied against. */
  | "settlement-direction"
  /** A payment from a person still to come (pending, or a recurring forecast): expected cash AND debt. */
  | "expected-reimbursement"
  /** A received reimbursement that abates nobody's debt. */
  | "unlinked-reimbursement"
  /** Money received from a person that also counts as the user's own income. */
  | "person-income-as-own"
  /** Any other income whose cash and ledger effects do not cancel. */
  | "income-mismatch"
  /** A paid fatura: the others' slice the personal lens discounts differs from the ledger shares. */
  | "paid-bill"
  /** A share the ledger charges with no cost behind it in the general lens. */
  | "share-without-cost"
  /** Others' slice charged to the general lens with no share in the ledger. */
  | "cost-without-share"
  /** Both exist and differ (a shared obligation paid for another amount, a split that does not add up). */
  | "share-cost-mismatch";

interface GapItemBase {
  readonly reason: GapReason;
  /** Signed contribution to `general − personal`. */
  readonly cents: number;
  readonly date: IsoDate;
  readonly description: string;
  readonly personIds: readonly string[];
}

export interface SettlementGapItem extends GapItemBase {
  readonly subject: "settlement";
  readonly settlement: Settlement;
  /** Cash the general lens counted (`> 0` in, `< 0` out, 0 with no known account). */
  readonly cashCents: number;
  /** The clamped delta the ledger applied (`< 0` reduced what they owe). */
  readonly appliedCents: number;
}

export interface IncomeGapItem extends GapItemBase {
  readonly subject: "income";
  readonly transaction: IncomeTransaction;
  /** A recurring forecast (not a booked row). */
  readonly projected: boolean;
  /** Cash the general lens counts and the personal one does not. */
  readonly cashCents: number;
  /** What the ledger abated for it (`≤ 0`). */
  readonly ledgerCents: number;
}

export interface ExpenseGapItem extends GapItemBase {
  readonly subject: "expense";
  readonly transaction: ExpenseTransaction;
  /** A recurring forecast (not a booked row). */
  readonly projected: boolean;
  readonly competence: CompetenceMonth;
  /** Others' slice the general lens is charged beyond the personal one. */
  readonly costCents: number;
  /** Shares the ledger charges for it. */
  readonly ledgerCents: number;
}

export interface BillGapItem extends GapItemBase {
  readonly subject: "bill";
  readonly cardId: string;
  readonly competence: CompetenceMonth;
  /** The amount snapshotted when the fatura was paid. */
  readonly paidCents: number;
  /** What the bill's charges add up to today. */
  readonly chargesCents: number;
  /** The user's own slice of those charges. */
  readonly mineCents: number;
  /** Card credits (estornos) bucketed into the bill. */
  readonly creditsCents: number;
  /** Others' slice the personal lens leaves out: the payment minus the user's own slice of it. */
  readonly costCents: number;
  /** Shares the ledger charges for the bill's rows (0 while the bill lies beyond `month`). */
  readonly ledgerCents: number;
  /** False when the paying account no longer exists (the payment then debits nothing). */
  readonly accountKnown: boolean;
}

export type MonthEndGapItem = SettlementGapItem | IncomeGapItem | ExpenseGapItem | BillGapItem;

/** A person's ledger through `month`, for context next to the items. */
export interface PersonGapSummary {
  readonly personId: string;
  /** Σ shares charged (incl. forecasts). */
  readonly sharesCents: number;
  /** Σ received payments booked as income, as a positive figure. */
  readonly paymentsCents: number;
  /** Σ what acertos abated, as a positive figure (negative when they reduced what the user owed). */
  readonly settledCents: number;
  /** The clamped balance (`> 0` they owe). */
  readonly balanceCents: number;
  /** Money parked by acertos above the debt (`> 0` theirs with the user). */
  readonly advanceCents: number;
}

export interface MonthEndGapReport {
  readonly month: CompetenceMonth;
  readonly general: MonthEndFigure;
  readonly personal: MonthEndFigure;
  /** `general.totalCents − personal.totalCents`. */
  readonly gapCents: number;
  /** Every entity that moves the gap, largest first. An ordinary shared expense is not here. */
  readonly items: MonthEndGapItem[];
  readonly explainedCents: number;
  /** `gapCents − explainedCents`: 0 unless a calculator changed without this module following. */
  readonly unexplainedCents: number;
  readonly people: PersonGapSummary[];
}

interface ExpenseTally {
  readonly tx: ExpenseTransaction;
  readonly projected: boolean;
  cost: number;
  ledger: number;
  readonly persons: Set<string>;
}

interface IncomeTally {
  readonly tx: IncomeTransaction;
  readonly projected: boolean;
  cash: number;
  ledger: number;
  expected: boolean;
}

interface BillTally {
  readonly cardId: string;
  readonly competence: CompetenceMonth;
  date: IsoDate;
  paid: number;
  cost: number;
  ledger: number;
  charges: number;
  mine: number;
  credits: number;
  accountKnown: boolean;
  readonly persons: Set<string>;
}

const sumCents = (balances: Map<string, Money>): number => {
  let total = 0;
  for (const value of balances.values()) total += value.cents;
  return total;
};

const billKey = (cardId: string, competence: CompetenceMonth): string => `${cardId}|${competence}`;
const occurrenceKey = (id: string, date: IsoDate): string => `${id}|${date}`;

/**
 * Explain `general − personal` for the "fim do mês" of `month`, entity by entity (see the module
 * doc). The two figures are computed with the dashboard's own formulas, so they equal what the
 * hero shows for the same data.
 */
export function explainMonthEndGap(input: MonthEndGapInput): MonthEndGapReport {
  const { accounts, people, transactions, settlements, cardBillPayments, month, currentMonth, competenceOf } =
    input;
  const monthEnd = dateInMonth(month, 31);
  // The projection window `[currentMonth, month]` exists only from the current month onward.
  const projects = compareMonths(currentMonth, month) <= 0;
  const knownAccounts = new Set(accounts.map((a) => a.id));
  const knownPeople = new Set(people.map((p) => p.id));

  // ------------------------------------------------ the two figures (the dashboard's formulas)
  let overdueGeneral = 0;
  let overduePersonal = 0;
  const overdueRows: ExpenseTransaction[] = [];
  if (projects) {
    for (const tx of transactions) {
      if (!isPayableObligation(tx) || isPaid(tx) || isRolled(tx)) continue;
      if (compareMonths(competenceOf(tx), currentMonth) >= 0) continue;
      overdueGeneral += Math.abs(tx.amountCents);
      overduePersonal += tx.myShareCents;
      overdueRows.push(tx);
    }
  }
  const { nets } = computePersonMonthNetsAndSettledCash(
    people,
    transactions,
    settlements,
    month,
    competenceOf,
  );
  let peopleCents = 0;
  for (const person of people) {
    for (const net of (nets.get(person.id) ?? new Map<CompetenceMonth, number>()).values()) {
      peopleCents += net;
    }
  }
  const figure = (lens: ViewMode): MonthEndFigure => {
    const accountsCents = sumCents(
      projectedMonthEndBalances(
        accounts,
        transactions,
        month,
        competenceOf,
        currentMonth,
        lens,
        settlements,
        cardBillPayments,
      ),
    );
    const obligationsCents = obligationsDueThrough(
      transactions,
      currentMonth,
      month,
      competenceOf,
      lens,
      currentMonth,
      cardBillPayments,
    ).cents;
    const overdueCents = lens === "general" ? overdueGeneral : overduePersonal;
    const people = lens === "general" ? peopleCents : 0;
    return {
      accountsCents,
      obligationsCents,
      overdueCents,
      peopleCents: people,
      totalCents: accountsCents - obligationsCents - overdueCents + people,
    };
  };
  const general = figure("general");
  const personal = figure("personal");
  const gapCents = general.totalCents - personal.totalCents;

  // ------------------------------------------------------------------ per-entity tallies
  const realExpenses = new Map<Transaction, ExpenseTally>();
  const projectedExpenses = new Map<string, ExpenseTally>();
  const realIncomes = new Map<Transaction, IncomeTally>();
  const projectedIncomes = new Map<string, IncomeTally>();
  const settlementTallies = new Map<Settlement, { cash: number; ledger: number }>();
  const bills = new Map<string, BillTally>();

  const expenseTally = (tx: ExpenseTransaction): ExpenseTally => {
    let tally = realExpenses.get(tx);
    if (!tally) {
      tally = { tx, projected: false, cost: 0, ledger: 0, persons: new Set() };
      realExpenses.set(tx, tally);
    }
    return tally;
  };
  const occurrenceTally = (tx: ExpenseTransaction): ExpenseTally => {
    const key = occurrenceKey(tx.id, tx.date);
    let tally = projectedExpenses.get(key);
    if (!tally) {
      tally = { tx, projected: true, cost: 0, ledger: 0, persons: new Set() };
      projectedExpenses.set(key, tally);
    }
    return tally;
  };
  const incomeTally = (tx: IncomeTransaction): IncomeTally => {
    let tally = realIncomes.get(tx);
    if (!tally) {
      tally = { tx, projected: false, cash: 0, ledger: 0, expected: false };
      realIncomes.set(tx, tally);
    }
    return tally;
  };
  const settlementTally = (s: Settlement): { cash: number; ledger: number } => {
    let tally = settlementTallies.get(s);
    if (!tally) {
      tally = { cash: 0, ledger: 0 };
      settlementTallies.set(s, tally);
    }
    return tally;
  };

  /** What a row moves in the known accounts through the general lens beyond the personal one. */
  const lensCashDiff = (tx: Transaction): number => {
    let diff = 0;
    for (const [accountId, delta] of accountDeltas(tx, "general")) {
      if (knownAccounts.has(accountId)) diff += delta.cents;
    }
    for (const [accountId, delta] of accountDeltas(tx, "personal")) {
      if (knownAccounts.has(accountId)) diff -= delta.cents;
    }
    return diff;
  };

  // 1. Real account movements through month-end (computeAccountBalances).
  for (const tx of transactions) {
    if (balanceEffectiveDate(tx) > monthEnd) continue;
    const diff = lensCashDiff(tx);
    if (diff === 0) continue;
    if (isExpense(tx)) expenseTally(tx).cost -= diff;
    else if (isIncome(tx)) incomeTally(tx).cash += diff;
  }

  // 2. Acertos that name an account: cash in the general lens only, by the same direction rule.
  const rawBalances = computePersonBalances([], transactions, []);
  for (const s of settlements) {
    if (s.accountId === null || s.date > monthEnd || !knownAccounts.has(s.accountId)) continue;
    const owedToYou = !(rawBalances.get(s.personId) ?? Money.zero()).isNegative();
    settlementTally(s).cash += owedToYou ? s.amountCents : -s.amountCents;
  }

  // 3. Paid faturas: the general lens debits the whole payment, the personal one its prorated slice.
  for (const payment of cardBillPayments) {
    if (payment.date > monthEnd) continue;
    const key = billKey(payment.cardId, payment.competence);
    let bill = bills.get(key);
    if (!bill) {
      bill = {
        cardId: payment.cardId,
        competence: payment.competence,
        date: payment.date,
        paid: 0,
        cost: 0,
        ledger: 0,
        charges: 0,
        mine: 0,
        credits: 0,
        accountKnown: true,
        persons: new Set(),
      };
      bills.set(key, bill);
    }
    bill.paid += payment.amountCents;
    if (knownAccounts.has(payment.accountId)) {
      bill.cost += payment.amountCents - faturaPersonalDebit(payment, transactions, competenceOf).cents;
    } else {
      bill.accountKnown = false;
    }
  }

  // 4. Recurring occurrences forecast into the accounts (projectedMonthEndBalances).
  if (projects) {
    for (let m = currentMonth; compareMonths(m, month) <= 0; m = addMonths(m, 1)) {
      for (const occurrence of projectRecurring(transactions, m, competenceOf)) {
        const fresh = freshOccurrence(occurrence.source, occurrence.date);
        if (isIncome(fresh)) {
          const forecast = { ...fresh, receivedAt: occurrence.date, receivedAccountId: fresh.accountId };
          const diff = lensCashDiff(forecast);
          if (diff === 0) continue;
          projectedIncomes.set(occurrenceKey(fresh.id, fresh.date), {
            tx: fresh,
            projected: true,
            cash: diff,
            ledger: 0,
            expected: true,
          });
        } else if (isExpense(fresh)) {
          const diff = lensCashDiff(fresh);
          if (diff !== 0) occurrenceTally(fresh).cost -= diff;
        }
      }
    }
  }

  // 5. Pending receivables forecast as cash (the personal lens drops the reimbursements).
  for (const tx of transactions) {
    if (!isPendingReceivable(tx) || !tx.isReimbursement) continue;
    if (tx.accountId === null || tx.date > monthEnd || !knownAccounts.has(tx.accountId)) continue;
    const tally = incomeTally(tx);
    tally.cash += settledIncomeCents(tx);
    tally.expected = true;
  }

  // 6. Deferred obligations due in the window (obligationsDueThrough) and 7. the overdue ones.
  if (projects) {
    const landed = new Set<string>();
    for (const payment of cardBillPayments) {
      if (payment.date <= monthEnd) landed.add(billKey(payment.cardId, payment.competence));
    }
    const onPaidBill = (tx: Transaction, due: CompetenceMonth): boolean =>
      (isExpense(tx) || isCardCredit(tx)) && tx.cardId !== null && landed.has(billKey(tx.cardId, due));
    const isObligation = (tx: Transaction): tx is ExpenseTransaction =>
      isExpense(tx) &&
      tx.source !== "account" &&
      tx.source !== "overdraft" &&
      !isRolled(tx) &&
      !(tx.paidAt != null && tx.paidAt <= monthEnd);
    const inWindow = (due: CompetenceMonth): boolean =>
      compareMonths(due, currentMonth) >= 0 && compareMonths(due, month) <= 0;

    const realCovered = new Set<string>();
    for (const tx of transactions) {
      if (isExpense(tx) && tx.recurrence !== null) {
        realCovered.add(`${competenceOf(tx)}|${recurrenceIdentity(tx)}`);
      }
      const due = competenceOf(tx);
      if (!inWindow(due) || onPaidBill(tx, due) || !isObligation(tx)) continue;
      expenseTally(tx).cost += Math.abs(tx.amountCents) - tx.myShareCents;
    }
    const seen = new Set<string>();
    for (let m = currentMonth; compareMonths(m, month) <= 0; m = addMonths(m, 1)) {
      for (const occurrence of projectRecurring(transactions, m, competenceOf)) {
        const source = freshOccurrence(occurrence.source, occurrence.date);
        if (!isObligation(source)) continue;
        const due = competenceOf(source);
        if (!inWindow(due) || onPaidBill(source, due)) continue;
        const key = `${due}|${recurrenceIdentity(source)}`;
        if (realCovered.has(key) || seen.has(key)) continue;
        seen.add(key);
        occurrenceTally(source).cost += Math.abs(source.amountCents) - source.myShareCents;
      }
    }
    for (const tx of overdueRows) {
      expenseTally(tx).cost += Math.abs(tx.amountCents) - tx.myShareCents;
    }
  }

  // 8. The person ledger through `month` — what the general lens adds for people.
  const ledger = computePersonLedger(people, transactions, settlements, month, competenceOf);
  const realRows = new Set<Transaction>(transactions);
  const shares = new Map<string, number>();
  const payments = new Map<string, number>();
  const settled = new Map<string, number>();
  const bump = (map: Map<string, number>, personId: string, cents: number): void => {
    map.set(personId, (map.get(personId) ?? 0) + cents);
  };
  for (const mv of ledger.movements) {
    if (!knownPeople.has(mv.personId)) continue;
    if (mv.source.type === "settlement") {
      settlementTally(mv.source.settlement).ledger += mv.signedDeltaCents;
      bump(settled, mv.personId, -mv.signedDeltaCents);
    } else if (mv.source.type === "payment") {
      // The ledger only emits a payment for a booked, received income.
      incomeTally(mv.source.tx as IncomeTransaction).ledger += mv.signedDeltaCents;
      bump(payments, mv.personId, -mv.signedDeltaCents);
    } else {
      // A share always comes from an expense: a booked row, or a forecast (a fresh instance).
      const tx = mv.source.tx as ExpenseTransaction;
      const tally = realRows.has(tx) ? expenseTally(tx) : occurrenceTally(tx);
      tally.ledger += mv.signedDeltaCents;
      tally.persons.add(mv.personId);
      bump(shares, mv.personId, mv.signedDeltaCents);
    }
  }

  // A charge on a paid fatura is carried by the payment, not by the row: fold it into its bill.
  for (const tx of transactions) {
    if (isIncome(tx) && tx.cardId !== null) {
      const bill = bills.get(billKey(tx.cardId, competenceOf(tx)));
      if (bill) bill.credits += tx.amountCents;
      continue;
    }
    if (!isExpense(tx) || tx.source !== "card" || tx.cardId === null || isRolled(tx)) continue;
    const bill = bills.get(billKey(tx.cardId, competenceOf(tx)));
    if (!bill) continue;
    bill.charges += Math.abs(tx.amountCents);
    bill.mine += tx.myShareCents;
    const tally = realExpenses.get(tx);
    if (!tally) continue;
    bill.ledger += tally.ledger;
    bill.cost += tally.cost;
    for (const personId of tally.persons) bill.persons.add(personId);
    realExpenses.delete(tx);
  }

  // ------------------------------------------------------------------------------ items
  const items: MonthEndGapItem[] = [];
  for (const bill of bills.values()) {
    const cents = bill.ledger - bill.cost;
    if (cents === 0) continue;
    items.push({
      subject: "bill",
      reason: "paid-bill",
      cents,
      date: bill.date,
      description: "",
      personIds: [...bill.persons],
      cardId: bill.cardId,
      competence: bill.competence,
      paidCents: bill.paid,
      chargesCents: bill.charges,
      mineCents: bill.mine,
      creditsCents: bill.credits,
      costCents: bill.cost,
      ledgerCents: bill.ledger,
      accountKnown: bill.accountKnown,
    });
  }
  for (const tally of [...realExpenses.values(), ...projectedExpenses.values()]) {
    const cents = tally.ledger - tally.cost;
    if (cents === 0) continue;
    items.push({
      subject: "expense",
      reason:
        tally.cost === 0
          ? "share-without-cost"
          : tally.ledger === 0
            ? "cost-without-share"
            : "share-cost-mismatch",
      cents,
      date: tally.tx.date,
      description: tally.tx.description,
      personIds: [...tally.persons],
      transaction: tally.tx,
      projected: tally.projected,
      competence: competenceOf(tally.tx),
      costCents: tally.cost,
      ledgerCents: tally.ledger,
    });
  }
  for (const tally of [...realIncomes.values(), ...projectedIncomes.values()]) {
    const cents = tally.cash + tally.ledger;
    if (cents === 0) continue;
    const reason: GapReason =
      tally.cash > 0 && tally.ledger === 0
        ? tally.expected
          ? "expected-reimbursement"
          : "unlinked-reimbursement"
        : tally.cash === 0 && !tally.tx.isReimbursement
          ? "person-income-as-own"
          : "income-mismatch";
    items.push({
      subject: "income",
      reason,
      cents,
      date: tally.tx.date,
      description: tally.tx.description,
      personIds: tally.tx.fromPersonId === null ? [] : [tally.tx.fromPersonId],
      transaction: tally.tx,
      projected: tally.projected,
      cashCents: tally.cash,
      ledgerCents: tally.ledger,
    });
  }
  for (const [settlement, tally] of settlementTallies) {
    const cents = tally.cash + tally.ledger;
    if (cents === 0) continue;
    const reason: GapReason =
      tally.cash === 0
        ? "writeoff"
        : tally.cash > 0 && tally.ledger <= 0
          ? "advance"
          : tally.cash < 0 && tally.ledger >= 0
            ? "overpaid-person"
            : "settlement-direction";
    items.push({
      subject: "settlement",
      reason,
      cents,
      date: settlement.date,
      description: settlement.note ?? "",
      personIds: [settlement.personId],
      settlement,
      cashCents: tally.cash,
      appliedCents: tally.ledger,
    });
  }
  items.sort(
    (a, b) => Math.abs(b.cents) - Math.abs(a.cents) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
  );

  const explainedCents = items.reduce((total, item) => total + item.cents, 0);
  const advances = computePersonAdvances(people, ledger.movements);
  return {
    month,
    general,
    personal,
    gapCents,
    items,
    explainedCents,
    unexplainedCents: gapCents - explainedCents,
    people: people.map((person) => ({
      personId: person.id,
      sharesCents: shares.get(person.id) ?? 0,
      paymentsCents: payments.get(person.id) ?? 0,
      settledCents: settled.get(person.id) ?? 0,
      balanceCents: ledger.balances.get(person.id)?.cents ?? 0,
      advanceCents: advances.get(person.id) ?? 0,
    })),
  };
}

/** A paid fatura whose snapshot no longer matches what its rows add up to. */
export interface PaidBillDrift {
  readonly payment: CardBillPayment;
  /** The bill recomputed today from its charges and credits. */
  readonly currentBillCents: number;
  /** `paid − current`: `> 0` the account was debited MORE than the rows say, `< 0` less. */
  readonly driftCents: number;
}

/**
 * Paid faturas whose amount differs from the bill as its rows stand today. Paying a fatura
 * snapshots the total the app computed at that moment and debits the account by it; the amount is
 * never typed and never follows later edits. So a charge added, removed or corrected after paying —
 * or a bill the bank charged for another value — leaves the account balance off by exactly this
 * drift, even with every row correct. Latest payment first.
 */
export function findPaidBillDrifts(
  cardBillPayments: readonly CardBillPayment[],
  transactions: readonly Transaction[],
  competenceOf: CompetenceResolver,
): PaidBillDrift[] {
  const drifts: PaidBillDrift[] = [];
  for (const payment of cardBillPayments) {
    const current = computeCardBillForMonth(payment.cardId, transactions, payment.competence, competenceOf);
    if (current.cents === payment.amountCents) continue;
    drifts.push({
      payment,
      currentBillCents: current.cents,
      driftCents: payment.amountCents - current.cents,
    });
  }
  return drifts.sort((a, b) =>
    a.payment.date < b.payment.date ? 1 : a.payment.date > b.payment.date ? -1 : 0,
  );
}
