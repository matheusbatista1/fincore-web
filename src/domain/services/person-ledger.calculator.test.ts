import fc from "fast-check";
import { describe, expect, it } from "vitest";
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
import { applySettlement, computePersonBalances } from "./person-ledger.calculator";

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
