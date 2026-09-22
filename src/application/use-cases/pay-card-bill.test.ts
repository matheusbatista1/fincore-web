import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/domain/entities/account";
import type { CardBillPayment } from "@/domain/entities/card-bill-payment";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { ExpenseTransaction } from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import type { CardBillPaymentData, FinanceRepository, Workspace } from "../ports/finance-repository";
import { payCardBill } from "./pay-card-bill";

// Caixa-style card: closes 24, due 2 → a charge on the 10th bills the NEXT month (competence July).
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

const account: Account = {
  id: "acc-1",
  bank: "Itaú",
  name: "Conta",
  type: "PF",
  themeKey: "",
  openingBalanceCents: 100000,
  maskedNumber: "",
};

const charge = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: "chg-1",
  description: "Compra",
  date: "2026-06-10" as IsoDate,
  kind: "expense",
  amountCents: -30000,
  categoryId: null,
  source: "card",
  cardId: "card-1",
  accountId: null,
  linkedAccountId: null,
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

function stub(over: Partial<Workspace> = {}): { repo: FinanceRepository; pay: ReturnType<typeof vi.fn> } {
  const ws: Workspace = {
    accounts: [account],
    creditCards: [card],
    people: [],
    categories: [],
    transactions: [charge()],
    settlements: [],
    budgets: [],
    goals: [],
    cardBillDates: [],
    cardBillPayments: [],
    ...over,
  };
  const pay = vi.fn(async (_u: string, _i: CardBillPaymentData) => {});
  const repo = { loadWorkspace: async () => ws, payCardBill: pay } as unknown as FinanceRepository;
  return { repo, pay };
}

describe("payCardBill", () => {
  it("snapshots the computed bill total and records the payment on the paying account", async () => {
    const { repo, pay } = stub();
    const result = await payCardBill(repo, "u", {
      cardId: "card-1",
      competenceMonth: "2026-07",
      paidAccountId: "acc-1",
      paidAt: "2026-07-05" as IsoDate,
    });
    expect(result.ok).toBe(true);
    expect(pay).toHaveBeenCalledWith("u", {
      cardId: "card-1",
      competenceMonth: "2026-07",
      amountCents: 30000, // the July bill total, computed server-side
      accountId: "acc-1",
      paidOn: "2026-07-05",
    });
  });

  it("rejects an unknown card", async () => {
    const { repo, pay } = stub();
    const r = await payCardBill(repo, "u", {
      cardId: "nope",
      competenceMonth: "2026-07",
      paidAccountId: "acc-1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("card_not_found");
    expect(pay).not.toHaveBeenCalled();
  });

  it("rejects an invalid paying account", async () => {
    const { repo } = stub();
    const r = await payCardBill(repo, "u", {
      cardId: "card-1",
      competenceMonth: "2026-07",
      paidAccountId: "gone",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_account");
  });

  it("rejects a bill with nothing to pay", async () => {
    const { repo } = stub({ transactions: [] }); // no charges → July bill is 0
    const r = await payCardBill(repo, "u", {
      cardId: "card-1",
      competenceMonth: "2026-07",
      paidAccountId: "acc-1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("nothing_to_pay");
  });

  it("rejects a fatura already paid", async () => {
    const paid: CardBillPayment = {
      id: "p1",
      cardId: "card-1",
      competence: "2026-07",
      amountCents: 30000,
      accountId: "acc-1",
      date: "2026-07-05" as IsoDate,
    };
    const { repo } = stub({ cardBillPayments: [paid] });
    const r = await payCardBill(repo, "u", {
      cardId: "card-1",
      competenceMonth: "2026-07",
      paidAccountId: "acc-1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("already_paid");
  });
});
