import { describe, expect, it } from "vitest";
import type { ExpenseTransaction, IncomeTransaction } from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { getMonthly } from "./get-monthly";

let seq = 0;
const expense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: `exp-${seq++}`,
  description: "Despesa",
  date: "2026-06-10" as IsoDate,
  kind: "expense",
  amountCents: -10000,
  categoryId: null,
  source: "account",
  cardId: null,
  accountId: "acc-1",
  linkedAccountId: null,
  splits: [],
  myShareCents: 10000,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  rolledAt: null,
  ...over,
});

const income = (over: Partial<IncomeTransaction> = {}): IncomeTransaction => ({
  id: `inc-${seq++}`,
  description: "Receita",
  date: "2026-06-05" as IsoDate,
  kind: "income",
  amountCents: 50000,
  accountId: "acc-1",
  cardId: null,
  fromPersonId: null,
  isReimbursement: false,
  recurrence: null,
  ...over,
});

function stubRepo(transactions: (ExpenseTransaction | IncomeTransaction)[]): FinanceRepository {
  const ws: Workspace = {
    accounts: [],
    creditCards: [],
    people: [],
    categories: [],
    transactions,
    settlements: [],
    budgets: [],
    goals: [],
    cardBillDates: [],
  };
  return { loadWorkspace: async () => ws } as unknown as FinanceRepository;
}

describe("getMonthly", () => {
  it("excludes a rolled (abated) expense from totals and items", async () => {
    const repo = stubRepo([
      expense({ id: "real", amountCents: -10000 }),
      // Abated debt kept only for history — must not appear or count.
      expense({ id: "rolled", amountCents: -5000, rolledAt: "2026-06-20" as IsoDate }),
      income({ id: "wage", amountCents: 50000 }),
    ]);
    const data = await getMonthly(repo, "u", "2026-06");

    expect(data.realized.expenseCents).toBe(10000); // the rolled 50,00 is excluded
    expect(data.realized.incomeCents).toBe(50000);
    // Newest-first (byDateDesc): real (06-10) before wage (06-05); the rolled row is gone.
    expect(data.items.map((i) => i.id)).toEqual(["real", "wage"]);
    expect(data.items.some((i) => i.id === "rolled")).toBe(false);
  });
});
