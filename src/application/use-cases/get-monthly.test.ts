import { describe, expect, it } from "vitest";
import type { Person } from "@/domain/entities/person";
import type { Settlement } from "@/domain/entities/settlement";
import type { ExpenseTransaction, IncomeTransaction } from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { getMonthly } from "./get-monthly";

const person = (id: string): Person => ({ id, name: id, relationship: "Amigo", color: "#000000" });

let seq = 0;
const expense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: `exp-${seq++}`,
  description: "Despesa",
  date: "2026-06-10" as IsoDate,
  kind: "expense",
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
  rolledAt: null,
  ...over,
});

const income = (over: Partial<IncomeTransaction> = {}): IncomeTransaction => ({
  id: `inc-${seq++}`,
  description: "Receita",
  date: "2026-06-05" as IsoDate,
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
  people: Person[] = [],
  settlements: Settlement[] = [],
): FinanceRepository {
  const ws: Workspace = {
    accounts: [],
    creditCards: [],
    people,
    categories: [],
    transactions,
    settlements,
    budgets: [],
    goals: [],
    cardBillDates: [],
    cardBillPayments: [],
  };
  return { loadWorkspace: async () => ws } as unknown as FinanceRepository;
}

describe("getMonthly", () => {
  it("excludes a rolled (abated) expense from totals and items", async () => {
    const repo = stubRepo([
      expense({ id: "real", amountCents: -10000 }),
      // Abated debt kept only for history — must not appear or count.
      expense({ id: "rolled", amountCents: -5000, rolledAt: "2026-06-20" as IsoDate }),
      income({ id: "wage", amountCents: 50000 }),
    ]);
    const data = await getMonthly(repo, "u", "2026-06");

    expect(data.realized.expenseCents).toBe(10000); // the rolled 50,00 is excluded
    expect(data.realized.incomeCents).toBe(50000);
    // Newest-first (byDateDesc): real (06-10) before wage (06-05); the rolled row is gone.
    expect(data.items.map((i) => i.id)).toEqual(["real", "wage"]);
    expect(data.items.some((i) => i.id === "rolled")).toBe(false);
  });

  it("shows a settlement (person paid you) as an ENTRADA in the month it was paid", async () => {
    const repo = stubRepo(
      // p owes you R$100 (their full share) — gross positive → settlement is an inflow.
      [
        expense({
          id: "racha",
          amountCents: -10000,
          myShareCents: 0,
          splits: [{ personId: "p", shareCents: 10000 }],
        }),
      ],
      [person("p")],
      [{ id: "s1", personId: "p", amountCents: 10000, date: "2026-06-12" as IsoDate, accountId: "acc-1" }],
    );
    const data = await getMonthly(repo, "u", "2026-06");
    const settle = data.items.find((i) => i.id === "settle:s1");
    expect(settle?.kind).toBe("income");
    expect(settle?.amountCents).toBe(10000);
    expect(settle?.settlement).toBe(true); // flagged so the personal lens can drop it
    // Racha: full expense −100 as a saída, the payment +100 as an entrada → net 0.
    expect(data.realized.incomeCents).toBe(10000);
    expect(data.realized.expenseCents).toBe(10000);
    expect(data.realized.netCents).toBe(0);
  });

  it("shows a settlement (you paid them) as a SAÍDA", async () => {
    const repo = stubRepo(
      // p's May income (you owe them) drives the gross balance negative; not in June's items.
      [income({ id: "may", amountCents: 5000, fromPersonId: "p", date: "2026-05-05" as IsoDate })],
      [person("p")],
      [{ id: "s1", personId: "p", amountCents: 5000, date: "2026-06-12" as IsoDate, accountId: "acc-1" }],
    );
    const data = await getMonthly(repo, "u", "2026-06");
    const settle = data.items.find((i) => i.id === "settle:s1");
    expect(settle?.kind).toBe("expense");
    expect(settle?.amountCents).toBe(-5000);
    expect(data.realized.expenseCents).toBe(5000);
    expect(data.realized.incomeCents).toBe(0);
  });

  it("ignores a 'sem conta' (perdão) settlement — no cash moved", async () => {
    const repo = stubRepo(
      [
        expense({
          id: "racha",
          amountCents: -10000,
          myShareCents: 0,
          splits: [{ personId: "p", shareCents: 10000 }],
        }),
      ],
      [person("p")],
      [{ id: "s1", personId: "p", amountCents: 10000, date: "2026-06-12" as IsoDate, accountId: null }],
    );
    const data = await getMonthly(repo, "u", "2026-06");
    expect(data.items.some((i) => i.id === "settle:s1")).toBe(false);
    expect(data.realized.incomeCents).toBe(0);
  });

  it("a pre-payment shows the entrada in the payment month, not the bill month", async () => {
    // Pastel R$43 on card, billed August; brother owes R$12 (myShare 3100). He pre-pays in June.
    const pastel = expense({
      id: "pastel",
      source: "card",
      cardId: "card-1",
      accountId: null,
      date: "2026-06-12" as IsoDate,
      billMonthOverride: "2026-08",
      amountCents: -4300,
      myShareCents: 3100,
      splits: [{ personId: "p", shareCents: 1200 }],
    });
    const repo = stubRepo(
      [pastel],
      [person("p")],
      [{ id: "s1", personId: "p", amountCents: 1200, date: "2026-06-12" as IsoDate, accountId: "acc-1" }],
    );
    // June: the payment shows as an entrada (the pastel bills in August, so it's not here).
    const june = await getMonthly(repo, "u", "2026-06");
    expect(june.items.find((i) => i.id === "settle:s1")?.kind).toBe("income");
    expect(june.realized.incomeCents).toBe(1200);
    // August: the pastel bill is a saída; the settlement is NOT re-counted here.
    const aug = await getMonthly(repo, "u", "2026-08");
    expect(aug.items.some((i) => i.id === "settle:s1")).toBe(false);
    expect(aug.realized.expenseCents).toBe(4300);
  });

  it("surfaces a paid obligation's out-flow in the month it was paid, on the paying account", async () => {
    const repo = stubRepo([
      expense({
        id: "boleto",
        source: "boleto",
        accountId: null,
        amountCents: -30000,
        myShareCents: 30000,
        paidAt: "2026-06-15" as IsoDate,
        paidAccountId: "acc-1",
        paidAmountCents: 30000,
      }),
    ]);
    const data = await getMonthly(repo, "u", "2026-06");
    expect(data.paidObligationFlows).toMatchObject([{ accountId: "acc-1", outCents: 30000 }]);
  });

  it("buckets the paid out-flow by the paid month, not the due month", async () => {
    // Boleto due June 28 but paid July 2 → the cash moved in July.
    const repo = stubRepo([
      expense({
        id: "boleto",
        source: "boleto",
        accountId: null,
        date: "2026-06-28" as IsoDate,
        amountCents: -30000,
        myShareCents: 30000,
        paidAt: "2026-07-02" as IsoDate,
        paidAccountId: "acc-1",
        paidAmountCents: 30000,
      }),
    ]);
    // June: the row is a due-month expense, but no cash moved in June → no flow.
    expect((await getMonthly(repo, "u", "2026-06")).paidObligationFlows).toEqual([]);
    // July: the payment landed → out-flow on acc-1.
    expect((await getMonthly(repo, "u", "2026-07")).paidObligationFlows).toMatchObject([
      { accountId: "acc-1", outCents: 30000 },
    ]);
  });

  it("ignores an unpaid obligation (no cash moved yet)", async () => {
    const repo = stubRepo([
      expense({ id: "boleto", source: "boleto", accountId: null, amountCents: -30000, myShareCents: 30000 }),
    ]);
    expect((await getMonthly(repo, "u", "2026-06")).paidObligationFlows).toEqual([]);
  });

  it("a projected occurrence of a PAID recurring obligation reads unpaid, at the rule's face amount", async () => {
    // Aluguel: recurring boleto anchored (and paid, with a discount) in June. July's projected
    // occurrence is a fresh instance — inheriting the anchor's paid state would badge it "pago"
    // and total it at the discounted amount, and let Pagar/Desfazer settle June from July.
    const repo = stubRepo([
      expense({
        id: "aluguel",
        description: "Aluguel",
        source: "boleto",
        accountId: null,
        date: "2026-06-03" as IsoDate,
        amountCents: -46967,
        myShareCents: 46967,
        recurrence: { dayOfMonth: 3 },
        paidAt: "2026-06-01" as IsoDate,
        paidAccountId: "acc-1",
        paidAmountCents: 40000, // paid with a discount
      }),
    ]);
    const july = await getMonthly(repo, "u", "2026-07");
    const proj = july.items.find((i) => i.projected);

    expect(proj).toBeDefined();
    expect(proj?.date).toBe("2026-07-03");
    expect(proj?.isPaid).toBe(false);
    expect(proj?.paidAt).toBeNull();
    expect(proj?.paidAmountCents).toBeNull();
    // Totals at face (469,67), NOT at June's settled 400,00.
    expect(july.projectedTotals.expenseCents).toBe(46967);
    // The rule is still reachable for editing/stopping via the anchor.
    expect(proj?.anchor?.id).toBe("aluguel");
  });
});

describe("usualPayAccountId — which wallet a monthly bill comes out of", () => {
  it("carries the account that settled the rule's last occurrence", async () => {
    // "Energia" is paid from Itaú every month. When August's occurrence comes due, the Pagar modal
    // must offer Itaú — defaulting to the first account silently moved the bill to another wallet.
    const july = expense({
      id: "energia-jul",
      description: "Energia",
      source: "boleto",
      accountId: null,
      date: "2026-07-03" as IsoDate,
      amountCents: -18672,
      myShareCents: 18672,
      recurrence: { dayOfMonth: 3 },
      paidAt: "2026-07-01" as IsoDate,
      paidAccountId: "itau",
      paidAmountCents: 18672,
    });
    const august = expense({
      id: "energia-ago",
      description: "Energia",
      source: "boleto",
      accountId: null,
      date: "2026-08-03" as IsoDate,
      amountCents: -18672,
      myShareCents: 18672,
    });
    const data = await getMonthly(stubRepo([july, august]), "u", "2026-08");
    const row = data.items.find((i) => i.id === "energia-ago");

    expect(row?.isPaid).toBe(false);
    expect(row?.usualPayAccountId).toBe("itau");
  });

  it("is null for a rule that has never been paid", async () => {
    const first = expense({
      id: "novo",
      description: "Boleto novo",
      source: "boleto",
      accountId: null,
      date: "2026-06-10" as IsoDate,
      myShareCents: 10000,
    });
    const data = await getMonthly(stubRepo([first]), "u", "2026-06");
    expect(data.items.find((i) => i.id === "novo")?.usualPayAccountId).toBeNull();
  });
});
