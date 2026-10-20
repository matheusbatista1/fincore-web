import { describe, expect, it, vi } from "vitest";
import type { Person } from "@/domain/entities/person";
import type { Settlement } from "@/domain/entities/settlement";
import type { ExpenseTransaction, Transaction } from "@/domain/entities/transaction";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";

// Freeze "today" so the horizon (browsed month vs. today) is deterministic.
vi.mock("@/shared/formatting/now", () => ({ currentMonthInBrazil: () => "2026-10" }));

const { getPeople } = await import("./get-people");

const ana: Person = { id: "p1", name: "Ana", relationship: "Amiga", color: "#000000" };

const shared = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: "e1",
  description: "Mercado",
  date: "2026-08-10",
  kind: "expense",
  amountCents: -5000,
  categoryId: null,
  source: "account",
  cardId: null,
  accountId: "acc-1",
  linkedAccountId: null,
  splits: [{ personId: "p1", shareCents: 5000 }],
  myShareCents: 0,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  ...over,
});

function stubRepo(transactions: Transaction[], settlements: Settlement[] = []): FinanceRepository {
  const ws: Workspace = {
    accounts: [],
    creditCards: [],
    people: [ana],
    categories: [],
    transactions,
    settlements,
    budgets: [],
    goals: [],
    cardBillDates: [],
    cardBillPayments: [],
  };
  return { loadWorkspace: async () => ws } as unknown as FinanceRepository;
}

describe("getPeople — a past month reads through today's ledger", () => {
  it("an acerto dated after the month zeroes that month (nothing is left to register)", async () => {
    // Ana's August share, paid with an acerto in September: browsing August must not show it as
    // pending — the end-of-month snapshot did, and no new acerto (dated today) could ever clear it.
    const paidInSeptember: Settlement = {
      id: "s1",
      personId: "p1",
      amountCents: 5000,
      date: "2026-09-15",
      accountId: null,
    };
    const [person] = await getPeople(stubRepo([shared()], [paidInSeptember]), "u", "2026-08");
    expect(person?.monthBalanceCents).toBe(0);
    expect(person?.totalBalanceCents).toBe(0);
    expect(person?.realBalanceCents).toBe(0);
  });

  it("an unpaid share still shows in its month, and in the total", async () => {
    const [person] = await getPeople(stubRepo([shared()]), "u", "2026-08");
    expect(person?.monthBalanceCents).toBe(5000);
    expect(person?.totalBalanceCents).toBe(5000);
  });

  it("a later month's share does not leak into the browsed month; the total runs through today", async () => {
    const september = shared({ id: "e2", date: "2026-09-10" });
    const [person] = await getPeople(stubRepo([shared(), september]), "u", "2026-08");
    expect(person?.monthBalanceCents).toBe(5000); // August only
    expect(person?.totalBalanceCents).toBe(10000); // August + September, as of today
  });
});

describe("getPeople — a future month keeps its projections", () => {
  it("projects a recurring shared expense into the browsed future month", async () => {
    const rule = shared({ id: "rule", date: "2026-10-05", recurrence: { dayOfMonth: 5 } });
    const [person] = await getPeople(stubRepo([rule]), "u", "2026-11");
    expect(person?.monthBalanceCents).toBe(5000); // November's projected share
    expect(person?.totalBalanceCents).toBe(10000); // October (real) + November (projected)
    expect(person?.realBalanceCents).toBe(5000); // booked only
  });
});
