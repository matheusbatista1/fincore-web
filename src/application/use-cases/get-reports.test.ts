import { describe, expect, it } from "vitest";
import type { Category } from "@/domain/entities/category";
import type { ExpenseTransaction, IncomeTransaction } from "@/domain/entities/transaction";
import { addMonths } from "@/domain/value-objects/competence-month";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { getReports } from "./get-reports";

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
});
