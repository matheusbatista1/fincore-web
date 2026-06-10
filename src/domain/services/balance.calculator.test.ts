import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Account } from "../entities/account";
import type {
  ExpenseSource,
  ExpenseTransaction,
  IncomeTransaction,
  ParcelaStatus,
  Transaction,
  TransferTransaction,
} from "../entities/transaction";
import { Money } from "../money/money";
import { accountDeltas, computeAccountBalance, computeAccountBalances } from "./balance.calculator";

// ---------------------------------------------------------------------------
// Builders — minimal valid entities for the discriminated unions, so tests stay
// focused on the fields the balance calculator actually reads.
// ---------------------------------------------------------------------------

function makeAccount(id: string, openingBalanceCents: number): Account {
  return {
    id,
    bank: "Bank",
    name: `Account ${id}`,
    type: "PF",
    themeKey: "default",
    openingBalanceCents,
    maskedNumber: "•• 0000",
  };
}

let txSeq = 0;
const nextId = (): string => `tx-${++txSeq}`;

function income(accountId: string, amountCents: number): IncomeTransaction {
  return {
    id: nextId(),
    kind: "income",
    description: "income",
    date: "2026-06-01",
    amountCents,
    accountId,
    fromPersonId: null,
    isReimbursement: false,
    recurrence: null,
  };
}

interface ExpenseOpts {
  readonly source: ExpenseSource;
  readonly accountId?: string | null;
  readonly cardId?: string | null;
  readonly linkedAccountId?: string | null;
  readonly installmentStatus?: ParcelaStatus;
}

function expense(amountCents: number, opts: ExpenseOpts): ExpenseTransaction {
  return {
    id: nextId(),
    kind: "expense",
    description: "expense",
    date: "2026-06-01",
    amountCents,
    categoryId: null,
    source: opts.source,
    cardId: opts.cardId ?? null,
    accountId: opts.accountId ?? null,
    linkedAccountId: opts.linkedAccountId ?? null,
    splits: [],
    myShareCents: Math.abs(amountCents),
    installment:
      opts.installmentStatus === undefined
        ? null
        : { groupId: "grp", number: 1, total: 3, status: opts.installmentStatus },
    recurrence: null,
  };
}

function transfer(fromAccountId: string, toAccountId: string, valueCents: number): TransferTransaction {
  return {
    id: nextId(),
    kind: "transfer",
    description: "transfer",
    date: "2026-06-01",
    fromAccountId,
    toAccountId,
    valueCents,
  };
}

// ---------------------------------------------------------------------------
// Concrete examples taken from the prototype seed data (Finance Pessoal/data.js).
// Opening balances are arbitrary here; what matters is the DERIVED movement.
// ---------------------------------------------------------------------------

describe("computeAccountBalances — prototype seed examples", () => {
  it("credits income to its account (Salário → Itaú, Freela → C6)", () => {
    const accounts = [makeAccount("it", 0), makeAccount("c6", 0)];
    const txs: Transaction[] = [
      income("it", 920_000), // Salário R$ 9.200,00
      income("c6", 250_000), // Freela design R$ 2.500,00
    ];
    const balances = computeAccountBalances(accounts, txs);
    expect(balances.get("it")?.cents).toBe(920_000);
    expect(balances.get("c6")?.cents).toBe(250_000);
  });

  it("debits account-source expenses (academia + faxina from Nubank)", () => {
    const accounts = [makeAccount("nu", 1_000_000)];
    const txs: Transaction[] = [
      expense(-12_990, { source: "account", accountId: "nu" }), // Academia R$ 129,90
      expense(-18_000, { source: "account", accountId: "nu" }), // Faxina R$ 180,00
    ];
    const balances = computeAccountBalances(accounts, txs);
    // 1_000_000 - 12_990 - 18_000 = 969_010
    expect(balances.get("nu")?.cents).toBe(969_010);
  });

  it("ignores card and linked-account expenses (Pizzaria card, Aluguel boleto, financing, loan)", () => {
    const accounts = [makeAccount("nu", 500_000), makeAccount("it", 500_000)];
    const txs: Transaction[] = [
      expense(-14_800, { source: "card", cardId: "c-nu" }), // Pizzaria Bráz
      expense(-3_240, { source: "card", cardId: "c-c6" }), // Uber
      expense(-240_000, { source: "boleto", linkedAccountId: "it" }), // Aluguel
      expense(-118_000, { source: "financing", linkedAccountId: "it" }), // Financiamento carro
      expense(-64_000, { source: "loan", linkedAccountId: "nu" }), // Empréstimo pessoal
    ];
    const balances = computeAccountBalances(accounts, txs);
    // None of these touch an account balance.
    expect(balances.get("nu")?.cents).toBe(500_000);
    expect(balances.get("it")?.cents).toBe(500_000);
  });

  it("moves value across accounts on a transfer (C6 → Nubank R$ 2.000)", () => {
    const accounts = [makeAccount("c6", 3_210_075), makeAccount("nu", 842_050)];
    const txs: Transaction[] = [transfer("c6", "nu", 200_000)];
    const balances = computeAccountBalances(accounts, txs);
    expect(balances.get("c6")?.cents).toBe(3_210_075 - 200_000);
    expect(balances.get("nu")?.cents).toBe(842_050 + 200_000);
  });

  it("only the 'atual' installment of the Notebook Dell purchase moves a card (none touch accounts anyway)", () => {
    const accounts = [makeAccount("c6", 0)];
    const txs: Transaction[] = [
      expense(-48_000, { source: "card", cardId: "c-c6", installmentStatus: "paga" }), // 3/10
      expense(-48_000, { source: "card", cardId: "c-c6", installmentStatus: "atual" }), // 4/10
      expense(-48_000, { source: "card", cardId: "c-c6", installmentStatus: "futura" }), // 5/10
    ];
    // All are card-paid, so the account balance is untouched regardless of status.
    expect(computeAccountBalances(accounts, txs).get("c6")?.cents).toBe(0);
  });

  it("paga/futura account-source installments do not move the account; only atual does", () => {
    const accounts = [makeAccount("nu", 100_000)];
    const paid = expense(-10_000, { source: "account", accountId: "nu", installmentStatus: "paga" });
    const current = expense(-10_000, { source: "account", accountId: "nu", installmentStatus: "atual" });
    const future = expense(-10_000, { source: "account", accountId: "nu", installmentStatus: "futura" });
    expect(computeAccountBalances(accounts, [paid, future]).get("nu")?.cents).toBe(100_000);
    expect(computeAccountBalances(accounts, [current]).get("nu")?.cents).toBe(90_000);
  });

  it("returns the opening balance for accounts with no movement", () => {
    const accounts = [makeAccount("idle", 1_240_30)];
    expect(computeAccountBalances(accounts, []).get("idle")?.cents).toBe(1_240_30);
  });

  it("ignores deltas for accounts not in the provided list", () => {
    const accounts = [makeAccount("nu", 0)];
    // Transfer references 'it' which is not reported; only 'nu' is affected.
    const balances = computeAccountBalances(accounts, [transfer("it", "nu", 5_000)]);
    expect(balances.size).toBe(1);
    expect(balances.get("nu")?.cents).toBe(5_000);
  });
});

describe("accountDeltas — single transaction effect", () => {
  it("a transfer nets to zero across the two accounts", () => {
    const deltas = accountDeltas(transfer("a", "b", 7_500));
    expect(deltas.get("a")?.cents).toBe(-7_500);
    expect(deltas.get("b")?.cents).toBe(7_500);
    const total = Money.sum([...deltas.values()]);
    expect(total.cents).toBe(0);
  });

  it("a paga/futura installment produces no deltas", () => {
    expect(
      accountDeltas(expense(-10_000, { source: "account", accountId: "nu", installmentStatus: "paga" })).size,
    ).toBe(0);
    expect(
      accountDeltas(expense(-10_000, { source: "account", accountId: "nu", installmentStatus: "futura" }))
        .size,
    ).toBe(0);
  });
});

describe("computeAccountBalance — single-account helper", () => {
  it("matches the map result for one account", () => {
    const acct = makeAccount("nu", 100_000);
    const txs: Transaction[] = [
      income("nu", 50_000),
      expense(-20_000, { source: "account", accountId: "nu" }),
    ];
    expect(computeAccountBalance(acct, txs).cents).toBe(130_000);
  });

  it("returns opening balance when untouched", () => {
    const acct = makeAccount("nu", 777);
    expect(computeAccountBalance(acct, []).cents).toBe(777);
  });
});

// ---------------------------------------------------------------------------
// Property tests — the business invariants.
// ---------------------------------------------------------------------------

// Bounded so sums stay well within Number.MAX_SAFE_INTEGER even with long lists.
const smallCents = () => fc.integer({ min: 0, max: 1_000_000 });
const acctId = () => fc.constantFrom("a", "b", "c", "d");

describe("balance invariants (property-based)", () => {
  it("a transfer nets to zero across all account deltas", () => {
    fc.assert(
      fc.property(acctId(), acctId(), smallCents(), (from, to, value) => {
        fc.pre(from !== to);
        const total = Money.sum([...accountDeltas(transfer(from, to, value)).values()]);
        expect(total.cents).toBe(0);
      }),
    );
  });

  it("a transfer between two reported accounts conserves their combined balance", () => {
    fc.assert(
      fc.property(smallCents(), smallCents(), smallCents(), (openA, openB, value) => {
        const accounts = [makeAccount("a", openA), makeAccount("b", openB)];
        const balances = computeAccountBalances(accounts, [transfer("a", "b", value)]);
        const combined = (balances.get("a")?.cents ?? 0) + (balances.get("b")?.cents ?? 0);
        expect(combined).toBe(openA + openB);
      }),
    );
  });

  it("balance = opening + Σincome − Σaccount-expenses ± transfers, for a single account", () => {
    const incomeAmt = () => smallCents();
    const expenseAmt = () => smallCents();

    fc.assert(
      fc.property(
        smallCents(),
        fc.array(incomeAmt(), { maxLength: 20 }),
        fc.array(expenseAmt(), { maxLength: 20 }),
        fc.array(fc.record({ value: smallCents(), inbound: fc.boolean() }), { maxLength: 20 }),
        (opening, incomes, expenses, transfers) => {
          const account = makeAccount("a", opening);
          const txs: Transaction[] = [
            ...incomes.map((c) => income("a", c)),
            ...expenses.map((c) => expense(-c, { source: "account", accountId: "a" })),
            ...transfers.map((t) =>
              t.inbound ? transfer("other", "a", t.value) : transfer("a", "other", t.value),
            ),
          ];

          const expected =
            opening +
            incomes.reduce((s, c) => s + c, 0) -
            expenses.reduce((s, c) => s + c, 0) +
            transfers.reduce((s, t) => s + (t.inbound ? t.value : -t.value), 0);

          expect(computeAccountBalance(account, txs).cents).toBe(expected);
        },
      ),
    );
  });

  it("card and linked-account expenses never move any account balance", () => {
    const nonAccountSource = () =>
      fc.constantFrom<ExpenseSource>("card", "boleto", "loan", "financing", "overdraft");

    fc.assert(
      fc.property(
        smallCents(),
        fc.array(fc.tuple(nonAccountSource(), smallCents()), { maxLength: 20 }),
        (opening, items) => {
          const account = makeAccount("a", opening);
          const txs: Transaction[] = items.map(([source, c]) =>
            source === "card"
              ? expense(-c, { source, cardId: "card-1" })
              : expense(-c, { source, linkedAccountId: "a" }),
          );
          // Even when linkedAccountId points at "a", balance must not change.
          expect(computeAccountBalance(account, txs).cents).toBe(opening);
        },
      ),
    );
  });

  it("paga/futura installments never move balances", () => {
    fc.assert(
      fc.property(
        smallCents(),
        fc.array(
          fc.record({
            amount: smallCents(),
            status: fc.constantFrom<ParcelaStatus>("paga", "futura"),
          }),
          { maxLength: 20 },
        ),
        (opening, items) => {
          const account = makeAccount("a", opening);
          const txs: Transaction[] = items.map((i) =>
            expense(-i.amount, { source: "account", accountId: "a", installmentStatus: i.status }),
          );
          expect(computeAccountBalance(account, txs).cents).toBe(opening);
        },
      ),
    );
  });

  it("every input account appears in the result map", () => {
    fc.assert(
      fc.property(fc.uniqueArray(acctId(), { minLength: 1, maxLength: 4 }), (ids) => {
        const accounts = ids.map((id) => makeAccount(id, 0));
        const balances = computeAccountBalances(accounts, []);
        for (const id of ids) {
          expect(balances.has(id)).toBe(true);
        }
      }),
    );
  });
});
