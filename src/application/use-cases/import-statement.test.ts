import { describe, expect, it } from "vitest";
import type { ImportStatementInput } from "@/shared/schemas/import";
import type { CreateTransactionCommand, FinanceRepository } from "../ports/finance-repository";
import { importStatement } from "./import-statement";

type ImportEntry = ImportStatementInput["entries"][number];

/** Stub repo that records every create command (importCard may call it more than once). */
function stubRepo(commands: CreateTransactionCommand[]): FinanceRepository {
  return {
    createTransaction: async (_userId: string, command: CreateTransactionCommand) => {
      commands.push(command);
    },
  } as unknown as FinanceRepository;
}

const USER = "user-1";

/** Build an import line with sensible defaults (no fixed, no installment). */
const line = (over: Partial<ImportEntry>): ImportEntry => ({
  date: "2026-06-10",
  description: "X",
  amountCents: -1000,
  categoryId: null,
  fixed: false,
  installment: null,
  ...over,
});

describe("importStatement use-case", () => {
  it("maps a bank statement to account expenses and incomes by sign", async () => {
    const commands: CreateTransactionCommand[] = [];
    const result = await importStatement(stubRepo(commands), USER, {
      target: { type: "account", accountId: "acc-1" },
      entries: [
        line({ description: "Mercado", amountCents: -15090, categoryId: "cat-food" }),
        line({ description: "Salário", amountCents: 300000 }),
      ],
    });

    expect(result.imported).toBe(2);
    const entries = commands[0]?.entries ?? [];
    expect(entries[0]).toMatchObject({
      kind: "expense",
      source: "account",
      accountId: "acc-1",
      amountCents: -15090,
      myShareCents: 15090,
      categoryId: "cat-food",
    });
    expect(entries[1]).toMatchObject({ kind: "income", accountId: "acc-1", amountCents: 300000 });
  });

  it("maps a card bill normalizing any sign to a negative card charge", async () => {
    const commands: CreateTransactionCommand[] = [];
    const result = await importStatement(stubRepo(commands), USER, {
      target: { type: "card", cardId: "card-1" },
      entries: [
        line({ description: "Uber", amountCents: 3200, categoryId: "cat-trans" }),
        line({ description: "Supermercado", amountCents: -60762 }),
      ],
    });

    expect(result.imported).toBe(2);
    expect((commands[0]?.entries ?? []).map((e) => e.amountCents)).toEqual([-3200, -60762]);
    expect(commands[0]?.entries[0]).toMatchObject({ source: "card", cardId: "card-1", myShareCents: 3200 });
  });

  it("marks a fixed line with a recurrence day-of-month", async () => {
    const commands: CreateTransactionCommand[] = [];
    await importStatement(stubRepo(commands), USER, {
      target: { type: "account", accountId: "acc-1" },
      entries: [line({ description: "Aluguel", amountCents: -150000, date: "2026-06-13", fixed: true })],
    });

    expect(commands[0]?.entries[0]?.recurrenceDayOfMonth).toBe(13);
  });

  it("expands a card installment line into a group with N parcelas", async () => {
    const commands: CreateTransactionCommand[] = [];
    const result = await importStatement(stubRepo(commands), USER, {
      target: { type: "card", cardId: "card-1" },
      entries: [
        line({
          description: "Geladeira",
          amountCents: 30000,
          installment: { total: 3, current: 1, includePrevious: false, includeNext: true },
        }),
      ],
    });

    expect(result.imported).toBe(1);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.installmentGroup).toEqual({ totalCount: 3, totalCents: -30000 });
    const entries = commands[0]?.entries ?? [];
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.amountCents)).toEqual([-10000, -10000, -10000]);
    expect(entries.map((e) => e.parcelaStatus)).toEqual(["atual", "futura", "futura"]);
    expect(entries[0]).toMatchObject({ source: "card", cardId: "card-1", parcelaNo: 1, parcelaTotal: 3 });
  });

  it("batches plain charges and emits each installment line as its own group", async () => {
    const commands: CreateTransactionCommand[] = [];
    const result = await importStatement(stubRepo(commands), USER, {
      target: { type: "card", cardId: "card-1" },
      entries: [
        line({ description: "Padaria", amountCents: 990 }),
        line({
          description: "Notebook",
          amountCents: 24000,
          installment: { total: 12, current: 1, includePrevious: false, includeNext: true },
        }),
      ],
    });

    expect(result.imported).toBe(2);
    // One batch for the plain charge + one command for the installment group.
    expect(commands).toHaveLength(2);
    expect(commands[0]?.entries).toHaveLength(1);
    expect(commands[1]?.installmentGroup?.totalCount).toBe(12);
    expect(commands[1]?.entries).toHaveLength(12);
  });
});
