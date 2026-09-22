import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/domain/entities/account";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { ExpenseTransaction } from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import type { FinanceRepository, UserProfile, Workspace } from "../ports/finance-repository";
import { reconcileAutoPayments } from "./reconcile-auto-payments";

const account: Account = {
  id: "acc-1",
  bank: "Itaú",
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
  flag: "visa",
  themeKey: "",
  maskedNumber: "",
  limitCents: 500000,
  closingDay: 24,
  dueDay: 2,
};

// Dates safely in the past / future relative to any real wall clock the test runs under.
const PAST = "2020-01-10" as IsoDate;
const FUTURE = "2099-01-10" as IsoDate;

const obligation = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: "o1",
  description: "Boleto",
  date: PAST,
  kind: "expense",
  amountCents: -30000,
  categoryId: null,
  source: "boleto",
  cardId: null,
  accountId: null,
  linkedAccountId: "acc-1",
  splits: [],
  myShareCents: 30000,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  rolledAt: null,
  paidAt: null,
  paidAccountId: null,
  paidAmountCents: null,
  ...over,
});

const cardCharge = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  ...obligation({ source: "card", cardId: "card-1", linkedAccountId: null, amountCents: -20000 }),
  id: "c1",
  ...over,
});

const profile = (over: Partial<UserProfile> = {}): UserProfile => ({
  displayName: null,
  email: "u@x.com",
  avatarUrl: null,
  enabledModules: [],
  onboardedAt: null,
  autoPaymentsEnabled: true,
  defaultPayAccountId: "acc-1",
  // Enabled long ago, so the PAST fixtures fall within [since, today] and FUTURE ones don't.
  autoPaymentsSince: "2019-01-01",
  recurringMaterializedThrough: null,
  ...over,
});

function stub(prof: UserProfile, wsOver: Partial<Workspace> = {}) {
  const ws: Workspace = {
    accounts: [account],
    creditCards: [card],
    people: [],
    categories: [],
    transactions: [],
    settlements: [],
    budgets: [],
    goals: [],
    cardBillDates: [],
    cardBillPayments: [],
    ...wsOver,
  };
  const payTransaction = vi.fn(async () => {});
  const payCardBill = vi.fn(async () => {});
  const repo = {
    getProfile: async () => prof,
    loadWorkspace: async () => ws,
    payTransaction,
    payCardBill,
  } as unknown as FinanceRepository;
  return { repo, payTransaction, payCardBill };
}

describe("reconcileAutoPayments", () => {
  it("does nothing when auto-payments is off", async () => {
    const { repo, payTransaction, payCardBill } = stub(profile({ autoPaymentsEnabled: false }), {
      transactions: [obligation()],
    });
    const r = await reconcileAutoPayments(repo, "u");
    expect(r).toEqual({ paidObligations: 0, paidFaturas: 0 });
    expect(payTransaction).not.toHaveBeenCalled();
    expect(payCardBill).not.toHaveBeenCalled();
  });

  it("does nothing when there is no default account (or it was deleted)", async () => {
    const noneSet = stub(profile({ defaultPayAccountId: null }), { transactions: [obligation()] });
    expect(await reconcileAutoPayments(noneSet.repo, "u")).toEqual({ paidObligations: 0, paidFaturas: 0 });
    expect(noneSet.payTransaction).not.toHaveBeenCalled();

    const deleted = stub(profile({ defaultPayAccountId: "gone" }), { transactions: [obligation()] });
    expect(await reconcileAutoPayments(deleted.repo, "u")).toEqual({ paidObligations: 0, paidFaturas: 0 });
    expect(deleted.payTransaction).not.toHaveBeenCalled();
  });

  it("books a due obligation on its due date, skipping future/paid/rolled ones", async () => {
    const { repo, payTransaction } = stub(profile(), {
      transactions: [
        obligation({ id: "due", date: PAST, amountCents: -30000 }),
        obligation({ id: "future", date: FUTURE }),
        obligation({ id: "paid", paidAt: PAST, paidAccountId: "acc-1", paidAmountCents: 30000 }),
        obligation({ id: "rolled", rolledAt: PAST }),
      ],
    });
    const r = await reconcileAutoPayments(repo, "u");
    expect(r.paidObligations).toBe(1);
    expect(payTransaction).toHaveBeenCalledTimes(1);
    expect(payTransaction).toHaveBeenCalledWith("u", "due", {
      paidAt: PAST,
      paidAccountId: "acc-1",
      paidAmountCents: 30000,
    });
  });

  it("books a due fatura from the default account, skipping already-paid competences", async () => {
    const { repo, payCardBill } = stub(profile(), { transactions: [cardCharge({ date: PAST })] });
    const r = await reconcileAutoPayments(repo, "u");
    expect(r.paidFaturas).toBe(1);
    expect(payCardBill).toHaveBeenCalledTimes(1);
    expect(payCardBill).toHaveBeenCalledWith(
      "u",
      expect.objectContaining({ cardId: "card-1", amountCents: 20000, accountId: "acc-1" }),
    );
  });

  it("does not book a fatura whose due date has not arrived", async () => {
    const { repo, payCardBill } = stub(profile(), { transactions: [cardCharge({ date: FUTURE })] });
    const r = await reconcileAutoPayments(repo, "u");
    expect(r.paidFaturas).toBe(0);
    expect(payCardBill).not.toHaveBeenCalled();
  });

  it("does not retroactively book items due before auto-pay was enabled (the 'since' floor)", async () => {
    // Enabled only from FUTURE — so the PAST-due obligation and fatura are before the floor.
    const { repo, payTransaction, payCardBill } = stub(profile({ autoPaymentsSince: FUTURE }), {
      transactions: [obligation({ date: PAST }), cardCharge({ id: "c9", date: PAST })],
    });
    const r = await reconcileAutoPayments(repo, "u");
    expect(r).toEqual({ paidObligations: 0, paidFaturas: 0 });
    expect(payTransaction).not.toHaveBeenCalled();
    expect(payCardBill).not.toHaveBeenCalled();
  });
});
