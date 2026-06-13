import { describe, expect, it } from "vitest";
import type { ImportStatementInput } from "@/shared/schemas/import";
import type { CreateTransactionCommand, FinanceRepository } from "../ports/finance-repository";
import { importStatement } from "./import-statement";

/** Stub repo that records the create command (the use case is pure up to this call). */
function stubRepo(captured: { command?: CreateTransactionCommand; calls: number }): FinanceRepository {
  return {
    createTransaction: async (_userId: string, command: CreateTransactionCommand) => {
      captured.command = command;
      captured.calls += 1;
    },
  } as unknown as FinanceRepository;
}

const USER = "user-1";

const rows: ImportStatementInput["entries"] = [
  { date: "2026-06-10", description: "Mercado", amountCents: -15090, categoryId: "cat-food" },
  { date: "2026-06-12", description: "Salário", amountCents: 300000, categoryId: null },
];

describe("importStatement use-case", () => {
  it("maps a bank statement to account expenses and incomes by sign", async () => {
    const captured: { command?: CreateTransactionCommand; calls: number } = { calls: 0 };
    const result = await importStatement(stubRepo(captured), USER, {
      target: { type: "account", accountId: "acc-1" },
      entries: rows,
    });

    expect(result.imported).toBe(2);
    const entries = captured.command?.entries ?? [];
    expect(entries[0]).toMatchObject({
      kind: "expense",
      source: "account",
      accountId: "acc-1",
      amountCents: -15090,
      myShareCents: 15090,
      categoryId: "cat-food",
    });
    expect(entries[1]).toMatchObject({
      kind: "income",
      accountId: "acc-1",
      amountCents: 300000,
      isReimbursement: false,
    });
  });

  it("maps a card bill: positive lines become negative card charges", async () => {
    const captured: { command?: CreateTransactionCommand; calls: number } = { calls: 0 };
    const result = await importStatement(stubRepo(captured), USER, {
      target: { type: "card", cardId: "card-1" },
      entries: [{ date: "2026-06-10", description: "Uber", amountCents: 3200, categoryId: "cat-trans" }],
    });

    expect(result.imported).toBe(1);
    expect(captured.command?.entries[0]).toMatchObject({
      kind: "expense",
      source: "card",
      cardId: "card-1",
      amountCents: -3200,
      myShareCents: 3200,
      categoryId: "cat-trans",
    });
  });

  it("normalizes any input sign to a negative card charge (OFX purchases are negative)", async () => {
    // The wizard already excluded credits by dominant sign; the use case just charges
    // every received line by magnitude, so negative OFX purchases stay charges.
    const captured: { command?: CreateTransactionCommand; calls: number } = { calls: 0 };
    const result = await importStatement(stubRepo(captured), USER, {
      target: { type: "card", cardId: "card-1" },
      entries: [
        { date: "2026-06-13", description: "Supermercado", amountCents: -60762, categoryId: null },
        { date: "2026-06-10", description: "Apple", amountCents: -1499, categoryId: null },
      ],
    });

    expect(result.imported).toBe(2);
    expect(captured.command?.entries.map((e) => e.amountCents)).toEqual([-60762, -1499]);
    expect(captured.command?.entries[0]).toMatchObject({ source: "card", myShareCents: 60762 });
  });
});
