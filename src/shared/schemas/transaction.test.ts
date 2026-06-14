import { describe, expect, it } from "vitest";
import { createTransactionSchema, updateTransactionSchema } from "./transaction";

const baseIncome = { kind: "income" as const, date: "2026-06-10", amountCents: 1000 };

describe("income destination — account XOR card", () => {
  it("accepts an income that lands in an account", () => {
    expect(createTransactionSchema.safeParse({ ...baseIncome, accountId: "acc-1" }).success).toBe(true);
  });

  it("accepts a card credit (estorno) that targets a card", () => {
    expect(createTransactionSchema.safeParse({ ...baseIncome, cardId: "card-1" }).success).toBe(true);
  });

  it("rejects an income with both an account and a card", () => {
    const result = createTransactionSchema.safeParse({
      ...baseIncome,
      accountId: "acc-1",
      cardId: "card-1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an income with neither destination", () => {
    expect(createTransactionSchema.safeParse({ ...baseIncome }).success).toBe(false);
  });

  it("enforces the same rule on updates", () => {
    const id = "tx-1";
    expect(updateTransactionSchema.safeParse({ ...baseIncome, id, cardId: "card-1" }).success).toBe(true);
    expect(updateTransactionSchema.safeParse({ ...baseIncome, id, accountId: "acc-1" }).success).toBe(true);
    expect(
      updateTransactionSchema.safeParse({ ...baseIncome, id, accountId: "a", cardId: "c" }).success,
    ).toBe(false);
    expect(updateTransactionSchema.safeParse({ ...baseIncome, id }).success).toBe(false);
  });
});
