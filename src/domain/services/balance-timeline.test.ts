import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Account } from "../entities/account";
import type { CardBillPayment } from "../entities/card-bill-payment";
import type { Settlement } from "../entities/settlement";
import type {
  ExpenseSource,
  ExpenseTransaction,
  IncomeTransaction,
  Transaction,
  TransferTransaction,
} from "../entities/transaction";
import { addDays } from "../value-objects/competence-month";
import { computeAccountBalances } from "./balance.calculator";
import { computeBalanceTimeline, dailyTotalBalances, totalBalanceAt } from "./balance-timeline";

// ---------------------------------------------------------------------------
// Builders — minimal valid entities; each test states only what it is about.
// ---------------------------------------------------------------------------

let seq = 0;
const nextId = (): string => `id-${++seq}`;

const account = (id: string, openingBalanceCents = 0): Account => ({
  id,
  bank: "Bank",
  name: `Account ${id}`,
  type: "PF",
  themeKey: "default",
  openingBalanceCents,
  maskedNumber: "•• 0000",
  isReserve: false,
});

const income = (
  accountId: string,
  amountCents: number,
  date: string,
  over: Partial<IncomeTransaction> = {},
): IncomeTransaction => ({
  id: nextId(),
  kind: "income",
  description: "income",
  date,
  amountCents,
  accountId,
  cardId: null,
  fromPersonId: null,
  isReimbursement: false,
  recurrence: null,
  ...over,
});

const expense = (
  amountCents: number,
  date: string,
  over: Partial<ExpenseTransaction> = {},
): ExpenseTransaction => ({
  id: nextId(),
  kind: "expense",
  description: "expense",
  date,
  amountCents,
  categoryId: null,
  source: "account",
  cardId: null,
  accountId: "a",
  linkedAccountId: null,
  splits: [],
  myShareCents: Math.abs(amountCents),
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  ...over,
});

const transfer = (from: string, to: string, valueCents: number, date: string): TransferTransaction => ({
  id: nextId(),
  kind: "transfer",
  description: "transfer",
  date,
  fromAccountId: from,
  toAccountId: to,
  valueCents,
});

const settlement = (
  personId: string,
  amountCents: number,
  accountId: string | null,
  date: string,
): Settlement => ({ id: nextId(), personId, amountCents, date, accountId });

const faturaPayment = (accountId: string, amountCents: number, date: string): CardBillPayment => ({
  id: nextId(),
  cardId: "card",
  competence: date.slice(0, 7),
  amountCents,
  accountId,
  date,
});

/** What the account balances add up to with `date` as their cutoff — the figure to agree with. */
function totalOfBalances(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  date: string | undefined,
  settlements: readonly Settlement[] = [],
  payments: readonly CardBillPayment[] = [],
): number {
  let total = 0;
  for (const balance of computeAccountBalances(
    accounts,
    transactions,
    date,
    "general",
    settlements,
    payments,
  ).values()) {
    total += balance.cents;
  }
  return total;
}

describe("computeBalanceTimeline", () => {
  it("with no movement is just the opening balances", () => {
    const timeline = computeBalanceTimeline([account("a", 100_000), account("b", -2_500)], []);
    expect(timeline).toEqual({ openingCents: 97_500, changes: [] });
    expect(totalBalanceAt(timeline, "2026-06-10")).toBe(97_500);
  });

  it("nets each day's movements, oldest day first", () => {
    const timeline = computeBalanceTimeline(
      [account("a", 10_000)],
      [
        expense(-3_000, "2026-06-12"),
        income("a", 500_000, "2026-06-05"),
        expense(-1_250, "2026-06-12"),
        expense(-40_000, "2026-06-08"),
      ],
    );
    expect(timeline.openingCents).toBe(10_000);
    expect(timeline.changes).toEqual([
      { date: "2026-06-05", deltaCents: 500_000 },
      { date: "2026-06-08", deltaCents: -40_000 },
      { date: "2026-06-12", deltaCents: -4_250 },
    ]);
  });

  it("leaves out a day whose movements cancel: money that only changed pockets", () => {
    const timeline = computeBalanceTimeline(
      [account("a", 50_000), account("b")],
      [
        transfer("a", "b", 20_000, "2026-06-03"),
        // Bought and refunded on the same day.
        expense(-9_990, "2026-06-04"),
        income("a", 9_990, "2026-06-04"),
      ],
    );
    expect(timeline.changes).toEqual([]);
    expect(totalBalanceAt(timeline, "2026-06-30")).toBe(50_000);
  });

  it("counts a transfer to an account outside the set as money leaving", () => {
    // Only `a` is reported on: what went to `elsewhere` is gone as far as this total is concerned.
    const timeline = computeBalanceTimeline(
      [account("a", 50_000)],
      [transfer("a", "elsewhere", 20_000, "2026-06-03"), income("elsewhere", 999, "2026-06-04")],
    );
    expect(timeline.changes).toEqual([{ date: "2026-06-03", deltaCents: -20_000 }]);
  });

  it("dates each movement on the day its cash moved, not the day it was filed under", () => {
    const timeline = computeBalanceTimeline(
      [account("a")],
      [
        // A boleto due on the 10th, paid on the 14th with a discount.
        expense(-50_000, "2026-06-10", {
          source: "boleto",
          accountId: null,
          paidAt: "2026-06-14",
          paidAccountId: "a",
          paidAmountCents: 48_000,
        }),
        // An income booked for the 20th that landed on the 22nd, short of what was expected.
        income("a", 100_000, "2026-06-20", {
          receivedAt: "2026-06-22",
          receivedAccountId: "a",
          receivedAmountCents: 95_000,
        }),
      ],
    );
    expect(timeline.changes).toEqual([
      { date: "2026-06-14", deltaCents: -48_000 },
      { date: "2026-06-22", deltaCents: 95_000 },
    ]);
  });

  it("ignores what never touches an account", () => {
    const sources: ExpenseSource[] = ["card", "boleto", "loan", "financing"];
    const timeline = computeBalanceTimeline(
      [account("a", 1_000)],
      [
        ...sources.map((source) => expense(-7_000, "2026-06-05", { source, accountId: null })),
        // A receivable not received yet, a card credit, a rolled expense and a ledger-only debt.
        income("a", 30_000, "2026-06-06", { receivedAt: null }),
        income("a", 4_000, "2026-06-06", { accountId: null, cardId: "card" }),
        expense(-2_000, "2026-06-07", { rolledAt: "2026-06-09" }),
        expense(-6_000, "2026-06-08", { accountId: null }),
      ],
    );
    expect(timeline).toEqual({ openingCents: 1_000, changes: [] });
  });

  it("includes the cash of an account-backed settlement and of a fatura payment", () => {
    const owedByAna = expense(-30_000, "2026-06-02", {
      source: "card",
      cardId: "card",
      accountId: null,
      splits: [{ personId: "ana", shareCents: 30_000 }],
      myShareCents: 0,
    });
    const timeline = computeBalanceTimeline(
      [account("a")],
      [owedByAna],
      [settlement("ana", 30_000, "a", "2026-06-15"), settlement("ana", 5_000, null, "2026-06-16")],
      [faturaPayment("a", 30_000, "2026-07-02")],
    );
    expect(timeline.changes).toEqual([
      { date: "2026-06-15", deltaCents: 30_000 }, // the share, paid back into the account
      { date: "2026-07-02", deltaCents: -30_000 }, // the fatura left the account
    ]);
  });

  it("counts an account listed twice once, as its balance does", () => {
    const twice = [account("a", 10_000), account("a", 10_000)];
    const timeline = computeBalanceTimeline(twice, [income("a", 500, "2026-06-05")]);
    expect(timeline).toEqual({ openingCents: 10_000, changes: [{ date: "2026-06-05", deltaCents: 500 }] });
    expect(totalBalanceAt(timeline, "2026-06-05")).toBe(totalOfBalances(twice, [], undefined) + 500);
  });
});

describe("totalBalanceAt", () => {
  const timeline = computeBalanceTimeline(
    [account("a", 10_000)],
    [income("a", 500_000, "2026-06-05"), expense(-40_000, "2026-06-08")],
  );

  it("includes the movements of the day itself and nothing after it", () => {
    expect(totalBalanceAt(timeline, "2026-06-04")).toBe(10_000);
    expect(totalBalanceAt(timeline, "2026-06-05")).toBe(510_000);
    expect(totalBalanceAt(timeline, "2026-06-07")).toBe(510_000);
    expect(totalBalanceAt(timeline, "2026-06-08")).toBe(470_000);
    expect(totalBalanceAt(timeline, "2099-01-01")).toBe(470_000);
  });
});

describe("dailyTotalBalances", () => {
  const timeline = computeBalanceTimeline(
    [account("a", 10_000)],
    [income("a", 500_000, "2026-06-05"), expense(-40_000, "2026-06-08"), expense(-1_000, "2026-07-01")],
  );

  it("has one end-of-day total per calendar day, repeating it while nothing moves", () => {
    expect(dailyTotalBalances(timeline, "2026-06-04", "2026-06-09")).toEqual([
      10_000, // 04
      510_000, // 05: the income
      510_000, // 06
      510_000, // 07
      470_000, // 08: the expense
      470_000, // 09
    ]);
  });

  it("starts from everything that happened before the window", () => {
    expect(dailyTotalBalances(timeline, "2026-06-30", "2026-07-02")).toEqual([470_000, 469_000, 469_000]);
  });

  it("stops at the last day asked for, whatever comes later", () => {
    expect(dailyTotalBalances(timeline, "2026-06-08", "2026-06-08")).toEqual([470_000]);
  });

  it("is empty when the window ends before it starts", () => {
    expect(dailyTotalBalances(timeline, "2026-06-09", "2026-06-08")).toEqual([]);
  });

  it("crosses month and leap-day boundaries one day at a time", () => {
    const flat = computeBalanceTimeline([account("a", 1)], []);
    expect(dailyTotalBalances(flat, "2024-02-27", "2024-03-02")).toHaveLength(5);
    expect(dailyTotalBalances(flat, "2026-12-30", "2027-01-02")).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Property: the timeline is the account balances, read by day.
// ---------------------------------------------------------------------------

const DAYS = Array.from({ length: 40 }, (_, i) => addDays("2026-05-25", i));
const dayArb = () => fc.constantFrom(...DAYS);
const accountIdArb = () => fc.constantFrom("a", "b", "c", "ghost");
const centsArb = () => fc.integer({ min: 1, max: 500_000 });

const transactionArb = (): fc.Arbitrary<Transaction> =>
  fc.oneof(
    fc
      .record({ accountId: accountIdArb(), cents: centsArb(), date: dayArb(), received: fc.boolean() })
      .map(({ accountId, cents, date, received }) =>
        income(accountId, cents, date, received ? {} : { receivedAt: null }),
      ),
    fc
      .record({
        accountId: accountIdArb(),
        cents: centsArb(),
        date: dayArb(),
        receivedAt: dayArb(),
        receivedCents: centsArb(),
      })
      .map(({ accountId, cents, date, receivedAt, receivedCents }) =>
        income(accountId, cents, date, {
          receivedAt,
          receivedAccountId: accountId,
          receivedAmountCents: receivedCents,
        }),
      ),
    fc
      .record({
        accountId: accountIdArb(),
        cents: centsArb(),
        date: dayArb(),
        source: fc.constantFrom<ExpenseSource>("account", "overdraft", "card"),
        person: fc.constantFrom(null, "ana", "bia"),
      })
      .map(({ accountId, cents, date, source, person }) =>
        expense(-cents, date, {
          source,
          accountId: source === "account" ? accountId : null,
          linkedAccountId: source === "overdraft" ? accountId : null,
          cardId: source === "card" ? "card" : null,
          splits: person === null ? [] : [{ personId: person, shareCents: cents }],
          myShareCents: person === null ? cents : 0,
        }),
      ),
    fc
      .record({
        accountId: accountIdArb(),
        cents: centsArb(),
        date: dayArb(),
        paidAt: fc.option(dayArb(), { nil: null }),
        paidCents: centsArb(),
      })
      .map(({ accountId, cents, date, paidAt, paidCents }) =>
        expense(-cents, date, {
          source: "boleto",
          accountId: null,
          ...(paidAt === null ? {} : { paidAt, paidAccountId: accountId, paidAmountCents: paidCents }),
        }),
      ),
    fc
      .record({ from: accountIdArb(), to: accountIdArb(), cents: centsArb(), date: dayArb() })
      .map(({ from, to, cents, date }) => transfer(from, to, cents, date)),
  );

const settlementArb = (): fc.Arbitrary<Settlement> =>
  fc
    .record({
      person: fc.constantFrom("ana", "bia"),
      cents: centsArb(),
      accountId: fc.option(accountIdArb(), { nil: null }),
      date: dayArb(),
    })
    .map(({ person, cents, accountId, date }) => settlement(person, cents, accountId, date));

const paymentArb = (): fc.Arbitrary<CardBillPayment> =>
  fc
    .record({ accountId: accountIdArb(), cents: centsArb(), date: dayArb() })
    .map(({ accountId, cents, date }) => faturaPayment(accountId, cents, date));

const workspaceArb = () =>
  fc.record({
    openings: fc.tuple(
      fc.integer({ min: -200_000, max: 900_000 }),
      fc.integer({ min: -200_000, max: 900_000 }),
      fc.integer({ min: -200_000, max: 900_000 }),
    ),
    transactions: fc.array(transactionArb(), { maxLength: 25 }),
    settlements: fc.array(settlementArb(), { maxLength: 6 }),
    payments: fc.array(paymentArb(), { maxLength: 4 }),
  });

describe("balance timeline (property-based)", () => {
  it("reads, on every day, the total the account balances add up to on that day", () => {
    fc.assert(
      fc.property(workspaceArb(), ({ openings, transactions, settlements, payments }) => {
        const accounts = [account("a", openings[0]), account("b", openings[1]), account("c", openings[2])];
        const timeline = computeBalanceTimeline(accounts, transactions, settlements, payments);

        // Before the first day, on every day, and after the last one.
        const probes = [addDays(DAYS[0] as string, -3), ...DAYS, addDays(DAYS.at(-1) as string, 5)];
        for (const date of probes) {
          expect(totalBalanceAt(timeline, date)).toBe(
            totalOfBalances(accounts, transactions, date, settlements, payments),
          );
        }

        // With no cutoff at all: the opening plus every change.
        const everything = timeline.changes.reduce((sum, c) => sum + c.deltaCents, timeline.openingCents);
        expect(everything).toBe(totalOfBalances(accounts, transactions, undefined, settlements, payments));
      }),
    );
  });

  it("lists only days the total moved, each once, oldest first", () => {
    fc.assert(
      fc.property(workspaceArb(), ({ openings, transactions, settlements, payments }) => {
        const accounts = [account("a", openings[0]), account("b", openings[1]), account("c", openings[2])];
        const { changes } = computeBalanceTimeline(accounts, transactions, settlements, payments);
        for (const [i, change] of changes.entries()) {
          expect(change.deltaCents).not.toBe(0);
          expect(Object.is(change.deltaCents, -0)).toBe(false);
          const previous = changes[i - 1];
          if (previous !== undefined) expect(previous.date < change.date).toBe(true);
        }
      }),
    );
  });

  it("samples the same totals day by day as it answers one date at a time", () => {
    fc.assert(
      fc.property(
        workspaceArb(),
        fc.integer({ min: -5, max: 44 }),
        fc.integer({ min: 0, max: 50 }),
        ({ openings, transactions, settlements, payments }, offset, span) => {
          const accounts = [account("a", openings[0]), account("b", openings[1]), account("c", openings[2])];
          const timeline = computeBalanceTimeline(accounts, transactions, settlements, payments);
          const from = addDays(DAYS[0] as string, offset);
          const daily = dailyTotalBalances(timeline, from, addDays(from, span));
          expect(daily).toHaveLength(span + 1);
          for (const [i, total] of daily.entries()) {
            expect(total).toBe(totalBalanceAt(timeline, addDays(from, i)));
          }
        },
      ),
    );
  });
});
