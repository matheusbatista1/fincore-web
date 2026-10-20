import { describe, expect, it, vi } from "vitest";
import type { Person } from "@/domain/entities/person";
import type { Settlement } from "@/domain/entities/settlement";
import type { ExpenseTransaction, IncomeTransaction, Transaction } from "@/domain/entities/transaction";
import { shortDate } from "@/shared/formatting/dates";
import { todayInBrazil } from "@/shared/formatting/now";
import type { AssumeDebtInput } from "@/shared/schemas/transaction";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { assumePersonDebt } from "./assume-person-debt";

const ana: Person = { id: "p1", name: "Ana Souza", relationship: "Amiga", color: "#000000" };

const sharedExpense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: "e1",
  description: "Empréstimo",
  date: "2026-08-05",
  kind: "expense",
  amountCents: -40000,
  categoryId: null,
  source: "loan",
  cardId: null,
  accountId: null,
  linkedAccountId: null,
  splits: [{ personId: "p1", shareCents: 40000 }],
  myShareCents: 0,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  ...over,
});

function stub(transactions: Transaction[], settlements: Settlement[] = [], people: Person[] = [ana]) {
  const ws: Workspace = {
    accounts: [],
    creditCards: [],
    people,
    categories: [],
    transactions,
    settlements,
    budgets: [],
    goals: [],
    cardBillDates: [],
    cardBillPayments: [],
  };
  const assumeFn = vi.fn(async (_userId: string, items: readonly unknown[]) => items.length);
  const repo = {
    loadWorkspace: async () => ws,
    assumePersonShares: assumeFn,
  } as unknown as FinanceRepository;
  return { repo, assumeFn };
}

const input = (over: Partial<AssumeDebtInput> = {}): AssumeDebtInput => ({
  personId: "p1",
  month: "2026-08",
  amountCents: 40000,
  scope: "month",
  ...over,
});

describe("assumePersonDebt — moves the uncovered shares onto the user", () => {
  it("plans the browsed month's pending and stamps a dated trail on the row", async () => {
    const { repo, assumeFn } = stub([sharedExpense()]);
    const result = await assumePersonDebt(repo, "u", input());
    expect(result).toEqual({ ok: true, value: 1 });
    expect(assumeFn).toHaveBeenCalledTimes(1);
    const [, items, note] = assumeFn.mock.calls[0] as unknown as [string, unknown[], string];
    expect(items).toEqual([{ transactionId: "e1", personId: "p1", assumeCents: 40000 }]);
    expect(note).toBe(`Assumido de Ana em ${shortDate(todayInBrazil())}`);
  });

  it("a partial amount leaves the rest with the person", async () => {
    const { repo, assumeFn } = stub([sharedExpense()]);
    const result = await assumePersonDebt(repo, "u", input({ amountCents: 15000 }));
    expect(result.ok).toBe(true);
    const [, items] = assumeFn.mock.calls[0] as unknown as [string, unknown[]];
    expect(items).toEqual([{ transactionId: "e1", personId: "p1", assumeCents: 15000 }]);
  });

  it("`all` reaches earlier months and is capped at the booked outstanding through the month", async () => {
    const june = sharedExpense({
      id: "jun",
      date: "2026-06-05",
      amountCents: -10000,
      splits: [{ personId: "p1", shareCents: 10000 }],
    });
    const { repo, assumeFn } = stub([june, sharedExpense()]);
    const ok = await assumePersonDebt(repo, "u", input({ scope: "all", amountCents: 50000 }));
    expect(ok.ok).toBe(true);
    const [, items] = assumeFn.mock.calls[0] as unknown as [string, Array<{ transactionId: string }>];
    expect(items.map((i) => i.transactionId)).toEqual(["e1", "jun"]);

    const over = await assumePersonDebt(
      stub([june, sharedExpense()]).repo,
      "u",
      input({ scope: "all", amountCents: 50001 }),
    );
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe("over_assume");
  });
});

describe("assumePersonDebt — guards", () => {
  it("rejects more than the month's booked pending", async () => {
    const { repo, assumeFn } = stub([sharedExpense()]);
    const result = await assumePersonDebt(repo, "u", input({ amountCents: 40001 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("over_assume");
      expect(result.error.message).toContain("R$");
    }
    expect(assumeFn).not.toHaveBeenCalled();
  });

  it("rejects when the month holds only forecasts (a previsto has no row to move)", async () => {
    const rule = sharedExpense({ date: "2026-05-05", recurrence: { dayOfMonth: 5 } });
    const { repo, assumeFn } = stub([rule]);
    const result = await assumePersonDebt(repo, "u", input({ month: "2026-07" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("nothing_to_assume");
    expect(assumeFn).not.toHaveBeenCalled();
  });

  it("rejects when the person already settled everything", async () => {
    const paid: Settlement = {
      id: "s1",
      personId: "p1",
      amountCents: 40000,
      date: "2026-08-20",
      accountId: null,
    };
    const { repo, assumeFn } = stub([sharedExpense()], [paid]);
    const result = await assumePersonDebt(repo, "u", input());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("nothing_to_assume");
    expect(assumeFn).not.toHaveBeenCalled();
  });

  it("rejects when YOU owe the person — there is nothing of theirs to take over", async () => {
    const payment: IncomeTransaction = {
      id: "i1",
      description: "Pagamento",
      date: "2026-08-01",
      kind: "income",
      amountCents: 10000,
      accountId: "acc-1",
      cardId: null,
      fromPersonId: "p1",
      isReimbursement: true,
      recurrence: null,
      receivedAt: "2026-08-01",
      receivedAccountId: "acc-1",
      receivedAmountCents: 10000,
    };
    const { repo, assumeFn } = stub([payment]);
    const result = await assumePersonDebt(repo, "u", input({ amountCents: 5000 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("nothing_to_assume");
    expect(assumeFn).not.toHaveBeenCalled();
  });

  it("returns not_found for an unknown person", async () => {
    const { repo } = stub([sharedExpense()]);
    const result = await assumePersonDebt(repo, "u", input({ personId: "ghost" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});
