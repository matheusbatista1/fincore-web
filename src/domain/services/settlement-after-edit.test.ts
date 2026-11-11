import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Account } from "../entities/account";
import {
  type ExpenseSource,
  type ExpenseTransaction,
  type IncomeTransaction,
  settledIncomeCents,
  type Transaction,
  type TransferTransaction,
} from "../entities/transaction";
import { computeAccountBalances } from "./balance.calculator";
import { type EditedRow, type RecordedSettlement, settlementAfterEdit } from "./settlement-after-edit";

const TODAY = "2026-11-11";

const NONE: RecordedSettlement = {
  receivedAt: null,
  receivedAccountId: null,
  receivedAmountCents: null,
  paidAt: null,
  paidAccountId: null,
  paidAmountCents: null,
};

/** An income received on booking: the receipt mirrors the row. */
const income = (over: Partial<IncomeTransaction> = {}): IncomeTransaction => ({
  id: "inc",
  kind: "income",
  description: "Cashback",
  date: "2026-11-04",
  amountCents: 1886,
  accountId: "c6",
  cardId: null,
  fromPersonId: null,
  isReimbursement: false,
  recurrence: null,
  receivedAt: "2026-11-04",
  receivedAccountId: "c6",
  receivedAmountCents: 1886,
  ...over,
});

/** A boleto paid in full on its due date. */
const paidBoleto = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: "exp",
  kind: "expense",
  description: "Água",
  date: "2026-11-03",
  amountCents: -4168,
  categoryId: null,
  source: "boleto",
  cardId: null,
  accountId: null,
  linkedAccountId: null,
  splits: [],
  myShareCents: 4168,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  paidAt: "2026-11-08",
  paidAccountId: "c6",
  paidAmountCents: 4168,
  ...over,
});

/** The row as the edit form sends it back, with only the given fields changed. */
const edited = (tx: IncomeTransaction | ExpenseTransaction, over: Partial<EditedRow> = {}): EditedRow => ({
  date: tx.date,
  amountCents: tx.amountCents,
  accountId: tx.accountId,
  cardId: tx.cardId,
  source: tx.kind === "expense" ? tx.source : null,
  ...over,
});

describe("settlementAfterEdit — a received income", () => {
  it("carries the receipt along when the amount is corrected", () => {
    // Booked as 18,86, corrected to 18,84: the balance must credit 18,84 from then on.
    const before = income();
    expect(settlementAfterEdit(before, edited(before, { amountCents: 1884 }), TODAY)).toEqual({
      ...NONE,
      receivedAt: "2026-11-04",
      receivedAccountId: "c6",
      receivedAmountCents: 1884,
    });
  });

  it("carries the receipt along when the account or the day is corrected", () => {
    const before = income();
    expect(settlementAfterEdit(before, edited(before, { accountId: "nubank" }), TODAY)).toMatchObject({
      receivedAccountId: "nubank",
      receivedAt: "2026-11-04",
      receivedAmountCents: 1886,
    });
    expect(settlementAfterEdit(before, edited(before, { date: "2026-11-02" }), TODAY)).toMatchObject({
      receivedAt: "2026-11-02",
      receivedAccountId: "c6",
    });
  });

  it("keeps a receipt that was deliberately different from the row", () => {
    // Expected 500,00 on the 10th in the C6; she paid 480,00 on the 12th into the Nubank.
    const before = income({
      date: "2026-10-10",
      amountCents: 50_000,
      receivedAt: "2026-10-12",
      receivedAccountId: "nubank",
      receivedAmountCents: 48_000,
    });
    const after = edited(before, { date: "2026-10-09", amountCents: 51_000, accountId: "itau" });
    expect(settlementAfterEdit(before, after, TODAY)).toEqual({
      ...NONE,
      receivedAt: "2026-10-12",
      receivedAccountId: "nubank",
      receivedAmountCents: 48_000,
    });
  });

  it("follows each field on its own", () => {
    // Received on its day and in its account, but for another amount.
    const before = income({ receivedAmountCents: 1_500 });
    const after = edited(before, { date: "2026-11-05", amountCents: 2_000, accountId: "itau" });
    expect(settlementAfterEdit(before, after, TODAY)).toEqual({
      ...NONE,
      receivedAt: "2026-11-05",
      receivedAccountId: "itau",
      receivedAmountCents: 1_500,
    });
  });

  it("leaves 'the row's amount' (null) as it is, so it keeps following the row", () => {
    const before = income({ receivedAmountCents: null });
    expect(settlementAfterEdit(before, edited(before, { amountCents: 9_000 }), TODAY)).toMatchObject({
      receivedAt: "2026-11-04",
      receivedAmountCents: null,
    });
  });

  it("becomes a pending receivable when moved to a day still to come", () => {
    const before = income();
    expect(settlementAfterEdit(before, edited(before, { date: "2026-11-20" }), TODAY)).toEqual(NONE);
    // …unless it was received on a day of its own: that receipt already happened.
    const custom = income({ receivedAt: "2026-11-06" });
    expect(settlementAfterEdit(custom, edited(custom, { date: "2026-11-20" }), TODAY)).toMatchObject({
      receivedAt: "2026-11-06",
    });
  });

  it("changes nothing when the edit changes nothing", () => {
    for (const before of [
      income(),
      income({ receivedAmountCents: 1_500, receivedAccountId: "nubank", receivedAt: "2026-11-06" }),
      income({ receivedAmountCents: null }),
      // A state the app does not create (received on a day still to come) is still left alone.
      income({ date: "2026-12-01", receivedAt: "2026-12-01" }),
    ]) {
      expect(settlementAfterEdit(before, edited(before), TODAY)).toEqual({
        ...NONE,
        receivedAt: before.receivedAt,
        receivedAccountId: before.receivedAccountId,
        receivedAmountCents: before.receivedAmountCents,
      });
    }
  });
});

describe("settlementAfterEdit — pending receivables and card credits", () => {
  const pending = income({
    date: "2026-11-25",
    receivedAt: null,
    receivedAccountId: null,
    receivedAmountCents: null,
  });

  it("keeps a pending receivable pending, whatever is edited", () => {
    expect(settlementAfterEdit(pending, edited(pending, { amountCents: 5_000 }), TODAY)).toEqual(NONE);
    expect(settlementAfterEdit(pending, edited(pending, { date: "2026-11-01" }), TODAY)).toEqual(NONE);
    // An income that predates the receipt fields reads the same way.
    const { receivedAt: _at, receivedAccountId: _account, receivedAmountCents: _cents, ...legacy } = income();
    expect(settlementAfterEdit(legacy, edited(legacy, { amountCents: 5_000 }), TODAY)).toEqual(NONE);
  });

  it("drops the receipt when the income becomes a card credit", () => {
    const before = income();
    expect(settlementAfterEdit(before, edited(before, { accountId: null, cardId: "card-1" }), TODAY)).toEqual(
      NONE,
    );
  });

  it("books a card credit turned into a normal income by its date", () => {
    const credit = income({
      accountId: null,
      cardId: "card-1",
      receivedAt: null,
      receivedAccountId: null,
      receivedAmountCents: null,
    });
    expect(settlementAfterEdit(credit, edited(credit, { accountId: "c6", cardId: null }), TODAY)).toEqual({
      ...NONE,
      receivedAt: "2026-11-04",
      receivedAccountId: "c6",
      receivedAmountCents: 1886,
    });
    const later = edited(credit, { accountId: "c6", cardId: null, date: "2026-11-30" });
    expect(settlementAfterEdit(credit, later, TODAY)).toEqual(NONE);
    // Still a card credit: nothing to receive.
    expect(settlementAfterEdit(credit, edited(credit, { amountCents: 100 }), TODAY)).toEqual(NONE);
  });
});

describe("settlementAfterEdit — a paid obligation", () => {
  it("carries the paid amount along when the value is corrected", () => {
    const before = paidBoleto();
    expect(settlementAfterEdit(before, edited(before, { amountCents: -4_170 }), TODAY)).toEqual({
      ...NONE,
      paidAt: "2026-11-08",
      paidAccountId: "c6",
      paidAmountCents: 4_170,
    });
  });

  it("keeps a discount: the amount paid was never the row's", () => {
    // A 347,65 parcela settled early for 342,32.
    const before = paidBoleto({ source: "loan", amountCents: -34_765, paidAmountCents: 34_232 });
    expect(settlementAfterEdit(before, edited(before, { amountCents: -35_000 }), TODAY)).toMatchObject({
      paidAmountCents: 34_232,
    });
  });

  it("leaves the day and the account of the payment alone: the row's date is its due date", () => {
    const before = paidBoleto();
    expect(settlementAfterEdit(before, edited(before, { date: "2026-11-05" }), TODAY)).toMatchObject({
      paidAt: "2026-11-08",
      paidAccountId: "c6",
      paidAmountCents: 4_168,
    });
  });

  it("leaves 'the row's amount' (null) as it is", () => {
    const before = paidBoleto({ paidAmountCents: null });
    expect(settlementAfterEdit(before, edited(before, { amountCents: -9_000 }), TODAY)).toMatchObject({
      paidAt: "2026-11-08",
      paidAmountCents: null,
    });
  });

  it("drops the payment when the row stops being paid one by one", () => {
    const before = paidBoleto();
    for (const source of ["card", "account", "overdraft"] satisfies ExpenseSource[]) {
      expect(settlementAfterEdit(before, edited(before, { source }), TODAY)).toEqual(NONE);
    }
    // Between payable sources the payment stays.
    expect(settlementAfterEdit(before, edited(before, { source: "financing" }), TODAY)).toMatchObject({
      paidAt: "2026-11-08",
    });
  });

  it("has nothing to carry for an unpaid expense or a transfer", () => {
    const unpaid = paidBoleto({ paidAt: null, paidAccountId: null, paidAmountCents: null });
    expect(settlementAfterEdit(unpaid, edited(unpaid, { amountCents: -5_000 }), TODAY)).toEqual(NONE);
    const { paidAt: _at, paidAccountId: _account, paidAmountCents: _cents, ...plain } = paidBoleto();
    expect(settlementAfterEdit(plain, edited(plain, { amountCents: -5_000 }), TODAY)).toEqual(NONE);
    const transfer: TransferTransaction = {
      id: "tr",
      kind: "transfer",
      description: "",
      date: "2026-11-04",
      fromAccountId: "c6",
      toAccountId: "nubank",
      valueCents: 1_000,
    };
    expect(
      settlementAfterEdit(
        transfer,
        { date: "2026-11-05", amountCents: 0, accountId: null, cardId: null, source: null },
        TODAY,
      ),
    ).toEqual(NONE);
  });
});

describe("settlementAfterEdit — the balance follows the edited row (property)", () => {
  const accounts: Account[] = ["c6", "nubank", "itau"].map((id) => ({
    id,
    bank: id,
    name: "Conta",
    type: "PF",
    themeKey: "",
    openingBalanceCents: 0,
    maskedNumber: "",
  }));
  const accountArb = fc.constantFrom("c6", "nubank", "itau");
  const dayArb = fc.integer({ min: 1, max: 11 }).map((d) => `2026-11-${String(d).padStart(2, "0")}`);
  const centsArb = fc.integer({ min: 1, max: 500_000 });

  it("an income received on booking credits exactly what the edited row says, where and when it says", () => {
    fc.assert(
      fc.property(
        fc.record({ date: dayArb, amount: centsArb, account: accountArb }),
        fc.record({ date: dayArb, amount: centsArb, account: accountArb }),
        (was, now) => {
          const before = income({
            date: was.date,
            amountCents: was.amount,
            accountId: was.account,
            receivedAt: was.date,
            receivedAccountId: was.account,
            receivedAmountCents: was.amount,
          });
          const after = edited(before, { date: now.date, amountCents: now.amount, accountId: now.account });
          const settlement = settlementAfterEdit(before, after, TODAY);
          const row: Transaction = {
            ...before,
            date: after.date,
            amountCents: after.amountCents,
            accountId: after.accountId,
            receivedAt: settlement.receivedAt,
            receivedAccountId: settlement.receivedAccountId,
            receivedAmountCents: settlement.receivedAmountCents,
          };
          expect(settledIncomeCents(row as IncomeTransaction)).toBe(now.amount);
          // On the day before the new date nothing has landed; on the day itself it is all there.
          const balances = computeAccountBalances(accounts, [row], now.date);
          for (const account of accounts) {
            expect(balances.get(account.id)?.cents).toBe(account.id === now.account ? now.amount : 0);
          }
          const dayBefore = `2026-11-${String(Number(now.date.slice(8)) - 1).padStart(2, "0")}`;
          const earlier = computeAccountBalances(accounts, [row], dayBefore);
          expect([...earlier.values()].every((balance) => balance.isZero())).toBe(true);
        },
      ),
    );
  });

  it("applying the same edit twice changes nothing more", () => {
    fc.assert(
      fc.property(
        fc.record({
          date: dayArb,
          amount: centsArb,
          account: accountArb,
          receivedOn: dayArb,
          receivedAmount: centsArb,
          receivedIn: accountArb,
        }),
        fc.record({ date: dayArb, amount: centsArb, account: accountArb }),
        (was, now) => {
          const before = income({
            date: was.date,
            amountCents: was.amount,
            accountId: was.account,
            receivedAt: was.receivedOn,
            receivedAccountId: was.receivedIn,
            receivedAmountCents: was.receivedAmount,
          });
          const after = edited(before, { date: now.date, amountCents: now.amount, accountId: now.account });
          const once = settlementAfterEdit(before, after, TODAY);
          const saved = income({
            date: after.date,
            amountCents: after.amountCents,
            accountId: after.accountId,
            receivedAt: once.receivedAt,
            receivedAccountId: once.receivedAccountId,
            receivedAmountCents: once.receivedAmountCents,
          });
          expect(settlementAfterEdit(saved, after, TODAY)).toEqual(once);
        },
      ),
    );
  });
});
