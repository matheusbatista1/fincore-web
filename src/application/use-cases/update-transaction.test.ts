import { describe, expect, it } from "vitest";
import type {
  CreateTransactionCommand,
  FinanceRepository,
  UpdateTransactionCommand,
} from "../ports/finance-repository";
import { updateTransaction } from "./update-transaction";

interface Captured {
  updateCommand?: UpdateTransactionCommand;
  updateScope?: "one" | "forward" | "all" | undefined;
  replace?: { originalId: string; command: CreateTransactionCommand };
}

/** Stub repo recording the update command and any installment replacement. */
function stubRepo(captured: Captured): FinanceRepository {
  return {
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
