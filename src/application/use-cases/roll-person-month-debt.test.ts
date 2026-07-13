import { describe, expect, it, vi } from "vitest";
import type { Person } from "@/domain/entities/person";
import type { Settlement } from "@/domain/entities/settlement";
import type { ExpenseTransaction, IncomeTransaction, Transaction } from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import { todayInBrazil } from "@/shared/formatting/now";
import type { RollMonthDebtInput } from "@/shared/schemas/transaction";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { rollPersonMonthDebt } from "./roll-person-month-debt";

const ana: Person = { id: "p1", name: "Ana", relationship: "Amiga", color: "#000000" };

const sharedExpense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: "e1",
  description: "Mercado",
  date: "2026-07-05" as IsoDate,
  kind: "expense",
  amountCents: -40000,
  categoryId: null,
  source: "account",
  cardId: null,
  accountId: "acc-1",
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
  const rollFn = vi.fn(async () => {});
  const repo = {
    loadWorkspace: async () => ws,
    rollPersonMonthDebt: rollFn,
  } as unknown as FinanceRepository;
  return { repo, rollFn };
}

const input = (over: Partial<RollMonthDebtInput> = {}): RollMonthDebtInput => ({
  personId: "p1",
  month: "2026-07",
  principalCents: 40000,
  jurosCents: 3000,
  date: "2026-08-10" as IsoDate,
  source: "loan",
  cardId: null,
  accountId: null,
  linkedAccountId: null,
  installments: 1,
  description: "Dívida de Ana",
  ...over,
});

describe("rollPersonMonthDebt — pool roll guards", () => {
  it("rolls the remainder: cash-less settlement (today) + new debt fully owed by the person", async () => {
    const { repo, rollFn } = stub([sharedExpense()]);
    const result = await rollPersonMonthDebt(repo, "u", input());
    expect(result.ok).toBe(true);
    expect(rollFn).toHaveBeenCalledTimes(1);
    const [, settlement, command] = rollFn.mock.calls[0] as unknown as [
      string,
      { personId: string; amountCents: number; date: string; accountId: string | null },
      { entries: Array<{ kind: string; amountCents: number; splits?: Array<{ shareCents: number }> }> },
    ];
    expect(settlement).toMatchObject({
      personId: "p1",
      amountCents: 40000,
      accountId: null, // cash-less — nothing was received
      date: todayInBrazil(),
    });
    expect(command.entries).toHaveLength(1);
    expect(command.entries[0]).toMatchObject({ kind: "expense", amountCents: -43000 });
    expect(command.entries[0]?.splits?.[0]).toMatchObject({ personId: "p1", shareCents: 43000 });
  });

  it("rejects when the person has NOTHING booked to roll (projections are not debts)", async () => {
    const recurring = sharedExpense({ recurrence: { dayOfMonth: 5 }, date: "2026-05-05" as IsoDate });
    // Only a May anchor + projections into July — July has no BOOKED debt.
    const { repo, rollFn } = stub(
      [recurring],
      [{ id: "s1", personId: "p1", amountCents: 40000, date: "2026-05-10", accountId: "acc-1" }],
    );
    const result = await rollPersonMonthDebt(repo, "u", input());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("nothing_to_roll");
    expect(rollFn).not.toHaveBeenCalled();
  });

  it("rejects when YOU owe the person (negative balance) — rolling would erase your own debt", async () => {
    const payment: IncomeTransaction = {
      id: "i1",
      description: "Pagamento",
      date: "2026-07-01" as IsoDate,
      kind: "income",
      amountCents: 10000,
      accountId: "acc-1",
      cardId: null,
      fromPersonId: "p1",
      isReimbursement: true,
      recurrence: null,
      receivedAt: "2026-07-01" as IsoDate,
      receivedAccountId: "acc-1",
      receivedAmountCents: 10000,
    };
    const { repo, rollFn } = stub([payment]);
    const result = await rollPersonMonthDebt(repo, "u", input({ principalCents: 5000 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("nothing_to_roll");
    expect(rollFn).not.toHaveBeenCalled();
  });

  it("rejects rolling MORE than the booked outstanding", async () => {
    const { repo, rollFn } = stub([sharedExpense()]);
    const result = await rollPersonMonthDebt(repo, "u", input({ principalCents: 40001 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("over_roll");
    expect(rollFn).not.toHaveBeenCalled();
  });

  it("rejects a new debt due in (or before) the rolled month — it would intercept its own settlement", async () => {
    const { repo, rollFn } = stub([sharedExpense()]);
    const result = await rollPersonMonthDebt(repo, "u", input({ date: "2026-07-25" as IsoDate }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("bad_due_month");
    expect(rollFn).not.toHaveBeenCalled();
  });

  it("returns not_found for an unknown person", async () => {
    const { repo } = stub([sharedExpense()]);
    const result = await rollPersonMonthDebt(repo, "u", input({ personId: "ghost" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});
