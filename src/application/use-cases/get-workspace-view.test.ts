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
    cardBillPayments: [],
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

describe("billProjectedCents — the previsto slice of the fatura atual", () => {
  it("exposes the projected charges that bill into the open competence", async () => {
    // Card closes 28, due 2; frozen today = 2026-06-24 → open competence 2026-07. The day-10 rule
    // anchored in January projects a 2026-06-10 charge, which bills July: the whole open fatura is
    // still a forecast, so billCents stays 0 and the previsto slice carries the amount.
    const sub: ExpenseTransaction = {
      id: "sub",
      description: "Assinatura",
      date: "2026-01-10" as IsoDate,
      kind: "expense",
      amountCents: -1990,
      categoryId: null,
      source: "card",
      cardId: "card-1",
      accountId: null,
      linkedAccountId: null,
      splits: [],
      myShareCents: 1990,
      installment: null,
      recurrence: { dayOfMonth: 10 },
      billMonthOverride: null,
      rolledAt: null,
    };
    const view = await getWorkspaceView(stubRepo([sub]), "u");
    const c = view.cards.find((x) => x.id === "card-1");
    expect(c?.billProjectedCents).toBe(1990);
    expect(c?.billCents).toBe(0);

    // Once the June charge is booked, the forecast is suppressed and the real bill takes over.
    const booked = { ...cardCharge("2026-07", -1990, "2026-06-10"), description: "Assinatura" };
    const after = await getWorkspaceView(stubRepo([sub, booked]), "u");
    expect(after.cards.find((x) => x.id === "card-1")?.billProjectedCents).toBe(0);
    expect(after.cards.find((x) => x.id === "card-1")?.billCents).toBe(1990);
  });
});
