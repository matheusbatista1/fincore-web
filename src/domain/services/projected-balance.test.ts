import { describe, expect, it } from "vitest";
import type { Account } from "../entities/account";
import type { CreditCard } from "../entities/credit-card";
import type { ExpenseTransaction, IncomeTransaction, Transaction } from "../entities/transaction";
import { billingCompetence } from "./card-bill.calculator";
import { cardBillsDueThrough, projectedMonthEndBalances } from "./projected-balance";

const account: Account = {
  id: "acc-1",
  bank: "Nu",
  name: "Conta",
  type: "PF",
  themeKey: "",
  openingBalanceCents: 100000,
  maskedNumber: "",
};

// Caixa-style card: closes 24, due 2 → a charge on the 10th is due the NEXT month.
const card: CreditCard = {
  id: "card-1",
  bank: "C6",
  product: "Carbon",
  flag: "visa",
  themeKey: "",
  maskedNumber: "",
  limitCents: 500000,
  closingDay: 24,
  dueDay: 2,
};

let seq = 0;
/** Recurring account expense (day 10), anchored 2026-05-10, −R$200. */
const recurringAcctExpense = (): ExpenseTransaction => ({
  id: `e${seq++}`,
  kind: "expense",
  description: "Aluguel",
  date: "2026-05-10",
  amountCents: -20000,
  categoryId: null,
  source: "account",
  cardId: null,
  accountId: "acc-1",
  linkedAccountId: null,
  splits: [],
  myShareCents: 20000,
  installment: null,
  recurrence: { dayOfMonth: 10 },
  billMonthOverride: null,
});

const cardExpense = (cents: number, date: string): ExpenseTransaction => ({
  id: `e${seq++}`,
  kind: "expense",
  description: "Compra",
  date,
  amountCents: cents,
  categoryId: null,
  source: "card",
  cardId: "card-1",
  accountId: null,
  linkedAccountId: null,
  splits: [],
  myShareCents: Math.abs(cents),
  installment: null,
  recurrence: null,
  billMonthOverride: null,
});

const cardCredit = (cents: number, date: string): IncomeTransaction => ({
  id: `i${seq++}`,
  kind: "income",
  description: "Estorno",
  date,
  amountCents: cents,
  accountId: null,
  cardId: "card-1",
  fromPersonId: null,
  isReimbursement: false,
  recurrence: null,
});

const calendar = billingCompetence([]);
const sum = (m: Map<string, { cents: number }>) => [...m.values()].reduce((s, v) => s + v.cents, 0);

describe("projectedMonthEndBalances", () => {
  it("current month: real movements to EOM + this month's projected recurring", () => {
    // opening 100000 − 20000 (May real) = 80000; June projection of the recurring −20000 → 60000.
    const txs: Transaction[] = [recurringAcctExpense()];
    const out = projectedMonthEndBalances([account], txs, "2026-06", calendar, "2026-06");
    expect(sum(out)).toBe(60000);
  });

  it("future month: accumulates projected recurring of every month in between", () => {
    // EOM Aug real = 80000; June+July+Aug projections (−20000 each) → 80000 − 60000 = 20000.
    const txs: Transaction[] = [recurringAcctExpense()];
    const out = projectedMonthEndBalances([account], txs, "2026-08", calendar, "2026-06");
    expect(sum(out)).toBe(20000);
  });

  it("past month: just the historical real balance (no projection)", () => {
    // April EOM: the May expense is after April → opening 100000 only.
    const txs: Transaction[] = [recurringAcctExpense()];
    const out = projectedMonthEndBalances([account], txs, "2026-04", calendar, "2026-06");
    expect(sum(out)).toBe(100000);
  });
});

describe("cardBillsDueThrough", () => {
  const competenceOf = billingCompetence([card]);

  it("nets charges minus credits whose bill is due in the range", () => {
    // Charge 2026-06-10 and credit 2026-06-12 both fall due in JULY (closes 24, due 2).
    const txs: Transaction[] = [cardExpense(-30000, "2026-06-10"), cardCredit(600, "2026-06-12")];
    expect(cardBillsDueThrough(txs, "2026-07", "2026-07", competenceOf).cents).toBe(29400);
  });

  it("is zero when no bill is due in the range", () => {
    const txs: Transaction[] = [cardExpense(-30000, "2026-06-10")]; // due July
    expect(cardBillsDueThrough(txs, "2026-06", "2026-06", competenceOf).cents).toBe(0);
  });

  it("is zero for an inverted range", () => {
    const txs: Transaction[] = [cardExpense(-30000, "2026-06-10")];
    expect(cardBillsDueThrough(txs, "2026-08", "2026-07", competenceOf).cents).toBe(0);
  });
});
