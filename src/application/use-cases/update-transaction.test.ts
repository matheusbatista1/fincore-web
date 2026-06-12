import { describe, expect, it } from "vitest";
import type { FinanceRepository, UpdateTransactionCommand } from "../ports/finance-repository";
import { updateTransaction } from "./update-transaction";

/** Stub repo that records the command (the use case is pure up to this call). */
function stubRepo(captured: { command?: UpdateTransactionCommand }): FinanceRepository {
  return {
    updateTransaction: async (_userId: string, command: UpdateTransactionCommand) => {
      captured.command = command;
    },
  } as unknown as FinanceRepository;
}

const USER = "user-1";

describe("updateTransaction use-case", () => {
  it("negates the expense amount and recomputes an equal split server-side", async () => {
    const captured: { command?: UpdateTransactionCommand } = {};
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
      split: { method: "equal", meIn: true, selected: ["p1", "p2"], custom: {} },
    });

    expect(result.ok).toBe(true);
    const command = captured.command;
    expect(command?.amountCents).toBe(-3000);
    expect(command?.myShareCents).toBe(1000);
    expect(command?.splits).toEqual([
      { personId: "p1", shareCents: 1000 },
      { personId: "p2", shareCents: 1000 },
    ]);
    expect(command?.cardId).toBe("card-1");
    expect(command?.accountId).toBeNull();
    expect(command?.linkedAccountId).toBeNull();
  });

  it("rejects a card expense without a card (repo untouched)", async () => {
    const captured: { command?: UpdateTransactionCommand } = {};
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
      split: { method: "equal", meIn: true, selected: [], custom: {} },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_source");
    expect(captured.command).toBeUndefined();
  });

  it("rejects an invalid custom split (sum exceeds the amount)", async () => {
    const captured: { command?: UpdateTransactionCommand } = {};
    const result = await updateTransaction(stubRepo(captured), USER, {
      kind: "expense",
      id: "tx-1",
      description: "Jantar",
      date: "2026-06-10",
      amountCents: 1000,
      categoryId: null,
      source: "account",
      cardId: null,
      accountId: "acc-1",
      linkedAccountId: null,
      split: { method: "custom", meIn: true, selected: ["p1"], custom: { p1: 2000 } },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_split");
    expect(captured.command).toBeUndefined();
  });

  it("drops zero-cent shares (DB requires share > 0)", async () => {
    const captured: { command?: UpdateTransactionCommand } = {};
    const result = await updateTransaction(stubRepo(captured), USER, {
      kind: "expense",
      id: "tx-1",
      description: "Uber",
      date: "2026-06-10",
      amountCents: 1000,
      categoryId: null,
      source: "account",
      cardId: null,
      accountId: "acc-1",
      linkedAccountId: null,
      split: { method: "custom", meIn: true, selected: ["p1", "p2"], custom: { p1: 1000, p2: 0 } },
    });

    expect(result.ok).toBe(true);
    expect(captured.command?.splits).toEqual([{ personId: "p1", shareCents: 1000 }]);
    expect(captured.command?.myShareCents).toBe(0);
  });

  it("marks an income from a person as a reimbursement with full myShare", async () => {
    const captured: { command?: UpdateTransactionCommand } = {};
    const result = await updateTransaction(stubRepo(captured), USER, {
      kind: "income",
      id: "tx-2",
      description: "",
      date: "2026-06-11",
      amountCents: 5000,
      accountId: "acc-1",
      fromPersonId: "p1",
    });

    expect(result.ok).toBe(true);
    expect(captured.command?.isReimbursement).toBe(true);
    expect(captured.command?.myShareCents).toBe(5000);
    expect(captured.command?.description).toBe("Pagamento recebido");
  });

  it("keeps transfers at zero amount with the moved value on transferValueCents", async () => {
    const captured: { command?: UpdateTransactionCommand } = {};
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
    expect(captured.command?.amountCents).toBe(0);
    expect(captured.command?.transferValueCents).toBe(12345);
    expect(captured.command?.description).toBe("Transferência");
    expect(captured.command?.note).toBeNull();
  });
});
