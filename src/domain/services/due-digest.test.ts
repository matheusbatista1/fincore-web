import { describe, expect, it } from "vitest";
import type { CardBillDate } from "../entities/card-bill-date";
import type { CardBillPayment } from "../entities/card-bill-payment";
import type { CreditCard } from "../entities/credit-card";
import type { ExpenseTransaction, IncomeTransaction, Transaction } from "../entities/transaction";
import { type DueDigestInput, dueDigest, hasDue, OVERDUE_WINDOW_DAYS } from "./due-digest";

const TODAY = "2026-06-14";

let seq = 0;

/** Closes on the 24th, due on the 15th: tomorrow, for a fatura of June. */
const card = (over: Partial<CreditCard> = {}): CreditCard => ({
  id: "k",
  bank: "Nubank",
  product: "Gold",
  flag: "mastercard",
  themeKey: "",
  maskedNumber: "",
  limitCents: 500_000,
  closingDay: 24,
  dueDay: 15,
  ...over,
});

const boleto = (cents: number, date: string, over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: `tx-${++seq}`,
  kind: "expense",
  description: "Internet",
  date,
  amountCents: -cents,
  categoryId: null,
  source: "boleto",
  cardId: null,
  accountId: null,
  linkedAccountId: null,
  splits: [],
  myShareCents: cents,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  ...over,
});

/** A card charge dated so it is billed in June (closing day 24: anything from 25 Apr to 24 May). */
const charge = (cents: number, over: Partial<ExpenseTransaction> = {}): ExpenseTransaction =>
  boleto(cents, "2026-05-20", { description: "Mercado", source: "card", cardId: "k", ...over });

const digestOf = (transactions: Transaction[], over: Partial<Omit<DueDigestInput, "transactions">> = {}) =>
  dueDigest({
    creditCards: [],
    cardBillDates: [],
    cardBillPayments: [],
    today: TODAY,
    ...over,
    transactions,
  });

describe("dueDigest — boletos and parcelas", () => {
  it("is empty when there is nothing to pay", () => {
    const digest = digestOf([]);
    expect(digest).toEqual({ overdue: [], today: [], tomorrow: [] });
    expect(hasDue(digest)).toBe(false);
  });

  it("puts each unpaid obligation in the day it is due", () => {
    const digest = digestOf([
      boleto(12_000, "2026-06-14"),
      boleto(185_000, "2026-06-15", { description: "Aluguel", source: "financing" }),
      boleto(8_000, "2026-06-12", { description: "Condomínio", source: "loan" }),
    ]);
    expect(digest.today).toEqual([{ label: "Internet", cents: 12_000, date: "2026-06-14" }]);
    expect(digest.tomorrow).toEqual([{ label: "Aluguel", cents: 185_000, date: "2026-06-15" }]);
    expect(digest.overdue).toEqual([{ label: "Condomínio", cents: 8_000, date: "2026-06-12" }]);
    expect(hasDue(digest)).toBe(true);
  });

  it("leaves out what is paid, rolled, further ahead, or not an obligation at all", () => {
    const salary: IncomeTransaction = {
      id: "salary",
      kind: "income",
      description: "Salário",
      date: TODAY,
      amountCents: 500_000,
      accountId: "a",
      cardId: null,
      fromPersonId: null,
      isReimbursement: false,
      recurrence: null,
    };
    const digest = digestOf([
      boleto(1_000, TODAY, { paidAt: "2026-06-13", paidAccountId: "a", paidAmountCents: 1_000 }),
      boleto(2_000, TODAY, { rolledAt: "2026-06-10" }),
      boleto(3_000, "2026-06-16"),
      // Paid from the account on the spot: nothing left to pay.
      boleto(4_000, TODAY, { source: "account", accountId: "a" }),
      boleto(5_000, TODAY, { source: "overdraft", linkedAccountId: "a" }),
      salary,
    ]);
    expect(hasDue(digest)).toBe(false);
  });

  it("reminds of a late one for a few days only", () => {
    expect(OVERDUE_WINDOW_DAYS).toBe(7);
    const digest = digestOf([
      boleto(1_000, "2026-06-13", { description: "Ontem" }),
      boleto(2_000, "2026-06-07", { description: "Há sete dias" }),
      boleto(3_000, "2026-06-06", { description: "Há oito dias" }),
      boleto(4_000, "2025-01-10", { description: "Esquecido" }),
    ]);
    expect(digest.overdue.map((item) => item.label)).toEqual(["Há sete dias", "Ontem"]);
  });

  it("lists each group oldest first, then by name", () => {
    const digest = digestOf([
      boleto(1_000, TODAY, { description: "Luz" }),
      boleto(2_000, TODAY, { description: "Água" }),
      boleto(3_000, "2026-06-13", { description: "Zebra" }),
      boleto(4_000, "2026-06-12", { description: "Internet" }),
    ]);
    expect(digest.today.map((item) => item.label)).toEqual(["Água", "Luz"]);
    expect(digest.overdue.map((item) => item.label)).toEqual(["Internet", "Zebra"]);
  });
});

describe("dueDigest — card faturas", () => {
  it("lists a fatura on its due day, for what it adds up to", () => {
    // Due on the 15th: tomorrow. Two charges and an estorno billed in June.
    const estorno: IncomeTransaction = {
      id: "estorno",
      kind: "income",
      description: "Estorno",
      date: "2026-05-22",
      amountCents: 1_000,
      accountId: null,
      cardId: "k",
      fromPersonId: null,
      isReimbursement: false,
      recurrence: null,
    };
    const digest = digestOf([charge(30_000), charge(5_000), estorno], { creditCards: [card()] });
    expect(digest.tomorrow).toEqual([{ label: "Fatura Nubank", cents: 34_000, date: "2026-06-15" }]);
    expect(digest.today).toEqual([]);

    const dueToday = digestOf([charge(30_000)], { creditCards: [card({ dueDay: 14 })] });
    expect(dueToday.today).toEqual([{ label: "Fatura Nubank", cents: 30_000, date: "2026-06-14" }]);
  });

  it("says nothing of a fatura already paid, empty, or due another day", () => {
    const payment: CardBillPayment = {
      id: "p",
      cardId: "k",
      competence: "2026-06",
      amountCents: 30_000,
      accountId: "a",
      date: "2026-06-10",
    };
    expect(hasDue(digestOf([charge(30_000)], { creditCards: [card()], cardBillPayments: [payment] }))).toBe(
      false,
    );
    expect(hasDue(digestOf([], { creditCards: [card()] }))).toBe(false);
    expect(hasDue(digestOf([charge(30_000)], { creditCards: [card({ dueDay: 20 })] }))).toBe(false);
    // Past its day with no payment recorded: presumed paid at the bank, like everywhere else.
    expect(hasDue(digestOf([charge(30_000)], { creditCards: [card({ dueDay: 10 })] }))).toBe(false);
  });

  it("follows the due day changed for that one fatura", () => {
    const moved: CardBillDate = { cardId: "k", month: "2026-06", closingDay: 24, dueDay: 14 };
    const digest = digestOf([charge(30_000)], { creditCards: [card()], cardBillDates: [moved] });
    expect(digest.today).toEqual([{ label: "Fatura Nubank", cents: 30_000, date: "2026-06-14" }]);
    expect(digest.tomorrow).toEqual([]);
  });

  it("finds tomorrow's fatura across the end of a month", () => {
    // Today is the last day of June; the July fatura is due on the 1st.
    const first = card({ dueDay: 1 });
    const billedInJuly = charge(42_000, { date: "2026-06-20" });
    const digest = digestOf([billedInJuly], { creditCards: [first], today: "2026-06-30" });
    expect(digest.tomorrow).toEqual([{ label: "Fatura Nubank", cents: 42_000, date: "2026-07-01" }]);
  });

  it("keeps boletos and faturas together, oldest first", () => {
    const digest = digestOf([charge(30_000), boleto(12_000, "2026-06-15")], { creditCards: [card()] });
    expect(digest.tomorrow.map((item) => item.label)).toEqual(["Fatura Nubank", "Internet"]);
  });
});
