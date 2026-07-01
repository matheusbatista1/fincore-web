import { describe, expect, it } from "vitest";
import type { IsoDate } from "../value-objects/competence-month";
import type { ExpenseTransaction, IncomeTransaction } from "./transaction";
import { isOverdue, isPaid, isPayableObligation } from "./transaction";

const expense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: "e1",
  kind: "expense",
  description: "Despesa",
  date: "2026-07-20" as IsoDate,
  amountCents: -24000,
  categoryId: null,
  source: "boleto",
  cardId: null,
  accountId: null,
  linkedAccountId: "acc-1",
  splits: [],
  myShareCents: 24000,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  rolledAt: null,
  paidAt: null,
  paidAccountId: null,
  paidAmountCents: null,
  ...over,
});

const income = (): IncomeTransaction => ({
  id: "i1",
  kind: "income",
  description: "Salário",
  date: "2026-07-01" as IsoDate,
  amountCents: 500000,
  accountId: "acc-1",
  cardId: null,
  fromPersonId: null,
  isReimbursement: false,
  recurrence: null,
});

describe("isPayableObligation", () => {
  it("is true for boleto/loan/financing", () => {
    for (const source of ["boleto", "loan", "financing"] as const) {
      expect(isPayableObligation(expense({ source }))).toBe(true);
    }
  });

  it("is false for account/overdraft/card and for non-expenses", () => {
    expect(isPayableObligation(expense({ source: "account", accountId: "acc-1" }))).toBe(false);
    expect(isPayableObligation(expense({ source: "overdraft" }))).toBe(false);
    expect(isPayableObligation(expense({ source: "card", cardId: "c1", linkedAccountId: null }))).toBe(false);
    expect(isPayableObligation(income())).toBe(false);
  });
});

describe("isPaid", () => {
  it("is true only once paidAt is set", () => {
    expect(isPaid(expense())).toBe(false);
    expect(isPaid(expense({ paidAt: "2026-07-01" as IsoDate, paidAccountId: "acc-1" }))).toBe(true);
  });

  it("is false for income (never carries a paid state)", () => {
    expect(isPaid(income())).toBe(false);
  });
});

describe("isOverdue", () => {
  const today = "2026-07-15" as IsoDate;

  it("is true for an unpaid payable obligation past its due date", () => {
    expect(isOverdue(expense({ date: "2026-07-10" as IsoDate }), today)).toBe(true);
  });

  it("is false when not yet due (due date on/after today)", () => {
    expect(isOverdue(expense({ date: "2026-07-20" as IsoDate }), today)).toBe(false);
    expect(isOverdue(expense({ date: today }), today)).toBe(false);
  });

  it("is false once paid, even if the due date passed", () => {
    const paid = expense({
      date: "2026-07-10" as IsoDate,
      paidAt: "2026-07-11" as IsoDate,
      paidAccountId: "acc-1",
    });
    expect(isOverdue(paid, today)).toBe(false);
  });

  it("is false for a rolled (abated) obligation", () => {
    expect(
      isOverdue(expense({ date: "2026-07-10" as IsoDate, rolledAt: "2026-07-11" as IsoDate }), today),
    ).toBe(false);
  });

  it("is false for account/card sources (not individually payable)", () => {
    expect(
      isOverdue(expense({ source: "account", accountId: "acc-1", date: "2026-07-10" as IsoDate }), today),
    ).toBe(false);
  });
});
