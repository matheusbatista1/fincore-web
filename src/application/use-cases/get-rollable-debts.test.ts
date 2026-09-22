import { describe, expect, it } from "vitest";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { Person } from "@/domain/entities/person";
import type { ExpenseTransaction } from "@/domain/entities/transaction";
import type { CompetenceMonth, IsoDate } from "@/domain/value-objects/competence-month";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { getRollableDebts } from "./get-rollable-debts";

const person = (id: string): Person => ({ id, name: id, relationship: "Amigo", color: "#000000" });

let seq = 0;
const expense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: `exp-${seq++}`,
  description: "Empréstimo",
  date: "2026-06-10" as IsoDate,
  kind: "expense",
  amountCents: -34765,
  categoryId: null,
  source: "loan",
  cardId: null,
  accountId: null,
  linkedAccountId: "acc-1",
  splits: [],
  myShareCents: 0,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  rolledAt: null,
  ...over,
});

const card = (over: Partial<CreditCard> = {}): CreditCard => ({
  id: "card-1",
  bank: "Nubank",
  product: "Platinum",
  flag: "visa",
  themeKey: "nubank",
  maskedNumber: "0000",
  limitCents: 1_000_000,
  closingDay: 5,
  dueDay: 12,
  ...over,
});

const parcela = (number: number, total: number) =>
  ({ groupId: "grp-1", number, total, status: "atual" }) as const;

function stubRepo(
  people: Person[],
  transactions: ExpenseTransaction[],
  cards: CreditCard[] = [],
): FinanceRepository {
  const ws: Workspace = {
    accounts: [],
    creditCards: cards,
    people,
    categories: [],
    transactions,
    settlements: [],
    budgets: [],
    goals: [],
    cardBillDates: [],
    cardBillPayments: [],
  };
  return { loadWorkspace: async () => ws } as unknown as FinanceRepository;
}

const JUNE = "2026-06" as CompetenceMonth;
const JULY = "2026-07" as CompetenceMonth;

describe("getRollableDebts", () => {
  it("lists only the browsed month's debt — a future installment parcela is excluded", async () => {
    const repo = stubRepo(
      [person("p")],
      [
        // The loan owed by p, parcela 4/12 (June) and 5/12 (July) — separate rows, same split.
        expense({
          date: "2026-06-18" as IsoDate,
          installment: parcela(4, 12),
          splits: [{ personId: "p", shareCents: 34765 }],
        }),
        expense({
          date: "2026-07-18" as IsoDate,
          installment: parcela(5, 12),
          splits: [{ personId: "p", shareCents: 34765 }],
        }),
      ],
    );
    const debts = await getRollableDebts(repo, "u", JUNE);
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({
      personId: "p",
      shareCents: 34765,
      parcela: { number: 4, total: 12 },
    });
  });

  it("excludes a rolled (abated) debt", async () => {
    const repo = stubRepo(
      [person("p")],
      [
        expense({ splits: [{ personId: "p", shareCents: 34765 }], rolledAt: "2026-06-24" as IsoDate }),
        expense({ splits: [{ personId: "p", shareCents: 20000 }] }),
      ],
    );
    const debts = await getRollableDebts(repo, "u", JUNE);
    expect(debts).toHaveLength(1);
    expect(debts[0]?.shareCents).toBe(20000);
  });

  it("ignores non-shared expenses and non-positive shares", async () => {
    const repo = stubRepo(
      [person("p")],
      [
        expense({ splits: [] }), // my own expense, no one owes me
        expense({ splits: [{ personId: "p", shareCents: 0 }] }), // zero share
      ],
    );
    expect(await getRollableDebts(repo, "u", JUNE)).toHaveLength(0);
  });

  it("emits one rollable debt per person sharing the expense", async () => {
    const repo = stubRepo(
      [person("a"), person("b")],
      [
        expense({
          splits: [
            { personId: "a", shareCents: 5000 },
            { personId: "b", shareCents: 3000 },
          ],
        }),
      ],
    );
    const debts = await getRollableDebts(repo, "u", JUNE);
    expect(debts.map((d) => [d.personId, d.shareCents])).toEqual([
      ["a", 5000],
      ["b", 3000],
    ]);
  });

  it("buckets a card charge by its bill competence, not the calendar month", async () => {
    // A June card charge whose bill falls in July (manual move) is rollable in July, not June.
    const repo = stubRepo(
      [person("p")],
      [
        expense({
          source: "card",
          cardId: "card-1",
          accountId: null,
          linkedAccountId: null,
          date: "2026-06-28" as IsoDate,
          billMonthOverride: "2026-07",
          splits: [{ personId: "p", shareCents: 9000 }],
        }),
      ],
      [card()],
    );
    expect(await getRollableDebts(repo, "u", JUNE)).toHaveLength(0);
    expect(await getRollableDebts(repo, "u", JULY)).toHaveLength(1);
  });
});
