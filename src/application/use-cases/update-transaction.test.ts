import { describe, expect, it, vi } from "vitest";
import type { ExpenseTransaction, IncomeTransaction, Transaction } from "@/domain/entities/transaction";
import type {
  CreateTransactionCommand,
  FinanceRepository,
  UpdateTransactionCommand,
  Workspace,
} from "../ports/finance-repository";
import { updateTransaction } from "./update-transaction";

// Freeze "today": an income moved to a later day becomes a pending receivable.
vi.mock("@/shared/formatting/now", () => ({ todayInBrazil: () => "2026-11-11" }));

interface Captured {
  updateCommand?: UpdateTransactionCommand;
  updateScope?: "one" | "forward" | "all" | undefined;
  replace?: { originalId: string; command: CreateTransactionCommand };
}

/** Stub repo recording the update command and any installment replacement. */
function stubRepo(captured: Captured, transactions: Transaction[] = []): FinanceRepository {
  const workspace: Workspace = {
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
  return {
    loadWorkspace: async () => workspace,
    updateTransaction: async (
      _userId: string,
      command: UpdateTransactionCommand,
      scope?: "one" | "forward" | "all",
    ) => {
      captured.updateCommand = command;
      captured.updateScope = scope;
      return 1;
    },
    replaceWithInstallment: async (
      _userId: string,
      originalId: string,
      command: CreateTransactionCommand,
    ) => {
      captured.replace = { originalId, command };
    },
  } as unknown as FinanceRepository;
}

const USER = "user-1";

describe("updateTransaction use-case", () => {
  it("negates the expense amount and recomputes an equal split server-side", async () => {
    const captured: Captured = {};
    const result = await updateTransaction(stubRepo(captured), USER, {
      kind: "expense",
      id: "tx-1",
      description: "Mercado",
      date: "2026-06-10",
      amountCents: 3000,
      categoryId: null,
      source: "card",
      cardId: "card-1",
      accountId: null,
      linkedAccountId: null,
      fixed: false,
      installment: null,
      split: { method: "equal", meIn: true, selected: ["p1", "p2"], custom: {} },
      scope: "one",
    });

    expect(result.ok).toBe(true);
    const command = captured.updateCommand;
    expect(command?.amountCents).toBe(-3000);
    expect(command?.myShareCents).toBe(1000);
    expect(command?.splits).toEqual([
      { personId: "p1", shareCents: 1000 },
      { personId: "p2", shareCents: 1000 },
    ]);
    expect(command?.cardId).toBe("card-1");
    expect(command?.fixed).toBe(false);
  });

  it("rejects a card expense without a card (repo untouched)", async () => {
    const captured: Captured = {};
    const result = await updateTransaction(stubRepo(captured), USER, {
      kind: "expense",
      id: "tx-1",
      description: "",
      date: "2026-06-10",
      amountCents: 1000,
      categoryId: null,
      source: "card",
      cardId: null,
      accountId: null,
      linkedAccountId: null,
      fixed: false,
      installment: null,
      split: { method: "equal", meIn: true, selected: [], custom: {} },
      scope: "one",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_source");
    expect(captured.updateCommand).toBeUndefined();
  });

  it("turns a single expense into a recurring one when fixed is on", async () => {
    const captured: Captured = {};
    const result = await updateTransaction(stubRepo(captured), USER, {
      kind: "expense",
      id: "tx-1",
      description: "Aluguel",
      date: "2026-06-13",
      amountCents: 150000,
      categoryId: null,
      source: "account",
      cardId: null,
      accountId: "acc-1",
      linkedAccountId: null,
      fixed: true,
      installment: null,
      split: { method: "equal", meIn: true, selected: [], custom: {} },
      scope: "all",
    });

    expect(result.ok).toBe(true);
    expect(captured.updateCommand?.fixed).toBe(true);
  });

  it("marks an income from a person as a reimbursement with full myShare", async () => {
    const captured: Captured = {};
    const result = await updateTransaction(stubRepo(captured), USER, {
      kind: "income",
      id: "tx-2",
      description: "",
      date: "2026-06-11",
      amountCents: 5000,
      accountId: "acc-1",
      cardId: null,
      fromPersonId: "p1",
      fixed: false,
      scope: "one",
    });

    expect(result.ok).toBe(true);
    expect(captured.updateCommand?.isReimbursement).toBe(true);
    expect(captured.updateCommand?.myShareCents).toBe(5000);
    expect(captured.updateCommand?.fixed).toBe(false);
  });

  it("keeps transfers at zero amount with the moved value on transferValueCents", async () => {
    const captured: Captured = {};
    const result = await updateTransaction(stubRepo(captured), USER, {
      kind: "transfer",
      id: "tx-3",
      description: "",
      date: "2026-06-11",
      fromAccountId: "acc-1",
      toAccountId: "acc-2",
      valueCents: 12345,
    });

    expect(result.ok).toBe(true);
    expect(captured.updateCommand?.amountCents).toBe(0);
    expect(captured.updateCommand?.transferValueCents).toBe(12345);
  });

  it("converts a non-installment expense into an installment group (replaces the row)", async () => {
    const captured: Captured = {};
    const result = await updateTransaction(stubRepo(captured), USER, {
      kind: "expense",
      id: "tx-1",
      description: "Geladeira",
      date: "2026-06-10",
      amountCents: 30000,
      categoryId: null,
      source: "card",
      cardId: "card-1",
      accountId: null,
      linkedAccountId: null,
      fixed: false,
      installment: { total: 3, current: 1, includePrevious: false, includeNext: true },
      split: { method: "equal", meIn: true, selected: [], custom: {} },
      scope: "one",
    });

    expect(result.ok).toBe(true);
    expect(captured.updateCommand).toBeUndefined();
    expect(captured.replace?.originalId).toBe("tx-1");
    expect(captured.replace?.command.installmentGroup).toEqual({ totalCount: 3, totalCents: -30000 });
    const entries = captured.replace?.command.entries ?? [];
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.amountCents)).toEqual([-10000, -10000, -10000]);
    expect(entries[0]).toMatchObject({
      source: "card",
      cardId: "card-1",
      parcelaNo: 1,
      parcelaTotal: 3,
      parcelaStatus: "atual",
    });
  });

  it("rejects converting a non-parcelável source into an installment", async () => {
    const captured: Captured = {};
    const result = await updateTransaction(stubRepo(captured), USER, {
      kind: "expense",
      id: "tx-1",
      description: "Pix",
      date: "2026-06-10",
      amountCents: 1000,
      categoryId: null,
      source: "account",
      cardId: null,
      accountId: "acc-1",
      linkedAccountId: null,
      fixed: false,
      installment: { total: 2, current: 1, includePrevious: false, includeNext: true },
      split: { method: "equal", meIn: true, selected: [], custom: {} },
      scope: "one",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_source");
    expect(captured.replace).toBeUndefined();
  });

  it("forwards the edit scope to the repository", async () => {
    const captured: Captured = {};
    const result = await updateTransaction(stubRepo(captured), USER, {
      kind: "expense",
      id: "tx-1",
      description: "Mercado",
      date: "2026-06-10",
      amountCents: 3000,
      categoryId: "cat-x",
      source: "card",
      cardId: "card-1",
      accountId: null,
      linkedAccountId: null,
      fixed: false,
      installment: null,
      split: { method: "equal", meIn: true, selected: [], custom: {} },
      scope: "all",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);
    expect(captured.updateScope).toBe("all");
  });
});

describe("updateTransaction use-case — the settlement follows the edited row", () => {
  // An income received on booking: its receipt mirrors the row.
  const cashback: IncomeTransaction = {
    id: "tx-cashback",
    kind: "income",
    description: "Cashback",
    date: "2026-11-04",
    amountCents: 1886,
    accountId: "acc-c6",
    cardId: null,
    fromPersonId: null,
    isReimbursement: false,
    recurrence: null,
    receivedAt: "2026-11-04",
    receivedAccountId: "acc-c6",
    receivedAmountCents: 1886,
  };
  const editCashback = (over: { amountCents?: number; accountId?: string; date?: string; cardId?: string }) =>
    ({
      kind: "income" as const,
      id: "tx-cashback",
      description: "Cashback",
      date: over.date ?? "2026-11-04",
      amountCents: over.amountCents ?? 1886,
      accountId: over.cardId ? null : (over.accountId ?? "acc-c6"),
      cardId: over.cardId ?? null,
      fromPersonId: null,
      fixed: false,
      scope: "one" as const,
    }) satisfies Parameters<typeof updateTransaction>[2];

  it("corrects what the balance credits when a received income's amount is corrected", async () => {
    // Booked as 18,86 and corrected to 18,84: without this the list shows 18,84 and the balance
    // keeps crediting 18,86.
    const captured: Captured = {};
    const result = await updateTransaction(
      stubRepo(captured, [cashback]),
      USER,
      editCashback({ amountCents: 1884 }),
    );

    expect(result.ok).toBe(true);
    expect(captured.updateCommand?.amountCents).toBe(1884);
    expect(captured.updateCommand?.settlement).toEqual({
      receivedAt: "2026-11-04",
      receivedAccountId: "acc-c6",
      receivedAmountCents: 1884,
      paidAt: null,
      paidAccountId: null,
      paidAmountCents: null,
    });
  });

  it("moves the receipt with the account and the day", async () => {
    const captured: Captured = {};
    await updateTransaction(
      stubRepo(captured, [cashback]),
      USER,
      editCashback({ accountId: "acc-nubank", date: "2026-11-02" }),
    );
    expect(captured.updateCommand?.settlement).toMatchObject({
      receivedAt: "2026-11-02",
      receivedAccountId: "acc-nubank",
      receivedAmountCents: 1886,
    });
  });

  it("keeps a receipt that was deliberately different from the row", async () => {
    const custom: IncomeTransaction = {
      ...cashback,
      receivedAt: "2026-11-06",
      receivedAccountId: "acc-nubank",
      receivedAmountCents: 1500,
    };
    const captured: Captured = {};
    await updateTransaction(stubRepo(captured, [custom]), USER, editCashback({ amountCents: 2000 }));
    expect(captured.updateCommand?.settlement).toMatchObject({
      receivedAt: "2026-11-06",
      receivedAccountId: "acc-nubank",
      receivedAmountCents: 1500,
    });
  });

  it("turns a received income into a pending receivable when it moves to a later day", async () => {
    const captured: Captured = {};
    await updateTransaction(stubRepo(captured, [cashback]), USER, editCashback({ date: "2026-11-25" }));
    expect(captured.updateCommand?.settlement).toMatchObject({
      receivedAt: null,
      receivedAccountId: null,
      receivedAmountCents: null,
    });
  });

  it("drops the receipt when the income becomes a card credit", async () => {
    const captured: Captured = {};
    await updateTransaction(stubRepo(captured, [cashback]), USER, editCashback({ cardId: "card-1" }));
    expect(captured.updateCommand?.cardId).toBe("card-1");
    expect(captured.updateCommand?.settlement).toMatchObject({ receivedAt: null, receivedAccountId: null });
  });

  const paidBoleto: ExpenseTransaction = {
    id: "tx-boleto",
    kind: "expense",
    description: "Água",
    date: "2026-11-03",
    amountCents: -4168,
    categoryId: null,
    source: "boleto",
    cardId: null,
    accountId: null,
    linkedAccountId: null,
    splits: [],
    myShareCents: 4168,
    installment: null,
    recurrence: null,
    billMonthOverride: null,
    paidAt: "2026-11-08",
    paidAccountId: "acc-c6",
    paidAmountCents: 4168,
  };
  const editBoleto = (over: { amountCents?: number; source?: "boleto" | "account" }) =>
    ({
      kind: "expense" as const,
      id: "tx-boleto",
      description: "Água",
      date: "2026-11-03",
      amountCents: over.amountCents ?? 4168,
      categoryId: null,
      source: over.source ?? "boleto",
      cardId: null,
      accountId: over.source === "account" ? "acc-c6" : null,
      linkedAccountId: null,
      fixed: false,
      installment: null,
      split: { method: "equal" as const, meIn: true, selected: [], custom: {} },
      scope: "one" as const,
    }) satisfies Parameters<typeof updateTransaction>[2];

  it("corrects the amount paid with a paid obligation's value, and keeps a discount", async () => {
    const captured: Captured = {};
    await updateTransaction(stubRepo(captured, [paidBoleto]), USER, editBoleto({ amountCents: 4170 }));
    expect(captured.updateCommand?.settlement).toMatchObject({
      paidAt: "2026-11-08",
      paidAccountId: "acc-c6",
      paidAmountCents: 4170,
    });

    const discounted: ExpenseTransaction = { ...paidBoleto, paidAmountCents: 4000 };
    await updateTransaction(stubRepo(captured, [discounted]), USER, editBoleto({ amountCents: 4170 }));
    expect(captured.updateCommand?.settlement).toMatchObject({ paidAmountCents: 4000 });
  });

  it("drops the payment when the obligation becomes an account debit", async () => {
    const captured: Captured = {};
    await updateTransaction(stubRepo(captured, [paidBoleto]), USER, editBoleto({ source: "account" }));
    expect(captured.updateCommand?.settlement).toMatchObject({
      paidAt: null,
      paidAccountId: null,
      paidAmountCents: null,
    });
  });

  it("leaves the settlement untouched when the row is not in the workspace", async () => {
    const captured: Captured = {};
    const result = await updateTransaction(stubRepo(captured), USER, editCashback({ amountCents: 1884 }));
    expect(result.ok).toBe(true);
    expect(captured.updateCommand).toBeDefined();
    expect(captured.updateCommand?.settlement).toBeUndefined();
  });
});
