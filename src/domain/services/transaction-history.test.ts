import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  ExpenseTransaction,
  IncomeTransaction,
  Transaction,
  TransferTransaction,
} from "../entities/transaction";
import { changedFields, diffTransactions, TRANSACTION_FIELDS } from "./transaction-history";

const expense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: "exp-1",
  kind: "expense",
  description: "Mercado",
  date: "2026-11-10",
  amountCents: -5000,
  categoryId: "cat-food",
  source: "account",
  cardId: null,
  accountId: "acc-1",
  linkedAccountId: null,
  splits: [],
  myShareCents: 5000,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  ...over,
});

const income = (over: Partial<IncomeTransaction> = {}): IncomeTransaction => ({
  id: "inc-1",
  kind: "income",
  description: "Salário",
  date: "2026-11-05",
  amountCents: 300000,
  accountId: "acc-1",
  cardId: null,
  fromPersonId: null,
  isReimbursement: false,
  recurrence: null,
  ...over,
});

const transfer = (over: Partial<TransferTransaction> = {}): TransferTransaction => ({
  id: "tr-1",
  kind: "transfer",
  description: "Guardar",
  date: "2026-11-06",
  fromAccountId: "acc-1",
  toAccountId: "acc-2",
  valueCents: 20000,
  ...over,
});

const fields = (before: Transaction, after: Transaction): string[] =>
  changedFields(before, after).map((change) => change.field);

describe("changedFields — an expense", () => {
  it("is empty when nothing a person edits is different", () => {
    expect(changedFields(expense(), expense())).toEqual([]);
  });

  it("ignores what moves on its own: a parcela's status and the user's own share", () => {
    const parcela = { groupId: "g", number: 2, total: 10, status: "futura" as const };
    const before = expense({ installment: parcela, myShareCents: 5000 });
    const after = expense({ installment: { ...parcela, status: "paga" }, myShareCents: 4000 });
    expect(changedFields(before, after)).toEqual([]);
  });

  it("reads the amount without its sign, and each value with its type", () => {
    const after = expense({
      description: "Mercado do mês",
      amountCents: -6000,
      date: "2026-11-11",
      categoryId: null,
      note: "com a feira",
    });
    expect(changedFields(expense(), after)).toEqual([
      {
        field: "description",
        before: { type: "text", text: "Mercado" },
        after: { type: "text", text: "Mercado do mês" },
      },
      { field: "amount", before: { type: "money", cents: 5000 }, after: { type: "money", cents: 6000 } },
      {
        field: "date",
        before: { type: "date", date: "2026-11-10" },
        after: { type: "date", date: "2026-11-11" },
      },
      {
        field: "category",
        before: { type: "ref", entity: "category", id: "cat-food" },
        after: { type: "none" },
      },
      { field: "note", before: { type: "none" }, after: { type: "text", text: "com a feira" } },
    ]);
  });

  it("treats an empty description or note as nothing written", () => {
    expect(fields(expense({ note: "" }), expense())).toEqual([]);
    expect(changedFields(expense({ description: "" }), expense())).toEqual([
      { field: "description", before: { type: "none" }, after: { type: "text", text: "Mercado" } },
    ]);
  });

  it("says where the money comes from: the source, the card, the accounts", () => {
    const onCard = expense({ source: "card", cardId: "card-1", accountId: null });
    expect(changedFields(expense(), onCard)).toEqual([
      {
        field: "source",
        before: { type: "source", source: "account" },
        after: { type: "source", source: "card" },
      },
      { field: "card", before: { type: "none" }, after: { type: "ref", entity: "card", id: "card-1" } },
      {
        field: "account",
        before: { type: "ref", entity: "account", id: "acc-1" },
        after: { type: "none" },
      },
    ]);
    const boleto = expense({ source: "boleto", accountId: null });
    expect(changedFields(boleto, { ...boleto, linkedAccountId: "acc-2" })).toEqual([
      {
        field: "linkedAccount",
        before: { type: "none" },
        after: { type: "ref", entity: "account", id: "acc-2" },
      },
    ]);
  });

  it("compares who shares it whatever order the people come in", () => {
    const ana = { personId: "ana", shareCents: 2000 };
    const bia = { personId: "bia", shareCents: 1000 };
    expect(fields(expense({ splits: [ana, bia] }), expense({ splits: [bia, ana] }))).toEqual([]);
    expect(changedFields(expense({ splits: [bia, ana] }), expense({ splits: [ana] }))).toEqual([
      {
        field: "splits",
        before: { type: "splits", splits: [ana, bia] },
        after: { type: "splits", splits: [ana] },
      },
    ]);
    expect(changedFields(expense({ splits: [ana] }), expense())).toEqual([
      { field: "splits", before: { type: "splits", splits: [ana] }, after: { type: "none" } },
    ]);
    // Two rows for the same person (never written by the app) still compare, in either order.
    const twice = [ana, { personId: "ana", shareCents: 500 }];
    expect(fields(expense({ splits: twice }), expense({ splits: twice }))).toEqual([]);
  });

  it("tells a fixed entry, a moved fatura and a rolled debt", () => {
    expect(changedFields(expense(), expense({ recurrence: { dayOfMonth: 10 } }))).toEqual([
      { field: "recurrence", before: { type: "none" }, after: { type: "day", day: 10 } },
    ]);
    expect(changedFields(expense(), expense({ billMonthOverride: "2026-12" }))).toEqual([
      { field: "billMonth", before: { type: "none" }, after: { type: "month", month: "2026-12" } },
    ]);
    expect(changedFields(expense(), expense({ rolledAt: "2026-11-12" }))).toEqual([
      { field: "rolled", before: { type: "none" }, after: { type: "date", date: "2026-11-12" } },
    ]);
    expect(fields(expense({ rolledAt: null }), expense())).toEqual([]);
  });

  it("reads a payment as one thing: the day, the account and the amount", () => {
    const boleto = expense({ source: "boleto", accountId: null });
    const paid = { ...boleto, paidAt: "2026-11-12", paidAccountId: "acc-1", paidAmountCents: 4800 };
    expect(changedFields(boleto, paid)).toEqual([
      {
        field: "payment",
        before: { type: "none" },
        after: { type: "settled", date: "2026-11-12", accountId: "acc-1", cents: 4800 },
      },
    ]);
    // Undone: back to nothing. A payment recorded with no account or amount still reads as paid.
    expect(changedFields(paid, { ...boleto, paidAt: null })).toEqual([
      {
        field: "payment",
        before: { type: "settled", date: "2026-11-12", accountId: "acc-1", cents: 4800 },
        after: { type: "none" },
      },
    ]);
    expect(changedFields(boleto, { ...boleto, paidAt: "2026-11-12" })).toEqual([
      {
        field: "payment",
        before: { type: "none" },
        after: { type: "settled", date: "2026-11-12", accountId: null, cents: null },
      },
    ]);
  });
});

describe("changedFields — an income", () => {
  it("is empty for the same income", () => {
    expect(changedFields(income(), income())).toEqual([]);
  });

  it("says who it came from, whether it is a reimbursement and when it was received", () => {
    const after = income({
      amountCents: 280000,
      fromPersonId: "ana",
      isReimbursement: true,
      recurrence: { dayOfMonth: 5 },
      receivedAt: "2026-11-06",
      receivedAccountId: "acc-2",
      receivedAmountCents: 280000,
    });
    expect(changedFields(income(), after)).toEqual([
      {
        field: "amount",
        before: { type: "money", cents: 300000 },
        after: { type: "money", cents: 280000 },
      },
      {
        field: "fromPerson",
        before: { type: "none" },
        after: { type: "ref", entity: "person", id: "ana" },
      },
      { field: "reimbursement", before: { type: "flag", on: false }, after: { type: "flag", on: true } },
      { field: "recurrence", before: { type: "none" }, after: { type: "day", day: 5 } },
      {
        field: "receipt",
        before: { type: "none" },
        after: { type: "settled", date: "2026-11-06", accountId: "acc-2", cents: 280000 },
      },
    ]);
  });

  it("follows an estorno from an account to a card", () => {
    expect(fields(income(), income({ accountId: null, cardId: "card-1" }))).toEqual(["card", "account"]);
  });
});

describe("changedFields — a transfer", () => {
  it("is empty for the same transfer", () => {
    expect(changedFields(transfer(), transfer())).toEqual([]);
  });

  it("says which accounts and how much", () => {
    const after = transfer({ fromAccountId: "acc-3", toAccountId: "acc-1", valueCents: 25000 });
    expect(changedFields(transfer(), after)).toEqual([
      { field: "amount", before: { type: "money", cents: 20000 }, after: { type: "money", cents: 25000 } },
      {
        field: "transferFrom",
        before: { type: "ref", entity: "account", id: "acc-1" },
        after: { type: "ref", entity: "account", id: "acc-3" },
      },
      {
        field: "transferTo",
        before: { type: "ref", entity: "account", id: "acc-2" },
        after: { type: "ref", entity: "account", id: "acc-1" },
      },
    ]);
  });
});

describe("changedFields — in general", () => {
  it("reads a field one version does not have as nothing there", () => {
    // The app never changes a row's kind; two rows of different kinds still compare field by field.
    const changes = changedFields(expense(), transfer({ description: "Mercado", date: "2026-11-10" }));
    expect(changes.map((change) => change.field)).toEqual([
      "amount",
      "category",
      "source",
      "account",
      "transferFrom",
      "transferTo",
    ]);
    expect(changes.find((change) => change.field === "source")?.after).toEqual({ type: "none" });
    expect(changes.find((change) => change.field === "transferTo")?.before).toEqual({ type: "none" });
  });

  it("lists the fields in one fixed order, each at most once", () => {
    fc.assert(
      fc.property(
        fc.record({
          description: fc.constantFrom("Mercado", "Feira", ""),
          amountCents: fc.constantFrom(-5000, -7000),
          date: fc.constantFrom("2026-11-10" as const, "2026-11-12" as const),
          categoryId: fc.constantFrom("cat-food", null),
          note: fc.constantFrom("obs", ""),
          recurrence: fc.constantFrom({ dayOfMonth: 10 }, null),
        }),
        (over) => {
          const listed = fields(expense(), expense(over));
          const order = listed.map((field) => TRANSACTION_FIELDS.indexOf(field as never));
          expect([...order].sort((a, b) => a - b)).toEqual(order);
          expect(new Set(listed).size).toBe(listed.length);
          // Comparing the other way round lists the same fields, with the values swapped.
          expect(fields(expense(over), expense())).toEqual(listed);
        },
      ),
    );
  });
});

describe("diffTransactions", () => {
  it("is empty for two readings of the same book", () => {
    const book = [expense(), income(), transfer()];
    expect(diffTransactions(book, book)).toEqual([]);
    expect(diffTransactions([], [])).toEqual([]);
  });

  it("tells what appeared, what changed and what is gone", () => {
    const before = [expense(), income(), transfer()];
    const edited = expense({ amountCents: -6000 });
    const added = expense({ id: "exp-2", description: "Farmácia" });
    const after = [added, edited, transfer()];
    expect(diffTransactions(before, after)).toEqual([
      { transactionId: "exp-2", kind: "created", before: null, after: added },
      { transactionId: "exp-1", kind: "updated", before: expense(), after: edited },
      { transactionId: "inc-1", kind: "deleted", before: income(), after: null },
    ]);
  });

  it("does not report a row that only moved on its own", () => {
    const parcela = { groupId: "g", number: 1, total: 3, status: "atual" as const };
    const before = [expense({ installment: parcela })];
    const after = [expense({ installment: { ...parcela, status: "paga" } })];
    expect(diffTransactions(before, after)).toEqual([]);
  });

  it("accounts for every row of both readings exactly once", () => {
    const row = fc.record({
      id: fc.constantFrom("a", "b", "c", "d", "e"),
      amountCents: fc.constantFrom(-1000, -2000),
    });
    const book = fc.uniqueArray(row, { selector: (r) => r.id }).map((rows) => rows.map((r) => expense(r)));
    fc.assert(
      fc.property(book, book, (before, after) => {
        const changes = diffTransactions(before, after);
        const ids = changes.map((change) => change.transactionId);
        expect(new Set(ids).size).toBe(ids.length);
        const was = new Map(before.map((tx) => [tx.id, tx]));
        const is = new Map(after.map((tx) => [tx.id, tx]));
        for (const change of changes) {
          expect(change.before).toBe(was.get(change.transactionId) ?? null);
          expect(change.after).toBe(is.get(change.transactionId) ?? null);
          expect(change.kind).toBe(
            change.before === null ? "created" : change.after === null ? "deleted" : "updated",
          );
        }
        // Whatever is not listed is in both readings, with the same amount.
        for (const [id, tx] of is) {
          if (ids.includes(id)) continue;
          expect(was.get(id)?.amountCents).toBe(tx.amountCents);
        }
        for (const id of was.keys()) expect(is.has(id) || ids.includes(id)).toBe(true);
      }),
    );
  });
});
