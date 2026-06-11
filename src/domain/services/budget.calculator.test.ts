import { describe, expect, it } from "vitest";
import type { Budget } from "../entities/budget";
import type { ExpenseTransaction, Transaction } from "../entities/transaction";
import { computeBudgetStatuses } from "./budget.calculator";

function expense(
  id: string,
  categoryId: string | null,
  amountCents: number,
  date: string,
): ExpenseTransaction {
  return {
    id,
    kind: "expense",
    description: id,
    date,
    amountCents,
    categoryId,
    source: "account",
    cardId: null,
    accountId: "a1",
    linkedAccountId: null,
    splits: [],
    myShareCents: amountCents,
    installment: null,
    recurrence: null,
  };
}

const budgets: Budget[] = [
  { id: "b1", categoryId: "food", limitCents: 100_00 },
  { id: "b2", categoryId: "fun", limitCents: 50_00 },
];

describe("computeBudgetStatuses", () => {
  it("sums absolute expenses for the category within the month", () => {
    const txs: Transaction[] = [
      expense("t1", "food", -60_00, "2026-06-10"),
      expense("t2", "food", -20_00, "2026-06-20"),
      expense("t3", "food", -999_00, "2026-05-10"), // other month — ignored
      expense("t4", "fun", -10_00, "2026-06-01"),
    ];
    const [food, fun] = computeBudgetStatuses(budgets, txs, "2026-06");

    expect(food?.spentCents).toBe(80_00);
    expect(food?.remainingCents).toBe(20_00);
    expect(food?.over).toBe(false);
    expect(food?.ratio).toBeCloseTo(0.8);
    expect(fun?.spentCents).toBe(10_00);
  });

  it("flags a budget as over when spending exceeds the limit", () => {
    const txs: Transaction[] = [expense("t1", "fun", -75_00, "2026-06-05")];
    const [, fun] = computeBudgetStatuses(budgets, txs, "2026-06");

    expect(fun?.spentCents).toBe(75_00);
    expect(fun?.remainingCents).toBe(-25_00);
    expect(fun?.over).toBe(true);
  });

  it("treats a category with no spending as zero", () => {
    const [food] = computeBudgetStatuses(budgets, [], "2026-06");
    expect(food?.spentCents).toBe(0);
    expect(food?.ratio).toBe(0);
    expect(food?.over).toBe(false);
  });
});
