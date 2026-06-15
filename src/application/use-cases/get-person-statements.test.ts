import { describe, expect, it } from "vitest";
import type { Person } from "@/domain/entities/person";
import type { Settlement } from "@/domain/entities/settlement";
import type { ExpenseTransaction, IncomeTransaction } from "@/domain/entities/transaction";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { getPersonStatements } from "./get-person-statements";

const person = (id: string): Person => ({ id, name: id, relationship: "Amigo", color: "#000000" });

let seq = 0;
const expense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: `exp-${seq++}`,
  description: "Despesa",
  date: "2026-06-10",
  kind: "expense",
  amountCents: -10000,
  categoryId: null,
  source: "account",
  cardId: null,
  accountId: "acc-1",
  linkedAccountId: null,
  splits: [],
  myShareCents: 0,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  ...over,
});

const income = (over: Partial<IncomeTransaction> = {}): IncomeTransaction => ({
  id: `inc-${seq++}`,
  description: "Pagamento",
  date: "2026-06-05",
  kind: "income",
  amountCents: 10000,
  accountId: "acc-1",
  cardId: null,
  fromPersonId: null,
  isReimbursement: false,
  recurrence: null,
  ...over,
});

const settlement = (over: Partial<Settlement> & { personId: string }): Settlement => ({
  id: `s-${seq++}`,
  amountCents: 10000,
  date: "2026-06-12",
  accountId: null,
  ...over,
});

function workspace(
  people: Person[],
  transactions: (ExpenseTransaction | IncomeTransaction)[],
  settlements: Settlement[],
): Workspace {
  return {
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
}

function stubRepo(
  people: Person[],
  transactions: (ExpenseTransaction | IncomeTransaction)[],
  settlements: Settlement[] = [],
): FinanceRepository {
  return {
    loadWorkspace: async () => workspace(people, transactions, settlements),
  } as unknown as FinanceRepository;
}

const range = { from: "2026-05", to: "2026-06" } as const;

describe("getPersonStatements", () => {
  it("reconciles opening + debits - credits == closing", async () => {
    const repo = stubRepo(
      [person("p")],
      [
        // April charge (before the window) -> opening; June charge + June payment in window.
        expense({ date: "2026-04-10", splits: [{ personId: "p", shareCents: 8000 }] }),
        expense({ date: "2026-06-05", splits: [{ personId: "p", shareCents: 4000 }] }),
        income({ date: "2026-05-20", amountCents: 3000, fromPersonId: "p" }),
      ],
    );
    const [st] = await getPersonStatements(repo, "u", range);
    expect(st).toBeDefined();
    if (!st) return;
    expect(st.openingCents).toBe(8000); // April charge carried in
    expect(st.openingCents + st.debitTotalCents - st.creditTotalCents).toBe(st.closingCents);
    expect(st.closingCents).toBe(9000); // 8000 + 4000 - 3000
    // Last entry's running balance lands on the closing.
    expect(st.entries.at(-1)?.balanceCents).toBe(9000);
  });

  it("classifies a shared expense as debit and a payment as credit", async () => {
    const repo = stubRepo(
      [person("p")],
      [
        expense({ date: "2026-06-05", splits: [{ personId: "p", shareCents: 8000 }] }),
        income({ date: "2026-06-20", amountCents: 3000, fromPersonId: "p" }),
      ],
    );
    const [st] = await getPersonStatements(repo, "u", range);
    expect(st?.debitTotalCents).toBe(8000);
    expect(st?.creditTotalCents).toBe(3000);
    expect(st?.entries.find((e) => e.amountCents === 8000)?.kind).toBe("debit");
    expect(st?.entries.find((e) => e.amountCents === 3000)?.kind).toBe("credit");
  });

  it("settling a negative (you-owe-them) balance reconciles and nets the running balance to zero", async () => {
    // They overpay you 12000 (you now owe them) -> you settle 12000 back.
    const repo = stubRepo(
      [person("p")],
      [income({ date: "2026-05-10", amountCents: 12000, fromPersonId: "p" })],
      [settlement({ personId: "p", date: "2026-06-10", amountCents: 12000 })],
    );
    const [st] = await getPersonStatements(repo, "u", range);
    expect(st).toBeDefined();
    if (!st) return;
    expect(st.closingCents).toBe(0);
    expect(st.openingCents + st.debitTotalCents - st.creditTotalCents).toBe(0);
    // Two real movements, both magnitude 12000; the running balance ends at zero.
    expect(st.entries).toHaveLength(2);
    expect(st.entries.at(-1)?.balanceCents).toBe(0);
  });

  it("drops a no-op settlement (applied against a zero balance) from the entries", async () => {
    const repo = stubRepo(
      [person("p")],
      [],
      [settlement({ personId: "p", date: "2026-06-10", amountCents: 5000 })],
    );
    const [st] = await getPersonStatements(repo, "u", range);
    expect(st?.entries).toHaveLength(0); // no phantom "R$ 0,00" row
    expect(st?.closingCents).toBe(0);
  });

  it("labels a settlement origin as 'Acerto' when it has no account", async () => {
    const repo = stubRepo(
      [person("p")],
      [expense({ date: "2026-06-01", splits: [{ personId: "p", shareCents: 5000 }] })],
      [settlement({ personId: "p", date: "2026-06-15", amountCents: 2000 })],
    );
    const [st] = await getPersonStatements(repo, "u", range);
    const settleEntry = st?.entries.find((e) => e.amountCents === 2000);
    expect(settleEntry?.origin).toBe("Acerto");
    expect(settleEntry?.kind).toBe("credit"); // reduces a positive balance
  });

  it("returns a statement for every person, with zeros when there is no activity", async () => {
    const repo = stubRepo([person("p"), person("q")], []);
    const statements = await getPersonStatements(repo, "u", range);
    expect(statements).toHaveLength(2);
    for (const st of statements) {
      expect(st.openingCents).toBe(0);
      expect(st.closingCents).toBe(0);
      expect(st.entries).toHaveLength(0);
    }
  });
});
