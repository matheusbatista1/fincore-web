import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CreditCard } from "../entities/credit-card";
import type { Person } from "../entities/person";
import type { Settlement } from "../entities/settlement";
import type {
  ExpenseTransaction,
  IncomeTransaction,
  ParcelaStatus,
  Transaction,
  TransactionSplit,
  TransferTransaction,
} from "../entities/transaction";
import { Money } from "../money/money";
import { billingCompetence } from "./card-bill.calculator";
import {
  applySettlement,
  computePersonBalances,
  computePersonBalancesForMonth,
  computePersonBalancesThrough,
  computePersonBookedBalancesThrough,
  computePersonLedger,
  computePersonMonthNets,
  computePersonMonthNetsAndSettledCash,
  type LedgerMovement,
} from "./person-ledger.calculator";

/** Calendar competence (month of the transaction's date) for the month-scoped tests. */
const calOf = (tx: Transaction): string => tx.date.slice(0, 7);

// --- test data factories -----------------------------------------------------

const person = (id: string): Person => ({
  id,
  name: id,
  relationship: "Amigo",
  color: "#000000",
});

const expense = (
  overrides: Partial<ExpenseTransaction> & { splits?: readonly TransactionSplit[] },
): ExpenseTransaction => ({
  id: "tx",
  description: "expense",
  date: "2026-06-10",
  kind: "expense",
  amountCents: -10_000,
  categoryId: null,
  source: "card",
  cardId: "c-nu",
  accountId: null,
  linkedAccountId: null,
  splits: [],
  myShareCents: 0,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  ...overrides,
});

const income = (overrides: Partial<IncomeTransaction>): IncomeTransaction => ({
  id: "tx",
  description: "income",
  date: "2026-06-10",
  kind: "income",
  amountCents: 10_000,
  accountId: "nu",
  cardId: null,
  fromPersonId: null,
  isReimbursement: false,
  recurrence: null,
  ...overrides,
});

const transfer = (overrides: Partial<TransferTransaction>): TransferTransaction => ({
  id: "tx",
  description: "transfer",
  date: "2026-06-10",
  kind: "transfer",
  fromAccountId: "nu",
  toAccountId: "it",
  valueCents: 10_000,
  ...overrides,
});

const settlement = (personId: string, amountCents: number): Settlement => ({
  id: `s-${personId}`,
  personId,
  amountCents,
  date: "2026-06-10",
  accountId: null,
});

// =============================================================================
// applySettlement — the key invariant: NEVER crosses zero.
// =============================================================================

describe("applySettlement (port of applySettle)", () => {
  it("reduces a positive (they-owe-you) balance toward zero, clamped at 0", () => {
    // balance > 0 -> max(0, balance - amount)
    expect(applySettlement(Money.fromCents(18_000), 5_000).cents).toBe(13_000);
    expect(applySettlement(Money.fromCents(18_000), 18_000).cents).toBe(0); // exact quit
    expect(applySettlement(Money.fromCents(18_000), 25_000).cents).toBe(0); // overpay clamps
  });

  it("reduces a negative (you-owe-them) balance toward zero, clamped at 0", () => {
    // balance < 0 -> min(0, balance + amount)
    expect(applySettlement(Money.fromCents(-12_000), 5_000).cents).toBe(-7_000);
    expect(applySettlement(Money.fromCents(-12_000), 12_000).cents).toBe(0); // exact quit
    expect(applySettlement(Money.fromCents(-12_000), 25_000).cents).toBe(0); // overpay clamps
  });

  it("leaves an already-settled (zero) balance at zero", () => {
    expect(applySettlement(Money.zero(), 5_000).cents).toBe(0);
    expect(applySettlement(Money.zero(), 0).cents).toBe(0);
  });

  // Property: the balance NEVER crosses zero — its sign is preserved or it lands
  // exactly on zero, regardless of the (non-negative) settle amount.
  it("never crosses zero for any non-negative settle amount", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.integer({ min: 0, max: 20_000_000 }),
        (balanceCents, amountCents) => {
          const result = applySettlement(Money.fromCents(balanceCents), amountCents);
          if (balanceCents > 0) {
            // stayed non-negative (never went below zero)
            expect(result.cents).toBeGreaterThanOrEqual(0);
            expect(result.cents).toBeLessThanOrEqual(balanceCents);
          } else if (balanceCents < 0) {
            // stayed non-positive (never went above zero)
            expect(result.cents).toBeLessThanOrEqual(0);
            expect(result.cents).toBeGreaterThanOrEqual(balanceCents);
          } else {
            expect(result.cents).toBe(0);
          }
        },
      ),
    );
  });

  // Property: matches the exact arithmetic of the prototype's applySettle.
  it("matches the prototype formula exactly (max/min clamp)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.integer({ min: 0, max: 20_000_000 }),
        (balanceCents, amountCents) => {
          const expected =
            balanceCents > 0
              ? Math.max(0, balanceCents - amountCents)
              : balanceCents < 0
                ? Math.min(0, balanceCents + amountCents)
                : 0;
          expect(applySettlement(Money.fromCents(balanceCents), amountCents).cents).toBe(expected);
        },
      ),
    );
  });

  // Property: settling the full outstanding amount always quits exactly to zero.
  it("settling the full |balance| always lands exactly on zero", () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000_000, max: 10_000_000 }), (balanceCents) => {
        const result = applySettlement(Money.fromCents(balanceCents), Math.abs(balanceCents));
        expect(result.cents).toBe(0);
      }),
    );
  });
});

// =============================================================================
// computePersonBalances — derived ledger.
// =============================================================================

describe("computePersonBalances", () => {
  it("adds each split share to what the person owes you", () => {
    const people = [person("p-mar")];
    const txs: Transaction[] = [expense({ splits: [{ personId: "p-mar", shareCents: 7_400 }] })];
    const balances = computePersonBalances(people, txs, []);
    expect(balances.get("p-mar")?.cents).toBe(7_400);
  });

  it("abates a person's debt with an income payment (fromPersonId)", () => {
    const people = [person("p-joao")];
    const txs: Transaction[] = [
      expense({ id: "e1", splits: [{ personId: "p-joao", shareCents: 9_200 }] }),
      income({ id: "i1", amountCents: 4_000, fromPersonId: "p-joao" }),
    ];
    const balances = computePersonBalances(people, txs, []);
    // 9_200 owed - 4_000 paid = 5_200 still owed.
    expect(balances.get("p-joao")?.cents).toBe(5_200);
  });

  it("does NOT abate a debt from a pending (not-yet-received) income", () => {
    const people = [person("p-joao")];
    const txs: Transaction[] = [
      expense({ id: "e1", splits: [{ personId: "p-joao", shareCents: 9_200 }] }),
      income({ id: "i1", amountCents: 4_000, fromPersonId: "p-joao", receivedAt: null }),
    ];
    const balances = computePersonBalances(people, txs, []);
    // The payment is still a pending receivable — the full debt stands.
    expect(balances.get("p-joao")?.cents).toBe(9_200);
  });

  it("abates by the amount actually received once the payment is received", () => {
    const people = [person("p-joao")];
    const txs: Transaction[] = [
      expense({ id: "e1", splits: [{ personId: "p-joao", shareCents: 9_200 }] }),
      income({
        id: "i1",
        amountCents: 4_000,
        fromPersonId: "p-joao",
        receivedAt: "2026-06-12",
        receivedAccountId: "nu",
        receivedAmountCents: 3_500,
      }),
    ];
    const balances = computePersonBalances(people, txs, []);
    // 9_200 owed - 3_500 actually received = 5_700 still owed.
    expect(balances.get("p-joao")?.cents).toBe(5_700);
  });

  it("buckets a received payment in the RECEIPT month, not the booked month", () => {
    const people = [person("p-joao")];
    // Debt incurred in June; an expected payment BOOKED for August but RECEIVED early in June.
    const txs: Transaction[] = [
      expense({ id: "e1", date: "2026-06-10", splits: [{ personId: "p-joao", shareCents: 10_000 }] }),
      income({
        id: "i1",
        amountCents: 10_000,
        fromPersonId: "p-joao",
        date: "2026-08-10",
        receivedAt: "2026-06-25",
        receivedAccountId: "nu",
        receivedAmountCents: 10_000,
      }),
    ];
    // The abatement lands in June (the receipt month), so June nets to zero — not August (booked).
    const june = computePersonBalancesForMonth(people, txs, [], "2026-06", calOf, "2026-06");
    expect(june.get("p-joao")?.cents).toBe(0);
    const nets = computePersonMonthNets(people, txs, [], "2026-08", calOf);
    expect(nets.get("p-joao")?.get("2026-08") ?? 0).toBe(0);
    // All-time it is fully settled.
    expect(computePersonBalances(people, txs, []).get("p-joao")?.cents).toBe(0);
  });

  it("ignores paid and future installments, counts only the current installment", () => {
    const people = [person("p-x")];
    const mk = (status: ParcelaStatus): ExpenseTransaction =>
      expense({
        id: `e-${status}`,
        splits: [{ personId: "p-x", shareCents: 1_000 }],
        installment: { groupId: "g1", number: 1, total: 3, status },
      });
    const balances = computePersonBalances(people, [mk("paga"), mk("atual"), mk("futura")], []);
    // Only the "atual" installment contributes its 1_000.
    expect(balances.get("p-x")?.cents).toBe(1_000);
  });

  it("settlements reduce the outstanding balance, clamped at zero", () => {
    const people = [person("p-mar")];
    const txs: Transaction[] = [expense({ splits: [{ personId: "p-mar", shareCents: 18_000 }] })];
    const balances = computePersonBalances(people, txs, [settlement("p-mar", 5_000)]);
    expect(balances.get("p-mar")?.cents).toBe(13_000);

    // Overpaying via settlement clamps to zero, never negative.
    const balances2 = computePersonBalances(people, txs, [settlement("p-mar", 25_000)]);
    expect(balances2.get("p-mar")?.cents).toBe(0);
  });

  it("transfers have no effect on any person balance", () => {
    const people = [person("p-mar")];
    const txs: Transaction[] = [transfer({ valueCents: 50_000 })];
    const balances = computePersonBalances(people, txs, []);
    expect(balances.get("p-mar")?.cents).toBe(0);
  });

  it("includes every person at zero even with no activity", () => {
    const people = [person("p-mar"), person("p-joao")];
    const balances = computePersonBalances(people, [], []);
    expect(balances.get("p-mar")?.cents).toBe(0);
    expect(balances.get("p-joao")?.cents).toBe(0);
    expect(balances.size).toBe(2);
  });

  // Concrete examples reconstructed from data.js seed (people balances + the seed
  // expenses that produce them):
  //   Mariana +180, Joao +450, Sofia +500, Pedro -120, Camila +90.
  it("reproduces the seed-data balances from splits and payments", () => {
    const people = [person("p-mar"), person("p-joao"), person("p-mae"), person("p-ped"), person("p-cam")];

    const txs: Transaction[] = [
      // t1: Pizzaria Bráz, split with Mariana — she owes 74.00 (so far 180 total later).
      expense({ id: "t1", splits: [{ personId: "p-mar", shareCents: 7_400 }] }),
      // Extra Mariana shares to reach +180.00 total.
      expense({ id: "t1b", splits: [{ personId: "p-mar", shareCents: 10_600 }] }),
      // t5: Passagem aérea (Mãe), 100% Sofia — she owes 500.00.
      expense({ id: "t5", splits: [{ personId: "p-mae", shareCents: 50_000 }] }),
      // t11: Bar do Juarez, split with Joao and Camila — each owes 92.00.
      expense({
        id: "t11",
        splits: [
          { personId: "p-joao", shareCents: 9_200 },
          { personId: "p-cam", shareCents: 9_200 },
        ],
      }),
      // Additional Joao share to reach +450.00 total.
      expense({ id: "t11b", splits: [{ personId: "p-joao", shareCents: 35_800 }] }),
      // Camila top-up to reach +90.00 total (9_200 - 200 via a payment below).
      // Pedro: you owe him 120.00 -> modeled as an income from-person creating
      // a negative balance (a payment Pedro made on your behalf is represented in
      // the prototype as the person's balance being negative).
    ];

    // Camila paid back 2.00 of her 92.00 to land at 90.00.
    txs.push(income({ id: "pay-cam", amountCents: 200, fromPersonId: "p-cam" }));

    // Pedro: -120.00. With no positive share, an income payment from Pedro drives
    // his balance negative (you owe him), matching balance < 0 convention.
    txs.push(income({ id: "pay-ped", amountCents: 12_000, fromPersonId: "p-ped" }));

    const balances = computePersonBalances(people, txs, []);

    expect(balances.get("p-mar")?.cents).toBe(18_000); // +180.00
    expect(balances.get("p-joao")?.cents).toBe(45_000); // +450.00
    expect(balances.get("p-mae")?.cents).toBe(50_000); // +500.00
    expect(balances.get("p-ped")?.cents).toBe(-12_000); // -120.00
    expect(balances.get("p-cam")?.cents).toBe(9_000); // +90.00
  });

  // Property: a person's balance equals (sum of their split shares) minus (sum of
  // their income payments), then settled — and settlements never push it past zero.
  it("balance == Σ shares − Σ payments, with settlements clamped at zero", () => {
    const personIdArb = fc.constantFrom("p-a", "p-b", "p-c");
    const splitShareArb = fc.record({
      personId: personIdArb,
      shareCents: fc.integer({ min: 1, max: 100_000 }),
    });

    fc.assert(
      fc.property(
        fc.array(splitShareArb, { maxLength: 20 }),
        fc.array(fc.record({ personId: personIdArb, amountCents: fc.integer({ min: 1, max: 50_000 }) }), {
          maxLength: 20,
        }),
        (shares, payments) => {
          const people = [person("p-a"), person("p-b"), person("p-c")];

          const txs: Transaction[] = [
            ...shares.map(
              (s, i): Transaction =>
                expense({ id: `e${i}`, splits: [{ personId: s.personId, shareCents: s.shareCents }] }),
            ),
            ...payments.map(
              (p, i): Transaction =>
                income({ id: `i${i}`, amountCents: p.amountCents, fromPersonId: p.personId }),
            ),
          ];

          const balances = computePersonBalances(people, txs, []);

          for (const id of ["p-a", "p-b", "p-c"]) {
            const expectedShares = shares
              .filter((s) => s.personId === id)
              .reduce((sum, s) => sum + s.shareCents, 0);
            const expectedPayments = payments
              .filter((p) => p.personId === id)
              .reduce((sum, p) => sum + p.amountCents, 0);
            expect(balances.get(id)?.cents).toBe(expectedShares - expectedPayments);
          }
        },
      ),
    );
  });
});

// =============================================================================
// computePersonBalancesForMonth — the per-month net (drives "A receber" do mês).
// =============================================================================

describe("computePersonBalancesForMonth", () => {
  it("counts only shares whose competence is the target month", () => {
    const people = [person("p-mar")];
    const txs: Transaction[] = [
      expense({ id: "jun", date: "2026-06-10", splits: [{ personId: "p-mar", shareCents: 7_400 }] }),
      expense({ id: "jul", date: "2026-07-10", splits: [{ personId: "p-mar", shareCents: 5_000 }] }),
    ];
    expect(
      computePersonBalancesForMonth(people, txs, [], "2026-06", calOf, "2026-06").get("p-mar")?.cents,
    ).toBe(7_400);
    expect(
      computePersonBalancesForMonth(people, txs, [], "2026-07", calOf, "2026-07").get("p-mar")?.cents,
    ).toBe(5_000);
  });

  it("abates with a payment dated in the same month and clamps settlements", () => {
    const people = [person("p-joao")];
    const txs: Transaction[] = [
      expense({ id: "e", date: "2026-06-05", splits: [{ personId: "p-joao", shareCents: 9_000 }] }),
      income({ id: "pay", date: "2026-06-20", amountCents: 2_000, fromPersonId: "p-joao" }),
    ];
    // 9_000 share − 2_000 payment = 7_000; a 3_000 settlement in June → 4_000.
    const balances = computePersonBalancesForMonth(
      people,
      txs,
      [settlement("p-joao", 3_000)],
      "2026-06",
      calOf,
      "2026-06",
    );
    expect(balances.get("p-joao")?.cents).toBe(4_000);
  });

  it("a month with no activity nets to zero", () => {
    const people = [person("p-mar")];
    const txs: Transaction[] = [
      expense({ id: "jun", date: "2026-06-10", splits: [{ personId: "p-mar", shareCents: 7_400 }] }),
    ];
    expect(
      computePersonBalancesForMonth(people, txs, [], "2026-05", calOf, "2026-05").get("p-mar")?.cents,
    ).toBe(0);
  });

  it("ignores transfers, non-person income and other-month settlements; counts the month's parcela", () => {
    const people = [person("p-x")];
    const txs: Transaction[] = [
      expense({
        id: "jun",
        date: "2026-06-02",
        splits: [{ personId: "p-x", shareCents: 5_000 }],
        installment: { groupId: "g", number: 4, total: 12, status: "atual" },
      }),
      transfer({ id: "tr", date: "2026-06-05", valueCents: 50_000 }),
      income({ id: "noperson", date: "2026-06-06", amountCents: 3_000, fromPersonId: null }),
    ];
    // June: the parcela (5_000) less the June settlement (1_000) = 4_000.
    expect(
      computePersonBalancesForMonth(people, txs, [settlement("p-x", 1_000)], "2026-06", calOf, "2026-06").get(
        "p-x",
      )?.cents,
    ).toBe(4_000);
    // July: the June parcela isn't July's and the June settlement is out of scope → 0.
    expect(
      computePersonBalancesForMonth(people, txs, [settlement("p-x", 1_000)], "2026-07", calOf, "2026-07").get(
        "p-x",
      )?.cents,
    ).toBe(0);
  });

  it("counts a FUTURE installment parcela for its own month (but not in the all-time outstanding)", () => {
    const people = [person("p-x")];
    const txs: Transaction[] = [
      expense({
        id: "jul",
        date: "2026-07-18",
        splits: [{ personId: "p-x", shareCents: 5_000 }],
        installment: { groupId: "g", number: 5, total: 12, status: "futura" },
      }),
    ];
    // Even though it's "futura" relative to today, July's parcela counts for July.
    expect(
      computePersonBalancesForMonth(people, txs, [], "2026-07", calOf, "2026-06").get("p-x")?.cents,
    ).toBe(5_000);
    // The all-time "current outstanding" excludes future parcelas.
    expect(computePersonBalances(people, txs, []).get("p-x")?.cents).toBe(0);
  });

  it("projects a recurring shared expense's share into a future month", () => {
    const people = [person("p-ana")];
    const txs: Transaction[] = [
      expense({
        id: "internet",
        date: "2026-06-15",
        recurrence: { dayOfMonth: 15 },
        splits: [{ personId: "p-ana", shareCents: 10_000 }],
      }),
    ];
    // Current month (anchor) uses the real split; the future month projects the recurring share.
    expect(
      computePersonBalancesForMonth(people, txs, [], "2026-06", calOf, "2026-06").get("p-ana")?.cents,
    ).toBe(10_000);
    expect(
      computePersonBalancesForMonth(people, txs, [], "2026-07", calOf, "2026-06").get("p-ana")?.cents,
    ).toBe(10_000);
  });

  // Pre-payment: a person pays BEFORE the debt's competence month (e.g. a card-bill share
  // sits in August, but they Pix you in June). The payment must cover the debt in its own
  // month so the month view stops contradicting the all-time "quitado".
  it("a pre-payment covers a later-competence debt in the debt's month (the pastel case)", () => {
    const people = [person("p-irmao")];
    const txs: Transaction[] = [
      expense({ id: "pastel", date: "2026-08-10", splits: [{ personId: "p-irmao", shareCents: 1_200 }] }),
    ];
    const setts: Settlement[] = [
      { id: "s", personId: "p-irmao", amountCents: 1_200, date: "2026-06-21", accountId: "nu" },
    ];
    // August (the bill month) nets to zero — the June pre-payment covered it.
    expect(
      computePersonBalancesForMonth(people, txs, setts, "2026-08", calOf, "2026-06").get("p-irmao")?.cents,
    ).toBe(0);
    // June shows no spurious credit, and the all-time is quitado.
    expect(
      computePersonBalancesForMonth(people, txs, setts, "2026-06", calOf, "2026-06").get("p-irmao")?.cents,
    ).toBe(0);
    expect(computePersonBalancesThrough(people, txs, setts, "2026-08", calOf).get("p-irmao")?.cents).toBe(0);
  });

  it("a partial pre-payment leaves only the remainder in the debt's month", () => {
    const people = [person("p")];
    const txs: Transaction[] = [
      expense({ id: "x", date: "2026-08-10", splits: [{ personId: "p", shareCents: 1_200 }] }),
    ];
    const setts: Settlement[] = [
      { id: "s", personId: "p", amountCents: 500, date: "2026-06-21", accountId: null },
    ];
    expect(
      computePersonBalancesForMonth(people, txs, setts, "2026-08", calOf, "2026-06").get("p")?.cents,
    ).toBe(700);
  });

  it("paying AFTER the debt: still owed when browsing the debt month, covered once the horizon includes the payment", () => {
    const people = [person("p")];
    const txs: Transaction[] = [
      expense({ id: "x", date: "2026-08-10", splits: [{ personId: "p", shareCents: 1_200 }] }),
    ];
    const setts: Settlement[] = [
      { id: "s", personId: "p", amountCents: 1_200, date: "2026-09-05", accountId: null },
    ];
    // Browsing August (the Sep payment hasn't happened yet): they still owe you.
    expect(
      computePersonBalancesForMonth(people, txs, setts, "2026-08", calOf, "2026-08").get("p")?.cents,
    ).toBe(1_200);
    // Through September (payment made): the August debt is covered, no spurious 'você deve' in Sep.
    const nets = computePersonMonthNets(people, txs, setts, "2026-09", calOf).get("p");
    expect(nets?.get("2026-08") ?? 0).toBe(0);
    expect(nets?.get("2026-09") ?? 0).toBe(0);
  });
});

// =============================================================================
// computePersonMonthNets — per-month nets with pre-payment re-bucketing.
// =============================================================================

describe("computePersonMonthNets", () => {
  it("re-buckets a settlement onto the oldest debt month it covers", () => {
    const people = [person("p")];
    const txs: Transaction[] = [
      expense({ id: "jul", date: "2026-07-10", splits: [{ personId: "p", shareCents: 1_000 }] }),
      expense({ id: "aug", date: "2026-08-10", splits: [{ personId: "p", shareCents: 1_200 }] }),
    ];
    const setts: Settlement[] = [
      { id: "s", personId: "p", amountCents: 1_500, date: "2026-06-21", accountId: null },
    ];
    const nets = computePersonMonthNets(people, txs, setts, "2026-08", calOf).get("p");
    expect(nets?.get("2026-07") ?? 0).toBe(0); // oldest fully covered
    expect(nets?.get("2026-08") ?? 0).toBe(700); // remainder
  });

  // Master invariant: in a SINGLE pass, the month nets sum to the through-balance.
  it("Σ over months === computePersonBalancesThrough(H) (property)", () => {
    const personIdArb = fc.constantFrom("p-a", "p-b", "p-c");
    const monthArb = fc.constantFrom("2026-01", "2026-02", "2026-03", "2026-04", "2026-05");
    const dateIn = (m: string) => `${m}-10`;
    const shareArb = fc.record({
      personId: personIdArb,
      month: monthArb,
      shareCents: fc.integer({ min: 1, max: 100_000 }),
    });
    const payArb = fc.record({
      personId: personIdArb,
      month: monthArb,
      amountCents: fc.integer({ min: 1, max: 50_000 }),
    });
    const settArb = fc.record({
      personId: personIdArb,
      month: monthArb,
      amountCents: fc.integer({ min: 1, max: 120_000 }),
    });

    fc.assert(
      fc.property(
        fc.array(shareArb, { maxLength: 12 }),
        fc.array(payArb, { maxLength: 8 }),
        fc.array(settArb, { maxLength: 6 }),
        monthArb,
        (shares, pays, setts, horizon) => {
          const people = [person("p-a"), person("p-b"), person("p-c")];
          const txs: Transaction[] = [
            ...shares.map(
              (s, i): Transaction =>
                expense({
                  id: `e${i}`,
                  date: dateIn(s.month),
                  splits: [{ personId: s.personId, shareCents: s.shareCents }],
                }),
            ),
            ...pays.map(
              (p, i): Transaction =>
                income({
                  id: `i${i}`,
                  date: dateIn(p.month),
                  amountCents: p.amountCents,
                  fromPersonId: p.personId,
                }),
            ),
          ];
          const settlements: Settlement[] = setts.map((s, i) => ({
            id: `s${i}`,
            personId: s.personId,
            amountCents: s.amountCents,
            date: dateIn(s.month),
            accountId: null,
          }));

          const nets = computePersonMonthNets(people, txs, settlements, horizon, calOf);
          const through = computePersonBalancesThrough(people, txs, settlements, horizon, calOf);
          for (const id of ["p-a", "p-b", "p-c"]) {
            let sum = 0;
            for (const c of nets.get(id)?.values() ?? []) sum += c;
            expect(sum).toBe(through.get(id)?.cents ?? 0);
          }
        },
      ),
    );
  });
});

// =============================================================================
// computePersonBalancesThrough — accumulated incl. projected recurring.
// =============================================================================

describe("computePersonBalancesThrough", () => {
  const recurringShare = (): ExpenseTransaction =>
    expense({
      id: "internet",
      date: "2026-01-15",
      recurrence: { dayOfMonth: 15 },
      splits: [{ personId: "p-ana", shareCents: 10_000 }],
    });

  it("accrues a recurring shared expense month by month up to the horizon", () => {
    const people = [person("p-ana")];
    const txs: Transaction[] = [recurringShare()];
    // Through March: Jan (real anchor) + Feb + Mar (projected) = 3 × 10_000.
    expect(computePersonBalancesThrough(people, txs, [], "2026-03", calOf).get("p-ana")?.cents).toBe(30_000);
    // Through January: just the anchor.
    expect(computePersonBalancesThrough(people, txs, [], "2026-01", calOf).get("p-ana")?.cents).toBe(10_000);
  });

  it("applies settlements dated at or before the horizon", () => {
    const people = [person("p-ana")];
    const txs: Transaction[] = [recurringShare()];
    const feb = { id: "s1", personId: "p-ana", amountCents: 5_000, date: "2026-02-10", accountId: null };
    // 30_000 accrued through March − 5_000 settled in Feb = 25_000.
    expect(computePersonBalancesThrough(people, txs, [feb], "2026-03", calOf).get("p-ana")?.cents).toBe(
      25_000,
    );
  });

  it("returns zero for a person with no transactions", () => {
    expect(computePersonBalancesThrough([person("p-x")], [], [], "2026-03", calOf).get("p-x")?.cents).toBe(0);
  });

  it("accrues future installment parcelas up to the horizon", () => {
    const people = [person("p-x")];
    const mk = (id: string, date: string, status: ParcelaStatus, n: number): ExpenseTransaction =>
      expense({
        id,
        date,
        splits: [{ personId: "p-x", shareCents: 34_765 }],
        installment: { groupId: "g", number: n, total: 12, status },
      });
    const txs: Transaction[] = [
      mk("p4", "2026-06-18", "atual", 4),
      mk("p5", "2026-07-18", "futura", 5),
      mk("p6", "2026-08-18", "futura", 6),
    ];
    // Through July: parcelas 4 (Jun) + 5 (Jul); parcela 6 (Aug) is beyond the horizon.
    expect(computePersonBalancesThrough(people, txs, [], "2026-07", calOf).get("p-x")?.cents).toBe(69_530);
  });

  it("finds the earliest month regardless of input order", () => {
    const people = [person("p-ana")];
    const txs: Transaction[] = [
      expense({
        id: "mar",
        description: "Mar rule",
        date: "2026-03-15",
        recurrence: { dayOfMonth: 15 },
        splits: [{ personId: "p-ana", shareCents: 1_000 }],
      }),
      expense({
        id: "jan",
        description: "Jan rule",
        date: "2026-01-15",
        recurrence: { dayOfMonth: 15 },
        splits: [{ personId: "p-ana", shareCents: 1_000 }],
      }),
    ];
    // Through March: jan rule → jan+feb+mar (3_000); mar rule → mar only (1_000) = 4_000.
    expect(computePersonBalancesThrough(people, txs, [], "2026-03", calOf).get("p-ana")?.cents).toBe(4_000);
  });
});

// =============================================================================
// computePersonLedger — emitted movements that reconcile with the balance.
// =============================================================================

describe("computePersonLedger", () => {
  /** Window the emitted movements into a [from, to] statement (mirrors get-person-statements). */
  function windowFor(
    personId: string,
    movements: readonly LedgerMovement[],
    from: string,
    to: string,
  ): { openingCents: number; debitCents: number; creditCents: number; finalRunningCents: number } {
    let openingCents = 0;
    let debitCents = 0;
    let creditCents = 0;
    const period: LedgerMovement[] = [];
    for (const mv of movements) {
      if (mv.personId !== personId) continue;
      if (mv.competence < from) openingCents += mv.signedDeltaCents;
      else if (mv.competence <= to) {
        period.push(mv);
        if (mv.signedDeltaCents > 0) debitCents += mv.signedDeltaCents;
        else creditCents += -mv.signedDeltaCents;
      }
    }
    // Reconstruct the running balance from the opening, applying each period delta.
    let running = openingCents;
    for (const mv of period) running += mv.signedDeltaCents;
    return { openingCents, debitCents, creditCents, finalRunningCents: running };
  }

  it("balances equal computePersonBalancesThrough (single source of truth)", () => {
    const people = [person("p-ana")];
    const txs: Transaction[] = [
      expense({ id: "e1", date: "2026-01-10", splits: [{ personId: "p-ana", shareCents: 7_400 }] }),
      expense({ id: "e2", date: "2026-02-10", splits: [{ personId: "p-ana", shareCents: 5_000 }] }),
    ];
    const setts = [settlement("p-ana", 3_000)];
    const ledger = computePersonLedger(people, txs, setts, "2026-06", calOf);
    const direct = computePersonBalancesThrough(people, txs, setts, "2026-06", calOf);
    expect(ledger.balances.get("p-ana")?.cents).toBe(direct.get("p-ana")?.cents);
  });

  it("a settlement movement records the APPLIED delta, clamped at zero", () => {
    const people = [person("p-mar")];
    const txs: Transaction[] = [
      expense({ id: "e", date: "2026-06-10", splits: [{ personId: "p-mar", shareCents: 18_000 }] }),
    ];
    // Overpay: settle 25_000 against an 18_000 debt → applies only 18_000, lands at 0.
    const { movements, balances } = computePersonLedger(
      people,
      txs,
      [settlement("p-mar", 25_000)],
      "2026-06",
      calOf,
    );
    const settMv = movements.find((m) => m.source.type === "settlement");
    expect(settMv?.signedDeltaCents).toBe(-18_000);
    expect(settMv?.balanceAfterCents).toBe(0);
    expect(balances.get("p-mar")?.cents).toBe(0);
  });

  it("opening (pre-period) + period debits − credits == closing, with a non-empty opening", () => {
    const people = [person("p-ana")];
    const txs: Transaction[] = [
      expense({ id: "jan", date: "2026-01-10", splits: [{ personId: "p-ana", shareCents: 10_000 }] }),
      expense({ id: "mar", date: "2026-03-10", splits: [{ personId: "p-ana", shareCents: 4_000 }] }),
    ];
    const { movements, balances } = computePersonLedger(people, txs, [], "2026-04", calOf);
    const w = windowFor("p-ana", movements, "2026-02", "2026-04");
    expect(w.openingCents).toBe(10_000); // January is before the window
    expect(w.debitCents).toBe(4_000); // March charge falls inside it
    expect(w.creditCents).toBe(0);
    const closing = balances.get("p-ana")?.cents ?? 0;
    expect(w.openingCents + w.debitCents - w.creditCents).toBe(closing);
    expect(w.finalRunningCents).toBe(closing);
  });

  it("a person with a non-zero opening and no period activity reconciles (opening == closing)", () => {
    const people = [person("p-ana")];
    const txs: Transaction[] = [
      expense({ id: "jan", date: "2026-01-10", splits: [{ personId: "p-ana", shareCents: 9_000 }] }),
    ];
    const { movements, balances } = computePersonLedger(people, txs, [], "2026-05", calOf);
    const w = windowFor("p-ana", movements, "2026-03", "2026-05");
    expect(w.openingCents).toBe(9_000);
    expect(w.debitCents).toBe(0);
    expect(w.creditCents).toBe(0);
    expect(w.finalRunningCents).toBe(balances.get("p-ana")?.cents);
  });

  it("flags projected recurring occurrences (and not the real anchor)", () => {
    const people = [person("p-ana")];
    const txs: Transaction[] = [
      expense({
        id: "internet",
        date: "2026-01-15",
        recurrence: { dayOfMonth: 15 },
        splits: [{ personId: "p-ana", shareCents: 10_000 }],
      }),
    ];
    const { movements } = computePersonLedger(people, txs, [], "2026-03", calOf);
    const jan = movements.find((m) => m.competence === "2026-01");
    const feb = movements.find((m) => m.competence === "2026-02");
    const mar = movements.find((m) => m.competence === "2026-03");
    expect(jan?.projected).toBe(false); // real anchor
    expect(feb?.projected).toBe(true); // projected occurrence
    expect(mar?.projected).toBe(true);
  });

  it("flags a future ('futura') installment parcela as projected", () => {
    const people = [person("p-x")];
    const txs: Transaction[] = [
      expense({
        id: "p5",
        date: "2026-07-18",
        splits: [{ personId: "p-x", shareCents: 34_765 }],
        installment: { groupId: "g", number: 5, total: 12, status: "futura" },
      }),
    ];
    const { movements } = computePersonLedger(people, txs, [], "2026-07", calOf);
    const mv = movements.find((m) => m.personId === "p-x");
    expect(mv?.projected).toBe(true);
    expect(mv?.signedDeltaCents).toBe(34_765);
  });

  // Property: for any window, opening + period(debits − credits) == closing, and the
  // running balance reconstructed from the opening lands exactly on the closing balance.
  it("reconciles every window: opening + period == closing (property)", () => {
    const personIdArb = fc.constantFrom("p-a", "p-b", "p-c");
    const monthArb = fc.constantFrom("2026-01", "2026-02", "2026-03", "2026-04", "2026-05");
    const dateIn = (m: string) => `${m}-10`;
    const shareArb = fc.record({
      personId: personIdArb,
      month: monthArb,
      shareCents: fc.integer({ min: 1, max: 100_000 }),
    });
    const payArb = fc.record({
      personId: personIdArb,
      month: monthArb,
      amountCents: fc.integer({ min: 1, max: 50_000 }),
    });
    const settArb = fc.record({
      personId: personIdArb,
      month: monthArb,
      amountCents: fc.integer({ min: 1, max: 120_000 }),
    });

    fc.assert(
      fc.property(
        fc.array(shareArb, { maxLength: 12 }),
        fc.array(payArb, { maxLength: 8 }),
        fc.array(settArb, { maxLength: 6 }),
        fc.tuple(monthArb, monthArb),
        (shares, pays, setts, [a, b]) => {
          const [from, to] = a <= b ? [a, b] : [b, a];
          const people = [person("p-a"), person("p-b"), person("p-c")];
          const txs: Transaction[] = [
            ...shares.map(
              (s, i): Transaction =>
                expense({
                  id: `e${i}`,
                  date: dateIn(s.month),
                  splits: [{ personId: s.personId, shareCents: s.shareCents }],
                }),
            ),
            ...pays.map(
              (p, i): Transaction =>
                income({
                  id: `i${i}`,
                  date: dateIn(p.month),
                  amountCents: p.amountCents,
                  fromPersonId: p.personId,
                }),
            ),
          ];
          const settlements: Settlement[] = setts.map((s, i) => ({
            id: `s${i}`,
            personId: s.personId,
            amountCents: s.amountCents,
            date: dateIn(s.month),
            accountId: null,
          }));

          const { movements, balances } = computePersonLedger(people, txs, settlements, to, calOf);
          for (const id of ["p-a", "p-b", "p-c"]) {
            const w = windowFor(id, movements, from, to);
            const closing = balances.get(id)?.cents ?? 0;
            expect(w.openingCents + w.debitCents - w.creditCents).toBe(closing);
            expect(w.finalRunningCents).toBe(closing);
          }
        },
      ),
    );
  });
});

describe("computePersonMonthNetsAndSettledCash — settlement cash by covered competence", () => {
  const bankSettle = (over: Partial<Settlement>): Settlement => ({
    id: "sb",
    personId: "p-a",
    amountCents: 0,
    date: "2026-06-10",
    accountId: "nu",
    ...over,
  });

  it("re-buckets a pre-payment's cash onto the covered debt's month (none before the debt exists)", () => {
    const people = [person("p-a")];
    // Debt lands in JULY; the person pays in JUNE (advance).
    const txs: Transaction[] = [
      expense({ id: "e1", date: "2026-07-05", splits: [{ personId: "p-a", shareCents: 1200 }] }),
    ];
    const setts = [bankSettle({ amountCents: 1200, date: "2026-06-12" })];
    // Horizon June: the July debt is outside the ledger, the settlement clamps to zero → no cash.
    const june = computePersonMonthNetsAndSettledCash(people, txs, setts, "2026-06", calOf);
    expect(june.settledCashByMonth.size).toBe(0);
    // Horizon July: the cash covers the July bucket — not June, where the money arrived.
    const july = computePersonMonthNetsAndSettledCash(people, txs, setts, "2026-07", calOf);
    expect(july.settledCashByMonth.get("2026-07")).toBe(1200);
    expect(july.settledCashByMonth.get("2026-06")).toBeUndefined();
    expect(july.nets.get("p-a")?.get("2026-07") ?? 0).toBe(0);
  });

  it("splits coverage oldest-first across the covered months", () => {
    const people = [person("p-a")];
    const txs: Transaction[] = [
      expense({ id: "e1", date: "2026-06-05", splits: [{ personId: "p-a", shareCents: 1000 }] }),
      expense({ id: "e2", date: "2026-07-05", splits: [{ personId: "p-a", shareCents: 800 }] }),
    ];
    const setts = [bankSettle({ amountCents: 1500, date: "2026-06-20" })];
    const r = computePersonMonthNetsAndSettledCash(people, txs, setts, "2026-07", calOf);
    expect(r.settledCashByMonth.get("2026-06")).toBe(1000);
    expect(r.settledCashByMonth.get("2026-07")).toBe(500);
    expect(r.nets.get("p-a")?.get("2026-07") ?? 0).toBe(300);
  });

  it("an excess advance beyond the covered debts emits no cash (parked, not earned)", () => {
    const people = [person("p-a")];
    const txs: Transaction[] = [
      expense({ id: "e1", date: "2026-06-05", splits: [{ personId: "p-a", shareCents: 1000 }] }),
    ];
    const setts = [bankSettle({ amountCents: 1500, date: "2026-06-20" })];
    const r = computePersonMonthNetsAndSettledCash(people, txs, setts, "2026-07", calOf);
    expect(r.settledCashByMonth.get("2026-06")).toBe(1000);
    let total = 0;
    for (const v of r.settledCashByMonth.values()) total += v;
    expect(total).toBe(1000); // the extra R$5 stays held — never counted as month cash
  });

  it("paying a person YOU owe emits negative cash in the covered month", () => {
    const people = [person("p-a")];
    // A received payment from the person with no debt → you owe them (negative June bucket).
    const txs: Transaction[] = [income({ id: "i1", amountCents: 1200, fromPersonId: "p-a" })];
    const setts = [bankSettle({ amountCents: 1200, date: "2026-06-20" })];
    const r = computePersonMonthNetsAndSettledCash(people, txs, setts, "2026-06", calOf);
    expect(r.settledCashByMonth.get("2026-06")).toBe(-1200);
    expect(r.nets.get("p-a")?.get("2026-06") ?? 0).toBe(0);
  });

  it("a 'sem conta' settlement (perdão) covers buckets but emits NO cash", () => {
    const people = [person("p-a")];
    const txs: Transaction[] = [
      expense({ id: "e1", date: "2026-06-05", splits: [{ personId: "p-a", shareCents: 1000 }] }),
    ];
    const setts = [bankSettle({ amountCents: 1000, date: "2026-06-20", accountId: null })];
    const r = computePersonMonthNetsAndSettledCash(people, txs, setts, "2026-06", calOf);
    expect(r.settledCashByMonth.size).toBe(0);
    expect(r.nets.get("p-a")?.get("2026-06") ?? 0).toBe(0); // the debt is still forgiven
  });
});

describe("computePersonLedger — projected card occurrences bucket by BILL competence", () => {
  // Nubank-style cycle: closes 24, due 2 → a charge on the 4th bills the NEXT month.
  const card: CreditCard = {
    id: "c-nu",
    bank: "Nubank",
    product: "Gold",
    flag: "mastercard",
    themeKey: "",
    maskedNumber: "",
    limitCents: 1_000_000,
    closingDay: 24,
    dueDay: 2,
  };
  const billOf = billingCompetence([card]);
  // "Google Weverse Connec": R$10,99 on the 4th, 100% the person's, anchored in June (bills July).
  const weverse = expense({
    id: "weverse",
    description: "Google Weverse Connec",
    date: "2026-06-04",
    amountCents: -1099,
    myShareCents: 0,
    splits: [{ personId: "p-a", shareCents: 1099 }],
    recurrence: { dayOfMonth: 4 },
  });
  const people = [person("p-a")];

  it("charges the person in the fatura month, not the month the charge happens", () => {
    // August's occurrence is the 04/07 charge (bills August) — NOT 04/08 (which bills September).
    const august = computePersonLedger(people, [weverse], [], "2026-08", billOf);
    const projected = august.movements.filter((m) => m.projected);
    const inAugust = projected.filter((m) => m.competence === "2026-08");

    expect(inAugust).toHaveLength(1);
    expect(inAugust[0]?.date).toBe("2026-07-04");
    expect(inAugust[0]?.signedDeltaCents).toBe(1099);
    // Nothing charged twice: the 04/08 charge belongs to September's bill.
    expect(projected.some((m) => m.date === "2026-08-04" && m.competence === "2026-08")).toBe(false);
  });

  it("a real charge already booked in the bill suppresses that month's projection", () => {
    // The user re-entered the July charge by hand — a plain (non-recurring) row.
    const manual = expense({
      id: "weverse-jul",
      description: "Google Weverse Connec",
      date: "2026-07-04",
      amountCents: -1099,
      myShareCents: 0,
      splits: [{ personId: "p-a", shareCents: 1099 }],
    });
    const august = computePersonLedger(people, [weverse, manual], [], "2026-08", billOf);
    const inAugust = august.movements.filter((m) => m.competence === "2026-08");

    expect(inAugust).toHaveLength(1);
    expect(inAugust[0]?.projected).toBe(false);
    // August's bill charges 10,99 once, not twice (the running balance also carries July's bill,
    // which the June anchor charge lands in — 2× 10,99 through August).
    expect(inAugust.reduce((s, m) => s + m.signedDeltaCents, 0)).toBe(1099);
    expect(august.balances.get("p-a")?.cents).toBe(2198);
  });

  it("emits one occurrence per rule even when the same rule has two anchors", () => {
    const duplicateAnchor = { ...weverse, id: "weverse-2", date: "2026-05-04" as const };
    const august = computePersonLedger(people, [weverse, duplicateAnchor], [], "2026-08", billOf);
    expect(august.movements.filter((m) => m.projected && m.competence === "2026-08")).toHaveLength(1);
  });
});

describe("computePersonBookedBalancesThrough", () => {
  const people = [person("p-a")];

  it("counts only BOOKED debt — a projected recurring occurrence is not a debt yet", () => {
    const rule = expense({
      id: "netflix",
      date: "2026-06-10",
      source: "account",
      cardId: null,
      accountId: "nu",
      splits: [{ personId: "p-a", shareCents: 2000 }],
      recurrence: { dayOfMonth: 10 },
    });
    // Through August the projection-aware ledger accrues June + July + August (3× 20,00);
    // the booked view sees only the real June row.
    expect(computePersonBalancesThrough(people, [rule], [], "2026-08", calOf).get("p-a")?.cents).toBe(6000);
    expect(computePersonBookedBalancesThrough(people, [rule], [], "2026-08", calOf).get("p-a")?.cents).toBe(
      2000,
    );
  });

  it("nets settlements up to the month and buckets a received payment by its RECEIPT month", () => {
    const debt = expense({
      id: "e1",
      date: "2026-06-05",
      splits: [{ personId: "p-a", shareCents: 10_000 }],
    });
    // Booked in July but only received in September — it must not abate the June/July balance.
    const late = income({
      id: "i1",
      date: "2026-07-01",
      amountCents: 4000,
      fromPersonId: "p-a",
      isReimbursement: true,
      receivedAt: "2026-09-02",
      receivedAccountId: "nu",
      receivedAmountCents: 4000,
    });
    const setts = [settlement("p-a", 1000)]; // 2026-06-10, no account (perdão)

    expect(
      computePersonBookedBalancesThrough(people, [debt, late], setts, "2026-07", calOf).get("p-a")?.cents,
    ).toBe(9000); // 100,00 − 10,00 settled; the September receipt is still out of range
    expect(
      computePersonBookedBalancesThrough(people, [debt, late], setts, "2026-09", calOf).get("p-a")?.cents,
    ).toBe(5000); // − 40,00 once received
  });
});
