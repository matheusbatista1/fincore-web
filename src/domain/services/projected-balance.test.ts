import { describe, expect, it } from "vitest";
import type { Account } from "../entities/account";
import type { CreditCard } from "../entities/credit-card";
import type { ExpenseTransaction, IncomeTransaction, Transaction } from "../entities/transaction";
import { billingCompetence } from "./card-bill.calculator";
import { obligationsDueThrough, projectedMonthEndBalances } from "./projected-balance";

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

  it("does not re-debit a PAID recurring obligation on future projected occurrences", () => {
    // Recurring rent boleto day 10 anchored July, marked paid July 10 from acc-1. Its real paid
    // debit lands ONCE (July); the projected Aug/Sep occurrences are fresh, unpaid instances of a
    // deferred obligation → they must debit no account (a boleto never touches a balance unpaid).
    const rec: ExpenseTransaction = {
      ...cardExpense(-20000, "2026-07-10"),
      source: "boleto",
      cardId: null,
      linkedAccountId: "acc-1",
      recurrence: { dayOfMonth: 10 },
      paidAt: "2026-07-10",
      paidAccountId: "acc-1",
    };
    // July: opening 100000 − 20000 (the real paid debit) = 80000.
    expect(sum(projectedMonthEndBalances([account], [rec], "2026-07", calendar, "2026-07"))).toBe(80000);
    // Aug/Sep: still 80000 — the projected occurrences must NOT re-debit (was −60000/−40000 before).
    expect(sum(projectedMonthEndBalances([account], [rec], "2026-08", calendar, "2026-07"))).toBe(80000);
    expect(sum(projectedMonthEndBalances([account], [rec], "2026-09", calendar, "2026-07"))).toBe(80000);
  });
});

describe("projectedMonthEndBalances — personal lens", () => {
  it("debits only the user's share of a shared expense and drops reimbursement income", () => {
    const sharedExpense: ExpenseTransaction = {
      id: "shared",
      kind: "expense",
      description: "Jantar dividido",
      date: "2026-06-10",
      amountCents: -30000,
      categoryId: null,
      source: "account",
      cardId: null,
      accountId: "acc-1",
      linkedAccountId: null,
      splits: [{ personId: "p1", shareCents: 20000 }],
      myShareCents: 10000,
      installment: null,
      recurrence: null,
      billMonthOverride: null,
    };
    const reimbursement: IncomeTransaction = {
      id: "reimb",
      kind: "income",
      description: "Reembolso",
      date: "2026-06-12",
      amountCents: 5000,
      accountId: "acc-1",
      cardId: null,
      fromPersonId: "p1",
      isReimbursement: true,
      recurrence: null,
    };
    const txs: Transaction[] = [sharedExpense, reimbursement];
    // General: 100000 − 30000 (full) + 5000 (reimbursement counts) = 75000.
    expect(sum(projectedMonthEndBalances([account], txs, "2026-06", calendar, "2026-06"))).toBe(75000);
    // Personal: 100000 − 10000 (my share) + 0 (reimbursement dropped) = 90000.
    expect(sum(projectedMonthEndBalances([account], txs, "2026-06", calendar, "2026-06", "personal"))).toBe(
      90000,
    );
  });
});

describe("obligationsDueThrough", () => {
  const competenceOf = billingCompetence([card]);

  it("personal lens counts only the user's share of a shared card charge", () => {
    // Shared card charge −300 (my share 100), due July.
    const shared: ExpenseTransaction = { ...cardExpense(-30000, "2026-06-10"), myShareCents: 10000 };
    expect(obligationsDueThrough([shared], "2026-07", "2026-07", competenceOf).cents).toBe(30000);
    expect(obligationsDueThrough([shared], "2026-07", "2026-07", competenceOf, "personal").cents).toBe(10000);
  });

  it("nets charges minus credits whose bill is due in the range", () => {
    // Charge 2026-06-10 and credit 2026-06-12 both fall due in JULY (closes 24, due 2).
    const txs: Transaction[] = [cardExpense(-30000, "2026-06-10"), cardCredit(600, "2026-06-12")];
    expect(obligationsDueThrough(txs, "2026-07", "2026-07", competenceOf).cents).toBe(29400);
  });

  it("is zero when no bill is due in the range", () => {
    const txs: Transaction[] = [cardExpense(-30000, "2026-06-10")]; // due July
    expect(obligationsDueThrough(txs, "2026-06", "2026-06", competenceOf).cents).toBe(0);
  });

  it("is zero for an inverted range", () => {
    const txs: Transaction[] = [cardExpense(-30000, "2026-06-10")];
    expect(obligationsDueThrough(txs, "2026-08", "2026-07", competenceOf).cents).toBe(0);
  });

  it("projects recurring card charges into future bills when currentMonth is given", () => {
    // Recurring card charge day 10, anchored June (real → due July); projects July → due Aug.
    const rec: ExpenseTransaction = { ...cardExpense(-10000, "2026-06-10"), recurrence: { dayOfMonth: 10 } };
    // Real only: only the June charge's bill (due July) falls in [June, Aug] = 10000.
    expect(obligationsDueThrough([rec], "2026-06", "2026-08", competenceOf).cents).toBe(10000);
    // With projection: + the July charge (due Aug) = 20000.
    expect(obligationsDueThrough([rec], "2026-06", "2026-08", competenceOf, "general", "2026-06").cents).toBe(
      20000,
    );
  });

  it("projects only the user's share of a shared recurring card charge", () => {
    const rec: ExpenseTransaction = {
      ...cardExpense(-10000, "2026-06-10"),
      myShareCents: 4000,
      recurrence: { dayOfMonth: 10 },
    };
    // Personal, projected: real (4000, due July) + projected (4000, due Aug) = 8000.
    expect(
      obligationsDueThrough([rec], "2026-06", "2026-08", competenceOf, "personal", "2026-06").cents,
    ).toBe(8000);
  });

  it("does not project a non-recurring card charge", () => {
    const txs: Transaction[] = [cardExpense(-30000, "2026-06-10")]; // due July, not recurring
    expect(obligationsDueThrough(txs, "2026-06", "2026-08", competenceOf, "general", "2026-06").cents).toBe(
      30000,
    );
  });

  it("does not double-count a recurring card charge whose projection lands on its real bill", () => {
    // A recurring card charge pinned (billMonthOverride) to July: the real charge AND a
    // projected occurrence of the same rule both resolve to the July bill. The projection
    // must be suppressed so the bill is counted ONCE — the calendar-vs-bill-month dedupe
    // mismatch used to count it twice.
    const rec: ExpenseTransaction = {
      ...cardExpense(-6690, "2026-06-10"),
      recurrence: { dayOfMonth: 10 },
      billMonthOverride: "2026-07",
    };
    // Real charge only (no projection requested) → counted once.
    expect(obligationsDueThrough([rec], "2026-07", "2026-07", competenceOf).cents).toBe(6690);
    // With projection enabled, still once (the July projection is already covered by the real).
    expect(obligationsDueThrough([rec], "2026-06", "2026-07", competenceOf, "general", "2026-06").cents).toBe(
      6690,
    );
  });

  it("counts non-card obligations (boleto, financing) due in the range, ignoring account-source", () => {
    const boleto: ExpenseTransaction = {
      ...cardExpense(-50000, "2026-07-03"),
      source: "boleto",
      cardId: null,
    };
    const financing: ExpenseTransaction = {
      ...cardExpense(-164187, "2026-07-05"),
      source: "financing",
      cardId: null,
    };
    // Account-source expenses already hit the balance, so they must NOT be counted here.
    const acct: ExpenseTransaction = { ...cardExpense(-9999, "2026-07-06"), source: "account", cardId: null };
    // boleto + financing due July (calendar competence); the account expense is excluded.
    expect(obligationsDueThrough([boleto, financing, acct], "2026-07", "2026-07", competenceOf).cents).toBe(
      214187,
    );
  });

  it("excludes a rolled (abated) obligation", () => {
    const rolled: ExpenseTransaction = {
      ...cardExpense(-30000, "2026-07-03"),
      source: "boleto",
      cardId: null,
      rolledAt: "2026-07-04",
    };
    expect(obligationsDueThrough([rolled], "2026-07", "2026-07", competenceOf).cents).toBe(0);
  });

  it("excludes a PAID obligation — it already debited the account on its paid date", () => {
    const paid: ExpenseTransaction = {
      ...cardExpense(-30000, "2026-07-03"),
      source: "boleto",
      cardId: null,
      paidAt: "2026-07-01",
      paidAccountId: "acc-1",
    };
    expect(obligationsDueThrough([paid], "2026-07", "2026-07", competenceOf).cents).toBe(0);
  });

  it("keeps a paid obligation pending until its debit lands (paidAt after the browsed month-end)", () => {
    // Boleto due July, but recorded paid in September (a payment dated later than the month being
    // projected). Browsing July, the debit isn't in the balance yet (paidAt > July-end), so it must
    // still count as a pending obligation — otherwise it vanishes from both terms and overstates.
    const paidLate: ExpenseTransaction = {
      ...cardExpense(-30000, "2026-07-03"),
      source: "boleto",
      cardId: null,
      paidAt: "2026-09-05",
      paidAccountId: "acc-1",
    };
    // Browsing July: still pending (debit lands only in September).
    expect(obligationsDueThrough([paidLate], "2026-07", "2026-07", competenceOf).cents).toBe(30000);
    // Browsing through September: the debit has landed → excluded (no double-subtract).
    expect(obligationsDueThrough([paidLate], "2026-07", "2026-09", competenceOf).cents).toBe(0);
  });

  it("does not double-count a paid obligation between the projected balance and obligations", () => {
    // A R$500 boleto due July, paid early in June. It must be subtracted exactly ONCE.
    const paid: ExpenseTransaction = {
      ...cardExpense(-50000, "2026-07-03"),
      source: "boleto",
      cardId: null,
      paidAt: "2026-06-15",
      paidAccountId: "acc-1",
    };
    // Projected June balance already reflects the payment (100000 − 50000).
    expect(sum(projectedMonthEndBalances([account], [paid], "2026-06", calendar, "2026-06"))).toBe(50000);
    // …so it must NOT also be counted as a still-pending obligation.
    expect(obligationsDueThrough([paid], "2026-06", "2026-07", competenceOf).cents).toBe(0);
  });

  it("excludes overdraft (cheque especial) — it already debits its linked account", () => {
    // Overdraft now debits its account (PR #108), so counting it here too would double-subtract.
    const overdraft: ExpenseTransaction = {
      ...cardExpense(-30000, "2026-07-03"),
      source: "overdraft",
      cardId: null,
      linkedAccountId: "nu",
    };
    expect(obligationsDueThrough([overdraft], "2026-07", "2026-07", competenceOf).cents).toBe(0);
    // Even as a recurring overdraft with projection enabled, it stays out of obligations.
    const rec: ExpenseTransaction = { ...overdraft, recurrence: { dayOfMonth: 3 } };
    expect(obligationsDueThrough([rec], "2026-06", "2026-09", competenceOf, "general", "2026-06").cents).toBe(
      0,
    );
  });
});
