import { describe, expect, it, vi } from "vitest";
import type { ExpenseTransaction } from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { getProjectedCardCharges } from "./get-projected-card-charges";

// Freeze "current month" so the projection horizon is deterministic.
vi.mock("@/shared/formatting/now", () => ({ currentMonthInBrazil: () => "2026-06" }));

let seq = 0;
const cardExpense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: `exp-${seq++}`,
  description: "Netflix",
  date: "2026-03-10" as IsoDate,
  kind: "expense",
  amountCents: -3990,
  categoryId: null,
  source: "card",
  cardId: "card-1",
  accountId: null,
  linkedAccountId: null,
  splits: [],
  myShareCents: 3990,
  installment: null,
  recurrence: { dayOfMonth: 10 },
  billMonthOverride: null,
  rolledAt: null,
  ...over,
});

function stubRepo(transactions: ExpenseTransaction[]): FinanceRepository {
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
    cardBillPayments: [],
  };
  return { loadWorkspace: async () => ws } as unknown as FinanceRepository;
}

const monthOf = (id: string): string => id.split(":").at(-1) ?? "";

describe("getProjectedCardCharges", () => {
  it("projects a recurring card charge into future months keeping its calendar date + anchor", async () => {
    const repo = stubRepo([cardExpense({ id: "sub", date: "2026-03-10", recurrence: { dayOfMonth: 10 } })]);
    const out = await getProjectedCardCharges(repo, "u");

    const july = out.find((o) => o.id === "proj:sub:2026-07");
    expect(july).toBeDefined();
    // The CALENDAR date is kept (not re-dated into a bill month) so the view buckets it right.
    expect(july?.date).toBe("2026-07-10");
    expect(july?.kind).toBe("expense");
    expect(july?.cardId).toBe("card-1");
    expect(july?.amountCents).toBe(-3990);
    expect(july?.projected).toBe(true);
    expect(july?.anchor.id).toBe("sub");
    // Every projected row is a card charge.
    expect(out.every((o) => o.cardId === "card-1" && o.kind === "expense")).toBe(true);
  });

  it("does not project the anchor month — the real charge already covers it (no duplicate)", async () => {
    const repo = stubRepo([cardExpense({ id: "sub", date: "2026-06-10", recurrence: { dayOfMonth: 10 } })]);
    const out = await getProjectedCardCharges(repo, "u");
    expect(out.some((o) => o.id === "proj:sub:2026-06")).toBe(false);
    expect(out.some((o) => o.id === "proj:sub:2026-07")).toBe(true);
  });

  it("ignores a rolled (abated) recurring rule", async () => {
    const repo = stubRepo([
      cardExpense({ id: "sub", date: "2026-03-10", rolledAt: "2026-06-01" as IsoDate }),
    ]);
    expect(await getProjectedCardCharges(repo, "u")).toHaveLength(0);
  });

  it("ignores non-card recurring rules and non-recurring card charges", async () => {
    const repo = stubRepo([
      // Recurring boleto (not a card) — out.
      cardExpense({
        id: "boleto",
        source: "boleto",
        cardId: null,
        linkedAccountId: "acc-1",
        recurrence: { dayOfMonth: 5 },
        date: "2026-03-05",
      }),
      // One-off card charge (no recurrence) — out.
      cardExpense({ id: "oneoff", recurrence: null, date: "2026-03-10" }),
    ]);
    expect(await getProjectedCardCharges(repo, "u")).toHaveLength(0);
  });

  it("projects across the ~1-year horizon (current month through current + 14)", async () => {
    const repo = stubRepo([cardExpense({ id: "sub", date: "2025-01-10", recurrence: { dayOfMonth: 10 } })]);
    const months = (await getProjectedCardCharges(repo, "u")).map((o) => monthOf(o.id));
    expect(months).toContain("2026-06"); // current month projects too (anchor far in the past)
    expect(months).toContain("2026-07");
    expect(months).toContain("2027-06");
    // Bounded by the horizon: current (2026-06) + 14 = 2027-08.
    expect(months.every((m) => m <= "2027-08")).toBe(true);
  });
});
