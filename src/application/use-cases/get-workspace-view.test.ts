import { describe, expect, it, vi } from "vitest";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { Person } from "@/domain/entities/person";
import type { ExpenseTransaction } from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { getWorkspaceView } from "./get-workspace-view";

// Freeze "today" so the next-due-month calc is deterministic (dueDay 2 < day 24 → July).
vi.mock("@/shared/formatting/now", () => ({ todayInBrazil: () => "2026-06-24" }));

const card: CreditCard = {
  id: "card-1",
  bank: "Caixa",
  product: "Platinum",
  flag: "visa",
  themeKey: "caixa",
  maskedNumber: "0000",
  limitCents: 1_000_000,
  closingDay: 28,
  dueDay: 2,
};
const person: Person = { id: "p", name: "Nenê", relationship: "Família", color: "#000000" };

let seq = 0;
const cardCharge = (billMonth: string, amountCents: number, date: string): ExpenseTransaction => ({
  id: `exp-${seq++}`,
  description: "Compra",
  date: date as IsoDate,
  kind: "expense",
  amountCents,
  categoryId: null,
  source: "card",
  cardId: "card-1",
  accountId: null,
  linkedAccountId: null,
  splits: [],
  myShareCents: Math.abs(amountCents),
  installment: null,
  recurrence: null,
  billMonthOverride: billMonth,
  rolledAt: null,
});

const sharedExpense = (date: string, shareCents: number): ExpenseTransaction => ({
  id: `exp-${seq++}`,
  description: "Dividido",
  date: date as IsoDate,
  kind: "expense",
  amountCents: -shareCents,
  categoryId: null,
  source: "account",
  cardId: null,
  accountId: "acc-x",
  linkedAccountId: null,
  splits: [{ personId: "p", shareCents }],
  myShareCents: 0,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  rolledAt: null,
});

function stubRepo(transactions: ExpenseTransaction[]): FinanceRepository {
  const ws: Workspace = {
    accounts: [],
    creditCards: [card],
    people: [person],
    categories: [],
    transactions,
    settlements: [],
    budgets: [],
    goals: [],
    cardBillDates: [],
  };
  return { loadWorkspace: async () => ws } as unknown as FinanceRepository;
}

describe("getWorkspaceView", () => {
  it("dueBillCents is the bill that comes due next (competence of the upcoming dueDay), not other months", async () => {
    const repo = stubRepo([
      cardCharge("2026-07", -10000, "2026-06-20"), // bills July — the next due (dueDay 2 already passed on the 24th)
      cardCharge("2026-08", -5000, "2026-07-20"), // bills August — must NOT count
    ]);
    const view = await getWorkspaceView(repo, "u");
    expect(view.cards[0]?.dueBillCents).toBe(10000);
  });

  it("monthBalanceCents reflects the current month's person net", async () => {
    const repo = stubRepo([sharedExpense("2026-06-10", 8000)]);
    const view = await getWorkspaceView(repo, "u");
    expect(view.people[0]?.monthBalanceCents).toBe(8000);
  });
});
