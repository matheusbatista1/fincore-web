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
});
