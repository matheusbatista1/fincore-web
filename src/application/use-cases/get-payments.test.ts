import { describe, expect, it } from "vitest";
import type { ExpenseTransaction } from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { getPayments } from "./get-payments";

let seq = 0;
const expense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: `exp-${seq++}`,
  description: "Obrigação",
  date: "2026-07-20" as IsoDate,
  kind: "expense",
  amountCents: -10000,
  categoryId: null,
  source: "boleto",
  cardId: null,
  accountId: null,
  linkedAccountId: "acc-1",
  splits: [],
  myShareCents: 10000,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  rolledAt: null,
  paidAt: null,
  paidAccountId: null,
  paidAmountCents: null,
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

describe("getPayments", () => {
  it("lists only payable obligations (boleto/loan/financing), excluding card/account/overdraft", async () => {
    const repo = stubRepo([
      expense({ id: "boleto", source: "boleto" }),
      expense({ id: "loan", source: "loan" }),
      expense({ id: "financing", source: "financing" }),
      expense({ id: "account", source: "account", accountId: "acc-1", linkedAccountId: null }),
      expense({ id: "overdraft", source: "overdraft" }),
      expense({ id: "card", source: "card", cardId: "c1", linkedAccountId: null }),
    ]);
    const { pending } = await getPayments(repo, "u");
    expect(pending.map((t) => t.id).sort()).toEqual(["boleto", "financing", "loan"]);
  });

  it("splits pending vs paid and excludes rolled obligations", async () => {
    const repo = stubRepo([
      expense({ id: "pending" }),
      expense({ id: "paid", paidAt: "2026-07-01" as IsoDate, paidAccountId: "acc-1", paidAmountCents: 9000 }),
      expense({ id: "rolled", rolledAt: "2026-07-05" as IsoDate }),
    ]);
    const { pending, paid } = await getPayments(repo, "u");
    expect(pending.map((t) => t.id)).toEqual(["pending"]);
    expect(paid.map((t) => t.id)).toEqual(["paid"]);
  });

  it("sorts pending by due date ascending (soonest first)", async () => {
    const repo = stubRepo([
      expense({ id: "late", date: "2026-08-15" as IsoDate }),
      expense({ id: "soon", date: "2026-07-05" as IsoDate }),
      expense({ id: "mid", date: "2026-07-25" as IsoDate }),
    ]);
    const { pending } = await getPayments(repo, "u");
    expect(pending.map((t) => t.id)).toEqual(["soon", "mid", "late"]);
  });

  it("sorts paid by paid date descending (most recent first)", async () => {
    const repo = stubRepo([
      expense({
        id: "older",
        paidAt: "2026-07-02" as IsoDate,
        paidAccountId: "acc-1",
        paidAmountCents: 10000,
      }),
      expense({
        id: "newer",
        paidAt: "2026-07-20" as IsoDate,
        paidAccountId: "acc-1",
        paidAmountCents: 10000,
      }),
    ]);
    const { paid } = await getPayments(repo, "u");
    expect(paid.map((t) => t.id)).toEqual(["newer", "older"]);
  });

  it("totals the pending amounts (absolute cents), ignoring paid ones", async () => {
    const repo = stubRepo([
      expense({ id: "a", amountCents: -30000 }),
      expense({ id: "b", amountCents: -12000 }),
      expense({ id: "paid", amountCents: -50000, paidAt: "2026-07-01" as IsoDate, paidAccountId: "acc-1" }),
    ]);
    const { pendingTotalCents } = await getPayments(repo, "u");
    expect(pendingTotalCents).toBe(42000);
  });
});
