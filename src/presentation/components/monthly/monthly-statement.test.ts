import { describe, expect, it } from "vitest";
import type { MonthlyItem } from "@/application/use-cases/get-monthly";
import { applyLens } from "./monthly-statement";
import type { StmtGroup } from "./stmt-card";

const item = (over: Partial<MonthlyItem>): MonthlyItem =>
  ({
    kind: "income",
    cardId: null,
    amountCents: 0,
    isReimbursement: false,
    myShareCents: 0,
    ...over,
  }) as unknown as MonthlyItem;

const group = (lens: "income" | "expense" | "transfer", items: MonthlyItem[]): StmtGroup => ({
  key: "g",
  name: "G",
  accent: "#000",
  icon: "x",
  items,
  totalCents: items.reduce((s, i) => s + Math.abs(i.amountCents), 0),
  lens,
});

describe("applyLens — monthly statement personal lens", () => {
  it("personal income drops settlements and reimbursements (keeps own income)", () => {
    const g = group("income", [
      item({ id: "wage", amountCents: 50000 }),
      item({ id: "settle", amountCents: 1200, settlement: true }),
      item({ id: "reimb", amountCents: 800, isReimbursement: true }),
    ]);
    const personal = applyLens(g, true);
    expect(personal.items.map((i) => i.id)).toEqual(["wage"]);
    expect(personal.totalCents).toBe(50000);
    expect(personal.receivables).toBeUndefined(); // people receivables are general-only
  });

  it("personal expense drops settlements and shows only the user's share", () => {
    const g = group("expense", [
      item({ id: "racha", kind: "expense", amountCents: -20000, myShareCents: 10000 }),
      item({ id: "settle", kind: "expense", amountCents: -5000, myShareCents: 5000, settlement: true }),
    ]);
    const personal = applyLens(g, true);
    expect(personal.items.map((i) => i.id)).toEqual(["racha"]);
    expect(personal.items[0]?.amountCents).toBe(-10000); // my share, not the full 20000
    expect(personal.totalCents).toBe(10000);
  });

  it("general lens keeps settlements (passes through unchanged)", () => {
    const g = group("income", [item({ id: "settle", amountCents: 1200, settlement: true })]);
    expect(applyLens(g, false).items.map((i) => i.id)).toEqual(["settle"]);
  });
});
