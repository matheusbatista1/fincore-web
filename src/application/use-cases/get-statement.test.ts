import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/domain/entities/account";
import type { CardBillPayment } from "@/domain/entities/card-bill-payment";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { Person } from "@/domain/entities/person";
import type { Settlement } from "@/domain/entities/settlement";
import type {
  ExpenseTransaction,
  IncomeTransaction,
  TransferTransaction,
} from "@/domain/entities/transaction";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";

// Freeze "today" so the executed/future split is deterministic.
vi.mock("@/shared/formatting/now", () => ({
  todayInBrazil: () => "2026-06-14",
  currentMonthInBrazil: () => "2026-06",
}));

const { getStatement } = await import("./get-statement");

const account: Account = {
  id: "acc-1",
  bank: "Nubank",
  name: "Conta",
  type: "PF",
  themeKey: "",
  openingBalanceCents: 0,
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
const ana: Person = { id: "p1", name: "Ana Lima", relationship: "Amiga", color: "#000000" };

let seq = 0;
const exp = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: `e-${seq++}`,
  kind: "expense",
  description: "Despesa",
  date: "2026-06-10",
  amountCents: -10000,
  categoryId: null,
  source: "account",
  cardId: null,
  accountId: "acc-1",
  linkedAccountId: null,
  splits: [],
  myShareCents: 10000,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  ...over,
});
const inc = (over: Partial<IncomeTransaction> = {}): IncomeTransaction => ({
  id: `i-${seq++}`,
  kind: "income",
  description: "Receita",
  date: "2026-06-01",
  amountCents: 50000,
  accountId: "acc-1",
  cardId: null,
  fromPersonId: null,
  isReimbursement: false,
  recurrence: null,
  ...over,
});
const xfer = (over: Partial<TransferTransaction> = {}): TransferTransaction => ({
  id: `t-${seq++}`,
  kind: "transfer",
  description: "Transferência",
  date: "2026-06-05",
  fromAccountId: "acc-1",
  toAccountId: "acc-1",
  valueCents: 20000,
  ...over,
});

function stub(
  transactions: Array<ExpenseTransaction | IncomeTransaction | TransferTransaction>,
  settlements: Settlement[] = [],
  cardBillPayments: CardBillPayment[] = [],
): FinanceRepository {
  const ws: Workspace = {
    accounts: [account],
    creditCards: [card],
    people: [ana],
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

describe("getStatement — executed extrato", () => {
  it("includes real income, account expense and transfer dated on/before today", async () => {
    const { executed } = await getStatement(
      stub([inc({ date: "2026-06-01" }), exp({ date: "2026-06-10" }), xfer({ date: "2026-06-05" })]),
      "u",
    );
    expect(executed.map((r) => r.kind).sort()).toEqual(["expense", "income", "transfer"]);
  });

  it("books a paid obligation on its pay date, at the amount actually paid", async () => {
    const loan = exp({
      id: "loan",
      source: "loan",
      accountId: null,
      amountCents: -50000,
      date: "2026-06-30", // due later…
      paidAt: "2026-06-12", // …but paid earlier
      paidAccountId: "acc-1",
      paidAmountCents: 47000, // discount
    });
    const { executed, future } = await getStatement(stub([loan]), "u");
    expect(executed).toHaveLength(1);
    expect(executed[0]?.date).toBe("2026-06-12");
    expect(executed[0]?.amountCents).toBe(-47000);
    expect(future).toHaveLength(0);
  });

  it("excludes individual card charges and unpaid obligations from the extrato", async () => {
    const cardCharge = exp({
      source: "card",
      cardId: "card-1",
      accountId: null,
      billMonthOverride: "2026-06",
    });
    const unpaidBoleto = exp({ source: "boleto", accountId: null, date: "2026-06-20" });
    const { executed } = await getStatement(stub([cardCharge, unpaidBoleto]), "u");
    expect(executed).toHaveLength(0);
  });

  it("synthesizes a settlement (person paying you) as an executed entrada", async () => {
    // Ana owes you (a shared expense makes her a debtor), then settles R$120 into the account.
    const shared = exp({
      source: "card",
      cardId: "card-1",
      accountId: null,
      amountCents: -30000,
      myShareCents: 10000,
      splits: [{ personId: "p1", shareCents: 20000 }],
      billMonthOverride: "2026-06",
    });
    const setts: Settlement[] = [
      { id: "s1", personId: "p1", amountCents: 12000, date: "2026-06-13", accountId: "acc-1" },
    ];
    const { executed } = await getStatement(stub([shared], setts), "u");
    const acerto = executed.find((r) => r.id === "settle:s1");
    expect(acerto?.kind).toBe("income");
    expect(acerto?.amountCents).toBe(12000);
  });

  it("synthesizes a card-fatura payment as an executed saída", async () => {
    const payments: CardBillPayment[] = [
      {
        id: "fp1",
        cardId: "card-1",
        competence: "2026-05",
        amountCents: 25000,
        accountId: "acc-1",
        date: "2026-06-08",
      },
    ];
    const { executed } = await getStatement(stub([], [], payments), "u");
    const fat = executed.find((r) => r.id === "fatpay:fp1");
    expect(fat?.kind).toBe("expense");
    expect(fat?.amountCents).toBe(-25000);
  });

  it("excludes rolled expenses and card credits (estornos)", async () => {
    const rolled = exp({ date: "2026-06-02", rolledAt: "2026-06-03" });
    const estorno = inc({ date: "2026-06-02", cardId: "card-1", accountId: null });
    const { executed, future } = await getStatement(stub([rolled, estorno]), "u");
    expect(executed).toHaveLength(0);
    expect(future).toHaveLength(0);
  });
});

describe("getStatement — future", () => {
  it("includes future-dated reals, unpaid obligations and future-competence card charges", async () => {
    const futureIncome = inc({ date: "2026-07-01" });
    const unpaidBoleto = exp({ source: "boleto", accountId: null, date: "2026-06-25" });
    const futureCardCharge = exp({
      source: "card",
      cardId: "card-1",
      accountId: null,
      billMonthOverride: "2026-08",
    });
    const { future } = await getStatement(stub([futureIncome, unpaidBoleto, futureCardCharge]), "u");
    expect(future.length).toBe(3);
  });

  it("shows current-competence unpaid card charges as upcoming, but drops a paid fatura's charges", async () => {
    const currentCharge = exp({
      source: "card",
      cardId: "card-1",
      accountId: null,
      billMonthOverride: "2026-06",
    });
    const paidCharge = exp({
      source: "card",
      cardId: "card-1",
      accountId: null,
      billMonthOverride: "2026-07",
    });
    const payments: CardBillPayment[] = [
      {
        id: "fp",
        cardId: "card-1",
        competence: "2026-07",
        amountCents: 5000,
        accountId: "acc-1",
        date: "2026-06-05",
      },
    ];
    const { executed, future } = await getStatement(stub([currentCharge, paidCharge], [], payments), "u");
    expect(future.some((r) => r.id === currentCharge.id)).toBe(true); // current fatura still open → upcoming
    expect(future.some((r) => r.id === paidCharge.id)).toBe(false); // 2026-07 fatura paid → not repeated
    expect(executed.some((r) => r.id === "fatpay:fp")).toBe(true); // the payment itself is executed
  });

  it("orders executed newest-first and future oldest-first", async () => {
    const { executed } = await getStatement(
      stub([inc({ date: "2026-06-01" }), inc({ date: "2026-06-10" })]),
      "u",
    );
    expect(executed[0]?.date).toBe("2026-06-10");
    expect(executed[1]?.date).toBe("2026-06-01");

    const { future } = await getStatement(
      stub([inc({ date: "2026-07-10" }), inc({ date: "2026-07-01" })]),
      "u",
    );
    expect(future[0]?.date).toBe("2026-07-01");
    expect(future[1]?.date).toBe("2026-07-10");
  });
});
