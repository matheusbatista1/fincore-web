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
import {
  billingCompetence,
  cardBillMonth,
  cardUtilization,
  computeCardBill,
  computeCardBillForMonth,
  computeCardBills,
  computeCardBillsForMonth,
  computeCardOpenBill,
  computeCardOutstanding,
  computeCardOutstandings,
} from "./card-bill.calculator";

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
    billMonthOverride: null,
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
    billMonthOverride: null,
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
    cardId: null,
    fromPersonId: null,
    isReimbursement: false,
    recurrence: null,
  };
}

/** A card credit (estorno): a positive income whose destination is a card. */
function cardCredit(cents: number, cardId: string, date = "2026-06-05"): IncomeTransaction {
  return {
    id: nextId(),
    kind: "income",
    description: "Estorno",
    date,
    amountCents: cents,
    accountId: null,
    cardId,
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

describe("cardBillMonth", () => {
  it("rolls a charge after the closing day into the next cycle (due month)", () => {
    // Caixa: closes 24, due 2. Buy 26/05 → closes 24/06 → due 02/07.
    expect(cardBillMonth("2026-05-26", 24, 2)).toBe("2026-07");
  });

  it("keeps a charge on/before the closing day in the closing cycle", () => {
    expect(cardBillMonth("2026-05-20", 24, 2)).toBe("2026-06");
    // On the closing day itself still counts in that cycle.
    expect(cardBillMonth("2026-05-24", 24, 2)).toBe("2026-06");
  });

  it("labels by the same month when the due day comes after the closing day", () => {
    // Closes 5, due 20 → due in the closing month.
    expect(cardBillMonth("2026-05-03", 5, 20)).toBe("2026-05");
    expect(cardBillMonth("2026-05-07", 5, 20)).toBe("2026-06");
  });

  it("crosses the year boundary", () => {
    // Closes 24, due 2. Buy 30/12 → closes 24/01 → due 02/02.
    expect(cardBillMonth("2026-12-30", 24, 2)).toBe("2027-02");
  });

  it("honors a per-bill closing-day override only for that bill", () => {
    // Closes 24, due 2 (dueOffset +1). The July bill closes early on the 22nd.
    const overrides = new Map([["2026-07", { closingDay: 22, dueDay: 4 }]]);
    // A 23/06 charge: default closes 24/06 → bill JULY; override closes 22/06 → rolls to AUGUST.
    expect(cardBillMonth("2026-06-23", 24, 2)).toBe("2026-07");
    expect(cardBillMonth("2026-06-23", 24, 2, overrides)).toBe("2026-08");
    // Other months keep the default (no override for the June bill that closes in May).
    expect(cardBillMonth("2026-05-23", 24, 2, overrides)).toBe("2026-06");
  });
});

describe("billingCompetence", () => {
  // Caixa-style card: closes 24, due 2.
  const caixa: CreditCard = { ...card("card-1", 100000), closingDay: 24, dueDay: 2 };
  const resolve = billingCompetence([caixa]);

  it("buckets a card charge by its bill's due month", () => {
    const charge: ExpenseTransaction = { ...cardExpense(-60762, "card-1"), date: "2026-05-26" };
    expect(resolve(charge)).toBe("2026-07");
  });

  it("keeps a non-card expense on the calendar month of its date", () => {
    const pix: ExpenseTransaction = { ...accountExpense(-5000, "acc-1"), date: "2026-05-26" };
    expect(resolve(pix)).toBe("2026-05");
  });

  it("keeps income on the calendar month of its date", () => {
    expect(resolve({ ...income(300000, "acc-1"), date: "2026-05-26" })).toBe("2026-05");
  });

  it("falls back to the date month for a charge on an unknown card", () => {
    const charge: ExpenseTransaction = { ...cardExpense(-1000, "ghost"), date: "2026-05-26" };
    expect(resolve(charge)).toBe("2026-05");
  });

  it("buckets a card credit (estorno) by the card's bill due month, like a charge", () => {
    const caixa2: CreditCard = { ...card("card-1", 100000), closingDay: 24, dueDay: 2 };
    const resolve2 = billingCompetence([caixa2]);
    expect(resolve2({ ...cardCredit(600, "card-1", "2026-05-26") })).toBe("2026-07");
  });
});

// ---------------------------------------------------------------------------
// Month-scoped bill ("fatura do mês") and total outstanding ("limite utilizado").
// A card that closes 28 / due 29 keeps a charge dated ≤ 28 in its own calendar
// month, so competence == the date's month — making these cases easy to read.
// ---------------------------------------------------------------------------

describe("computeCardBillsForMonth — scoped by competence month", () => {
  const c: CreditCard = { ...card("c", 1_000_000), closingDay: 28, dueDay: 29 };
  const resolve = billingCompetence([c]);
  const jun: ExpenseTransaction = { ...cardExpense(-10_000, "c"), date: "2026-06-15" };
  const jul: ExpenseTransaction = { ...cardExpense(-20_000, "c"), date: "2026-07-15" };
  const jul2: ExpenseTransaction = { ...cardExpense(-5_000, "c"), date: "2026-07-20" };
  const txs: Transaction[] = [jun, jul, jul2];

  it("returns only the charges whose bill falls in the given month", () => {
    expect(computeCardBillsForMonth([c], txs, "2026-06", resolve).get("c")?.cents).toBe(10_000);
    expect(computeCardBillsForMonth([c], txs, "2026-07", resolve).get("c")?.cents).toBe(25_000);
    expect(computeCardBillsForMonth([c], txs, "2026-08", resolve).get("c")?.cents).toBe(0);
  });

  it("subtracts an estorno bucketed into the same bill month", () => {
    const credit: IncomeTransaction = cardCredit(3_000, "c", "2026-07-10");
    expect(computeCardBillsForMonth([c], [...txs, credit], "2026-07", resolve).get("c")?.cents).toBe(22_000);
  });

  it("seeds every card with zero and ignores non-card expenses", () => {
    const bills = computeCardBillsForMonth(
      [c, card("empty", 100)],
      [accountExpense(-9_999, "acc"), jun],
      "2026-06",
      resolve,
    );
    expect(bills.get("empty")?.cents).toBe(0);
    expect(bills.get("c")?.cents).toBe(10_000);
  });

  it("excludes charges and credits belonging to a different card", () => {
    const foreignCharge: ExpenseTransaction = { ...cardExpense(-7_777, "other"), date: "2026-06-15" };
    const foreignCredit: IncomeTransaction = cardCredit(1_000, "other", "2026-06-10");
    expect(computeCardBillForMonth("c", [jun, foreignCharge, foreignCredit], "2026-06", resolve).cents).toBe(
      10_000,
    );
  });
});

describe("computeCardOutstanding(s) — total committed against the limit", () => {
  const c: CreditCard = { ...card("c", 1_000_000), closingDay: 28, dueDay: 29 };
  const resolve = billingCompetence([c]);
  const currentMonth = "2026-07";
  // A paid past bill (June), the current bill (July), and two future installments.
  const past: ExpenseTransaction = { ...cardExpense(-10_000, "c"), date: "2026-06-15" };
  const atual: ExpenseTransaction = {
    ...cardExpense(-20_000, "c", { number: 1, total: 3, status: "atual" }),
    date: "2026-07-15",
  };
  const fut1: ExpenseTransaction = {
    ...cardExpense(-20_000, "c", { number: 2, total: 3, status: "futura" }),
    date: "2026-08-15",
  };
  const fut2: ExpenseTransaction = {
    ...cardExpense(-20_000, "c", { number: 3, total: 3, status: "futura" }),
    date: "2026-09-15",
  };
  const txs: Transaction[] = [past, atual, fut1, fut2];

  it("includes the current + all future bills and excludes paid past ones", () => {
    expect(computeCardOutstanding("c", txs, currentMonth, resolve).cents).toBe(60_000);
  });

  it("future installments count toward outstanding but NOT toward the current month's bill", () => {
    expect(computeCardBillsForMonth([c], txs, currentMonth, resolve).get("c")?.cents).toBe(20_000);
    expect(computeCardOutstanding("c", txs, currentMonth, resolve).cents).toBe(60_000);
  });

  it("an estorno in the window reduces the outstanding", () => {
    const credit: IncomeTransaction = cardCredit(5_000, "c", "2026-07-10");
    expect(computeCardOutstanding("c", [...txs, credit], currentMonth, resolve).cents).toBe(55_000);
  });

  it("frees the committed limit when a bill's competence is explicitly paid", () => {
    // Paying the July fatura removes its R$200 from the used limit → only Aug + Sep (40k) remain.
    const pay = {
      id: "p",
      cardId: "c",
      competence: "2026-07",
      amountCents: 20_000,
      accountId: "acc",
      date: "2026-07-20" as const,
    };
    expect(computeCardOutstanding("c", txs, currentMonth, resolve, [pay]).cents).toBe(40_000);
    // A payment for a DIFFERENT card doesn't free this card's limit.
    const other = { ...pay, cardId: "zzz" };
    expect(computeCardOutstanding("c", txs, currentMonth, resolve, [other]).cents).toBe(60_000);
  });

  it("computeCardOutstandings matches the single-card version and seeds zero", () => {
    const cards = [c, card("empty", 100)];
    const out = computeCardOutstandings(cards, txs, currentMonth, resolve);
    expect(out.get("c")?.cents).toBe(computeCardOutstanding("c", txs, currentMonth, resolve).cents);
    expect(out.get("empty")?.cents).toBe(0);
  });

  it("ignores non-card expenses, account income and transfers", () => {
    const noise: Transaction[] = [accountExpense(-9_999, "acc"), income(500_000, "acc"), transfer(1_000)];
    expect(computeCardOutstanding("c", [...txs, ...noise], currentMonth, resolve).cents).toBe(60_000);
  });

  it("excludes charges and credits belonging to a different card", () => {
    const foreignCharge: ExpenseTransaction = { ...cardExpense(-7_777, "other"), date: "2026-07-15" };
    const foreignCredit: IncomeTransaction = cardCredit(1_000, "other", "2026-07-10");
    expect(
      computeCardOutstanding("c", [...txs, foreignCharge, foreignCredit], currentMonth, resolve).cents,
    ).toBe(60_000);
  });

  it("excludes a rolled (abated) card charge from outstanding and the month bill", () => {
    const rolled: ExpenseTransaction = {
      ...cardExpense(-50_000, "c"),
      date: "2026-07-15",
      rolledAt: "2026-07-16",
    };
    expect(computeCardOutstanding("c", [rolled], currentMonth, resolve).cents).toBe(0);
    expect(computeCardBillForMonth("c", [rolled], "2026-07", resolve).cents).toBe(0);
  });
});

describe("card credits (estorno) reduce the bill", () => {
  it("subtracts a card credit from the card's bill", () => {
    const txs: Transaction[] = [cardExpense(-20000, "card-1"), cardCredit(600, "card-1")];
    expect(computeCardBill("card-1", txs).cents).toBe(19400);
  });

  it("ignores a credit recorded against a different card", () => {
    const txs: Transaction[] = [cardExpense(-20000, "card-1"), cardCredit(600, "card-2")];
    expect(computeCardBill("card-1", txs).cents).toBe(20000);
  });

  it("lets a bill go negative when credits exceed charges (credit balance)", () => {
    const txs: Transaction[] = [cardExpense(-500, "card-1"), cardCredit(600, "card-1")];
    const bill = computeCardBill("card-1", txs);
    expect(bill.cents).toBe(-100);
    expect(bill.isNegative()).toBe(true);
  });

  it("nets charges and credits per card in computeCardBills", () => {
    const cards = [card("card-1", 100000), card("card-2", 100000)];
    const txs: Transaction[] = [
      cardExpense(-20000, "card-1"),
      cardCredit(600, "card-1"),
      cardExpense(-5000, "card-2"),
    ];
    const bills = computeCardBills(cards, txs);
    expect(bills.get("card-1")?.cents).toBe(19400);
    expect(bills.get("card-2")?.cents).toBe(5000);
  });
});

describe("computeCardOpenBill — the OPEN (accumulating) fatura", () => {
  it("sums only the cycle a charge made today falls into, not every open/closed charge", () => {
    const c = card("c1", 500000); // closes 3, due 10 → dueOffset 0
    const today = "2026-07-15"; // a charge today closes 2026-08 → open competence = 2026-08
    const openCharge = { ...cardExpense(-10000, "c1"), date: "2026-07-15" }; // competence 2026-08 (open)
    const closedCharge = { ...cardExpense(-25000, "c1"), date: "2026-06-15" }; // competence 2026-07 (closed)
    const txs = [openCharge, closedCharge];
    const competenceOf = billingCompetence([c]);
    // Open bill = only the accumulating cycle.
    expect(computeCardOpenBill(c, txs, today, competenceOf).cents).toBe(10000);
    // computeCardBill (the old "fatura atual") piles BOTH cycles in — the over-count we fixed.
    expect(computeCardBill("c1", txs).cents).toBe(35000);
  });
});
