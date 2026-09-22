import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/domain/entities/account";
import type { CardBillPayment } from "@/domain/entities/card-bill-payment";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { Person } from "@/domain/entities/person";
import type { Settlement } from "@/domain/entities/settlement";
import type { ExpenseTransaction, IncomeTransaction } from "@/domain/entities/transaction";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";

// Freeze "today" so the live-vs-projected split is deterministic.
vi.mock("@/shared/formatting/now", () => ({ todayInBrazil: () => "2026-06-14" }));

const { getDashboard } = await import("./get-dashboard");

const account: Account = {
  id: "acc-1",
  bank: "Nubank",
  name: "Conta",
  type: "PF",
  themeKey: "",
  openingBalanceCents: 100000,
  maskedNumber: "",
};

const card: CreditCard = {
  id: "card-1",
  bank: "C6",
  product: "Carbon",
  flag: "mastercard",
  themeKey: "",
  maskedNumber: "",
  limitCents: 500000,
  closingDay: 24,
  dueDay: 2,
};

let seq = 0;
const expense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: `exp-${seq++}`,
  description: "Despesa",
  date: "2026-05-10",
  kind: "expense",
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
  ...over,
});

const income = (over: Partial<IncomeTransaction> = {}): IncomeTransaction => ({
  id: `inc-${seq++}`,
  description: "Salário",
  date: "2026-06-20",
  kind: "income",
  amountCents: 50000,
  accountId: "acc-1",
  cardId: null,
  fromPersonId: null,
  isReimbursement: false,
  recurrence: null,
  ...over,
});

function stubRepo(
  transactions: (ExpenseTransaction | IncomeTransaction)[],
  cards: CreditCard[] = [],
  people: Person[] = [],
  settlements: Settlement[] = [],
  cardBillPayments: CardBillPayment[] = [],
): FinanceRepository {
  const ws: Workspace = {
    accounts: [account],
    creditCards: cards,
    people,
    categories: [],
    transactions,
    settlements,
    budgets: [],
    goals: [],
    cardBillDates: [],
    cardBillPayments,
  };
  return { loadWorkspace: async () => ws } as unknown as FinanceRepository;
}

describe("getDashboard — projected end-of-month balance", () => {
  it("adds future-dated movements and recurring projections to the live balance", async () => {
    // Live (≤ 2026-06-14): opening 100000 − 20000 (May 10 real) = 80000.
    // EoM (≤ 2026-06-30): + 50000 (June 20 income) = 130000.
    // June projection of the recurring May expense: − 20000 → projected = 110000.
    const repo = stubRepo([expense(), income()]);
    const data = await getDashboard(repo, "u", "2026-06");
    expect(data.totalBalanceCents).toBe(80000);
    expect(data.projectedBalanceCents).toBe(110000);
  });

  it("subtracts an overdue/pending obligation from BEFORE the current month", async () => {
    // A boleto due in May (competence < current June), still unpaid: it never debits a balance and
    // used to fall outside the projection window — silently inflating "fim do mês". Now subtracted.
    const overdue = expense({
      id: "overdue-boleto",
      source: "boleto",
      accountId: null,
      date: "2026-05-10",
      amountCents: -8000,
      recurrence: null,
    });
    const base = await getDashboard(stubRepo([]), "u", "2026-06");
    const withOverdue = await getDashboard(stubRepo([overdue]), "u", "2026-06");
    expect(withOverdue.projectedBalanceCents).toBe(base.projectedBalanceCents - 8000);
  });

  it("does NOT subtract an old card charge with no payment record (fatura presumed paid)", async () => {
    // A pre-current card charge whose fatura has no CardBillPayment must stay presumed-paid — the
    // overdue term is boleto/loan/financing only, never card charges (guards the reviewed regression).
    const oldCardCharge = expense({
      id: "old-card",
      source: "card",
      cardId: "card-1",
      accountId: null,
      date: "2026-04-10", // competence 2026-05 (closes 24 / due 2) — before current June
      amountCents: -12345,
      recurrence: null,
    });
    const base = await getDashboard(stubRepo([], [card]), "u", "2026-06");
    const withOld = await getDashboard(stubRepo([oldCardCharge], [card]), "u", "2026-06");
    expect(withOld.projectedBalanceCents).toBe(base.projectedBalanceCents);
  });

  it("subtracts the card bill due in the month from the projected balance", async () => {
    // The card charge never moves an account balance, but its bill (due June, given
    // closes 24 / due 2) is subtracted from the projected end-of-month balance:
    // 110000 (accounts) − 9999 (fatura) = 100001.
    const repo = stubRepo(
      [
        expense(),
        income(),
        expense({
          source: "card",
          cardId: "card-1",
          accountId: null,
          date: "2026-05-15",
          amountCents: -9999,
          recurrence: null,
        }),
      ],
      [card],
    );
    const data = await getDashboard(repo, "u", "2026-06");
    expect(data.totalBalanceCents).toBe(80000);
    expect(data.projectedBalanceCents).toBe(100001);
  });

  it("for a past month, projected equals the realized month-end balance", async () => {
    // No recurring rules: nothing to project, so projected == realized month-end.
    const repo = stubRepo([
      expense({ recurrence: null, date: "2026-03-10" }),
      income({ date: "2026-03-20" }),
    ]);
    const data = await getDashboard(repo, "u", "2026-03");
    expect(data.projectedBalanceCents).toBe(data.totalBalanceCents);
  });
});

describe("getDashboard — future-month KPIs include projected recurring (today = 2026-06-14)", () => {
  it("folds projected income and expense into a future month's totals", async () => {
    const repo = stubRepo([
      // Recurring salary (June anchor) and recurring expense (May anchor) → both project into July.
      income({ amountCents: 50000, date: "2026-06-20", recurrence: { dayOfMonth: 20 } }),
      expense({
        amountCents: -20000,
        myShareCents: 20000,
        date: "2026-05-10",
        recurrence: { dayOfMonth: 10 },
      }),
    ]);
    const data = await getDashboard(repo, "u", "2026-07");
    expect(data.general.incomeCents).toBe(50000);
    expect(data.general.expenseCents).toBe(20000);
    expect(data.general.netCents).toBe(30000);
  });

  it("keeps the current month real-only (no projection in KPIs)", async () => {
    const repo = stubRepo([
      // Recurring May expense would project into June, but the current month stays real-only.
      expense({
        amountCents: -20000,
        myShareCents: 20000,
        date: "2026-05-10",
        recurrence: { dayOfMonth: 10 },
      }),
      income({ amountCents: 50000, date: "2026-06-20", recurrence: null }),
    ]);
    const data = await getDashboard(repo, "u", "2026-06");
    expect(data.general.incomeCents).toBe(50000);
    expect(data.general.expenseCents).toBe(0);
  });
});

describe("getDashboard — projected end-of-month by lens (today = 2026-06-14)", () => {
  it("general reflects this month's receivables; personal counts only the user's share", async () => {
    const ana: Person = { id: "p1", name: "Ana", relationship: "Amiga", color: "#000000" };
    // Shared account expense in MAY (a past month vs the June projection): −300, my share 100,
    // Ana owes 200. Its receivable belongs to May, not June.
    const shared = expense({
      id: "shared",
      source: "account",
      accountId: "acc-1",
      cardId: null,
      date: "2026-05-10",
      amountCents: -30000,
      myShareCents: 10000,
      splits: [{ personId: "p1", shareCents: 20000 }],
      recurrence: null,
    });
    const data = await getDashboard(stubRepo([shared], [], [ana]), "u", "2026-06");
    // Account holds the full −30000 (real); June's a-receber is 0 (the expense is May).
    expect(data.aReceberCents).toBe(0);
    expect(data.projectedBalanceCents).toBe(70000); // 100000 − 30000
    // Personal debits only my share (10000) → 90000.
    expect(data.projectedBalancePersonalCents).toBe(90000);
  });

  it("a person's pre-payment of a future-bill share is covered (no double-count)", async () => {
    const irmao: Person = { id: "p1", name: "Irmão", relationship: "Família", color: "#000000" };
    // Pastel R$43 on the card, billed in August (override); brother owes R$12, my share R$31.
    const pastel = expense({
      id: "pastel",
      source: "card",
      cardId: "card-1",
      accountId: null,
      date: "2026-06-12",
      billMonthOverride: "2026-08",
      amountCents: -4300,
      myShareCents: 3100,
      splits: [{ personId: "p1", shareCents: 1200 }],
      recurrence: null,
    });
    // Brother pre-paid R$12 in June into the account.
    const setts: Settlement[] = [
      { id: "s", personId: "p1", amountCents: 1200, date: "2026-06-12", accountId: "acc-1" },
    ];
    const data = await getDashboard(stubRepo([pastel], [card], [irmao], setts), "u", "2026-08");
    // August "a receber" is 0 — the June pre-payment covered the brother's August-bill share.
    expect(data.aReceberCents).toBe(0);
    // Projection: opening 100000 + 1200 (settlement cash) − 4300 (bill) + 0 (people) = 96900,
    // i.e. −R$31 net from the pastel — the R$12 is NOT counted twice.
    expect(data.projectedBalanceCents).toBe(96900);
  });

  it("attributes settlement cash to the covered debt's competence month, not the payment month", async () => {
    const ana: Person = { id: "p1", name: "Ana", relationship: "Amiga", color: "#000000" };
    // Ana owes R$200 of a MAY shared expense and pays it back in JUNE. The cash credit belongs to
    // MAY (where the expense counted in the general economia) — June must show no phantom credit.
    const shared = expense({
      id: "shared",
      source: "account",
      accountId: "acc-1",
      cardId: null,
      date: "2026-05-10",
      amountCents: -30000,
      myShareCents: 10000,
      splits: [{ personId: "p1", shareCents: 20000 }],
      recurrence: null,
    });
    const setts: Settlement[] = [
      { id: "s", personId: "p1", amountCents: 20000, date: "2026-06-12", accountId: "acc-1" },
    ];
    // Browsing MAY (horizon May): the June payment is beyond the horizon, so May's credit shows as
    // the still-open receivable — the economia is whole either way, with no double count.
    const may = await getDashboard(stubRepo([shared], [], [ana], setts), "u", "2026-05");
    expect(may.settlementNetCents).toBe(0);
    expect(may.aReceberCents).toBe(20000);
    // Browsing JUNE: the payment cleared MAY's bucket (through-ledger), so June gets neither a
    // receivable nor phantom settlement cash — the old date-month bucketing showed +200 here.
    const june = await getDashboard(stubRepo([shared], [], [ana], setts), "u", "2026-06");
    expect(june.settlementNetCents).toBe(0);
    expect(june.aReceberCents).toBe(0);
  });

  it("credits a PRE-payment in the future fatura's month (no phantom surplus in the cash month)", async () => {
    const ana: Person = { id: "p1", name: "Ana", relationship: "Amiga", color: "#000000" };
    // Ana's R$120 share of a card charge whose fatura is JULY (charge 2026-06-20, closes 06-24 →
    // due 07-02). She pays in JUNE (advance). June economia must NOT gain +120; July gets the credit.
    const charge = expense({
      id: "pastel",
      source: "card",
      cardId: "card-1",
      accountId: null,
      date: "2026-06-20",
      amountCents: -4300,
      myShareCents: 3100,
      splits: [{ personId: "p1", shareCents: 1200 }],
      recurrence: null,
    });
    const setts: Settlement[] = [
      { id: "s", personId: "p1", amountCents: 1200, date: "2026-06-12", accountId: "acc-1" },
    ];
    const june = await getDashboard(stubRepo([charge], [card], [ana], setts), "u", "2026-06");
    expect(june.settlementNetCents).toBe(0);
    expect(june.aReceberCents).toBe(0); // the advance is parked, not phantom June income
    const july = await getDashboard(stubRepo([charge], [card], [ana], setts), "u", "2026-07");
    expect(july.settlementNetCents).toBe(1200);
    expect(july.aReceberCents).toBe(0); // the advance already covered her July share
  });

  it("exposes heldForOthersCents = advances held minus others' shares already fronted", async () => {
    const ana: Person = { id: "p1", name: "Ana", relationship: "Amiga", color: "#000000" };
    // Ana pre-pays R$120 for her share of a JULY fatura the user hasn't paid yet: the cash sits in
    // the account but is hers → held = 120. (General 100000+1200; personal drops the settlement.)
    const charge = expense({
      id: "pastel",
      source: "card",
      cardId: "card-1",
      accountId: null,
      date: "2026-06-25",
      amountCents: -4300,
      myShareCents: 3100,
      splits: [{ personId: "p1", shareCents: 1200 }],
      recurrence: null,
    });
    const setts: Settlement[] = [
      { id: "s", personId: "p1", amountCents: 1200, date: "2026-06-12", accountId: "acc-1" },
    ];
    const data = await getDashboard(stubRepo([charge], [card], [ana], setts), "u", "2026-06");
    expect(data.totalBalanceCents).toBe(101200);
    expect(data.totalBalancePersonalCents).toBe(100000);
    expect(data.heldForOthersCents).toBe(1200);
  });

  it("settlementNetCents ignores other months and account-less (perdão) settlements", async () => {
    const ana: Person = { id: "p1", name: "Ana", relationship: "Amiga", color: "#000000" };
    const shared = expense({
      id: "shared",
      source: "account",
      accountId: "acc-1",
      cardId: null,
      date: "2026-05-10",
      amountCents: -30000,
      myShareCents: 10000,
      splits: [{ personId: "p1", shareCents: 20000 }],
      recurrence: null,
    });
    const setts: Settlement[] = [
      { id: "s1", personId: "p1", amountCents: 20000, date: "2026-05-12", accountId: "acc-1" }, // May
      { id: "s2", personId: "p1", amountCents: 5000, date: "2026-06-12", accountId: null }, // perdão
    ];
    const data = await getDashboard(stubRepo([shared], [], [ana], setts), "u", "2026-06");
    expect(data.settlementNetCents).toBe(0);
  });

  it("future month: a recurring shared expense projects the person's a-receber", async () => {
    const ana: Person = { id: "p1", name: "Ana", relationship: "Amiga", color: "#000000" };
    // Recurring shared expense anchored June (R$300, my share 100, Ana owes 200) → projects into July.
    const shared = expense({
      id: "internet",
      source: "account",
      accountId: "acc-1",
      cardId: null,
      date: "2026-06-10",
      amountCents: -30000,
      myShareCents: 10000,
      splits: [{ personId: "p1", shareCents: 20000 }],
      recurrence: { dayOfMonth: 10 },
    });
    const data = await getDashboard(stubRepo([shared], [], [ana]), "u", "2026-07");
    // The "A receber" stat is the browsed month only → Ana's July share.
    expect(data.aReceberCents).toBe(20000);
    // General fim do mês is consistent with personal: account 100000 − 30000 (June) − 30000
    // (July) = 40000, plus the CUMULATIVE people net Jun+Jul (20000 + 20000) = 80000.
    expect(data.projectedBalanceCents).toBe(80000);
    // Personal counts only my share each month: 100000 − 10000 − 10000 = 80000.
    expect(data.projectedBalancePersonalCents).toBe(80000);
  });
});

describe("getDashboard — saldo pessoal com fatura paga compartilhada", () => {
  it("debits only the user's slice of a paid fatura in the personal total", async () => {
    // A June-competence card charge (dated 2026-05-10, closes 05-24, due 06-02) of R$300 where
    // another person owes R$180 (my share R$120). The whole fatura was paid from acc-1 on 06-10.
    // GENERAL: real cash out = the full R$300. PERSONAL: only the user's slice (R$120) leaves —
    // faturaPersonalDebit reconstructs the share ratio, which REQUIRES competenceOf to be passed.
    // Regression: without it the personal total wrongly debited the full amount (−300).
    const charge = expense({
      id: "shared-card-charge",
      source: "card",
      cardId: "card-1",
      accountId: null,
      date: "2026-05-10",
      amountCents: -30000,
      myShareCents: 12000,
      splits: [{ personId: "p1", shareCents: 18000 }],
      recurrence: null,
    });
    const payment: CardBillPayment = {
      id: "pay-1",
      cardId: "card-1",
      competence: "2026-06",
      amountCents: 30000,
      accountId: "acc-1",
      date: "2026-06-10",
    };
    const data = await getDashboard(stubRepo([charge], [card], [], [], [payment]), "u", "2026-06");
    // General: opening 100000 − 30000 (full fatura) = 70000.
    expect(data.totalBalanceCents).toBe(70000);
    // Personal: opening 100000 − 12000 (only my slice of the paid fatura) = 88000.
    expect(data.totalBalancePersonalCents).toBe(88000);
  });
});
