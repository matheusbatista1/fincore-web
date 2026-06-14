import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/domain/entities/account";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { ExpenseTransaction, IncomeTransaction } from "@/domain/entities/transaction";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";

// Freeze "today" so the live-vs-projected split is deterministic.
vi.mock("@/shared/formatting/now", () => ({ todayInBrazil: () => "2026-06-14" }));

const { getDashboard } = await import("./get-dashboard");

const account: Account = {
  id: "acc-1",
  bank: "Nubank",
  name: "Conta",
  type: "PF",
  themeKey: "",
  openingBalanceCents: 100000,
  maskedNumber: "",
};

const card: CreditCard = {
  id: "card-1",
  bank: "C6",
  product: "Carbon",
  flag: "mastercard",
  themeKey: "",
  maskedNumber: "",
  limitCents: 500000,
  closingDay: 24,
  dueDay: 2,
};

let seq = 0;
const expense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: `exp-${seq++}`,
  description: "Despesa",
  date: "2026-05-10",
  kind: "expense",
  amountCents: -20000,
  categoryId: null,
  source: "account",
  cardId: null,
  accountId: "acc-1",
  linkedAccountId: null,
  splits: [],
  myShareCents: 20000,
  installment: null,
  recurrence: { dayOfMonth: 10 },
  billMonthOverride: null,
  ...over,
});

const income = (over: Partial<IncomeTransaction> = {}): IncomeTransaction => ({
  id: `inc-${seq++}`,
  description: "Salário",
  date: "2026-06-20",
  kind: "income",
  amountCents: 50000,
  accountId: "acc-1",
  fromPersonId: null,
  isReimbursement: false,
  recurrence: null,
  ...over,
});

function stubRepo(
  transactions: (ExpenseTransaction | IncomeTransaction)[],
  cards: CreditCard[] = [],
): FinanceRepository {
  const ws: Workspace = {
    accounts: [account],
    creditCards: cards,
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

describe("getDashboard — projected end-of-month balance", () => {
  it("adds future-dated movements and recurring projections to the live balance", async () => {
    // Live (≤ 2026-06-14): opening 100000 − 20000 (May 10 real) = 80000.
    // EoM (≤ 2026-06-30): + 50000 (June 20 income) = 130000.
    // June projection of the recurring May expense: − 20000 → projected = 110000.
    const repo = stubRepo([expense(), income()]);
    const data = await getDashboard(repo, "u", "2026-06");
    expect(data.totalBalanceCents).toBe(80000);
    expect(data.projectedBalanceCents).toBe(110000);
  });

  it("ignores card-paid recurring expenses (they never move an account balance)", async () => {
    const repo = stubRepo(
      [
        expense(),
        income(),
        expense({
          source: "card",
          cardId: "card-1",
          accountId: null,
          date: "2026-05-15",
          amountCents: -9999,
          recurrence: { dayOfMonth: 15 },
        }),
      ],
      [card],
    );
    const data = await getDashboard(repo, "u", "2026-06");
    expect(data.totalBalanceCents).toBe(80000);
    expect(data.projectedBalanceCents).toBe(110000);
  });

  it("for a past month, projected equals the realized month-end balance", async () => {
    // No recurring rules: nothing to project, so projected == realized month-end.
    const repo = stubRepo([
      expense({ recurrence: null, date: "2026-03-10" }),
      income({ date: "2026-03-20" }),
    ]);
    const data = await getDashboard(repo, "u", "2026-03");
    expect(data.projectedBalanceCents).toBe(data.totalBalanceCents);
  });
});
