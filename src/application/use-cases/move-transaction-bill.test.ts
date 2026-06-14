import { describe, expect, it } from "vitest";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { ExpenseTransaction } from "@/domain/entities/transaction";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { moveTransactionBill } from "./move-transaction-bill";

// Caixa-style card: closes 24, due 2 (a charge on 26/05 lands in the JULY bill).
const card: CreditCard = {
  id: "card-1",
  bank: "Caixa",
  product: "Ultra",
  flag: "visa",
  themeKey: "",
  maskedNumber: "",
  limitCents: 0,
  closingDay: 24,
  dueDay: 2,
};

const charge = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: "tx-1",
  description: "Compra",
  date: "2026-05-26",
  kind: "expense",
  amountCents: -10000,
  categoryId: null,
  source: "card",
  cardId: "card-1",
  accountId: null,
  linkedAccountId: null,
  splits: [],
  myShareCents: 10000,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  ...over,
});

function workspace(tx: ExpenseTransaction): Workspace {
  return {
    accounts: [],
    creditCards: [card],
    people: [],
    categories: [],
    transactions: [tx],
    settlements: [],
    budgets: [],
    goals: [],
    cardBillDates: [],
  };
}

function stubRepo(
  tx: ExpenseTransaction,
  captured: { month?: string | null; calls: number },
): FinanceRepository {
  return {
    loadWorkspace: async () => workspace(tx),
    setBillMonthOverride: async (_userId: string, _id: string, month: string | null) => {
      captured.month = month;
      captured.calls += 1;
    },
  } as unknown as FinanceRepository;
}

describe("moveTransactionBill", () => {
  it("pins a card charge to the previous bill", async () => {
    // Natural bill is JULY; moving prev pins it to JUNE.
    const captured: { month?: string | null; calls: number } = { calls: 0 };
    const result = await moveTransactionBill(stubRepo(charge(), captured), "u", "tx-1", "prev");
    expect(result.ok).toBe(true);
    expect(captured.month).toBe("2026-06");
  });

  it("clears the override when moving back to the natural bill", async () => {
    // Already pinned to JUNE; moving next reaches the natural JULY → override cleared.
    const captured: { month?: string | null; calls: number } = { calls: 0 };
    const tx = charge({ billMonthOverride: "2026-06" });
    const result = await moveTransactionBill(stubRepo(tx, captured), "u", "tx-1", "next");
    expect(result.ok).toBe(true);
    expect(captured.month).toBeNull();
  });

  it("rejects a non-card transaction (repo untouched)", async () => {
    const captured: { month?: string | null; calls: number } = { calls: 0 };
    const tx = charge({ source: "account", cardId: null });
    const result = await moveTransactionBill(stubRepo(tx, captured), "u", "tx-1", "prev");
    expect(result.ok).toBe(false);
    expect(captured.calls).toBe(0);
  });
});
