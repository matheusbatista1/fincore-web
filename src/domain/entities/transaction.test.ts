import { describe, expect, it } from "vitest";
import type { IsoDate } from "../value-objects/competence-month";
import type { ExpenseTransaction, IncomeTransaction } from "./transaction";
import {
  incomeEffectiveDate,
  isOverdue,
  isPaid,
  isPayableObligation,
  isPendingReceivable,
  isReceivableIncome,
  isReceived,
  settledIncomeCents,
} from "./transaction";

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

const income = (over: Partial<IncomeTransaction> = {}): IncomeTransaction => ({
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
  ...over,
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

describe("income received-state", () => {
  it("isReceivableIncome is true for a normal income, false for a card credit and non-incomes", () => {
    expect(isReceivableIncome(income())).toBe(true);
    expect(isReceivableIncome(income({ accountId: null, cardId: "c1" }))).toBe(false);
    expect(isReceivableIncome(expense())).toBe(false);
  });

  it("treats a legacy income (receivedAt undefined) as received on its date", () => {
    const legacy = income(); // no received fields set
    expect(isReceived(legacy)).toBe(true);
    expect(isPendingReceivable(legacy)).toBe(false);
    expect(incomeEffectiveDate(legacy)).toBe("2026-07-01");
    expect(settledIncomeCents(legacy)).toBe(500000);
  });

  it("is a pending receivable when explicitly booked with receivedAt null (future-dated)", () => {
    const pending = income({ date: "2026-09-10" as IsoDate, receivedAt: null });
    expect(isReceived(pending)).toBe(false);
    expect(isPendingReceivable(pending)).toBe(true);
    // A pending receivable reports its face value (expected); callers gate the cash on isReceived.
    expect(settledIncomeCents(pending)).toBe(500000);
  });

  it("is received once receivedAt is set, valued at the amount actually received", () => {
    const received = income({
      date: "2026-09-10" as IsoDate,
      receivedAt: "2026-09-12" as IsoDate,
      receivedAccountId: "acc-2",
      receivedAmountCents: 480000,
    });
    expect(isReceived(received)).toBe(true);
    expect(isPendingReceivable(received)).toBe(false);
    expect(incomeEffectiveDate(received)).toBe("2026-09-12");
    expect(settledIncomeCents(received)).toBe(480000);
  });

  it("a card credit is never received nor pending", () => {
    const credit = income({ accountId: null, cardId: "c1", receivedAt: null });
    expect(isReceived(credit)).toBe(false);
    expect(isPendingReceivable(credit)).toBe(false);
  });
});
