import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/domain/entities/account";
import type { IncomeTransaction, Transaction } from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { receiveIncome } from "./receive-income";

const account: Account = {
  id: "acc-1",
  bank: "Itaú",
  name: "Conta",
  type: "PF",
  themeKey: "",
  openingBalanceCents: 0,
  maskedNumber: "",
};

const pendingIncome = (over: Partial<IncomeTransaction> = {}): IncomeTransaction => ({
  id: "inc-1",
  kind: "income",
  description: "Fulano vai pagar",
  date: "2099-01-10" as IsoDate,
  amountCents: 50000,
  accountId: "acc-1",
  cardId: null,
  fromPersonId: "p1",
  isReimbursement: true,
  recurrence: null,
  receivedAt: null,
  receivedAccountId: null,
  receivedAmountCents: null,
  ...over,
});

function stub(transactions: Transaction[], accounts: Account[] = [account]) {
  const ws: Workspace = {
    accounts,
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
  const receiveIncomeFn = vi.fn(async () => {});
  const repo = {
    loadWorkspace: async () => ws,
    receiveIncome: receiveIncomeFn,
  } as unknown as FinanceRepository;
  return { repo, receiveIncomeFn };
}

describe("receiveIncome", () => {
  it("records the receipt with the full amount when no custom value is given", async () => {
    const { repo, receiveIncomeFn } = stub([pendingIncome()]);
    const result = await receiveIncome(repo, "u", {
      id: "inc-1",
      receivedAccountId: "acc-1",
      receivedAt: "2026-07-02" as IsoDate,
    });
    expect(result.ok).toBe(true);
    expect(receiveIncomeFn).toHaveBeenCalledWith("u", "inc-1", {
      receivedAt: "2026-07-02",
      receivedAccountId: "acc-1",
      receivedAmountCents: 50000,
    });
  });

  it("records a custom received amount (a person paid a different value)", async () => {
    const { repo, receiveIncomeFn } = stub([pendingIncome()]);
    await receiveIncome(repo, "u", {
      id: "inc-1",
      receivedAccountId: "acc-1",
      receivedAt: "2026-07-02" as IsoDate,
      receivedAmountCents: 45000,
    });
    expect(receiveIncomeFn).toHaveBeenCalledWith("u", "inc-1", {
      receivedAt: "2026-07-02",
      receivedAccountId: "acc-1",
      receivedAmountCents: 45000,
    });
  });

  it("rejects a card credit (estorno) — not a receivable income", async () => {
    const credit = pendingIncome({ id: "cc", accountId: null, cardId: "card-1", fromPersonId: null });
    const { repo, receiveIncomeFn } = stub([credit]);
    const result = await receiveIncome(repo, "u", { id: "cc", receivedAccountId: "acc-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_receivable");
    expect(receiveIncomeFn).not.toHaveBeenCalled();
  });

  it("rejects an income that is already received", async () => {
    const received = pendingIncome({
      receivedAt: "2026-06-01" as IsoDate,
      receivedAccountId: "acc-1",
      receivedAmountCents: 50000,
    });
    const { repo } = stub([received]);
    const result = await receiveIncome(repo, "u", { id: "inc-1", receivedAccountId: "acc-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("already_received");
  });

  it("rejects an unknown receiving account", async () => {
    const { repo } = stub([pendingIncome()]);
    const result = await receiveIncome(repo, "u", { id: "inc-1", receivedAccountId: "ghost" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_account");
  });

  it("rejects a non-positive custom amount", async () => {
    const { repo } = stub([pendingIncome()]);
    const result = await receiveIncome(repo, "u", {
      id: "inc-1",
      receivedAccountId: "acc-1",
      receivedAmountCents: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_amount");
  });

  it("returns not_found for a missing transaction", async () => {
    const { repo } = stub([]);
    const result = await receiveIncome(repo, "u", { id: "nope", receivedAccountId: "acc-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});
