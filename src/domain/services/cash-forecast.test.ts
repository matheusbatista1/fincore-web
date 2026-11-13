import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Account } from "../entities/account";
import type { CardBillDate } from "../entities/card-bill-date";
import type { CardBillPayment } from "../entities/card-bill-payment";
import type { CreditCard } from "../entities/credit-card";
import type { Person } from "../entities/person";
import type { Settlement } from "../entities/settlement";
import type {
  ExpenseTransaction,
  IncomeTransaction,
  Transaction,
  TransferTransaction,
} from "../entities/transaction";
import {
  addDays,
  addMonths,
  dateInMonth,
  dayOf,
  daysBetween,
  monthOf,
} from "../value-objects/competence-month";
import { billingCompetence } from "./card-bill.calculator";
import { type CashForecast, type ForecastEvent, forecastCash } from "./cash-forecast";
import { projectMonthEnd } from "./month-end-projection";

// ---------------------------------------------------------------------------
// Builders — minimal valid entities; each test states only what it is about.
// ---------------------------------------------------------------------------

const TODAY = "2026-06-14";

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

/** Closes on the 24th, due on the 2nd: a charge up to the 24th is billed the month after. */
const card = (id = "k", bank = "Nubank"): CreditCard => ({
  id,
  bank,
  product: "Gold",
  flag: "mastercard",
  themeKey: "",
  maskedNumber: "",
  limitCents: 500_000,
  closingDay: 24,
  dueDay: 2,
});

const person = (id: string): Person => ({ id, name: id, relationship: "", color: "#000000" });

const expense = (
  cents: number,
  date: string,
  over: Partial<ExpenseTransaction> = {},
): ExpenseTransaction => ({
  id: nextId(),
  kind: "expense",
  description: "expense",
  date,
  amountCents: -cents,
  categoryId: null,
  source: "account",
  cardId: null,
  accountId: "a",
  linkedAccountId: null,
  splits: [],
  myShareCents: cents,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  ...over,
});

const cardCharge = (
  cents: number,
  date: string,
  over: Partial<ExpenseTransaction> = {},
): ExpenseTransaction => expense(cents, date, { source: "card", cardId: "k", accountId: null, ...over });

const boleto = (cents: number, date: string, over: Partial<ExpenseTransaction> = {}): ExpenseTransaction =>
  expense(cents, date, { source: "boleto", accountId: null, ...over });

const income = (cents: number, date: string, over: Partial<IncomeTransaction> = {}): IncomeTransaction => ({
  id: nextId(),
  kind: "income",
  description: "income",
  date,
  amountCents: cents,
  accountId: "a",
  cardId: null,
  fromPersonId: null,
  isReimbursement: false,
  recurrence: null,
  ...over,
});

const transfer = (from: string, to: string, cents: number, date: string): TransferTransaction => ({
  id: nextId(),
  kind: "transfer",
  description: "transfer",
  date,
  fromAccountId: from,
  toAccountId: to,
  valueCents: cents,
});

const monthly = (date: string) => ({ recurrence: { dayOfMonth: dayOf(date) } });

interface World {
  accounts?: Account[];
  cards?: CreditCard[];
  billDates?: CardBillDate[];
  people?: Person[];
  transactions?: Transaction[];
  settlements?: Settlement[];
  payments?: CardBillPayment[];
  today?: string;
  through?: string;
}

/** The general "fim do mês" of every month from `today`'s to `through` — what a forecast is pinned on. */
function monthEnds(
  base: Omit<Parameters<typeof projectMonthEnd>[0], "month" | "currentMonth">,
  today: string,
  through: string,
): Map<string, number> {
  const anchors = new Map<string, number>();
  for (let month = monthOf(today); month <= through; month = addMonths(month, 1)) {
    anchors.set(
      month,
      projectMonthEnd({ ...base, month, currentMonth: monthOf(today) }, "general").totalCents,
    );
  }
  return anchors;
}

function forecast(world: World): CashForecast {
  const cards = world.cards ?? [card()];
  const billDates = world.billDates ?? [];
  const today = world.today ?? TODAY;
  const through = world.through ?? "2026-08";
  const base = {
    accounts: world.accounts ?? [account("a", 100_000)],
    people: world.people ?? [],
    transactions: world.transactions ?? [],
    settlements: world.settlements ?? [],
    cardBillPayments: world.payments ?? [],
    competenceOf: billingCompetence(cards, billDates),
  };
  return forecastCash({
    ...base,
    creditCards: cards,
    cardBillDates: billDates,
    today,
    throughMonth: through,
    // Pinned on the real month-end figures: an "adjustment" event would mean a part went unexplained.
    anchors: monthEnds(base, today, through),
  });
}

/** The forecast total at the end of `date`. */
const on = (result: CashForecast, date: string): number | undefined =>
  result.dailyCents[daysBetween(result.startDate, date)];

const brief = (events: readonly ForecastEvent[]): [string, string, number][] =>
  events.map((e) => [e.date, e.kind, e.deltaCents]);

describe("forecastCash", () => {
  it("with nothing to come, is a flat line from the live balance", () => {
    const result = forecast({ transactions: [expense(20_000, "2026-06-01")] });
    expect(result.liveCents).toBe(80_000);
    expect(result.startDate).toBe("2026-06-15");
    // 15 Jun … 31 Aug.
    expect(result.dailyCents).toHaveLength(16 + 31 + 31);
    expect(new Set(result.dailyCents)).toEqual(new Set([80_000]));
    expect(result.events).toEqual([]);
  });

  it("puts each thing on the day it falls", () => {
    const result = forecast({
      people: [person("ana")],
      transactions: [
        // Fixed, anchored in May: the salary on the 20th, the rent on the 28th.
        income(500_000, "2026-05-20", { description: "Salário", ...monthly("2026-05-20") }),
        income(500_000, "2026-06-12", { description: "Extra já recebido" }),
        expense(180_000, "2026-05-28", { description: "Aluguel", ...monthly("2026-05-28") }),
        // A card charge after the closing day of May: on the fatura due 2 July. Ana owes a third.
        cardCharge(90_000, "2026-05-30", {
          description: "Mercado",
          splits: [{ personId: "ana", shareCents: 30_000 }],
          myShareCents: 60_000,
        }),
        // A boleto due on the 25th, a receivable booked for the 22nd, a transfer for the 18th.
        boleto(42_000, "2026-06-25", { description: "Internet" }),
        income(70_000, "2026-06-22", { description: "Freela", receivedAt: null }),
        expense(15_000, "2026-06-18", { description: "Assinatura agendada" }),
      ],
      through: "2026-07",
    });
    // Live: 100000 + 500000 (May salary) − 180000 (May rent) + 500000 (extra) = 920000.
    expect(result.liveCents).toBe(920_000);
    expect(brief(result.events)).toEqual([
      ["2026-06-18", "scheduled", -15_000],
      ["2026-06-20", "recurring", 500_000],
      ["2026-06-22", "receivable", 70_000],
      ["2026-06-25", "obligation", -42_000],
      ["2026-06-28", "recurring", -180_000],
      // Nothing owed by Ana counts in June: her share is on the July fatura.
      ["2026-07-02", "card-bill", -90_000],
      ["2026-07-20", "recurring", 500_000],
      ["2026-07-28", "recurring", -180_000],
      ["2026-07-31", "people", 30_000],
    ]);
    expect(result.events.map((e) => e.label)).toEqual([
      "Assinatura agendada",
      "Salário",
      "Freela",
      "Internet",
      "Aluguel",
      "Fatura Nubank",
      "Salário",
      "Aluguel",
      "Acertos com pessoas",
    ]);
    // Each on its own day: nothing is late.
    expect(result.events.some((e) => e.late)).toBe(false);
    expect(on(result, "2026-06-17")).toBe(920_000);
    expect(on(result, "2026-06-18")).toBe(905_000);
    expect(on(result, "2026-06-24")).toBe(1_475_000);
    expect(on(result, "2026-06-30")).toBe(1_253_000);
    expect(on(result, "2026-07-02")).toBe(1_163_000);
    expect(on(result, "2026-07-31")).toBe(1_513_000);
  });

  it("assumes what is already late is settled next: tomorrow", () => {
    const result = forecast({
      transactions: [
        boleto(30_000, "2026-05-10", { description: "Boleto de maio" }), // overdue, before this month
        boleto(8_000, "2026-06-05", { description: "Boleto do dia 5" }), // due earlier this month
        income(25_000, "2026-06-03", { description: "A receber", receivedAt: null }),
        // Fixed on the 10th, anchored in May, not booked for June yet.
        expense(20_000, "2026-05-10", { description: "Academia", ...monthly("2026-05-10") }),
        // The May-cycle fatura was due on 2 June and is still unpaid.
        cardCharge(50_000, "2026-05-12", { description: "Compra" }),
      ],
      through: "2026-06",
    });
    expect(brief(result.events).sort()).toEqual(
      [
        ["2026-06-15", "overdue", -30_000],
        ["2026-06-15", "obligation", -8_000],
        ["2026-06-15", "receivable", 25_000],
        ["2026-06-15", "recurring", -20_000],
        ["2026-06-15", "card-bill", -50_000],
      ].sort(),
    );
    // …and each says it is late.
    expect(result.events.every((e) => e.late)).toBe(true);
    // Opening 100000 − 20000 (May gym) = 80000 live; then everything late lands at once.
    expect(result.liveCents).toBe(80_000);
    expect(on(result, "2026-06-15")).toBe(-3_000);
    expect(on(result, "2026-06-30")).toBe(-3_000);
  });

  it("bills a card on the due date of that fatura, override included, and skips a paid one", () => {
    const result = forecast({
      billDates: [{ cardId: "k", month: "2026-08", closingDay: 24, dueDay: 9 }],
      transactions: [
        cardCharge(40_000, "2026-05-20"), // June fatura — paid below
        cardCharge(10_000, "2026-06-01"), // July fatura
        income(2_500, "2026-06-10", { accountId: null, cardId: "k", description: "Estorno" }), // July, minus
        cardCharge(7_000, "2026-07-01"), // August fatura, due day overridden to the 9th
        cardCharge(6_000, "2026-05-28", { description: "Streaming", ...monthly("2026-05-28") }), // every bill
      ],
      payments: [
        {
          id: "p",
          cardId: "k",
          competence: "2026-06",
          amountCents: 40_000,
          accountId: "a",
          date: "2026-06-02",
        },
      ],
    });
    expect(brief(result.events)).toEqual([
      // July: 10000 − 2500 + the streaming charged on 28 May (after closing) and expected on 28 Jun? No:
      // 28 May is billed in July, 28 Jun (after the 24th) in August.
      ["2026-07-02", "card-bill", -13_500],
      ["2026-08-09", "card-bill", -13_000],
    ]);
  });

  it("nets a scheduled transfer between two of the accounts, and counts one that leaves them", () => {
    const result = forecast({
      accounts: [account("a", 50_000), account("b", 0)],
      transactions: [
        transfer("a", "b", 20_000, "2026-06-20"),
        transfer("a", "elsewhere", 5_000, "2026-06-21"),
      ],
      through: "2026-06",
    });
    expect(brief(result.events)).toEqual([["2026-06-21", "scheduled", -5_000]]);
  });

  it("settles people on the last day of each month, by what changed since the month before", () => {
    const result = forecast({
      people: [person("ana"), person("bia")],
      transactions: [
        // Ana owes 6000 from May (still pending) and 4000 more in July; Bia is owed nothing.
        expense(10_000, "2026-05-08", {
          splits: [{ personId: "ana", shareCents: 6_000 }],
          myShareCents: 4_000,
        }),
        expense(9_000, "2026-07-03", {
          splits: [{ personId: "ana", shareCents: 4_000 }],
          myShareCents: 5_000,
        }),
      ],
    });
    expect(brief(result.events)).toEqual([
      ["2026-06-30", "people", 6_000], // everything pending through June
      ["2026-07-03", "scheduled", -9_000],
      ["2026-07-31", "people", 4_000], // only what July added
    ]);
  });

  it("on the last day of a month, starts with the next one", () => {
    const result = forecast({
      today: "2026-06-30",
      transactions: [boleto(8_000, "2026-06-05")],
      through: "2026-07",
    });
    expect(result.startDate).toBe("2026-07-01");
    expect(result.dailyCents).toHaveLength(31);
    // Due earlier in the month that is ending today: still this month's obligation, paid next.
    expect(brief(result.events)).toEqual([["2026-07-01", "obligation", -8_000]]);
  });

  it("never calls what people owe late: on a month's last day it is simply tomorrow's", () => {
    const result = forecast({
      today: "2026-06-30",
      people: [person("ana")],
      transactions: [
        expense(10_000, "2026-06-08", {
          splits: [{ personId: "ana", shareCents: 6_000 }],
          myShareCents: 4_000,
        }),
      ],
      through: "2026-07",
    });
    expect(result.events.map((e) => [e.date, e.kind, e.deltaCents, e.late])).toEqual([
      ["2026-07-01", "people", 6_000, false],
    ]);
  });

  it("counts an acerto and a fatura payment booked ahead on their day, by name", () => {
    const result = forecast({
      people: [person("ana")],
      transactions: [
        // Ana owes 6000 of this; her acerto is booked for the 18th.
        expense(10_000, "2026-06-08", {
          splits: [{ personId: "ana", shareCents: 6_000 }],
          myShareCents: 4_000,
        }),
        // The June fatura, due on the 2nd: its payment is booked for the 20th.
        cardCharge(40_000, "2026-05-20"),
      ],
      settlements: [{ id: "s", personId: "ana", amountCents: 6_000, date: "2026-06-18", accountId: "a" }],
      payments: [
        {
          id: "p",
          cardId: "k",
          competence: "2026-06",
          amountCents: 40_000,
          accountId: "a",
          date: "2026-06-20",
        },
      ],
      through: "2026-06",
    });
    // Neither is counted twice: no late fatura, nothing left for Ana to settle at the month's end.
    expect(result.events.map((e) => [e.date, e.kind, e.deltaCents, e.label])).toEqual([
      ["2026-06-18", "scheduled", 6_000, "Acerto"],
      ["2026-06-20", "scheduled", -40_000, "Fatura Nubank"],
    ]);
    expect(result.liveCents).toBe(90_000);
    expect(on(result, "2026-06-30")).toBe(56_000);
  });

  it("is pinned on a month-end figure it is given, and says what its parts did not explain", () => {
    const cards = [card()];
    const result = forecastCash({
      accounts: [account("a", 100_000)],
      creditCards: cards,
      cardBillDates: [],
      people: [],
      transactions: [expense(5_000, "2026-07-05", { description: "Agendada" })],
      settlements: [],
      cardBillPayments: [],
      today: TODAY,
      throughMonth: "2026-07",
      competenceOf: billingCompetence(cards, []),
      // June really ends at 100000: told 75000, the forecast lands there and spells the difference out.
      anchors: new Map([["2026-06", 75_000]]),
    });
    expect(result.events).toEqual([
      {
        date: "2026-06-30",
        deltaCents: -25_000,
        kind: "adjustment",
        label: "Ajuste da projeção",
        late: false,
      },
      { date: "2026-07-05", deltaCents: -5_000, kind: "scheduled", label: "Agendada", late: false },
    ]);
    expect(on(result, "2026-06-29")).toBe(100_000);
    expect(on(result, "2026-06-30")).toBe(75_000);
    expect(on(result, "2026-07-31")).toBe(70_000);
  });

  it("is empty when the horizon is already behind", () => {
    const result = forecast({ today: "2026-06-30", through: "2026-06" });
    expect(result.dailyCents).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.startDate).toBe("2026-07-01");
  });
});

// ---------------------------------------------------------------------------
// Property: the dated parts explain the month-end figure — no adjustment is ever needed.
// ---------------------------------------------------------------------------

const DAYS = Array.from({ length: 150 }, (_, i) => addDays("2026-04-01", i)); // 1 Apr … 28 Aug
const dayArb = () => fc.constantFrom(...DAYS);
const pastDayArb = () => fc.constantFrom(...DAYS.filter((d) => d <= TODAY));
const centsArb = () => fc.integer({ min: 100, max: 400_000 });
const accountArb = () => fc.constantFrom("a", "b");
const personArb = () => fc.constantFrom("ana", "bia");

const splitArb = (cents: number) =>
  fc.option(
    fc.record({ personId: personArb(), pct: fc.integer({ min: 1, max: 100 }) }).map(({ personId, pct }) => {
      const shareCents = Math.max(1, Math.floor((cents * pct) / 100));
      return { splits: [{ personId, shareCents }], myShareCents: cents - shareCents };
    }),
    { nil: {} },
  );

const transactionArb = (): fc.Arbitrary<Transaction> =>
  fc.oneof(
    // An account (or overdraft) expense, maybe shared, maybe fixed.
    fc
      .record({
        cents: centsArb(),
        date: dayArb(),
        accountId: accountArb(),
        overdraft: fc.boolean(),
        fixed: fc.boolean(),
      })
      .chain((r) =>
        splitArb(r.cents).map((split) =>
          expense(r.cents, r.date, {
            ...(r.overdraft
              ? { source: "overdraft" as const, accountId: null, linkedAccountId: r.accountId }
              : { accountId: r.accountId }),
            ...split,
            ...(r.fixed ? monthly(r.date) : {}),
          }),
        ),
      ),
    // An income: received on its date, received on another date, or still pending; maybe fixed.
    fc
      .record({
        cents: centsArb(),
        date: dayArb(),
        accountId: accountArb(),
        state: fc.constantFrom("on-date", "pending", "received"),
        receivedAt: pastDayArb(),
        fixed: fc.boolean(),
        fromPerson: fc.option(personArb(), { nil: null }),
      })
      .map((r) =>
        income(r.cents, r.date, {
          accountId: r.accountId,
          ...(r.state === "pending" ? { receivedAt: null } : {}),
          ...(r.state === "received" ? { receivedAt: r.receivedAt, receivedAccountId: r.accountId } : {}),
          ...(r.fixed ? monthly(r.date) : {}),
          ...(r.fromPerson ? { fromPersonId: r.fromPerson, isReimbursement: true } : {}),
        }),
      ),
    // A card charge, maybe shared, maybe fixed — or a card credit.
    fc
      .record({ cents: centsArb(), date: dayArb(), fixed: fc.boolean(), credit: fc.boolean() })
      .chain((r) =>
        splitArb(r.cents).map((split) =>
          r.credit
            ? income(r.cents, r.date, { accountId: null, cardId: "k" })
            : cardCharge(r.cents, r.date, { ...split, ...(r.fixed ? monthly(r.date) : {}) }),
        ),
      ),
    // A boleto: unpaid, or paid on a past day; maybe shared, maybe fixed.
    fc
      .record({
        cents: centsArb(),
        date: dayArb(),
        paid: fc.boolean(),
        paidAt: pastDayArb(),
        paidCents: centsArb(),
        accountId: accountArb(),
        fixed: fc.boolean(),
      })
      .chain((r) =>
        splitArb(r.cents).map((split) =>
          boleto(r.cents, r.date, {
            ...split,
            ...(r.paid ? { paidAt: r.paidAt, paidAccountId: r.accountId, paidAmountCents: r.paidCents } : {}),
            ...(r.fixed ? monthly(r.date) : {}),
          }),
        ),
      ),
    fc
      .record({
        cents: centsArb(),
        date: dayArb(),
        from: accountArb(),
        to: fc.constantFrom("a", "b", "elsewhere"),
      })
      .map((r) => transfer(r.from, r.to, r.cents, r.date)),
  );

const worldArb = () =>
  fc.record({
    openings: fc.tuple(
      fc.integer({ min: -100_000, max: 900_000 }),
      fc.integer({ min: -100_000, max: 900_000 }),
    ),
    transactions: fc.array(transactionArb(), { maxLength: 18 }),
    settlements: fc.array(
      fc
        .record({
          personId: personArb(),
          amountCents: centsArb(),
          accountId: fc.option(accountArb(), { nil: null }),
          date: pastDayArb(),
        })
        .map((s): Settlement => ({ id: nextId(), ...s })),
      { maxLength: 4 },
    ),
    // Faturas paid on a past day.
    payments: fc.uniqueArray(
      fc
        .record({
          competence: fc.constantFrom("2026-05", "2026-06", "2026-07"),
          amountCents: centsArb(),
          accountId: accountArb(),
          date: pastDayArb(),
        })
        .map((p): CardBillPayment => ({ id: nextId(), cardId: "k", ...p })),
      { maxLength: 2, selector: (p) => p.competence },
    ),
  });

describe("forecastCash (property-based)", () => {
  it("passes through the month-end figure at each month-end, with no adjustment", () => {
    fc.assert(
      fc.property(worldArb(), ({ openings, transactions, settlements, payments }) => {
        const accounts = [account("a", openings[0]), account("b", openings[1])];
        const people = [person("ana"), person("bia")];
        const cards = [card()];
        const competenceOf = billingCompetence(cards, []);
        const base = {
          accounts,
          people,
          transactions,
          settlements,
          cardBillPayments: payments,
          competenceOf,
        };
        const args = {
          ...base,
          creditCards: cards,
          cardBillDates: [],
          today: TODAY,
          throughMonth: "2026-09",
        };
        // The general "fim do mês" of June, July, August and September.
        const anchors = monthEnds(base, TODAY, "2026-09");
        const result = forecastCash({ ...args, anchors });
        // With no anchor at all it is the very same line: the anchors only ever confirm it.
        expect(forecastCash(args).dailyCents).toEqual(result.dailyCents);

        expect(result.events.filter((e) => e.kind === "adjustment")).toEqual([]);
        expect([...anchors.keys()]).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
        for (const [month, figure] of anchors) expect(on(result, dateInMonth(month, 31))).toBe(figure);

        // The line is the live balance plus what happened up to each day, nothing else.
        let running = result.liveCents;
        let next = 0;
        for (const [i, total] of result.dailyCents.entries()) {
          const date = addDays(result.startDate, i);
          for (let e = result.events[next]; e !== undefined && e.date <= date; e = result.events[next]) {
            running += e.deltaCents;
            next += 1;
          }
          expect(total).toBe(running);
        }
        // Nothing is ever placed on today or before, nor past the horizon.
        for (const event of result.events) {
          expect(event.date > TODAY).toBe(true);
          expect(event.date <= "2026-09-30").toBe(true);
          expect(event.deltaCents).not.toBe(0);
        }
      }),
      { numRuns: 300 },
    );
    // 300 worlds, each replaying the person ledger a dozen times: seconds, not milliseconds, on a
    // busy runner.
  }, 30_000);
});
