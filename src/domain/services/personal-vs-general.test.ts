import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  ExpenseTransaction,
  IncomeTransaction,
  Transaction,
  TransactionSplit,
  TransferTransaction,
} from "../entities/transaction";
import { Money } from "../money/money";
import { computeViewTotals } from "./personal-vs-general";

// ---------------------------------------------------------------------------
// Builders — keep the discriminated-union shapes explicit and fully populated.
// ---------------------------------------------------------------------------

interface ExpenseOpts {
  readonly id: string;
  /** Stored negative (despesa). */
  readonly amountCents: number;
  readonly date?: string;
  readonly splits?: readonly TransactionSplit[];
}

function expense(opts: ExpenseOpts): ExpenseTransaction {
  const splits = opts.splits ?? [];
  const othersTotal = splits.reduce((s, sp) => s + sp.shareCents, 0);
  // myShare = |amount| − Σ split shares, mirroring the contract's derivation.
  const myShareCents = Math.abs(opts.amountCents) - othersTotal;
  return {
    kind: "expense",
    id: opts.id,
    description: opts.id,
    date: opts.date ?? "2026-06-10",
    amountCents: opts.amountCents,
    categoryId: null,
    source: "card",
    cardId: "c-nu",
    accountId: null,
    linkedAccountId: null,
    splits,
    myShareCents,
    installment: null,
    recurrence: null,
    billMonthOverride: null,
  };
}

interface IncomeOpts {
  readonly id: string;
  readonly amountCents: number;
  readonly isReimbursement?: boolean;
  readonly date?: string;
}

function income(opts: IncomeOpts): IncomeTransaction {
  return {
    kind: "income",
    id: opts.id,
    description: opts.id,
    date: opts.date ?? "2026-06-05",
    amountCents: opts.amountCents,
    accountId: "it",
    fromPersonId: null,
    isReimbursement: opts.isReimbursement ?? false,
    recurrence: null,
  };
}

function transfer(id: string, valueCents: number, date = "2026-06-09"): TransferTransaction {
  return {
    kind: "transfer",
    id,
    description: id,
    date,
    fromAccountId: "c6",
    toAccountId: "nu",
    valueCents,
  };
}

// ---------------------------------------------------------------------------
// Concrete examples from the prototype seed data (app/data.js).
// ---------------------------------------------------------------------------

// Shared expenses from the seed:
//   t1  Pizzaria Bráz  -148.00  share p-mar 74.00   → myShare 74.00
//   t5  Passagem (Mãe) -500.00  share p-mae 500.00  → myShare 0
//   t11 Bar do Juarez  -276.00  shares 92+92        → myShare 92.00
const seedTransactions: Transaction[] = [
  // ---- receitas ----
  income({ id: "t2", amountCents: 920_000 }), // Salário 9200.00
  income({ id: "t9", amountCents: 250_000 }), // Freela design 2500.00
  // ---- despesas com rateio ----
  expense({ id: "t1", amountCents: -14_800, splits: [{ personId: "p-mar", shareCents: 7_400 }] }),
  expense({ id: "t5", amountCents: -50_000, splits: [{ personId: "p-mae", shareCents: 50_000 }] }),
  expense({
    id: "t11",
    amountCents: -27_600,
    splits: [
      { personId: "p-joao", shareCents: 9_200 },
      { personId: "p-cam", shareCents: 9_200 },
    ],
  }),
  // ---- despesas simples ----
  expense({ id: "t3", amountCents: -3_240 }), // Uber
  expense({ id: "t4", amountCents: -34_280 }), // Mercado
  // ---- transferência (ignorada nas duas visões) ----
  transfer("t22", 200_000),
];

describe("computeViewTotals — prototype seed examples", () => {
  // Hand-computed from the seed list above:
  //   income (all)        = 9200.00 + 2500.00            = 11700.00 → 1_170_000c
  //   general expense     = 148 + 500 + 276 + 32.40 + 342.80 = 1299.20 → 129_920c
  //   personal expense    = myShares 74 + 0 + 92 + 32.40 + 342.80 = 541.20 → 54_120c
  //   others' shares      = 74 + 500 + 184                = 758.00 → 75_800c
  it("computes the general view (full amounts)", () => {
    const totals = computeViewTotals(seedTransactions, "general");
    expect(totals.income.cents).toBe(1_170_000);
    expect(totals.expense.cents).toBe(129_920);
    expect(totals.net.cents).toBe(1_170_000 - 129_920);
  });

  it("computes the personal view (your share only)", () => {
    const totals = computeViewTotals(seedTransactions, "personal");
    // No reimbursements in the seed, so personal income equals general income.
    expect(totals.income.cents).toBe(1_170_000);
    expect(totals.expense.cents).toBe(54_120);
    expect(totals.net.cents).toBe(1_170_000 - 54_120);
  });

  it("general expense exceeds personal expense by the others' shares (758.00)", () => {
    const general = computeViewTotals(seedTransactions, "general");
    const personal = computeViewTotals(seedTransactions, "personal");
    expect(general.expense.subtract(personal.expense).cents).toBe(75_800);
  });

  it("ignores transfers in both views", () => {
    const withoutTransfer = seedTransactions.filter((t) => t.kind !== "transfer");
    for (const mode of ["general", "personal"] as const) {
      const a = computeViewTotals(seedTransactions, mode);
      const b = computeViewTotals(withoutTransfer, mode);
      expect(a.income.cents).toBe(b.income.cents);
      expect(a.expense.cents).toBe(b.expense.cents);
    }
  });
});

describe("computeViewTotals — reimbursements", () => {
  it("excludes reimbursements from personal income but not general income", () => {
    const txs: Transaction[] = [
      income({ id: "salary", amountCents: 500_000 }),
      income({ id: "refund", amountCents: 12_000, isReimbursement: true }),
    ];
    expect(computeViewTotals(txs, "general").income.cents).toBe(512_000);
    expect(computeViewTotals(txs, "personal").income.cents).toBe(500_000);
  });
});

describe("computeViewTotals — month scoping", () => {
  it("counts only transactions inside the requested competence month", () => {
    const txs: Transaction[] = [
      income({ id: "jun", amountCents: 100_000, date: "2026-06-05" }),
      income({ id: "jul", amountCents: 200_000, date: "2026-07-05" }),
      expense({ id: "junExp", amountCents: -10_000, date: "2026-06-10" }),
      expense({ id: "mayExp", amountCents: -50_000, date: "2026-05-10" }),
    ];
    const jun = computeViewTotals(txs, "general", "2026-06");
    expect(jun.income.cents).toBe(100_000);
    expect(jun.expense.cents).toBe(10_000);
    expect(jun.net.cents).toBe(90_000);

    // No month filter → everything is in scope.
    const all = computeViewTotals(txs, "general");
    expect(all.income.cents).toBe(300_000);
    expect(all.expense.cents).toBe(60_000);
  });
});

describe("computeViewTotals — edge cases", () => {
  it("returns zeros for an empty list", () => {
    const totals = computeViewTotals([], "general");
    expect(totals.income.cents).toBe(0);
    expect(totals.expense.cents).toBe(0);
    expect(totals.net.cents).toBe(0);
  });

  it("returns zeros for a month with no matching transactions", () => {
    const txs: Transaction[] = [income({ id: "jun", amountCents: 100_000, date: "2026-06-05" })];
    const totals = computeViewTotals(txs, "personal", "2026-01");
    expect(totals.income.cents).toBe(0);
    expect(totals.expense.cents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Property tests — business invariants over arbitrary transaction lists.
// ---------------------------------------------------------------------------

// Generate an expense with valid, non-negative splits summing to ≤ |amount|.
const arbExpense = (idx: number): fc.Arbitrary<ExpenseTransaction> =>
  fc
    .record({
      absCents: fc.integer({ min: 1, max: 10_000_000 }),
      // Fractions of |amount| to hand to other people (0..0.9 each, capped overall).
      shareWeights: fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 4 }),
    })
    .map(({ absCents, shareWeights }) => {
      const totalWeight = shareWeights.reduce((s, w) => s + w, 0);
      const splits: TransactionSplit[] = [];
      if (totalWeight > 0) {
        // Reserve ~10% of the amount for the user so myShare stays ≥ 0; the
        // remaining budget is split deterministically across the other people.
        const budget = Math.floor(absCents * 0.9);
        let remaining = budget;
        shareWeights.forEach((w, i) => {
          const share = Math.floor((budget * w) / totalWeight);
          const clamped = Math.min(share, remaining);
          if (clamped > 0) {
            splits.push({ personId: `p${idx}-${i}`, shareCents: clamped });
            remaining -= clamped;
          }
        });
      }
      return expense({ id: `e${idx}`, amountCents: -absCents, splits });
    });

const arbIncome = (idx: number): fc.Arbitrary<IncomeTransaction> =>
  fc
    .record({
      amountCents: fc.integer({ min: 1, max: 10_000_000 }),
      isReimbursement: fc.boolean(),
    })
    .map(({ amountCents, isReimbursement }) => income({ id: `i${idx}`, amountCents, isReimbursement }));

const arbTransfer = (idx: number): fc.Arbitrary<TransferTransaction> =>
  fc.integer({ min: 1, max: 10_000_000 }).map((v) => transfer(`x${idx}`, v));

const arbTransaction = (idx: number): fc.Arbitrary<Transaction> =>
  fc.oneof(arbExpense(idx), arbIncome(idx), arbTransfer(idx));

const arbTransactions = (): fc.Arbitrary<Transaction[]> =>
  fc
    .array(fc.integer({ min: 0, max: 1_000 }), { maxLength: 30 })
    .chain((idxs) =>
      idxs.length === 0 ? fc.constant([]) : fc.tuple(...idxs.map((_, i) => arbTransaction(i))),
    );

describe("computeViewTotals — invariants (property based)", () => {
  it("net always equals income − expense (both views)", () => {
    fc.assert(
      fc.property(
        arbTransactions(),
        fc.constantFrom("general", "personal"),
        (txs, mode: "general" | "personal") => {
          const totals = computeViewTotals(txs, mode);
          expect(totals.net.cents).toBe(totals.income.cents - totals.expense.cents);
        },
      ),
    );
  });

  it("general expense is always >= personal expense", () => {
    fc.assert(
      fc.property(arbTransactions(), (txs) => {
        const general = computeViewTotals(txs, "general");
        const personal = computeViewTotals(txs, "personal");
        expect(general.expense.greaterThanOrEqual(personal.expense)).toBe(true);
      }),
    );
  });

  it("general income is always >= personal income (reimbursements only ever reduce it)", () => {
    fc.assert(
      fc.property(arbTransactions(), (txs) => {
        const general = computeViewTotals(txs, "general");
        const personal = computeViewTotals(txs, "personal");
        expect(general.income.greaterThanOrEqual(personal.income)).toBe(true);
      }),
    );
  });

  it("reimbursements never contribute to personal income", () => {
    fc.assert(
      fc.property(arbTransactions(), (txs) => {
        const personal = computeViewTotals(txs, "personal");
        const nonReimbursableIncome = txs
          .filter((t): t is IncomeTransaction => t.kind === "income" && !t.isReimbursement)
          .reduce((acc, t) => acc.add(Money.fromCents(t.amountCents)), Money.zero());
        expect(personal.income.cents).toBe(nonReimbursableIncome.cents);
      }),
    );
  });

  it("personal expense equals the sum of myShare across expenses", () => {
    fc.assert(
      fc.property(arbTransactions(), (txs) => {
        const personal = computeViewTotals(txs, "personal");
        const expectedShares = txs
          .filter((t): t is ExpenseTransaction => t.kind === "expense")
          .reduce((acc, t) => acc.add(Money.fromCents(t.myShareCents)), Money.zero());
        expect(personal.expense.cents).toBe(expectedShares.cents);
      }),
    );
  });

  it("the others' share gap equals general minus personal expense", () => {
    fc.assert(
      fc.property(arbTransactions(), (txs) => {
        const general = computeViewTotals(txs, "general");
        const personal = computeViewTotals(txs, "personal");
        const othersAll = txs
          .filter((t): t is ExpenseTransaction => t.kind === "expense")
          .reduce(
            (acc, t) =>
              acc.add(t.splits.reduce((s, sp) => s.add(Money.fromCents(sp.shareCents)), Money.zero())),
            Money.zero(),
          );
        expect(general.expense.subtract(personal.expense).cents).toBe(othersAll.cents);
      }),
    );
  });
});
