import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Account } from "@/domain/entities/account";
import type { Category } from "@/domain/entities/category";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { Person } from "@/domain/entities/person";
import type { Settlement } from "@/domain/entities/settlement";
import type { ExpenseTransaction, IncomeTransaction, Transaction } from "@/domain/entities/transaction";
import { computePersonAdvancesThrough } from "@/domain/services/person-ledger.calculator";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { getPersonStatements, NO_CATEGORY_LABEL } from "./get-person-statements";

const person = (id: string): Person => ({ id, name: id, relationship: "Amigo", color: "#000000" });

const itau: Account = {
  id: "acc-1",
  bank: "Itaú",
  name: "Conta",
  type: "PF",
  themeKey: "",
  openingBalanceCents: 0,
  maskedNumber: "",
  isReserve: false,
};

const mercado: Category = { id: "c1", name: "Mercado", color: "#111111", icon: "shopping-cart" };

/** The owner's card: closes on the 24th, due on the 2nd — a charge on the 5th bills NEXT month. */
const nubank: CreditCard = {
  id: "c-nu",
  bank: "Nubank",
  product: "Gold",
  flag: "mastercard",
  themeKey: "",
  maskedNumber: "",
  limitCents: 1_000_000,
  closingDay: 24,
  dueDay: 2,
};

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
  transactions: Transaction[],
  settlements: Settlement[],
  extra: Partial<Workspace> = {},
): Workspace {
  return {
    accounts: [itau],
    creditCards: [],
    people,
    categories: [],
    transactions,
    settlements,
    budgets: [],
    goals: [],
    cardBillDates: [],
    cardBillPayments: [],
    ...extra,
  };
}

function stubRepo(
  people: Person[],
  transactions: Transaction[],
  settlements: Settlement[] = [],
  extra: Partial<Workspace> = {},
): FinanceRepository {
  return {
    loadWorkspace: async () => workspace(people, transactions, settlements, extra),
  } as unknown as FinanceRepository;
}

const range = { from: "2026-05", to: "2026-06" } as const;

describe("getPersonStatements — the reader view", () => {
  it("reconciles opening + purchases + carried + refunds − payments + writeoffs + rollovers == closing", async () => {
    const repo = stubRepo(
      [person("p")],
      [
        // April charge (before the window) -> opening; June charge + May payment in the window.
        expense({ date: "2026-04-10", splits: [{ personId: "p", shareCents: 8000 }] }),
        expense({ date: "2026-06-05", splits: [{ personId: "p", shareCents: 4000 }] }),
        income({ date: "2026-05-20", amountCents: 3000, fromPersonId: "p" }),
      ],
    );
    const [st] = await getPersonStatements(repo, "u", range);
    expect(st).toBeDefined();
    if (!st) return;
    expect(st.openingCents).toBe(8000); // April charge carried in: they already owed
    expect(
      st.openingCents +
        st.purchasesCents +
        st.carriedCents +
        st.refundsCents -
        st.paymentsCents +
        st.writeoffsCents +
        st.rolloversCents,
    ).toBe(st.closingCents);
    expect(st.closingCents).toBe(9000);
    expect(st.ledgerClosingCents).toBe(9000);
    expect(st.rows.at(-1)?.runningCents).toBe(9000);
    expect(st.from).toBe("2026-05");
    expect(st.to).toBe("2026-06");
  });

  it("classifies a shared expense as a purchase and a received income as a payment", async () => {
    const repo = stubRepo(
      [person("p")],
      [
        expense({ date: "2026-06-05", splits: [{ personId: "p", shareCents: 8000 }] }),
        income({ date: "2026-06-20", amountCents: 3000, fromPersonId: "p" }),
      ],
    );
    const [st] = await getPersonStatements(repo, "u", range);
    expect(st?.purchasesCents).toBe(8000);
    expect(st?.paymentsCents).toBe(3000);
    const purchase = st?.rows.find((r) => r.kind === "purchase");
    const payment = st?.rows.find((r) => r.kind === "payment");
    expect(purchase?.cashCents).toBe(8000);
    expect(purchase?.originLabel).toBe("Itaú · Conta");
    expect(payment?.cashCents).toBe(-3000);
    expect(payment?.description).toBe("Pagamento");
  });

  it("a partial receipt counts what actually landed", async () => {
    const repo = stubRepo(
      [person("p")],
      [
        expense({ date: "2026-06-05", splits: [{ personId: "p", shareCents: 8000 }] }),
        income({
          date: "2026-06-20",
          amountCents: 3000,
          fromPersonId: "p",
          receivedAt: "2026-06-21",
          receivedAccountId: "acc-1",
          receivedAmountCents: 2500,
        }),
      ],
    );
    const [st] = await getPersonStatements(repo, "u", range);
    expect(st?.paymentsCents).toBe(2500);
    expect(st?.closingCents).toBe(5500);
  });

  it("paying back a person you owe is a refund that nets the running balance to zero", async () => {
    // They paid you 12000 with nothing behind it (you owe them) -> you pay 12000 back from an account.
    const repo = stubRepo(
      [person("p")],
      [income({ date: "2026-05-10", amountCents: 12000, fromPersonId: "p" })],
      [settlement({ personId: "p", date: "2026-06-10", amountCents: 12000, accountId: "acc-1" })],
    );
    const [st] = await getPersonStatements(repo, "u", range);
    expect(st).toBeDefined();
    if (!st) return;
    expect(st.rows.map((r) => r.kind)).toEqual(["payment", "refund"]);
    expect(st.rows[1]?.description).toBe("Devolução");
    expect(st.rows[1]?.originLabel).toBe("Itaú · Conta");
    expect(st.refundsCents).toBe(12000);
    expect(st.closingCents).toBe(0);
    expect(st.rows.at(-1)?.runningCents).toBe(0);
  });

  it("a 'sem conta' acerto is a Desconto that moves only what it forgave", async () => {
    const repo = stubRepo(
      [person("p")],
      [expense({ date: "2026-06-01", splits: [{ personId: "p", shareCents: 5000 }] })],
      [settlement({ personId: "p", date: "2026-06-15", amountCents: 8000 })], // forgives more than owed
    );
    const [st] = await getPersonStatements(repo, "u", range);
    const writeoff = st?.rows.find((r) => r.kind === "writeoff");
    expect(writeoff?.description).toBe("Desconto");
    expect(writeoff?.originLabel).toBe("sem conta");
    expect(writeoff?.cashCents).toBe(-5000);
    expect(st?.writeoffsCents).toBe(-5000);
    expect(st?.closingCents).toBe(0);
  });

  it("a rollover is a postponement: neither a discount nor a payment, and the debt returns later", async () => {
    // June: 50,00 owed. Rolled on the 15th with the user's own money to July 20.
    const repo = stubRepo(
      [person("p")],
      [
        expense({ date: "2026-06-01", splits: [{ personId: "p", shareCents: 5000 }] }),
        expense({
          description: "Dívida de p",
          date: "2026-07-20",
          amountCents: -5000,
          note: "Saldo de Junho 2026 adiado",
          accountId: null, // ledger-only: owed, nothing behind it
          splits: [{ personId: "p", shareCents: 5000 }],
        }),
      ],
      [
        settlement({
          personId: "p",
          date: "2026-06-15",
          amountCents: 5000,
          note: "Rolagem — Dívida de p · nova data 20/07/2026",
        }),
      ],
    );
    const [june] = await getPersonStatements(repo, "u", { from: "2026-06", to: "2026-06" });
    const rolled = june?.rows.find((r) => r.kind === "rollover");
    expect(rolled).toMatchObject({
      description: "Saldo adiado",
      originLabel: "Rolagem",
      note: "Dívida de p · nova data 20/07/2026",
      cashCents: -5000,
      runningCents: 0,
    });
    expect(june?.rolloversCents).toBe(-5000);
    expect(june?.writeoffsCents).toBe(0);
    expect(june?.paymentsCents).toBe(0);
    expect(june?.closingCents).toBe(0);

    const [july] = await getPersonStatements(repo, "u", { from: "2026-07", to: "2026-07" });
    expect(july?.openingCents).toBe(0);
    expect(july?.rows).toHaveLength(1);
    expect(july?.rows[0]).toMatchObject({
      kind: "carried", // owed again, but not something bought in July
      description: "Dívida de p",
      originLabel: "Dívida rolada",
      note: "Saldo de Junho 2026 adiado",
      cashCents: 5000,
    });
    expect(july?.carriedCents).toBe(5000);
    expect(july?.purchasesCents).toBe(0);
    expect(july?.byCategory).toEqual([]);
    expect(july?.closingCents).toBe(5000);
    // It was never paid: the statement must not remember a payment.
    expect(july?.lastPaymentBefore).toBeNull();
  });

  it("lists a rollover after the month's rows it settles, even those dated after the day it was made", async () => {
    // Rolled on the 12th: the month's remainder includes a parcela that only falls on the 18th.
    const repo = stubRepo(
      [person("p")],
      [
        expense({ date: "2026-06-02", splits: [{ personId: "p", shareCents: 2400 }] }),
        expense({ date: "2026-06-18", splits: [{ personId: "p", shareCents: 34765 }] }),
      ],
      [settlement({ personId: "p", date: "2026-06-12", amountCents: 37165, note: "Rolagem — Dívida de p" })],
    );
    const [st] = await getPersonStatements(repo, "u", { from: "2026-06", to: "2026-06" });
    expect(st?.rows.map((r) => [r.date, r.kind, r.runningCents])).toEqual([
      ["2026-06-02", "purchase", 2400],
      ["2026-06-18", "purchase", 37165],
      ["2026-06-12", "rollover", 0], // never a passing "credit" of 347,65 in between
    ]);
    // The span still reads the calendar, whatever the listing order.
    expect(st?.rowsDateSpan).toEqual({ first: "2026-06-02", last: "2026-06-18" });
  });

  it("a rollover backed by an account (the user's borrowed money landed there) is still not their payment", async () => {
    const repo = stubRepo(
      [person("p")],
      [expense({ date: "2026-06-01", splits: [{ personId: "p", shareCents: 5000 }] })],
      [
        settlement({
          personId: "p",
          date: "2026-06-15",
          amountCents: 5000,
          accountId: "acc-1",
          note: "Rolagem — Dívida de p",
        }),
      ],
    );
    const [st] = await getPersonStatements(repo, "u", range);
    expect(st?.rows.map((r) => r.kind)).toEqual(["purchase", "rollover"]);
    expect(st?.rows[1]).toMatchObject({ description: "Saldo adiado", note: "Dívida de p", cashCents: -5000 });
    expect(st?.paymentsCents).toBe(0);
    expect(st?.rolloversCents).toBe(-5000);
    const [later] = await getPersonStatements(repo, "u", { from: "2026-07", to: "2026-07" });
    expect(later?.lastPaymentBefore).toBeNull();
  });

  it("drops a no-op 'sem conta' acerto (against a zero balance) from the rows", async () => {
    const repo = stubRepo(
      [person("p")],
      [],
      [settlement({ personId: "p", date: "2026-06-10", amountCents: 5000 })],
    );
    const [st] = await getPersonStatements(repo, "u", range);
    expect(st?.rows).toHaveLength(0);
    expect(st?.closingCents).toBe(0);
    expect(st?.rowsDateSpan).toBeNull();
  });

  it("a pre-payment above the debt stays visible as credit instead of being clamped away", async () => {
    // The owner's mother: she paid R$ 1.100 on 20/09; her R$ 1.088,03 share was charged on 05/10 and
    // bills the NOVEMBER fatura (closes 24, due 2). The old statement dropped the September payment
    // (applied delta 0) and opened November with a bare "- 1.088,03".
    const repo = stubRepo(
      [person("p")],
      [
        expense({
          description: "Mercado",
          date: "2026-10-05",
          source: "card",
          cardId: "c-nu",
          accountId: null,
          amountCents: -108_803,
          splits: [{ personId: "p", shareCents: 108_803 }],
        }),
      ],
      [settlement({ personId: "p", date: "2026-09-20", amountCents: 110_000, accountId: "acc-1" })],
      { creditCards: [nubank] },
    );
    const [september] = await getPersonStatements(repo, "u", { from: "2026-09", to: "2026-09" });
    expect(september?.rows.map((r) => [r.kind, r.cashCents])).toEqual([["payment", -110_000]]);
    expect(september?.closingCents).toBe(-110_000); // credit in her favour
    expect(september?.ledgerClosingCents).toBe(0); // the ledger clamps; the reader view does not

    const [november] = await getPersonStatements(repo, "u", { from: "2026-11", to: "2026-11" });
    expect(november?.openingCents).toBe(-110_000);
    expect(november?.lastPaymentBefore).toEqual({ date: "2026-09-20", amountCents: 110_000 });
    expect(november?.rows.map((r) => [r.kind, r.cashCents, r.competence])).toEqual([
      ["purchase", 108_803, "2026-11"],
    ]);
    expect(november?.closingCents).toBe(-1_197); // R$ 11,97 still in her favour
    expect(november?.ledgerClosingCents).toBe(0);
    expect(november?.rowsDateSpan).toEqual({ first: "2026-10-05", last: "2026-10-05" });
  });

  it("an acerto above the debt shows the full amount paid and the note the app wrote", async () => {
    const repo = stubRepo(
      [person("p")],
      [expense({ date: "2026-06-01", splits: [{ personId: "p", shareCents: 59_640 }] })],
      [
        settlement({
          personId: "p",
          date: "2026-06-15",
          amountCents: 60_000,
          accountId: "acc-1",
          note: "Acerto · R$ 3,60 de crédito",
        }),
      ],
    );
    const [st] = await getPersonStatements(repo, "u", range);
    const payment = st?.rows.find((r) => r.kind === "payment");
    expect(payment?.cashCents).toBe(-60_000);
    expect(payment?.note).toBe("Acerto · R$ 3,60 de crédito");
    expect(st?.closingCents).toBe(-360);
    expect(st?.ledgerClosingCents).toBe(0);
  });

  it("an installment row says which parcela it is, how many are left, and the whole purchase", async () => {
    const parcela = (number: number, status: "paga" | "atual" | "futura", date: string) =>
      expense({
        description: "Geladeira",
        date,
        amountCents: -10_000,
        splits: [{ personId: "p", shareCents: 5_000 }],
        installment: { groupId: "g1", number, total: 10, status },
      });
    const repo = stubRepo(
      [person("p")],
      [parcela(1, "paga", "2026-04-10"), parcela(2, "paga", "2026-05-10"), parcela(3, "atual", "2026-06-10")],
    );
    const [st] = await getPersonStatements(repo, "u", { from: "2026-06", to: "2026-06" });
    const row = st?.rows[0];
    expect(row?.parcela).toEqual({ number: 3, total: 10, remaining: 7 });
    expect(row?.purchaseTotalCents).toBe(10_000);
    // The group totals only see the parcelas that exist as rows (three of the ten here).
    expect(row?.groupTotalCents).toBe(30_000);
    expect(row?.groupShareCents).toBe(15_000);
    expect(row?.groupCount).toBe(3);
  });

  it("a parcela already billed is not 'previsto', whatever its stored status says", async () => {
    // Registered in October with parcela 1 current: parcela 2 was stored "futura" and nothing updates
    // it when November arrives. The owner's real PDF showed a 13/10 charge billed in November as
    // "previsto". The calendar (the current month the pages pass) decides, not the snapshot.
    const parcela = (number: number, status: "paga" | "atual" | "futura", date: string) =>
      expense({
        description: "Fone",
        date,
        source: "card",
        cardId: "c-nu",
        accountId: null,
        amountCents: -15_499,
        splits: [{ personId: "p", shareCents: 15_499 }],
        installment: { groupId: "g2", number, total: 3, status },
      });
    const repo = stubRepo(
      [person("p")],
      [
        parcela(1, "atual", "2026-09-13"),
        parcela(2, "futura", "2026-10-13"),
        parcela(3, "futura", "2026-11-13"),
      ],
      [],
      { creditCards: [nubank] },
    );
    // Parcela 2 (charged 13/10) bills November; in November it is a real charge, not a forecast.
    const [november] = await getPersonStatements(repo, "u", {
      from: "2026-11",
      to: "2026-11",
      asOf: "2026-11",
    });
    expect(november?.rows.map((r) => [r.parcela?.number, r.projected])).toEqual([[2, false]]);
    expect(november?.projectedCount).toBe(0);
    // Parcela 3 (charged 13/11) bills December: browsing December in November, it is still ahead.
    const [december] = await getPersonStatements(repo, "u", {
      from: "2026-12",
      to: "2026-12",
      asOf: "2026-11",
    });
    expect(december?.rows.map((r) => [r.parcela?.number, r.projected])).toEqual([[3, true]]);
    // Without the current month the ledger's stored-status flag stands (legacy callers).
    const [legacy] = await getPersonStatements(repo, "u", { from: "2026-11", to: "2026-11" });
    expect(legacy?.rows[0]?.projected).toBe(true);
  });

  it("buckets purchases by category, largest first and 'Sem categoria' last", async () => {
    const repo = stubRepo(
      [person("p")],
      [
        expense({ date: "2026-06-01", categoryId: "c1", splits: [{ personId: "p", shareCents: 3000 }] }),
        expense({ date: "2026-06-02", categoryId: "c1", splits: [{ personId: "p", shareCents: 2000 }] }),
        expense({ date: "2026-06-03", splits: [{ personId: "p", shareCents: 10000 }] }),
      ],
      [],
      { categories: [mercado] },
    );
    const [st] = await getPersonStatements(repo, "u", range);
    expect(st?.rows[0]?.categoryName).toBe("Mercado");
    expect(st?.rows[0]?.categoryColor).toBe("#111111");
    expect(st?.rows[2]?.categoryName).toBeNull();
    expect(st?.byCategory).toEqual([
      { name: "Mercado", color: "#111111", count: 2, totalCents: 5000 },
      { name: NO_CATEGORY_LABEL, color: expect.any(String), count: 1, totalCents: 10000 },
    ]);
  });

  it("remembers the latest payment made before the window", async () => {
    const repo = stubRepo(
      [person("p")],
      [
        expense({ date: "2026-03-01", splits: [{ personId: "p", shareCents: 20000 }] }),
        income({ date: "2026-03-15", amountCents: 5000, fromPersonId: "p" }),
        income({ date: "2026-04-15", amountCents: 7000, fromPersonId: "p" }),
        expense({ date: "2026-06-05", splits: [{ personId: "p", shareCents: 1000 }] }),
      ],
    );
    const [st] = await getPersonStatements(repo, "u", range);
    expect(st?.lastPaymentBefore).toEqual({ date: "2026-04-15", amountCents: 7000 });
    expect(st?.openingCents).toBe(8000);
  });

  it("a projected card subscription is billed in its FATURA month, and counted as previsto", async () => {
    const weverse = expense({
      description: "Google Weverse Connec",
      date: "2026-06-04",
      source: "card",
      cardId: "c-nu",
      accountId: null,
      amountCents: -1099,
      splits: [{ personId: "p", shareCents: 1099 }],
      recurrence: { dayOfMonth: 4 },
    });
    const repo = stubRepo([person("p")], [weverse], [], { creditCards: [nubank] });

    const [august] = await getPersonStatements(repo, "u", { from: "2026-08", to: "2026-08" });
    // August's bill carries the 04/07 charge; the 04/08 one belongs to September.
    expect((august?.rows ?? []).filter((r) => r.projected).map((r) => r.date)).toEqual(["2026-07-04"]);
    expect(august?.projectedCount).toBe(1);
    expect(august?.projectedCents).toBe(1099);
    expect(august?.rows[0]?.originLabel).toBe("Cartão Nubank");

    const [september] = await getPersonStatements(repo, "u", { from: "2026-09", to: "2026-09" });
    expect((september?.rows ?? []).filter((r) => r.projected).map((r) => r.date)).toEqual(["2026-08-04"]);
  });

  it("asOf: a past window also reports the situation today (a later payment zeroes it)", async () => {
    const repo = stubRepo(
      [person("p")],
      [expense({ date: "2026-06-05", splits: [{ personId: "p", shareCents: 5000 }] })],
      [settlement({ personId: "p", date: "2026-07-10", amountCents: 5000, accountId: "acc-1" })],
    );
    const [june] = await getPersonStatements(repo, "u", { from: "2026-06", to: "2026-06", asOf: "2026-07" });
    expect(june?.closingCents).toBe(5000); // at the end of June she still owed
    expect(june?.asOf).toEqual({ month: "2026-07", closingCents: 0 }); // …but paid in July

    const [current] = await getPersonStatements(repo, "u", {
      from: "2026-06",
      to: "2026-06",
      asOf: "2026-06",
    });
    expect(current?.asOf).toBeNull();
  });

  it("returns a statement for every person, with zeros when there is no activity", async () => {
    const repo = stubRepo([person("p"), person("q")], []);
    const statements = await getPersonStatements(repo, "u", range);
    expect(statements).toHaveLength(2);
    for (const st of statements) {
      expect(st.openingCents).toBe(0);
      expect(st.closingCents).toBe(0);
      expect(st.rows).toHaveLength(0);
      expect(st.byCategory).toEqual([]);
      expect(st.lastPaymentBefore).toBeNull();
      expect(st.asOf).toBeNull();
    }
  });

  it("holds the invariants for any mix of shares, payments and acertos (property)", async () => {
    const monthArb = fc.constantFrom("2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06");
    const shareArb = fc.record({ month: monthArb, cents: fc.integer({ min: 1, max: 80_000 }) });
    const payArb = fc.record({ month: monthArb, cents: fc.integer({ min: 1, max: 40_000 }) });
    const settArb = fc.record({
      month: monthArb,
      cents: fc.integer({ min: 1, max: 100_000 }),
      withAccount: fc.boolean(),
      rollover: fc.boolean(),
    });
    await fc.assert(
      fc.asyncProperty(
        fc.array(shareArb, { maxLength: 8 }),
        fc.array(payArb, { maxLength: 4 }),
        fc.array(settArb, { maxLength: 5 }),
        monthArb,
        monthArb,
        async (shares, pays, setts, a, b) => {
          const [from, to] = a <= b ? [a, b] : [b, a];
          const txs: Transaction[] = [
            ...shares.map((s) =>
              expense({ date: `${s.month}-10`, splits: [{ personId: "p", shareCents: s.cents }] }),
            ),
            ...pays.map((p) => income({ date: `${p.month}-08`, amountCents: p.cents, fromPersonId: "p" })),
          ];
          const acertos = setts.map((s) =>
            settlement({
              personId: "p",
              date: `${s.month}-12`,
              amountCents: s.cents,
              accountId: s.withAccount ? "acc-1" : null,
              ...(s.rollover ? { note: "Rolagem — Dívida de p" } : {}),
            }),
          );
          const [st] = await getPersonStatements(stubRepo([person("p")], txs, acertos), "u", { from, to });
          if (!st) throw new Error("missing statement");
          expect(
            st.openingCents +
              st.purchasesCents +
              st.carriedCents +
              st.refundsCents -
              st.paymentsCents +
              st.writeoffsCents +
              st.rolloversCents,
          ).toBe(st.closingCents);
          // A rollover never reads as money the person paid, nor as a discount.
          for (const row of st.rows) {
            if (row.kind === "rollover") expect(row.description).toBe("Saldo adiado");
          }
          if (st.rows.length > 0) expect(st.rows.at(-1)?.runningCents).toBe(st.closingCents);
          for (const row of st.rows) expect(row.cashCents).not.toBe(0);
          const advance =
            computePersonAdvancesThrough([person("p")], txs, acertos, to, (tx) => tx.date.slice(0, 7)).get(
              "p",
            ) ?? 0;
          expect(st.ledgerClosingCents - advance).toBe(st.closingCents);
        },
      ),
      { numRuns: 60 },
    );
  });
});
