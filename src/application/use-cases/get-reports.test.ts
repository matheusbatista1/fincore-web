import { describe, expect, it, vi } from "vitest";
import type { Category } from "@/domain/entities/category";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { ExpenseTransaction, IncomeTransaction } from "@/domain/entities/transaction";
import { addMonths } from "@/domain/value-objects/competence-month";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { getReports } from "./get-reports";

// Freeze "current month" so the future-projection cutoff is deterministic.
vi.mock("@/shared/formatting/now", () => ({ currentMonthInBrazil: () => "2026-06" }));

const ANCHOR = "2026-06";
/** Single-month window (bars + categories all on the anchor month). */
const justAnchor = { from: ANCHOR, to: ANCHOR };

const food: Category = { id: "cat-food", name: "Alimentação", color: "#FF8800", icon: "utensils-crossed" };
const transport: Category = { id: "cat-trans", name: "Transporte", color: "#3366FF", icon: "car" };

let seq = 0;
const expense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: `exp-${seq++}`,
  description: "Despesa",
  date: "2026-06-10",
  kind: "expense",
  amountCents: -10000,
  categoryId: food.id,
  source: "account",
  cardId: null,
  accountId: "acc-1",
  linkedAccountId: null,
  splits: [],
  myShareCents: 10000,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  ...over,
});

const income = (over: Partial<IncomeTransaction> = {}): IncomeTransaction => ({
  id: `inc-${seq++}`,
  description: "Receita",
  date: "2026-06-05",
  kind: "income",
  amountCents: 400000,
  accountId: "acc-1",
  cardId: null,
  fromPersonId: null,
  isReimbursement: false,
  recurrence: null,
  ...over,
});

function workspace(transactions: (ExpenseTransaction | IncomeTransaction)[]): Workspace {
  return {
    accounts: [],
    creditCards: [],
    people: [],
    categories: [food, transport],
    transactions,
    settlements: [],
    budgets: [],
    goals: [],
    cardBillDates: [],
    cardBillPayments: [],
  };
}

function stubRepo(transactions: (ExpenseTransaction | IncomeTransaction)[]): FinanceRepository {
  return { loadWorkspace: async () => workspace(transactions) } as unknown as FinanceRepository;
}

describe("getReports — general vs personal lenses", () => {
  it("sums full expense amounts in general and only the user's share in personal", async () => {
    const repo = stubRepo([
      // 50/50 shared: |amount| 10000, my share 5000
      expense({ amountCents: -10000, myShareCents: 5000, categoryId: food.id }),
      // simple expense: my share = full
      expense({ amountCents: -3000, myShareCents: 3000, categoryId: food.id }),
      // fully reimbursed expense (my share 0): drops from the personal donut
      expense({ amountCents: -2000, myShareCents: 0, categoryId: transport.id }),
    ]);
    const data = await getReports(repo, "u", justAnchor);

    // General categories: food 13000, transport 2000.
    expect(data.categories.map((c) => [c.id, c.valueCents])).toEqual([
      [food.id, 13000],
      [transport.id, 2000],
    ]);
    expect(data.totalExpenseCents).toBe(15000);

    // Personal categories: only food survives, at the user's share (8000).
    expect(data.categoriesPersonal.map((c) => [c.id, c.valueCents])).toEqual([[food.id, 8000]]);
    expect(data.totalExpensePersonalCents).toBe(8000);
  });

  it("counts reimbursements as income in general but not in personal", async () => {
    const repo = stubRepo([
      income({ amountCents: 400000, isReimbursement: false }),
      income({ amountCents: 6000, isReimbursement: true }),
      expense({ amountCents: -10000, myShareCents: 5000 }),
    ]);
    const data = await getReports(repo, "u", justAnchor);

    const general = data.months.at(-1);
    const personal = data.monthsPersonal.at(-1);
    expect(general?.incomeCents).toBe(406000);
    expect(general?.expenseCents).toBe(10000);
    // Personal drops the reimbursement and uses the user's share of the expense.
    expect(personal?.incomeCents).toBe(400000);
    expect(personal?.expenseCents).toBe(5000);
  });

  it("emits one bar per month in [from, to], oldest → newest", async () => {
    const data = await getReports(stubRepo([]), "u", { from: addMonths(ANCHOR, -5), to: ANCHOR });
    expect(data.months).toHaveLength(6);
    expect(data.monthsPersonal).toHaveLength(6);
    expect(data.months[0]?.month).toBe("2026-01");
    expect(data.months.at(-1)?.month).toBe(ANCHOR);
  });

  it("aggregates categories across the whole category window", async () => {
    const repo = stubRepo([
      expense({ amountCents: -1000, myShareCents: 1000, date: "2026-04-10", categoryId: food.id }),
      expense({ amountCents: -2000, myShareCents: 2000, date: "2026-05-10", categoryId: food.id }),
      expense({ amountCents: -3000, myShareCents: 3000, date: "2026-06-10", categoryId: food.id }),
    ]);
    const data = await getReports(repo, "u", {
      from: "2026-04",
      to: ANCHOR,
      categoryFrom: "2026-04",
      categoryTo: ANCHOR,
    });
    expect(data.categories).toEqual([{ id: food.id, name: food.name, color: food.color, valueCents: 6000 }]);
    expect(data.totalExpenseCents).toBe(6000);
  });

  it("normalizes a reversed range (from after to)", async () => {
    const data = await getReports(stubRepo([]), "u", { from: ANCHOR, to: "2026-04" });
    expect(data.from).toBe("2026-04");
    expect(data.to).toBe(ANCHOR);
    expect(data.months).toHaveLength(3);
  });

  it("excludes a rolled (abated) expense from bars, categories and total", async () => {
    const repo = stubRepo([
      expense({ amountCents: -3000, myShareCents: 3000, categoryId: food.id }),
      // Abated debt kept only for history — out of the bars, the donut and the total.
      expense({ amountCents: -5000, myShareCents: 5000, categoryId: food.id, rolledAt: "2026-06-24" }),
    ]);
    const data = await getReports(repo, "u", justAnchor);

    expect(data.months.at(-1)?.expenseCents).toBe(3000); // bar excludes the rolled 50,00
    expect(data.categories.map((c) => [c.id, c.valueCents])).toEqual([[food.id, 3000]]);
    expect(data.totalExpenseCents).toBe(3000);
  });
});

describe("getReports — byCard (spending per card over the window)", () => {
  // Closes 28 / due 29 → a charge dated ≤ 28 bills in its own calendar month.
  const card: CreditCard = {
    id: "card-1",
    bank: "C6",
    product: "Black",
    flag: "visa",
    themeKey: "",
    maskedNumber: "",
    limitCents: 500000,
    closingDay: 28,
    dueDay: 29,
  };
  const cardExpense = (cents: number, date: string): ExpenseTransaction =>
    expense({ amountCents: cents, source: "card", cardId: "card-1", accountId: null, date });
  const repoWithCard = (txs: (ExpenseTransaction | IncomeTransaction)[]): FinanceRepository =>
    ({
      loadWorkspace: async () => ({ ...workspace(txs), creditCards: [card] }),
    }) as unknown as FinanceRepository;

  it("sums a card's charges whose bill falls in [from, to], excluding out-of-window bills", async () => {
    const repo = repoWithCard([
      cardExpense(-10000, "2026-06-15"), // bills June (in window)
      cardExpense(-5000, "2026-07-15"), // bills July (out of a June-only window)
    ]);
    const data = await getReports(repo, "u", justAnchor);
    expect(data.byCard).toEqual([{ id: "card-1", name: "C6 · Black", valueCents: 10000 }]);
  });

  it("subtracts an estorno in the window and drops cards with no spend", async () => {
    const repo = repoWithCard([
      cardExpense(-10000, "2026-06-15"),
      income({ amountCents: 2500, cardId: "card-1", accountId: null, date: "2026-06-20" }), // estorno, June bill
    ]);
    const data = await getReports(repo, "u", justAnchor);
    expect(data.byCard).toEqual([{ id: "card-1", name: "C6 · Black", valueCents: 7500 }]);
  });
});

describe("getReports — future months include projected recurring (current = 2026-06)", () => {
  it("folds fixed lançamentos into months ahead", async () => {
    const repo = stubRepo([
      // Recurring expense anchored in the current month → projects into July onward.
      expense({ amountCents: -5000, myShareCents: 5000, date: "2026-06-10", recurrence: { dayOfMonth: 10 } }),
    ]);
    const data = await getReports(repo, "u", {
      from: "2026-06",
      to: "2026-07",
      categoryFrom: "2026-06",
      categoryTo: "2026-07",
    });

    expect(data.months.find((m) => m.month === "2026-06")?.expenseCents).toBe(5000); // real
    expect(data.months.find((m) => m.month === "2026-07")?.expenseCents).toBe(5000); // projected
    expect(data.totalExpenseCents).toBe(10000); // June real + July projected
  });

  it("keeps the current month real-only (no projection)", async () => {
    const repo = stubRepo([
      // Anchored in May; would project into June, but current/past stay real-only.
      expense({ amountCents: -5000, myShareCents: 5000, date: "2026-05-10", recurrence: { dayOfMonth: 10 } }),
    ]);
    const data = await getReports(repo, "u", { from: "2026-06", to: "2026-06" });
    expect(data.months.at(-1)?.expenseCents).toBe(0);
  });

  it("flags future months and the window as projected", async () => {
    const data = await getReports(stubRepo([]), "u", {
      from: "2026-06",
      to: "2026-08",
      categoryFrom: "2026-06",
      categoryTo: "2026-08",
    });
    expect(data.months.map((m) => [m.month, m.projected])).toEqual([
      ["2026-06", false],
      ["2026-07", true],
      ["2026-08", true],
    ]);
    expect(data.monthsPersonal.map((m) => m.projected)).toEqual([false, true, true]);
    expect(data.includesProjected).toBe(true);
    expect(data.projectedLabel).not.toBe("");
  });

  it("marks a past/current-only window as not projected", async () => {
    const data = await getReports(stubRepo([]), "u", { from: "2026-04", to: "2026-06" });
    expect(data.months.every((m) => !m.projected)).toBe(true);
    expect(data.includesProjected).toBe(false);
    expect(data.projectedLabel).toBe("");
  });
});

// The dashboard "Receitas x Despesas" chart drives a 6-month forward (default) or backward
// window for the bars, while pinning the category donut to the browsed month via
// categoryFrom/categoryTo — so flipping the bars never drags the donut into the future.
describe("getReports — dashboard cash-flow windows (current = 2026-06)", () => {
  it("forward bars span the next 6 months while the donut stays on the browsed month", async () => {
    const repo = stubRepo([
      expense({ amountCents: -3000, myShareCents: 3000, date: "2026-06-10", categoryId: food.id }),
      // Recurring charge: projects into the future bars, but must NOT enter the pinned donut.
      expense({
        amountCents: -5000,
        myShareCents: 5000,
        date: "2026-06-10",
        categoryId: transport.id,
        recurrence: { dayOfMonth: 10 },
      }),
    ]);
    const data = await getReports(repo, "u", {
      from: "2026-06",
      to: "2026-11",
      categoryFrom: "2026-06",
      categoryTo: "2026-06",
    });
    // 6 forward bars: June real, Jul–Nov projected.
    expect(data.months.map((m) => [m.month, m.projected])).toEqual([
      ["2026-06", false],
      ["2026-07", true],
      ["2026-08", true],
      ["2026-09", true],
      ["2026-10", true],
      ["2026-11", true],
    ]);
    // Donut pinned to June only → it does NOT accumulate the projected future months.
    expect(data.totalExpenseCents).toBe(8000); // food 3000 + transport 5000, June only
  });

  it("backward bars span the trailing 6 months, actuals only", async () => {
    const data = await getReports(stubRepo([]), "u", {
      from: "2026-01",
      to: "2026-06",
      categoryFrom: "2026-06",
      categoryTo: "2026-06",
    });
    expect(data.months.map((m) => m.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    expect(data.months.every((m) => !m.projected)).toBe(true);
    expect(data.includesProjected).toBe(false);
  });
});
