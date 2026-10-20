import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Settlement } from "../entities/settlement";
import type {
  ExpenseTransaction,
  IncomeTransaction,
  Transaction,
  TransactionSplit,
} from "../entities/transaction";
import { planDebtAssumption } from "./debt-assumption.planner";

/** Calendar competence (month of the transaction's date). */
const calOf = (tx: Transaction): string => tx.date.slice(0, 7);

const expense = (
  overrides: Partial<ExpenseTransaction> & { splits?: readonly TransactionSplit[] },
): ExpenseTransaction => ({
  id: "tx",
  description: "Empréstimo",
  date: "2026-08-10",
  kind: "expense",
  amountCents: -10_000,
  categoryId: null,
  source: "loan",
  cardId: null,
  accountId: null,
  linkedAccountId: null,
  splits: [{ personId: "ana", shareCents: 10_000 }],
  myShareCents: 0,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  ...overrides,
});

/** A payment RECEIVED from Ana (abates her debt in its own month). */
const payment = (amountCents: number, date = "2026-08-15"): IncomeTransaction => ({
  id: `pay-${date}`,
  description: "Pagamento recebido",
  date,
  kind: "income",
  amountCents,
  accountId: "nu",
  cardId: null,
  fromPersonId: "ana",
  isReimbursement: true,
  recurrence: null,
  receivedAt: date,
  receivedAccountId: "nu",
  receivedAmountCents: amountCents,
});

const acerto = (amountCents: number, date = "2026-08-20"): Settlement => ({
  id: `s-${date}-${amountCents}`,
  personId: "ana",
  amountCents,
  date,
  accountId: null,
});

type PlanOverrides = Partial<Parameters<typeof planDebtAssumption>[0]>;
const plan = (transactions: Transaction[], settlements: Settlement[] = [], over: PlanOverrides = {}) =>
  planDebtAssumption({
    personId: "ana",
    transactions,
    settlements,
    month: "2026-08",
    competenceOf: calOf,
    amountCents: 10_000,
    scope: "month",
    ...over,
  });

describe("planDebtAssumption — one month", () => {
  it("takes the whole uncovered share of the browsed month", () => {
    const result = plan([expense({ id: "e1" })]);
    expect(result.items).toEqual([{ transactionId: "e1", personId: "ana", assumeCents: 10_000 }]);
    expect(result.totalCents).toBe(10_000);
  });

  it("only the part no acerto covered can be taken over", () => {
    // Ana already paid R$60 of the R$100 → R$40 is still hers to owe.
    const short = plan([expense({ id: "e1" })], [acerto(6_000)]);
    expect(short.items).toEqual([{ transactionId: "e1", personId: "ana", assumeCents: 4_000 }]);
    expect(short.totalCents).toBe(4_000); // the R$100 request could not be met

    const exact = plan([expense({ id: "e1" })], [acerto(6_000)], { amountCents: 4_000 });
    expect(exact.totalCents).toBe(4_000);
  });

  it("a payment from the person covers its own month, oldest row first", () => {
    const older = expense({
      id: "a",
      date: "2026-08-05",
      amountCents: -6_000,
      splits: [{ personId: "ana", shareCents: 6_000 }],
    });
    const newer = expense({
      id: "b",
      date: "2026-08-12",
      amountCents: -4_000,
      splits: [{ personId: "ana", shareCents: 4_000 }],
    });
    // R$60 received: the older row is fully covered, the newer one is what is left.
    expect(plan([older, newer, payment(6_000)], [], { amountCents: 4_000 }).items).toEqual([
      { transactionId: "b", personId: "ana", assumeCents: 4_000 },
    ]);
    // R$50 received: R$10 of the older row and the whole newer row remain — oldest first.
    expect(plan([older, newer, payment(5_000)], [], { amountCents: 5_000 }).items).toEqual([
      { transactionId: "a", personId: "ana", assumeCents: 1_000 },
      { transactionId: "b", personId: "ana", assumeCents: 4_000 },
    ]);
  });

  it("a partial amount stops at the request, oldest uncovered row first", () => {
    const older = expense({
      id: "a",
      date: "2026-08-05",
      amountCents: -6_000,
      splits: [{ personId: "ana", shareCents: 6_000 }],
    });
    const newer = expense({
      id: "b",
      date: "2026-08-12",
      amountCents: -4_000,
      splits: [{ personId: "ana", shareCents: 4_000 }],
    });
    const result = plan([older, newer], [], { amountCents: 7_000 });
    expect(result.items).toEqual([
      { transactionId: "a", personId: "ana", assumeCents: 6_000 },
      { transactionId: "b", personId: "ana", assumeCents: 1_000 },
    ]);
    expect(result.totalCents).toBe(7_000);
  });

  it("counts a row in the competence the resolver gives it (a card charge bills later)", () => {
    const julyCharge = expense({ id: "card", date: "2026-07-28" });
    const billsAugust = () => "2026-08";
    expect(plan([julyCharge], [], { competenceOf: billsAugust }).totalCents).toBe(10_000);
    expect(plan([julyCharge]).totalCents).toBe(0); // calendar July: not the browsed month
  });
});

describe("planDebtAssumption — across months", () => {
  const june = expense({
    id: "jun",
    date: "2026-06-10",
    amountCents: -3_000,
    splits: [{ personId: "ana", shareCents: 3_000 }],
  });
  const july = expense({
    id: "jul",
    date: "2026-07-10",
    amountCents: -2_000,
    splits: [{ personId: "ana", shareCents: 2_000 }],
  });
  const august = expense({
    id: "aug",
    date: "2026-08-10",
    amountCents: -5_000,
    splits: [{ personId: "ana", shareCents: 5_000 }],
  });

  it("`all` takes the browsed month first, then earlier months newest first", () => {
    expect(plan([june, july, august], [], { scope: "all", amountCents: 7_000 }).items).toEqual([
      { transactionId: "aug", personId: "ana", assumeCents: 5_000 },
      { transactionId: "jul", personId: "ana", assumeCents: 2_000 },
    ]);
    const everything = plan([june, july, august], [], { scope: "all", amountCents: 10_000 });
    expect(everything.items.map((i) => i.transactionId)).toEqual(["aug", "jul", "jun"]);
    expect(everything.totalCents).toBe(10_000);
  });

  it("`month` never reaches into other months", () => {
    const result = plan([june, july, august], [], { scope: "month", amountCents: 10_000 });
    expect(result.items).toEqual([{ transactionId: "aug", personId: "ana", assumeCents: 5_000 }]);
    expect(result.totalCents).toBe(5_000);
  });

  it("an acerto covers the oldest months first (the ledger rule), so the newest stay uncovered", () => {
    // R$40 settles June (30) and R$10 of July → July keeps R$10, August its full R$50.
    const result = plan([june, july, august], [acerto(4_000, "2026-07-25")], {
      scope: "all",
      amountCents: 6_000,
    });
    expect(result.items).toEqual([
      { transactionId: "aug", personId: "ana", assumeCents: 5_000 },
      { transactionId: "jul", personId: "ana", assumeCents: 1_000 },
    ]);
  });

  it("ignores months after the browsed one", () => {
    const september = expense({ id: "sep", date: "2026-09-10" });
    expect(plan([august, september], [], { scope: "all", amountCents: 15_000 }).totalCents).toBe(5_000);
  });
});

describe("planDebtAssumption — what is never a candidate", () => {
  it("a forecast (previsto occurrence of a recurring rule) has no row to take over", () => {
    const rule = expense({ id: "anchor", date: "2026-06-10", recurrence: { dayOfMonth: 10 } });
    // Booked: only the June anchor. July/August are projections and must not be planned against.
    expect(plan([rule], [], { scope: "month" }).totalCents).toBe(0);
    const all = plan([rule], [], { scope: "all" });
    expect(all.items).toEqual([{ transactionId: "anchor", personId: "ana", assumeCents: 10_000 }]);
  });

  it("a rolled (abated) row is out — the rolled-into debt carries the share now", () => {
    expect(plan([expense({ id: "old", rolledAt: "2026-08-01" })]).totalCents).toBe(0);
  });

  it("a month where you owe the person (net ≤ 0) yields nothing", () => {
    expect(plan([expense({ id: "e1" }), payment(12_000)]).totalCents).toBe(0);
  });

  it("someone else's share is not Ana's", () => {
    expect(plan([expense({ id: "e1", splits: [{ personId: "bob", shareCents: 10_000 }] })]).totalCents).toBe(
      0,
    );
  });
});

describe("planDebtAssumption — invariants", () => {
  it("never assumes more than requested nor more than the month's uncovered net", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000 }),
        fc.integer({ min: 0, max: 60_000 }),
        fc.integer({ min: 1, max: 60_000 }),
        (shareCents, settledCents, amountCents) => {
          const row = expense({
            id: "e1",
            amountCents: -shareCents,
            splits: [{ personId: "ana", shareCents }],
          });
          const result = plan([row], settledCents > 0 ? [acerto(settledCents)] : [], { amountCents });
          const net = Math.max(0, shareCents - settledCents);
          expect(result.totalCents).toBe(Math.min(amountCents, net));
          expect(result.items.reduce((sum, i) => sum + i.assumeCents, 0)).toBe(result.totalCents);
          for (const item of result.items) expect(item.assumeCents).toBeGreaterThan(0);
        },
      ),
    );
  });
});
