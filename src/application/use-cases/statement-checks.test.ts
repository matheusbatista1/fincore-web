import { describe, expect, it } from "vitest";
import type { Account } from "@/domain/entities/account";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { StatementCheck } from "@/domain/entities/statement-check";
import type { ExpenseTransaction } from "@/domain/entities/transaction";
import type { FinanceRepository, StatementCheckData, Workspace } from "../ports/finance-repository";
import { getLastStatementChecks, markStatementChecked } from "./statement-checks";

const account: Account = {
  id: "a",
  bank: "Banco",
  name: "Conta",
  type: "PF",
  themeKey: "default",
  openingBalanceCents: 100_000,
  maskedNumber: "•• 0000",
};
/** Closes on the 24th, due on the 2nd: a charge up to the 24th is billed the month after. */
const card: CreditCard = {
  id: "k",
  bank: "Nubank",
  product: "Gold",
  flag: "mastercard",
  themeKey: "",
  maskedNumber: "",
  limitCents: 500_000,
  closingDay: 24,
  dueDay: 2,
};

let seq = 0;
const expense = (
  cents: number,
  date: string,
  over: Partial<ExpenseTransaction> = {},
): ExpenseTransaction => ({
  id: `t${++seq}`,
  kind: "expense",
  description: "Despesa",
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

const workspace: Workspace = {
  accounts: [account],
  creditCards: [card],
  people: [],
  categories: [],
  transactions: [
    expense(4_590, "2026-11-03"),
    expense(900, "2026-11-09"),
    expense(5_000, "2026-11-01", { source: "card", cardId: "k", accountId: null }),
  ],
  settlements: [],
  budgets: [],
  goals: [],
  cardBillDates: [],
  cardBillPayments: [],
};

/** A repository that keeps what it is told to record, and answers with `known` checks. */
function repoWith(known: StatementCheck[] = []) {
  const recorded: StatementCheckData[] = [];
  const repo = {
    loadWorkspace: async () => workspace,
    recordStatementCheck: async (_userId: string, input: StatementCheckData) => {
      recorded.push(input);
    },
    listStatementChecks: async () => known,
  } as unknown as FinanceRepository;
  return { repo, recorded };
}

const line = (date: string, amountCents: number, description: string) => ({ date, description, amountCents });

describe("markStatementChecked", () => {
  it("records what the server finds for an account's statement, and says so", async () => {
    const { repo, recorded } = repoWith();
    const result = await markStatementChecked(
      repo,
      "user",
      {
        target: { type: "account", accountId: "a" },
        // The first line is booked; the fee is not; the coffee of the 9th is not at the bank.
        lines: [line("2026-11-03", -4_590, "RESTAURANTE"), line("2026-11-10", -1_290, "TARIFA")],
      },
      "2026-11-12",
    );
    expect(result).toEqual({
      ok: true,
      value: {
        checkedOn: "2026-11-12",
        periodFrom: "2026-11-03",
        periodTo: "2026-11-10",
        competence: null,
        bankOnly: 1,
        bookOnly: 1,
      },
    });
    expect(recorded).toEqual([
      {
        accountId: "a",
        cardId: null,
        competence: null,
        periodFrom: "2026-11-03",
        periodTo: "2026-11-10",
        bankLines: 2,
        bankOnly: 1,
        bookOnly: 1,
        checkedOn: "2026-11-12",
      },
    ]);
  });

  it("records a card's fatura by the month that was found for it", async () => {
    const { repo, recorded } = repoWith();
    const result = await markStatementChecked(
      repo,
      "user",
      { target: { type: "card", cardId: "k", month: null }, lines: [line("2026-11-01", 5_000, "MERCADO")] },
      "2026-11-12",
    );
    expect(result.ok && result.value).toMatchObject({ competence: "2026-12", bankOnly: 0, bookOnly: 0 });
    expect(recorded).toEqual([
      expect.objectContaining({ accountId: null, cardId: "k", competence: "2026-12", bankLines: 1 }),
    ]);
  });

  it("records nothing for an account that is not the user's", async () => {
    const { repo, recorded } = repoWith();
    const result = await markStatementChecked(
      repo,
      "user",
      { target: { type: "account", accountId: "nope" }, lines: [line("2026-11-03", -4_590, "X")] },
      "2026-11-12",
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "account_not_found", message: "Carteira não encontrada." },
    });
    expect(recorded).toEqual([]);
  });
});

describe("getLastStatementChecks", () => {
  const check = (over: Partial<StatementCheck>): StatementCheck => ({
    id: `c${++seq}`,
    accountId: "a",
    cardId: null,
    competence: null,
    periodFrom: "2026-10-01",
    periodTo: "2026-10-31",
    bankLines: 40,
    bankOnly: 0,
    bookOnly: 0,
    checkedOn: "2026-11-02",
    ...over,
  });

  it("keeps the latest check of each account and of each card", async () => {
    // The repository answers most recent first.
    const { repo } = repoWith([
      check({ checkedOn: "2026-11-12", periodFrom: "2026-11-01", periodTo: "2026-11-11", bankOnly: 2 }),
      check({ accountId: null, cardId: "k", competence: "2026-12", checkedOn: "2026-11-10" }),
      check({ checkedOn: "2026-11-02" }),
      check({ accountId: "b", checkedOn: "2026-10-20" }),
    ]);
    expect(await getLastStatementChecks(repo, "user")).toEqual({
      a: {
        checkedOn: "2026-11-12",
        periodFrom: "2026-11-01",
        periodTo: "2026-11-11",
        competence: null,
        bankOnly: 2,
        bookOnly: 0,
      },
      k: {
        checkedOn: "2026-11-10",
        periodFrom: "2026-10-01",
        periodTo: "2026-10-31",
        competence: "2026-12",
        bankOnly: 0,
        bookOnly: 0,
      },
      b: {
        checkedOn: "2026-10-20",
        periodFrom: "2026-10-01",
        periodTo: "2026-10-31",
        competence: null,
        bankOnly: 0,
        bookOnly: 0,
      },
    });
  });

  it("has nothing to say when nothing was ever checked", async () => {
    expect(await getLastStatementChecks(repoWith().repo, "user")).toEqual({});
  });
});
