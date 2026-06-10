import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CreditCard } from "../entities/credit-card";
import type {
  ExpenseTransaction,
  IncomeTransaction,
  ParcelaStatus,
  Transaction,
  TransferTransaction,
} from "../entities/transaction";
import { Money } from "../money/money";
import { cardUtilization, computeCardBill, computeCardBills } from "./card-bill.calculator";

// ---------------------------------------------------------------------------
// Test factories — keep each fixture minimal but type-complete under strict mode.
// ---------------------------------------------------------------------------

let seq = 0;
const nextId = () => `tx-${++seq}`;

function card(id: string, limitCents: number): CreditCard {
  return {
    id,
    bank: "Bank",
    product: "Product",
    flag: "mastercard",
    themeKey: "theme",
    maskedNumber: "•••• 0000",
    limitCents,
    closingDay: 3,
    dueDay: 10,
  };
}

/** A card expense; `cents` is the stored (negative) amount, `cardId` the target. */
function cardExpense(
  cents: number,
  cardId: string,
  installment?: { number: number; total: number; status: ParcelaStatus },
): ExpenseTransaction {
  return {
    id: nextId(),
    kind: "expense",
    description: "Card charge",
    date: "2026-06-10",
    amountCents: cents,
    categoryId: null,
    source: "card",
    cardId,
    accountId: null,
    linkedAccountId: null,
    splits: [],
    myShareCents: Math.abs(cents),
    installment: installment === undefined ? null : { groupId: "grp", ...installment },
    recurrence: null,
  };
}

/** A non-card expense (e.g. paid via account) — must never hit any bill. */
function accountExpense(cents: number, accountId: string): ExpenseTransaction {
  return {
    id: nextId(),
    kind: "expense",
    description: "Account charge",
    date: "2026-06-10",
    amountCents: cents,
    categoryId: null,
    source: "account",
    cardId: null,
    accountId,
    linkedAccountId: null,
    splits: [],
    myShareCents: Math.abs(cents),
    installment: null,
    recurrence: null,
  };
}

function income(cents: number, accountId: string): IncomeTransaction {
  return {
    id: nextId(),
    kind: "income",
    description: "Income",
    date: "2026-06-05",
    amountCents: cents,
    accountId,
    fromPersonId: null,
    isReimbursement: false,
    recurrence: null,
  };
}

function transfer(cents: number): TransferTransaction {
  return {
    id: nextId(),
    kind: "transfer",
    description: "Transfer",
    date: "2026-06-09",
    fromAccountId: "a",
    toAccountId: "b",
    valueCents: cents,
  };
}

// ---------------------------------------------------------------------------
// Concrete examples taken from the prototype seed data (data.js).
// ---------------------------------------------------------------------------

describe("computeCardBill — prototype seed examples", () => {
  // Nubank (c-nu): t1 148.00 + t5 500.00 + t11 276.00 = 924.00 — all non-installment.
  it("sums the Nubank card charges", () => {
    const txs: Transaction[] = [
      cardExpense(-14_800, "c-nu"),
      cardExpense(-50_000, "c-nu"),
      cardExpense(-27_600, "c-nu"),
    ];
    expect(computeCardBill("c-nu", txs).cents).toBe(92_400);
  });

  // C6 (c-c6): t3 32.40 + t4 342.80 + t8 210.00 + t12b (atual) 480.00 = 1065.20.
  // The Notebook Dell installment: parcela 3/10 "paga" and 5/10 "futura" are excluded.
  it("counts only the 'atual' installment for the C6 card", () => {
    const txs: Transaction[] = [
      cardExpense(-3_240, "c-c6"),
      cardExpense(-34_280, "c-c6"),
      cardExpense(-21_000, "c-c6"),
      cardExpense(-48_000, "c-c6", { number: 4, total: 10, status: "atual" }),
      cardExpense(-48_000, "c-c6", { number: 3, total: 10, status: "paga" }),
      cardExpense(-48_000, "c-c6", { number: 5, total: 10, status: "futura" }),
    ];
    expect(computeCardBill("c-c6", txs).cents).toBe(106_520);
  });

  // Itaú (c-it): t6 Netflix 55.90 + t13 Spotify 34.90 = 90.80.
  it("sums the Itaú card charges", () => {
    const txs: Transaction[] = [cardExpense(-5_590, "c-it"), cardExpense(-3_490, "c-it")];
    expect(computeCardBill("c-it", txs).cents).toBe(9_080);
  });

  // Santander (c-sa): t7 Farmácia 89.30.
  it("sums the Santander card charges", () => {
    expect(computeCardBill("c-sa", [cardExpense(-8_930, "c-sa")]).cents).toBe(8_930);
  });

  it("ignores non-card expenses, income and transfers", () => {
    const txs: Transaction[] = [
      cardExpense(-14_800, "c-nu"),
      accountExpense(-12_990, "nu"), // academia via account — not on any bill
      income(920_000, "it"), // salário
      transfer(200_000), // transferência p/ fatura
    ];
    expect(computeCardBill("c-nu", txs).cents).toBe(14_800);
  });
});

describe("computeCardBills — full prototype fixture", () => {
  const cards = [
    card("c-nu", 1_200_000),
    card("c-c6", 2_500_000),
    card("c-it", 900_000),
    card("c-sa", 600_000),
  ];

  const transactions: Transaction[] = [
    // Nubank
    cardExpense(-14_800, "c-nu"),
    cardExpense(-50_000, "c-nu"),
    cardExpense(-27_600, "c-nu"),
    // C6
    cardExpense(-3_240, "c-c6"),
    cardExpense(-34_280, "c-c6"),
    cardExpense(-21_000, "c-c6"),
    cardExpense(-48_000, "c-c6", { number: 4, total: 10, status: "atual" }),
    cardExpense(-48_000, "c-c6", { number: 3, total: 10, status: "paga" }),
    cardExpense(-48_000, "c-c6", { number: 5, total: 10, status: "futura" }),
    // Itaú
    cardExpense(-5_590, "c-it"),
    cardExpense(-3_490, "c-it"),
    // Santander
    cardExpense(-8_930, "c-sa"),
    // noise
    accountExpense(-12_990, "nu"),
    income(920_000, "it"),
    transfer(200_000),
  ];

  it("computes every card bill in one pass", () => {
    const bills = computeCardBills(cards, transactions);
    expect(bills.get("c-nu")?.cents).toBe(92_400);
    expect(bills.get("c-c6")?.cents).toBe(106_520);
    expect(bills.get("c-it")?.cents).toBe(9_080);
    expect(bills.get("c-sa")?.cents).toBe(8_930);
  });

  it("includes an entry for every card and matches the single-card calculator", () => {
    const bills = computeCardBills(cards, transactions);
    expect([...bills.keys()]).toEqual(["c-nu", "c-c6", "c-it", "c-sa"]);
    for (const c of cards) {
      expect(bills.get(c.id)?.cents).toBe(computeCardBill(c.id, transactions).cents);
    }
  });

  it("maps cards with no charges to zero", () => {
    const bills = computeCardBills([...cards, card("c-empty", 100_000)], transactions);
    expect(bills.get("c-empty")?.cents).toBe(0);
    expect(bills.get("c-empty")?.isZero()).toBe(true);
  });

  it("ignores charges to a card not in the list", () => {
    const bills = computeCardBills(
      [card("c-only", 100_000)],
      [cardExpense(-5_000, "c-only"), cardExpense(-9_999, "c-other")],
    );
    expect([...bills.keys()]).toEqual(["c-only"]);
    expect(bills.get("c-only")?.cents).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// Property tests — business invariants.
// ---------------------------------------------------------------------------

const CARD_ID = "card-x";

// An arbitrary card expense charged to CARD_ID (stored amount is negative).
const qualifyingArb = fc
  .record({
    cents: fc.integer({ min: 1, max: 5_000_000 }),
    installment: fc.option(
      fc.record({ number: fc.integer({ min: 1, max: 24 }), total: fc.integer({ min: 1, max: 24 }) }),
      { nil: undefined },
    ),
  })
  .map(({ cents, installment }) =>
    cardExpense(
      -cents,
      CARD_ID,
      installment === undefined
        ? undefined
        : { number: installment.number, total: installment.total, status: "atual" },
    ),
  );

// A card expense that must NOT count: a "paga" or "futura" installment on CARD_ID.
const nonCurrentInstallmentArb = fc
  .record({
    cents: fc.integer({ min: 1, max: 5_000_000 }),
    status: fc.constantFrom<ParcelaStatus>("paga", "futura"),
    number: fc.integer({ min: 1, max: 24 }),
    total: fc.integer({ min: 1, max: 24 }),
  })
  .map(({ cents, status, number, total }) => cardExpense(-cents, CARD_ID, { number, total, status }));

// Noise that must never affect CARD_ID's bill.
const noiseArb: fc.Arbitrary<Transaction> = fc.oneof(
  fc.integer({ min: 1, max: 5_000_000 }).map((c) => cardExpense(-c, "other-card")),
  fc.integer({ min: 1, max: 5_000_000 }).map((c) => accountExpense(-c, "acct")),
  fc.integer({ min: 1, max: 5_000_000 }).map((c) => income(c, "acct")),
  fc.integer({ min: 1, max: 5_000_000 }).map((c) => transfer(c)),
);

/** Deterministically reorder `items` by the given permutation of indices. */
function reorder<T>(items: readonly T[], order: readonly number[]): T[] {
  return order.map((i) => items[i]).filter((x): x is T => x !== undefined);
}

describe("computeCardBill — invariants", () => {
  it("a card with no expenses bills zero", () => {
    fc.assert(
      fc.property(fc.array(noiseArb, { maxLength: 20 }), (noise) => {
        expect(computeCardBill(CARD_ID, noise).isZero()).toBe(true);
      }),
    );
  });

  it("the bill equals the sum of qualifying expenses, regardless of order or noise", () => {
    fc.assert(
      fc.property(
        fc.array(qualifyingArb, { maxLength: 20 }),
        fc.array(nonCurrentInstallmentArb, { maxLength: 20 }),
        fc.array(noiseArb, { maxLength: 20 }),
        // A permutation of [0..n) used to interleave the three groups deterministically.
        fc.infiniteStream(fc.double({ min: 0, max: 1, noNaN: true })),
        (qualifying, nonCurrent, noise, randomStream) => {
          const expected = Money.sum(qualifying.map((e) => Money.fromCents(e.amountCents).abs()));
          const all = [...qualifying, ...nonCurrent, ...noise];
          // Build a permutation of indices via a Fisher–Yates shuffle driven by the stream.
          const order = all.map((_, i) => i);
          const iter = randomStream[Symbol.iterator]();
          for (let i = order.length - 1; i > 0; i--) {
            const r = iter.next().value ?? 0;
            const j = Math.floor(r * (i + 1));
            const a = order[i] as number;
            const b = order[j] as number;
            order[i] = b;
            order[j] = a;
          }
          expect(computeCardBill(CARD_ID, reorder(all, order)).cents).toBe(expected.cents);
        },
      ),
    );
  });

  it("'paga' and 'futura' installments never count toward the current bill", () => {
    fc.assert(
      fc.property(fc.array(nonCurrentInstallmentArb, { maxLength: 30 }), (txs) => {
        expect(computeCardBill(CARD_ID, txs).isZero()).toBe(true);
      }),
    );
  });

  it("adding one 'atual' installment increases the bill by exactly its absolute amount", () => {
    fc.assert(
      fc.property(
        fc.array(qualifyingArb, { maxLength: 15 }),
        fc.integer({ min: 1, max: 5_000_000 }),
        (base, cents) => {
          const before = computeCardBill(CARD_ID, base);
          const extra = cardExpense(-cents, CARD_ID, {
            number: 2,
            total: 5,
            status: "atual",
          });
          const after = computeCardBill(CARD_ID, [...base, extra]);
          expect(after.cents).toBe(before.cents + cents);
        },
      ),
    );
  });

  it("the bill is always non-negative", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(qualifyingArb, nonCurrentInstallmentArb, noiseArb), {
          maxLength: 30,
        }),
        (txs) => {
          expect(computeCardBill(CARD_ID, txs).isNegative()).toBe(false);
        },
      ),
    );
  });
});

describe("computeCardBills — invariants", () => {
  it("the per-card total equals computeCardBill for that card", () => {
    const cardIdArb = fc.constantFrom("c-a", "c-b", "c-c");
    const anyExpenseArb = fc.oneof(
      fc.tuple(fc.integer({ min: 1, max: 1_000_000 }), cardIdArb).map(([c, id]) => cardExpense(-c, id)),
      fc
        .tuple(
          fc.integer({ min: 1, max: 1_000_000 }),
          cardIdArb,
          fc.constantFrom<ParcelaStatus>("paga", "atual", "futura"),
        )
        .map(([c, id, status]) => cardExpense(-c, id, { number: 1, total: 3, status })),
    );

    fc.assert(
      fc.property(fc.array(anyExpenseArb, { maxLength: 40 }), (txs) => {
        const cards = [card("c-a", 100), card("c-b", 100), card("c-c", 100)];
        const bills = computeCardBills(cards, txs);
        for (const c of cards) {
          expect(bills.get(c.id)?.cents).toBe(computeCardBill(c.id, txs).cents);
        }
      }),
    );
  });
});

describe("cardUtilization", () => {
  it("matches the prototype seed ratios (bill / limit)", () => {
    // C6: bill 1065.20 against a 25 000 limit ≈ 0.042608.
    expect(cardUtilization(Money.fromCents(106_520), card("c-c6", 2_500_000))).toBeCloseTo(0.042608, 6);
  });

  it("returns 0 / 1 / >1 at the limit boundaries", () => {
    const c = card("c", 100_000);
    expect(cardUtilization(Money.zero(), c)).toBe(0);
    expect(cardUtilization(Money.fromCents(50_000), c)).toBe(0.5);
    expect(cardUtilization(Money.fromCents(100_000), c)).toBe(1);
    expect(cardUtilization(Money.fromCents(150_000), c)).toBe(1.5);
  });

  it("never returns a negative or NaN ratio, and handles a zero limit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (billCents, limitCents) => {
          const ratio = cardUtilization(Money.fromCents(billCents), card("c", limitCents));
          expect(Number.isNaN(ratio)).toBe(false);
          expect(ratio).toBeGreaterThanOrEqual(0);
          if (limitCents <= 0) {
            expect(ratio).toBe(billCents === 0 ? 0 : Number.POSITIVE_INFINITY);
          } else {
            expect(ratio).toBeCloseTo(billCents / limitCents, 10);
          }
        },
      ),
    );
  });
});
