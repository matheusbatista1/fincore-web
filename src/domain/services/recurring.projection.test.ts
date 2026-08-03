import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { ExpenseTransaction, IncomeTransaction, Transaction } from "../entities/transaction";
import type { CompetenceMonth } from "../value-objects/competence-month";
import { dateInMonth, monthOf } from "../value-objects/competence-month";
import {
  freshOccurrence,
  type ProjectedTransaction,
  projectRecurring,
  transactionsForMonth,
} from "./recurring.projection";

// ---------------------------------------------------------------------------
// Builders — minimal, fully-typed factories so tests read like the prototype.
// ---------------------------------------------------------------------------

function expense(
  over: Partial<ExpenseTransaction> & Pick<ExpenseTransaction, "id" | "description" | "date">,
): ExpenseTransaction {
  return {
    kind: "expense",
    amountCents: -1000,
    categoryId: null,
    source: "card",
    cardId: null,
    accountId: null,
    linkedAccountId: null,
    splits: [],
    myShareCents: 1000,
    installment: null,
    recurrence: null,
    billMonthOverride: null,
    ...over,
  };
}

function income(
  over: Partial<IncomeTransaction> & Pick<IncomeTransaction, "id" | "description" | "date" | "accountId">,
): IncomeTransaction {
  return {
    kind: "income",
    amountCents: 100000,
    cardId: null,
    fromPersonId: null,
    isReimbursement: false,
    recurrence: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Concrete examples taken from the prototype seed data (app/data.js).
// ---------------------------------------------------------------------------

describe("projectRecurring — prototype seed data", () => {
  // Netflix: card 'c-it', fixed on day 6, anchored in 2026-06.
  const netflix = expense({
    id: "t6",
    description: "Netflix",
    date: "2026-06-06",
    amountCents: -5590,
    categoryId: "fun",
    source: "card",
    cardId: "c-it",
    recurrence: { dayOfMonth: 6 },
  });
  // Salário: income on account 'it', fixed on day 5, anchored in 2026-06.
  const salario = income({
    id: "t2",
    description: "Salário",
    date: "2026-06-05",
    amountCents: 920000,
    accountId: "it",
    recurrence: { dayOfMonth: 5 },
  });
  // Aluguel: boleto linked to 'it', fixed on day 5, anchored in 2026-06.
  const aluguel = expense({
    id: "t10",
    description: "Aluguel",
    date: "2026-06-05",
    amountCents: -240000,
    categoryId: "home",
    source: "boleto",
    linkedAccountId: "it",
    recurrence: { dayOfMonth: 5 },
  });
  // Faxina (Pix): NOT fixed — must never project.
  const faxina = expense({
    id: "t15",
    description: "Faxina (Pix)",
    date: "2026-06-06",
    amountCents: -18000,
    categoryId: "home",
    source: "account",
    accountId: "nu",
  });

  const seed: Transaction[] = [netflix, salario, aluguel, faxina];

  it("does not project in the anchor month (real already covers it)", () => {
    const projections = projectRecurring(seed, "2026-06");
    expect(projections).toEqual([]);
  });

  it("projects every recurring source into a future month, on its recurrence day", () => {
    const projections = projectRecurring(seed, "2026-07");
    // Three recurring sources (Netflix, Salário, Aluguel); Faxina is not fixed.
    expect(projections.map((p) => p.source.id)).toEqual(["t6", "t2", "t10"]);
    expect(projections.map((p) => p.date)).toEqual([
      "2026-07-06", // Netflix day 6
      "2026-07-05", // Salário day 5
      "2026-07-05", // Aluguel day 5
    ]);
    expect(projections.every((p) => p.projected === true)).toBe(true);
  });

  it("never projects a non-recurring transaction (Faxina)", () => {
    const projections = projectRecurring(seed, "2026-08");
    expect(projections.some((p) => p.source.id === "t15")).toBe(false);
  });

  it("suppresses the projection when a real recurring entry of the same identity exists", () => {
    // A real July Netflix booked by the user (same desc + card), fixed.
    const julyNetflix = expense({
      id: "t6-real-jul",
      description: "Netflix",
      date: "2026-07-06",
      amountCents: -5590,
      categoryId: "fun",
      source: "card",
      cardId: "c-it",
      recurrence: { dayOfMonth: 6 },
    });
    const projections = projectRecurring([...seed, julyNetflix], "2026-07");
    // Netflix projection suppressed; Salário and Aluguel still project.
    expect(projections.map((p) => p.source.id)).toEqual(["t2", "t10"]);
  });

  it("does NOT suppress when the real entry shares the description but a different card", () => {
    // Same description 'Netflix' but on a different card — a distinct identity.
    const julyNetflixOtherCard = expense({
      id: "t6-other",
      description: "Netflix",
      date: "2026-07-06",
      amountCents: -5590,
      source: "card",
      cardId: "c-nu",
      recurrence: { dayOfMonth: 6 },
    });
    const projections = projectRecurring([...seed, julyNetflixOtherCard], "2026-07");
    // The original 'c-it' Netflix projection survives (different identity).
    expect(projections.some((p) => p.source.id === "t6")).toBe(true);
  });

  it("clamps the recurrence day to the last day of a short month (Feb)", () => {
    const fixedDay31 = expense({
      id: "rent-31",
      description: "Aluguel dia 31",
      date: "2026-01-31",
      source: "boleto",
      linkedAccountId: "it",
      recurrence: { dayOfMonth: 31 },
    });
    const [p] = projectRecurring([fixedDay31], "2026-02");
    expect(p?.date).toBe("2026-02-28"); // 2026 is not a leap year
  });
});

describe("transactionsForMonth — prototype seed data", () => {
  const netflix = expense({
    id: "t6",
    description: "Netflix",
    date: "2026-06-06",
    source: "card",
    cardId: "c-it",
    recurrence: { dayOfMonth: 6 },
  });
  const faxina = expense({
    id: "t15",
    description: "Faxina (Pix)",
    date: "2026-06-06",
    source: "account",
    accountId: "nu",
  });

  it("returns the real entries of the month plus future projections", () => {
    const june = transactionsForMonth([netflix, faxina], "2026-06");
    expect(june.real.map((t) => t.id).sort()).toEqual(["t15", "t6"]);
    expect(june.projected).toEqual([]); // anchor month: nothing projected

    const july = transactionsForMonth([netflix, faxina], "2026-07");
    expect(july.real).toEqual([]); // no real July transactions
    expect(july.projected.map((p) => p.source.id)).toEqual(["t6"]); // only the fixed one
  });
});

// ---------------------------------------------------------------------------
// Property tests — business invariants.
// ---------------------------------------------------------------------------

const monthArb = (): fc.Arbitrary<CompetenceMonth> =>
  fc
    .tuple(fc.integer({ min: 2000, max: 2099 }), fc.integer({ min: 1, max: 12 }))
    .map(([y, m]) => `${y}-${String(m).padStart(2, "0")}`);

/** A recurring expense with a stable, unique identity (id == description == card). */
const recurringExpenseArb = (): fc.Arbitrary<ExpenseTransaction> =>
  fc
    .record({
      key: fc.string({ minLength: 1, maxLength: 6 }),
      month: monthArb(),
      day: fc.integer({ min: 1, max: 31 }),
      anchorDay: fc.integer({ min: 1, max: 28 }),
    })
    .map(({ key, month, day, anchorDay }) =>
      expense({
        id: `id-${key}`,
        description: `desc-${key}`,
        date: dateInMonth(month, anchorDay),
        source: "card",
        cardId: `card-${key}`,
        recurrence: { dayOfMonth: day },
      }),
    );

/** A non-recurring expense (recurrence === null). */
const nonRecurringExpenseArb = (): fc.Arbitrary<ExpenseTransaction> =>
  fc
    .record({
      key: fc.string({ minLength: 1, maxLength: 6 }),
      month: monthArb(),
      day: fc.integer({ min: 1, max: 28 }),
    })
    .map(({ key, month, day }) =>
      expense({
        id: `nr-${key}`,
        description: `nr-${key}`,
        date: dateInMonth(month, day),
        source: "account",
        accountId: `acct-${key}`,
      }),
    );

describe("projectRecurring — invariants", () => {
  it("months with no recurring sources yield no projections", () => {
    fc.assert(
      fc.property(fc.array(nonRecurringExpenseArb(), { maxLength: 12 }), monthArb(), (txs, month) => {
        expect(projectRecurring(txs, month)).toEqual([]);
      }),
    );
  });

  it("every projection falls on the recurrence day, clamped to the target month", () => {
    fc.assert(
      fc.property(fc.array(recurringExpenseArb(), { maxLength: 10 }), monthArb(), (txs, month) => {
        for (const p of projectRecurring(txs, month)) {
          // The projection date is exactly what dateInMonth produces for the day.
          const day = (p.source as ExpenseTransaction).recurrence?.dayOfMonth ?? 0;
          expect(p.date).toBe(dateInMonth(month, day));
          // ...and it lives in the target month.
          expect(monthOf(p.date)).toBe(month);
          expect(p.projected).toBe(true);
        }
      }),
    );
  });

  it("a real recurring transaction in the month hides its own projection", () => {
    fc.assert(
      fc.property(recurringExpenseArb(), monthArb(), (tx, month) => {
        // Anchor strictly before the target month, so it would otherwise project there.
        fc.pre(monthOf(tx.date) < month);

        // Build a real transaction of the SAME identity living in the target month.
        const realInMonth: ExpenseTransaction = {
          ...tx,
          id: `${tx.id}-real`,
          date: dateInMonth(month, tx.recurrence?.dayOfMonth ?? 1),
        };

        // Without the real one, the source projects into the month.
        const withoutReal = projectRecurring([tx], month);
        expect(withoutReal.some((p) => p.source.id === tx.id)).toBe(true);

        // With the real one present, the projection is suppressed.
        const withReal = projectRecurring([tx, realInMonth], month);
        expect(withReal.some((p) => p.source.id === tx.id)).toBe(false);
      }),
    );
  });

  it("only projects into months after the anchor; count matches eligible sources", () => {
    fc.assert(
      fc.property(fc.array(recurringExpenseArb(), { maxLength: 10 }), monthArb(), (txs, month) => {
        const projections = projectRecurring(txs, month);
        // Every projection's source must be anchored strictly before the target month.
        for (const p of projections as readonly ProjectedTransaction[]) {
          expect(monthOf(p.source.date) < month).toBe(true);
        }
        // A projection is emitted for every recurring source that is (a) anchored
        // before the target month and (b) whose identity is not already booked as
        // a real recurring entry this month.
        const realIdentities = new Set(
          txs.filter((t) => monthOf(t.date) === month).map((t) => `${t.source}|${t.cardId}|${t.description}`),
        );
        const eligible = txs.filter(
          (t) => monthOf(t.date) < month && !realIdentities.has(`${t.source}|${t.cardId}|${t.description}`),
        );
        expect(projections.length).toBe(eligible.length);
      }),
    );
  });

  it("never projects into a month before the anchor (salary anchored 2026-07-02)", () => {
    const salary: IncomeTransaction = {
      id: "salary",
      kind: "income",
      description: "Salário",
      date: "2026-07-02",
      amountCents: 920_000,
      accountId: "it",
      cardId: null,
      fromPersonId: null,
      isReimbursement: false,
      recurrence: { dayOfMonth: 2 },
    };
    // June (before the anchor) must have NO projection — the bug the user hit.
    expect(projectRecurring([salary], "2026-06")).toHaveLength(0);
    // The anchor month itself is covered by the real row — no projection.
    expect(projectRecurring([salary], "2026-07")).toHaveLength(0);
    // August (after the anchor) projects on day 2.
    const aug = projectRecurring([salary], "2026-08");
    expect(aug).toHaveLength(1);
    expect(aug[0]?.date).toBe("2026-08-02");
  });

  it("transactionsForMonth.real is exactly the transactions dated in the month", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(recurringExpenseArb(), nonRecurringExpenseArb()), { maxLength: 12 }),
        monthArb(),
        (txs, month) => {
          const { real } = transactionsForMonth(txs, month);
          expect(real.every((t) => monthOf(t.date) === month)).toBe(true);
          // Completeness: no in-month transaction is dropped.
          const expected = txs.filter((t) => monthOf(t.date) === month).map((t) => t.id);
          expect(real.map((t) => t.id)).toEqual(expected);
        },
      ),
    );
  });
});

describe("freshOccurrence", () => {
  it("drops the anchor's paid/rolled state and moves the expense to the occurrence date", () => {
    const anchor = expense({
      id: "aluguel",
      description: "Aluguel",
      date: "2026-06-03",
      source: "boleto",
      linkedAccountId: "acc-1",
      recurrence: { dayOfMonth: 3 },
      paidAt: "2026-06-01",
      paidAccountId: "acc-1",
      paidAmountCents: 40000,
      rolledAt: "2026-06-05",
    });
    const occ = freshOccurrence(anchor, "2026-07-03");

    expect(occ).toMatchObject({
      id: "aluguel",
      date: "2026-07-03",
      paidAt: null,
      paidAccountId: null,
      paidAmountCents: null,
      rolledAt: null,
      // The rule itself and the money/split shape are preserved.
      amountCents: -1000,
      myShareCents: 1000,
      recurrence: { dayOfMonth: 3 },
    });
  });

  it("drops the anchor's received state on an income occurrence", () => {
    const anchor = income({
      id: "salario",
      description: "Salário",
      date: "2026-07-01",
      accountId: "acc-1",
      recurrence: { dayOfMonth: 1 },
      receivedAt: "2026-07-01",
      receivedAccountId: "acc-1",
      receivedAmountCents: 100000,
    });
    expect(freshOccurrence(anchor, "2026-08-01")).toMatchObject({
      date: "2026-08-01",
      receivedAt: null,
      receivedAccountId: null,
      receivedAmountCents: null,
    });
  });
});
