import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Account } from "../entities/account";
import type { CardBillPayment } from "../entities/card-bill-payment";
import type { CreditCard } from "../entities/credit-card";
import type { Person } from "../entities/person";
import type { Settlement } from "../entities/settlement";
import type { ExpenseTransaction, IncomeTransaction, Transaction } from "../entities/transaction";
import { billingCompetence } from "./card-bill.calculator";
import { explainMonthEndGap, findPaidBillDrifts, type MonthEndGapInput } from "./month-end-gap.explainer";

const account: Account = {
  id: "acc-1",
  bank: "Nu",
  name: "Conta",
  type: "PF",
  themeKey: "",
  openingBalanceCents: 100_000,
  maskedNumber: "",
  isReserve: false,
};

// Closes 24, due 2: a charge on May 20 is due on June 2 (competence June); on June 10, July.
const card: CreditCard = {
  id: "card-1",
  bank: "C6",
  product: "Carbon",
  flag: "visa",
  themeKey: "",
  maskedNumber: "",
  limitCents: 500_000,
  closingDay: 24,
  dueDay: 2,
};

const ana: Person = { id: "ana", name: "Ana", relationship: "Amiga", color: "#000000" };
const bia: Person = { id: "bia", name: "Bia", relationship: "Amiga", color: "#000000" };
const competenceOf = billingCompetence([card]);

let seq = 0;
const expense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: `e${seq++}`,
  kind: "expense",
  description: "Despesa",
  date: "2026-06-05",
  amountCents: -10_000,
  categoryId: null,
  source: "account",
  cardId: null,
  accountId: "acc-1",
  linkedAccountId: null,
  splits: [],
  myShareCents: 10_000,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  ...over,
});
/** An account expense of `total` where Ana owes `share` and the rest is the user's. */
const shared = (total: number, share: number, over: Partial<ExpenseTransaction> = {}): ExpenseTransaction =>
  expense({
    amountCents: -total,
    myShareCents: total - share,
    splits: share > 0 ? [{ personId: "ana", shareCents: share }] : [],
    ...over,
  });
/** The same on the card. */
const charge = (
  total: number,
  share: number,
  date: string,
  over: Partial<ExpenseTransaction> = {},
): ExpenseTransaction =>
  shared(total, share, { source: "card", cardId: "card-1", accountId: null, date, ...over });
const income = (over: Partial<IncomeTransaction> = {}): IncomeTransaction => ({
  id: `i${seq++}`,
  kind: "income",
  description: "Receita",
  date: "2026-06-10",
  amountCents: 10_000,
  accountId: "acc-1",
  cardId: null,
  fromPersonId: null,
  isReimbursement: false,
  recurrence: null,
  ...over,
});
/** A payment booked as income from Ana (a reimbursement). */
const fromAna = (over: Partial<IncomeTransaction> = {}): IncomeTransaction =>
  income({ fromPersonId: "ana", isReimbursement: true, ...over });
const acerto = (over: Partial<Settlement> = {}): Settlement => ({
  id: `s${seq++}`,
  personId: "ana",
  amountCents: 6_000,
  date: "2026-06-15",
  accountId: "acc-1",
  ...over,
});
const paidBill = (over: Partial<CardBillPayment> = {}): CardBillPayment => ({
  id: `p${seq++}`,
  cardId: "card-1",
  competence: "2026-06",
  amountCents: 10_000,
  accountId: "acc-1",
  date: "2026-06-02",
  ...over,
});

const explain = (transactions: Transaction[], extra: Partial<MonthEndGapInput> = {}) =>
  explainMonthEndGap({
    accounts: [account],
    people: [ana, bia],
    transactions,
    settlements: [],
    cardBillPayments: [],
    month: "2026-06",
    currentMonth: "2026-06",
    competenceOf,
    ...extra,
  });

describe("explainMonthEndGap — an ordinary shared expense opens no gap", () => {
  it("an account expense split with a person: the general lens pays her share and holds it as receivable", () => {
    const r = explain([shared(10_000, 6_000)]);
    expect(r.general).toEqual({
      accountsCents: 90_000,
      obligationsCents: 0,
      overdueCents: 0,
      peopleCents: 6_000,
      totalCents: 96_000,
    });
    expect(r.personal).toEqual({
      accountsCents: 96_000,
      obligationsCents: 0,
      overdueCents: 0,
      peopleCents: 0,
      totalCents: 96_000,
    });
    expect(r.gapCents).toBe(0);
    expect(r.items).toEqual([]);
    expect(r.unexplainedCents).toBe(0);
  });

  it("a shared card charge on a bill still to be paid", () => {
    const r = explain([charge(10_000, 6_000, "2026-05-20")]);
    expect(r.general.obligationsCents).toBe(10_000);
    expect(r.personal.obligationsCents).toBe(4_000);
    expect(r.general.totalCents).toBe(96_000);
    expect(r.gapCents).toBe(0);
    expect(r.items).toEqual([]);
  });

  it("…once she pays it back, and once the bill is paid for exactly its charges", () => {
    const repaid = explain([shared(10_000, 6_000)], { settlements: [acerto()] });
    expect(repaid.general.totalCents).toBe(96_000);
    expect(repaid.items).toEqual([]);

    const billPaid = explain([charge(10_000, 6_000, "2026-05-20")], { cardBillPayments: [paidBill()] });
    expect(billPaid.general).toMatchObject({
      accountsCents: 90_000,
      obligationsCents: 0,
      peopleCents: 6_000,
    });
    expect(billPaid.personal.accountsCents).toBe(96_000);
    expect(billPaid.items).toEqual([]);
  });

  it("an overdue shared boleto and a recurring shared expense forecast for the month", () => {
    const overdue = explain([
      expense({
        source: "boleto",
        accountId: null,
        date: "2026-05-10",
        amountCents: -8_000,
        myShareCents: 3_000,
        splits: [{ personId: "ana", shareCents: 5_000 }],
      }),
    ]);
    expect(overdue.general).toMatchObject({ overdueCents: 8_000, peopleCents: 5_000, totalCents: 97_000 });
    expect(overdue.personal).toMatchObject({ overdueCents: 3_000, totalCents: 97_000 });
    expect(overdue.items).toEqual([]);

    const recurring = explain([
      shared(10_000, 6_000, { date: "2026-05-10", recurrence: { dayOfMonth: 10 } }),
    ]);
    // May (booked) + June (forecast): −200,00 in cash, +120,00 receivable; personally −80,00.
    expect(recurring.general).toMatchObject({
      accountsCents: 80_000,
      peopleCents: 12_000,
      totalCents: 92_000,
    });
    expect(recurring.personal.totalCents).toBe(92_000);
    expect(recurring.items).toEqual([]);
  });
});

describe("explainMonthEndGap — acertos", () => {
  it("an acerto above the debt: the excess is cash the personal lens does not have (her credit)", () => {
    const paid = acerto({ amountCents: 60_000 });
    const r = explain([shared(59_640, 59_640)], { settlements: [paid] });
    expect(r.general.totalCents).toBe(100_360);
    expect(r.personal.totalCents).toBe(100_000);
    expect(r.gapCents).toBe(360);
    expect(r.items).toEqual([
      {
        subject: "settlement",
        reason: "advance",
        cents: 360,
        date: "2026-06-15",
        description: "",
        personIds: ["ana"],
        settlement: paid,
        cashCents: 60_000,
        appliedCents: -59_640,
      },
    ]);
    expect(r.explainedCents).toBe(360);
    expect(r.unexplainedCents).toBe(0);
    expect(r.people).toEqual([
      {
        personId: "ana",
        sharesCents: 59_640,
        paymentsCents: 0,
        settledCents: 59_640,
        balanceCents: 0,
        advanceCents: 360,
      },
      {
        personId: "bia",
        sharesCents: 0,
        paymentsCents: 0,
        settledCents: 0,
        balanceCents: 0,
        advanceCents: 0,
      },
    ]);
  });

  it("a 'sem conta' acerto forgives the debt without cash: the general lens loses the receivable", () => {
    const r = explain([shared(10_000, 6_000)], {
      settlements: [acerto({ accountId: null, note: "Perdão" })],
    });
    expect(r.gapCents).toBe(-6_000);
    expect(r.items).toMatchObject([
      { subject: "settlement", reason: "writeoff", cents: -6_000, cashCents: 0, appliedCents: -6_000 },
    ]);
    expect(r.items[0]?.description).toBe("Perdão");
  });

  it("paying a person back more than was owed parks the user's money with them", () => {
    // She paid 100,00 with nothing behind it (the user owes her); he pays 150,00 back.
    const r = explain([fromAna()], { settlements: [acerto({ amountCents: 15_000 })] });
    expect(r.gapCents).toBe(-5_000);
    expect(r.items).toMatchObject([
      {
        subject: "settlement",
        reason: "overpaid-person",
        cents: -5_000,
        cashCents: -15_000,
        appliedCents: 10_000,
      },
    ]);
  });

  it("flags an acerto whose cash direction disagrees with the balance it hit", () => {
    // Through June the user owes her (her payment came before her July share); all-time she owes.
    // The account rule reads the all-time sign (cash IN), the ledger reduced what HE owed.
    const r = explain([fromAna(), shared(20_000, 20_000, { date: "2026-07-05" })], {
      settlements: [acerto({ amountCents: 5_000, date: "2026-06-20" })],
    });
    expect(r.gapCents).toBe(10_000);
    expect(r.items).toMatchObject([
      {
        subject: "settlement",
        reason: "settlement-direction",
        cents: 10_000,
        cashCents: 5_000,
        appliedCents: 5_000,
      },
    ]);
  });

  it("counts the cash of an acerto from someone who is no longer among the people", () => {
    const r = explain([], { settlements: [acerto({ personId: "zed", amountCents: 5_000 })] });
    expect(r.gapCents).toBe(5_000);
    expect(r.items).toMatchObject([{ reason: "advance", cents: 5_000, personIds: ["zed"], appliedCents: 0 }]);
  });
});

describe("explainMonthEndGap — payments booked as income", () => {
  it("a payment still to be received counts as expected cash on top of the debt it pays", () => {
    const pending = fromAna({ amountCents: 6_000, date: "2026-06-25", receivedAt: null });
    const r = explain([shared(10_000, 6_000), pending]);
    expect(r.general).toMatchObject({ accountsCents: 96_000, peopleCents: 6_000, totalCents: 102_000 });
    expect(r.gapCents).toBe(6_000);
    expect(r.items).toEqual([
      {
        subject: "income",
        reason: "expected-reimbursement",
        cents: 6_000,
        date: "2026-06-25",
        description: "Receita",
        personIds: ["ana"],
        transaction: pending,
        projected: false,
        cashCents: 6_000,
        ledgerCents: 0,
      },
    ]);
  });

  it("the same for a recurring payment forecast for the month", () => {
    const r = explain([fromAna({ date: "2026-05-20", recurrence: { dayOfMonth: 20 } })]);
    // May: received (cash +, ledger −). June: forecast as cash, with nothing in the ledger.
    expect(r.gapCents).toBe(10_000);
    expect(r.items).toMatchObject([
      {
        subject: "income",
        reason: "expected-reimbursement",
        cents: 10_000,
        date: "2026-06-20",
        projected: true,
      },
    ]);
  });

  it("a received reimbursement that abates nobody", () => {
    const r = explain([income({ isReimbursement: true })]);
    expect(r.gapCents).toBe(10_000);
    expect(r.items).toMatchObject([{ reason: "unlinked-reimbursement", cents: 10_000, personIds: [] }]);
  });

  it("money from a person that also counts as the user's own income", () => {
    const r = explain([shared(10_000, 10_000), income({ fromPersonId: "ana" })]);
    expect(r.general.totalCents).toBe(100_000);
    expect(r.personal.totalCents).toBe(110_000);
    expect(r.items).toMatchObject([
      {
        subject: "income",
        reason: "person-income-as-own",
        cents: -10_000,
        cashCents: 0,
        ledgerCents: -10_000,
      },
    ]);
  });

  it("a reimbursement that landed in an account that no longer exists", () => {
    const r = explain([shared(10_000, 10_000), fromAna({ accountId: "ghost" })]);
    expect(r.gapCents).toBe(-10_000);
    expect(r.items).toMatchObject([{ subject: "income", reason: "income-mismatch", cents: -10_000 }]);
  });
});

describe("explainMonthEndGap — paid faturas", () => {
  const mine = () => charge(10_000, 0, "2026-05-10");
  const hers = () => charge(30_000, 30_000, "2026-05-12");

  const estorno = () => income({ accountId: null, cardId: "card-1", amountCents: 4_000, date: "2026-05-15" });

  it("an estorno alone opens no gap: it lowers the user's own slice, the others owe in full", () => {
    const r = explain([mine(), hers(), estorno()], { cardBillPayments: [paidBill({ amountCents: 36_000 })] });
    // General: −360,00 + 300,00 she owes. Personal: 100,00 − 40,00 = −60,00.
    expect(r.general.totalCents).toBe(94_000);
    expect(r.personal.totalCents).toBe(94_000);
    expect(r.gapCents).toBe(0);
    expect(r.items).toEqual([]);
  });

  it("an estorno on a fatura paid for another amount: the item carries the credits", () => {
    // The R$ 360,00 bill was paid for R$ 350,00: the personal slice is 350 × 60 / 360 = 58,33.
    const r = explain([mine(), hers(), estorno()], { cardBillPayments: [paidBill({ amountCents: 35_000 })] });
    expect(r.general.totalCents).toBe(95_000);
    expect(r.personal.totalCents).toBe(94_167);
    expect(r.items).toEqual([
      {
        subject: "bill",
        reason: "paid-bill",
        cents: 833,
        date: "2026-06-02",
        description: "",
        personIds: ["ana"],
        cardId: "card-1",
        competence: "2026-06",
        paidCents: 35_000,
        chargesCents: 40_000,
        mineCents: 10_000,
        creditsCents: 4_000,
        costCents: 29_167,
        ledgerCents: 30_000,
        accountKnown: true,
      },
    ]);
    expect(r.unexplainedCents).toBe(0);
  });

  it("a charge added after the fatura was paid: the snapshot no longer matches the rows", () => {
    const txs = [mine(), hers()];
    const payments = [paidBill({ amountCents: 30_000 })];
    const r = explain(txs, { cardBillPayments: payments });
    expect(r.gapCents).toBe(7_500);
    expect(r.items).toMatchObject([
      { subject: "bill", cents: 7_500, paidCents: 30_000, chargesCents: 40_000, costCents: 22_500 },
    ]);
    expect(findPaidBillDrifts(payments, txs, competenceOf)).toEqual([
      { payment: payments[0], currentBillCents: 40_000, driftCents: -10_000 },
    ]);
  });

  it("a fatura paid before its month: her share is not a receivable of this month yet", () => {
    const r = explain([charge(10_000, 8_000, "2026-06-10")], {
      cardBillPayments: [paidBill({ competence: "2026-07", date: "2026-06-20" })],
    });
    expect(r.gapCents).toBe(-8_000);
    expect(r.items).toMatchObject([
      { subject: "bill", competence: "2026-07", cents: -8_000, costCents: 8_000, ledgerCents: 0 },
    ]);
  });

  it("a fatura paid from an account that no longer exists debits nothing", () => {
    const r = explain([charge(10_000, 6_000, "2026-05-20")], {
      cardBillPayments: [paidBill({ accountId: "ghost" })],
    });
    expect(r.gapCents).toBe(6_000);
    expect(r.items).toMatchObject([{ subject: "bill", cents: 6_000, costCents: 0, accountKnown: false }]);
  });

  it("an old fatura with no payment record: nothing was ever debited for her share", () => {
    const old = charge(5_000, 5_000, "2026-04-10"); // due May 2: before the current month
    const r = explain([old]);
    expect(r.gapCents).toBe(5_000);
    expect(r.items).toEqual([
      {
        subject: "expense",
        reason: "share-without-cost",
        cents: 5_000,
        date: "2026-04-10",
        description: "Despesa",
        personIds: ["ana"],
        transaction: old,
        projected: false,
        competence: "2026-05",
        costCents: 0,
        ledgerCents: 5_000,
      },
    ]);
  });
});

describe("explainMonthEndGap — shares and costs that do not pair", () => {
  it("a shared boleto paid with a discount opens no gap: the discount is the user's in both lenses", () => {
    const r = explain([
      expense({
        source: "boleto",
        accountId: null,
        amountCents: -20_000,
        myShareCents: 10_000,
        splits: [{ personId: "ana", shareCents: 10_000 }],
        paidAt: "2026-06-05",
        paidAccountId: "acc-1",
        paidAmountCents: 18_000,
      }),
    ]);
    // General: −180,00 + 100,00 she owes. Personal: 180,00 − 100,00 = −80,00.
    expect(r.general.totalCents).toBe(92_000);
    expect(r.personal.totalCents).toBe(92_000);
    expect(r.items).toEqual([]);
  });

  it("a share split with someone who is no longer among the people", () => {
    // Ana owes R$ 40,00 and Zed (removed) R$ 20,00: the general lens paid for both, the ledger
    // only charges Ana.
    const r = explain([
      expense({
        amountCents: -10_000,
        myShareCents: 4_000,
        splits: [
          { personId: "ana", shareCents: 4_000 },
          { personId: "zed", shareCents: 2_000 },
        ],
      }),
    ]);
    expect(r.gapCents).toBe(-2_000);
    expect(r.items).toMatchObject([
      {
        subject: "expense",
        reason: "share-cost-mismatch",
        cents: -2_000,
        costCents: 6_000,
        ledgerCents: 4_000,
        personIds: ["ana"],
      },
    ]);
  });

  it("an expense whose own share is below the total with nobody to charge", () => {
    const r = explain([expense({ myShareCents: 4_000 })]);
    expect(r.gapCents).toBe(-6_000);
    expect(r.items).toMatchObject([
      { subject: "expense", reason: "cost-without-share", cents: -6_000, personIds: [] },
    ]);
  });

  it("a shared expense on an account that no longer exists", () => {
    const r = explain([shared(10_000, 6_000, { accountId: "ghost" })]);
    expect(r.gapCents).toBe(6_000);
    expect(r.items).toMatchObject([{ subject: "expense", reason: "share-without-cost", cents: 6_000 }]);
  });

  it("a forecast the ledger charges in a month the cash projection does not reach", () => {
    // A card subscription fully hers, anchored in March and never booked again. The ledger charges
    // a forecast for every later bill; the obligations only project the current month onward.
    const rule = charge(1_099, 1_099, "2026-03-04", {
      description: "Assinatura",
      recurrence: { dayOfMonth: 4 },
    });
    const r = explain([rule]);
    expect(r.general).toMatchObject({ obligationsCents: 1_099, peopleCents: 3_297 });
    expect(r.gapCents).toBe(2_198);
    expect(r.items.map((i) => [i.subject, i.reason, i.cents, i.date])).toEqual([
      ["expense", "share-without-cost", 1_099, "2026-03-04"], // booked, on an old fatura with no payment
      ["expense", "share-without-cost", 1_099, "2026-04-04"], // forecast billed in May
    ]);
    expect(r.items.map((i) => (i.subject === "expense" ? [i.projected, i.competence] : null))).toEqual([
      [false, "2026-04"],
      [true, "2026-05"],
    ]);
    expect(r.unexplainedCents).toBe(0);
  });
});

describe("explainMonthEndGap — a remainder rolled with the user's own money", () => {
  // June: 60,00 of an account expense is Ana's. On the 15th the remainder is rolled with the user's
  // own money: a cash-less acerto zeroes June and a ledger-only debt (own money, no account) books
  // the same 60,00 for July 20. No account moves at any point.
  const purchase = shared(10_000, 6_000);
  const rollover = acerto({ accountId: null, note: "Rolagem — Dívida de Ana · nova data 20/07/2026" });
  const carried = expense({
    description: "Dívida de Ana",
    date: "2026-07-20",
    amountCents: -6_000,
    accountId: null,
    myShareCents: 0,
    splits: [{ personId: "ana", shareCents: 6_000 }],
  });
  const rolled = { settlements: [rollover] };

  it("until the new date the general lens is short of exactly what was carried", () => {
    const r = explain([purchase, carried], rolled);
    // The cash is where the purchase left it; the receivable moved to July.
    expect(r.general).toMatchObject({ accountsCents: 90_000, peopleCents: 0, totalCents: 90_000 });
    expect(r.personal).toMatchObject({ accountsCents: 96_000, totalCents: 96_000 });
    expect(r.gapCents).toBe(-6_000);
    expect(r.items).toMatchObject([{ subject: "settlement", reason: "writeoff", cents: -6_000 }]);
    expect(r.unexplainedCents).toBe(0);
  });

  it("from the new month on the two lenses agree again: the debt is back as a receivable", () => {
    const r = explain([purchase, carried], { ...rolled, month: "2026-07" });
    expect(r.general).toMatchObject({ accountsCents: 90_000, peopleCents: 6_000, totalCents: 96_000 });
    expect(r.personal).toMatchObject({ accountsCents: 96_000, totalCents: 96_000 });
    expect(r.gapCents).toBe(0);
    // The two halves of the roll, cancelling: the receivable written off in June, and the same
    // amount owed again with no cost behind it.
    expect(r.items.map((i) => [i.subject, i.reason, i.cents])).toEqual([
      ["settlement", "writeoff", -6_000],
      ["expense", "share-without-cost", 6_000],
    ]);
    expect(r.unexplainedCents).toBe(0);
  });

  it("…and stay equal once she pays it", () => {
    const paid = acerto({ amountCents: 6_000, date: "2026-07-20" });
    const r = explain([purchase, carried], { settlements: [rollover, paid], month: "2026-07" });
    expect(r.general).toMatchObject({ accountsCents: 96_000, peopleCents: 0, totalCents: 96_000 });
    expect(r.gapCents).toBe(0);
    expect(r.unexplainedCents).toBe(0);
  });
});

describe("explainMonthEndGap — windows and ordering", () => {
  it("a past month has no projection window: only what really moved", () => {
    const r = explain([shared(59_640, 59_640, { date: "2026-05-05" })], {
      month: "2026-05",
      settlements: [acerto({ amountCents: 60_000, date: "2026-05-20" })],
    });
    expect(r.month).toBe("2026-05");
    expect(r.general).toMatchObject({ obligationsCents: 0, overdueCents: 0, totalCents: 100_360 });
    expect(r.gapCents).toBe(360);
    expect(r.items).toMatchObject([{ reason: "advance", cents: 360 }]);
  });

  it("lists the largest contributions first", () => {
    const r = explain(
      [
        shared(59_640, 59_640),
        expense({
          amountCents: -10_000,
          myShareCents: 4_000,
          splits: [{ personId: "bia", shareCents: 6_000 }],
        }),
      ],
      {
        settlements: [
          acerto({ amountCents: 60_000 }),
          acerto({ personId: "bia", accountId: null, amountCents: 6_000 }),
        ],
      },
    );
    expect(r.items.map((i) => [i.reason, i.cents])).toEqual([
      ["writeoff", -6_000],
      ["advance", 360],
    ]);
    expect(r.gapCents).toBe(-5_640);
    expect(r.explainedCents).toBe(-5_640);
  });
});

describe("explainMonthEndGap — every cent is explained (property)", () => {
  const monthArb = fc.constantFrom("2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08");
  const dayArb = fc.integer({ min: 1, max: 28 });
  const personArb = fc.constantFrom("ana", "bia", "zed");
  const date = (m: string, d: number): string => `${m}-${String(d).padStart(2, "0")}`;

  const expenseArb = fc.record({
    source: fc.constantFrom("account" as const, "card" as const, "boleto" as const),
    month: monthArb,
    day: dayArb,
    total: fc.integer({ min: 100, max: 50_000 }),
    sharePct: fc.integer({ min: 0, max: 100 }),
    person: personArb,
    recurring: fc.boolean(),
    paid: fc.boolean(),
    paidDelta: fc.integer({ min: -90, max: 90 }),
    label: fc.constantFrom("A", "B", "C"),
    ghostAccount: fc.boolean(),
  });
  const incomeArb = fc.record({
    month: monthArb,
    day: dayArb,
    amount: fc.integer({ min: 100, max: 30_000 }),
    person: fc.option(personArb, { nil: null }),
    reimbursement: fc.boolean(),
    pending: fc.boolean(),
    recurring: fc.boolean(),
    toCard: fc.boolean(),
  });
  const settlementArb = fc.record({
    month: monthArb,
    day: dayArb,
    amount: fc.integer({ min: 100, max: 60_000 }),
    person: personArb,
    withAccount: fc.boolean(),
  });
  const paymentArb = fc.record({
    competence: monthArb,
    payMonth: monthArb,
    day: dayArb,
    amount: fc.integer({ min: 1, max: 80_000 }),
  });

  it("Σ items === general − personal for any mix of rows, acertos and paid faturas", () => {
    fc.assert(
      fc.property(
        fc.array(expenseArb, { maxLength: 9 }),
        fc.array(incomeArb, { maxLength: 5 }),
        fc.array(settlementArb, { maxLength: 5 }),
        fc.array(paymentArb, { maxLength: 3 }),
        monthArb,
        (expenses, incomes, setts, pays, month) => {
          const transactions: Transaction[] = [
            ...expenses.map((e, i): Transaction => {
              const share = Math.floor((e.total * e.sharePct) / 100);
              const d = date(e.month, e.day);
              return expense({
                id: `pe${i}`,
                description: `Regra ${e.label}`,
                date: d,
                source: e.source,
                cardId: e.source === "card" ? "card-1" : null,
                accountId: e.source === "account" ? (e.ghostAccount ? "ghost" : "acc-1") : null,
                amountCents: -e.total,
                myShareCents: e.total - share,
                splits: share > 0 ? [{ personId: e.person, shareCents: share }] : [],
                recurrence: e.recurring ? { dayOfMonth: e.day } : null,
                ...(e.source === "boleto" && e.paid
                  ? { paidAt: d, paidAccountId: "acc-1", paidAmountCents: e.total + e.paidDelta }
                  : {}),
              });
            }),
            ...incomes.map((n, i): Transaction => {
              const d = date(n.month, n.day);
              if (n.toCard) {
                return income({
                  id: `pi${i}`,
                  date: d,
                  amountCents: n.amount,
                  accountId: null,
                  cardId: "card-1",
                });
              }
              return income({
                id: `pi${i}`,
                description: `Entrada ${i % 2}`,
                date: d,
                amountCents: n.amount,
                fromPersonId: n.person,
                isReimbursement: n.reimbursement,
                recurrence: n.recurring ? { dayOfMonth: n.day } : null,
                ...(n.pending ? { receivedAt: null } : {}),
              });
            }),
          ];
          const settlements = setts.map((s, i) =>
            acerto({
              id: `ps${i}`,
              personId: s.person,
              amountCents: s.amount,
              date: date(s.month, s.day),
              accountId: s.withAccount ? "acc-1" : null,
            }),
          );
          const seen = new Set<string>();
          const cardBillPayments = pays
            .filter((p) => (seen.has(p.competence) ? false : seen.add(p.competence)))
            .map((p, i) =>
              paidBill({
                id: `pp${i}`,
                competence: p.competence,
                amountCents: p.amount,
                date: date(p.payMonth, p.day),
              }),
            );
          const r = explain(transactions, { settlements, cardBillPayments, month });
          expect(r.unexplainedCents).toBe(0);
          expect(r.items.reduce((total, item) => total + item.cents, 0)).toBe(r.gapCents);
          expect(r.general.totalCents - r.personal.totalCents).toBe(r.gapCents);
          for (const item of r.items) expect(item.cents).not.toBe(0);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("findPaidBillDrifts", () => {
  it("is empty while every payment equals its bill (charges minus estornos)", () => {
    const txs: Transaction[] = [
      charge(40_000, 0, "2026-05-10"),
      income({ accountId: null, cardId: "card-1", amountCents: 4_000, date: "2026-05-15" }),
    ];
    expect(findPaidBillDrifts([paidBill({ amountCents: 36_000 })], txs, competenceOf)).toEqual([]);
  });

  it("reports the difference per payment, latest first", () => {
    const txs: Transaction[] = [charge(40_000, 0, "2026-05-10"), charge(5_000, 0, "2026-06-10")];
    const june = paidBill({ amountCents: 40_002, date: "2026-06-02" });
    const july = paidBill({ competence: "2026-07", amountCents: 4_000, date: "2026-07-02" });
    const empty = paidBill({ competence: "2026-01", amountCents: 100, date: "2026-07-02" });
    expect(findPaidBillDrifts([june, july, empty], txs, competenceOf)).toEqual([
      { payment: july, currentBillCents: 5_000, driftCents: -1_000 },
      { payment: empty, currentBillCents: 0, driftCents: 100 },
      { payment: june, currentBillCents: 40_000, driftCents: 2 },
    ]);
  });
});
