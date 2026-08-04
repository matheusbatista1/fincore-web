import { describe, expect, it, vi } from "vitest";
import type { ExpenseTransaction, IncomeTransaction, Transaction } from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import { todayInBrazil } from "@/shared/formatting/now";
import type {
  CreateTransactionCommand,
  FinanceRepository,
  UserProfile,
  Workspace,
} from "../ports/finance-repository";
import { materializeRecurring } from "./materialize-recurring";

const today = todayInBrazil();
const monthStart = `${today.slice(0, 7)}-01` as IsoDate;
/** A date inside the current month that has already passed (the 1st, always ≤ today). */
const dueDay = Number(monthStart.slice(8, 10));

const profile = (over: Partial<UserProfile> = {}): UserProfile => ({
  displayName: null,
  email: "u@x.com",
  avatarUrl: null,
  enabledModules: [],
  onboardedAt: null,
  autoPaymentsEnabled: false,
  defaultPayAccountId: null,
  autoPaymentsSince: null,
  recurringMaterializedThrough: null,
  ...over,
});

const rent = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: "aluguel",
  description: "Aluguel",
  date: "2026-01-01" as IsoDate,
  kind: "expense",
  amountCents: -46967,
  categoryId: null,
  source: "boleto",
  cardId: null,
  accountId: null,
  linkedAccountId: "acc-1",
  splits: [],
  myShareCents: 46967,
  installment: null,
  recurrence: { dayOfMonth: dueDay },
  billMonthOverride: null,
  rolledAt: null,
  paidAt: null,
  paidAccountId: null,
  paidAmountCents: null,
  ...over,
});

const salary = (over: Partial<IncomeTransaction> = {}): IncomeTransaction => ({
  id: "salario",
  description: "Salário",
  date: "2026-01-01" as IsoDate,
  kind: "income",
  amountCents: 675100,
  accountId: "acc-1",
  cardId: null,
  fromPersonId: null,
  isReimbursement: false,
  recurrence: { dayOfMonth: dueDay },
  receivedAt: "2026-01-01" as IsoDate,
  receivedAccountId: "acc-1",
  receivedAmountCents: 675100,
  ...over,
});

function stub(transactions: Transaction[], prof: UserProfile = profile()) {
  const ws: Workspace = {
    accounts: [],
    creditCards: [],
    people: [],
    categories: [],
    transactions,
    settlements: [],
    budgets: [],
    goals: [],
    cardBillDates: [],
    cardBillPayments: [],
  };
  const materialize = vi.fn(
    async (_u: string, _t: IsoDate, commands: readonly CreateTransactionCommand[]) => commands.length,
  );
  const repo = {
    getProfile: async () => prof,
    loadWorkspace: async () => ws,
    materializeRecurring: materialize,
  } as unknown as FinanceRepository;
  return { repo, materialize };
}

/** The single entry of the single command handed to the repository. */
const onlyEntry = (materialize: ReturnType<typeof vi.fn>) => {
  const [, , commands] = materialize.mock.calls[0] as unknown as [
    string,
    IsoDate,
    CreateTransactionCommand[],
  ];
  return commands[0]?.entries[0];
};

describe("materializeRecurring", () => {
  it("books this month's due occurrence and advances the watermark to today", async () => {
    const { repo, materialize } = stub([rent()]);
    const result = await materializeRecurring(repo, "u");

    expect(result.created).toBe(1);
    const [userId, through, commands] = materialize.mock.calls[0] as unknown as [
      string,
      IsoDate,
      CreateTransactionCommand[],
    ];
    expect(userId).toBe("u");
    expect(through).toBe(today);
    expect(commands).toHaveLength(1);
    expect(onlyEntry(materialize)).toMatchObject({
      kind: "expense",
      description: "Aluguel",
      date: monthStart,
      amountCents: -46967,
      source: "boleto",
      // A materialised row is an instance, never a new rule — the anchor stays the only anchor.
      recurrenceDayOfMonth: null,
    });
  });

  it("books an income due today or earlier as RECEIVED, so the money lands in the account", async () => {
    const { repo, materialize } = stub([salary()]);
    await materializeRecurring(repo, "u");
    expect(onlyEntry(materialize)).toMatchObject({
      kind: "income",
      amountCents: 675100,
      receivedAt: monthStart,
      receivedAccountId: "acc-1",
      receivedAmountCents: 675100,
    });
  });

  it("does nothing when the watermark already reached today", async () => {
    const { repo, materialize } = stub([rent()], profile({ recurringMaterializedThrough: today }));
    expect(await materializeRecurring(repo, "u")).toEqual({ created: 0 });
    expect(materialize).not.toHaveBeenCalled();
  });

  it("never back-fills history: an occurrence before the watermark is not booked", async () => {
    // Rule anchored a year ago; the default watermark is this month's 1st, so only THIS month's
    // occurrence can be created — every earlier month stays untouched.
    const { repo, materialize } = stub([rent({ recurrence: { dayOfMonth: 28 } })]);
    await materializeRecurring(repo, "u");
    const [, , commands] = materialize.mock.calls[0] as unknown as [
      string,
      IsoDate,
      CreateTransactionCommand[],
    ];
    // Day 28 has not arrived yet in a run early in the month; either way nothing before today.
    for (const command of commands) {
      for (const entry of command.entries) expect(entry.date <= today).toBe(true);
      for (const entry of command.entries) expect(entry.date > monthStart).toBe(true);
    }
  });

  it("skips an occurrence the user already booked by hand (same rule, same month)", async () => {
    const manual = rent({ id: "manual", date: monthStart, recurrence: null });
    const { repo, materialize } = stub([rent(), manual]);
    expect(await materializeRecurring(repo, "u")).toEqual({ created: 0 });
    // The watermark still advances, so the next pass short-circuits.
    expect(materialize).toHaveBeenCalledWith("u", today, []);
  });

  it("replays the anchor's split shares onto the materialised row", async () => {
    const shared = rent({
      amountCents: -1099,
      myShareCents: 0,
      splits: [{ personId: "p-mom", shareCents: 1099 }],
    });
    const { repo, materialize } = stub([shared]);
    await materializeRecurring(repo, "u");
    expect(onlyEntry(materialize)).toMatchObject({
      myShareCents: 0,
      splits: [{ personId: "p-mom", shareCents: 1099 }],
    });
  });

  it("reports zero created when a concurrent pass won the lock", async () => {
    const { repo } = stub([rent()]);
    // The repository claims the watermark first: a losing pass inserts nothing and returns 0.
    (repo as { materializeRecurring: unknown }).materializeRecurring = async () => 0;
    expect(await materializeRecurring(repo, "u")).toEqual({ created: 0 });
  });
});
