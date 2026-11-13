import { describe, expect, it } from "vitest";
import type { Account } from "@/domain/entities/account";
import type { CardBillPayment } from "@/domain/entities/card-bill-payment";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { Person } from "@/domain/entities/person";
import type { Settlement } from "@/domain/entities/settlement";
import type {
  ExpenseTransaction,
  IncomeTransaction,
  TransferTransaction,
} from "@/domain/entities/transaction";
import type { ReconcileStatementInput } from "@/shared/schemas/reconcile";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { type ReconcileResult, reconcileWithStatement } from "./reconcile-statement";

// ---------------------------------------------------------------------------
// Builders — minimal valid entities; each test states only what it is about.
// ---------------------------------------------------------------------------

let seq = 0;
const nextId = (): string => `id-${++seq}`;

const account = (id: string, openingBalanceCents = 0): Account => ({
  id,
  bank: "Banco",
  name: `Conta ${id}`,
  type: "PF",
  themeKey: "default",
  openingBalanceCents,
  maskedNumber: "•• 0000",
  isReserve: false,
});

/** Closes on the 24th, due on the 2nd: a charge up to the 24th is billed the month after. */
const card = (id = "k"): CreditCard => ({
  id,
  bank: "Nubank",
  product: "Gold",
  flag: "mastercard",
  themeKey: "",
  maskedNumber: "",
  limitCents: 500_000,
  closingDay: 24,
  dueDay: 2,
});

const person = (id: string, name: string): Person => ({ id, name, relationship: "", color: "#000000" });

const expense = (
  cents: number,
  date: string,
  description: string,
  over: Partial<ExpenseTransaction> = {},
): ExpenseTransaction => ({
  id: nextId(),
  kind: "expense",
  description,
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

const charge = (cents: number, date: string, description: string): ExpenseTransaction =>
  expense(cents, date, description, { source: "card", cardId: "k", accountId: null });

const income = (
  cents: number,
  date: string,
  description: string,
  over: Partial<IncomeTransaction> = {},
): IncomeTransaction => ({
  id: nextId(),
  kind: "income",
  description,
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
  description: "Para a reserva",
  date,
  fromAccountId: from,
  toAccountId: to,
  valueCents: cents,
});

const workspace = (over: Partial<Workspace>): Workspace => ({
  accounts: [],
  creditCards: [],
  people: [],
  categories: [],
  transactions: [],
  settlements: [],
  budgets: [],
  goals: [],
  cardBillDates: [],
  cardBillPayments: [],
  ...over,
});

const stubRepo = (ws: Workspace): FinanceRepository =>
  ({ loadWorkspace: async () => ws }) as unknown as FinanceRepository;

const line = (date: string, amountCents: number, description: string) => ({ date, description, amountCents });

async function check(ws: Workspace, input: ReconcileStatementInput): Promise<ReconcileResult> {
  const result = await reconcileWithStatement(stubRepo(ws), "user", input);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Each match as "kind: bank descriptions = app descriptions". */
const brief = (result: ReconcileResult): string[] =>
  result.matches.map(
    (m) => `${m.kind}: ${m.bank.map((r) => r.label).join(" + ")} = ${m.book.map((r) => r.label).join(" + ")}`,
  );

describe("reconcileWithStatement — an account", () => {
  const ana = person("ana", "Ana");
  const payment: CardBillPayment = {
    id: "pay",
    cardId: "k",
    competence: "2026-11",
    amountCents: 30_000,
    accountId: "a",
    date: "2026-11-10",
  };
  const acerto: Settlement = {
    id: "set",
    personId: "ana",
    amountCents: 6_000,
    date: "2026-11-08",
    accountId: "a",
  };
  const dinner = expense(4_590, "2026-11-02", "Jantar");
  const ws = workspace({
    accounts: [account("a", 100_000), account("b")],
    creditCards: [card()],
    people: [ana],
    transactions: [
      dinner,
      income(250_000, "2026-11-05", "Salário"),
      transfer("a", "b", 10_000, "2026-11-07"),
      expense(900, "2026-11-09", "Café que paguei em dinheiro"),
      // Outside the statement's days: not this file's business.
      expense(7_700, "2026-11-25", "Depois do extrato"),
      // Another account's.
      expense(1_234, "2026-11-12", "Da outra conta", { accountId: "b" }),
    ],
    settlements: [acerto],
    cardBillPayments: [payment],
  });
  const input: ReconcileStatementInput = {
    target: { type: "account", accountId: "a" },
    lines: [
      line("2026-11-03", -4_590, "IFOOD *REST 8842"),
      line("2026-11-05", 250_000, "TED RECEBIDA"),
      line("2026-11-07", -10_000, "PIX ENVIADO"),
      line("2026-11-08", 6_000, "PIX RECEBIDO"),
      line("2026-11-10", -30_000, "PGTO FATURA"),
      line("2026-11-12", -1_234, "TARIFA PACOTE"),
    ],
  };

  it("pairs each line with what moved the account, whatever it is and whatever it is called", async () => {
    const result = await check(ws, input);
    expect(brief(result)).toEqual([
      "exact: IFOOD *REST 8842 = Jantar",
      "exact: TED RECEBIDA = Salário",
      "exact: PIX ENVIADO = Para a reserva",
      "exact: PIX RECEBIDO = Acerto com Ana",
      "exact: PGTO FATURA = Fatura Nubank",
    ]);
    expect(result.target).toEqual({ type: "account", id: "a", label: "Banco · Conta a" });
    expect(result.period).toEqual({ from: "2026-11-03", to: "2026-11-12" });
  });

  it("says what the bank has that the app does not, and the other way round", async () => {
    const result = await check(ws, input);
    expect(result.bankOnly.map((r) => [r.date, r.amountCents, r.label])).toEqual([
      ["2026-11-12", -1_234, "TARIFA PACOTE"],
    ]);
    // Only what is dated inside the statement's days; the entry of the 25th is not expected in it.
    expect(result.bookOnly.map((r) => [r.date, r.amountCents, r.label])).toEqual([
      ["2026-11-09", -900, "Café que paguei em dinheiro"],
    ]);
  });

  it("tells an entry's kind, and carries the transaction so the screen can open it", async () => {
    const result = await check(ws, input);
    const [first, , , fourth, fifth] = result.matches;
    expect(first?.book[0]?.origin).toBe("transaction");
    expect(first?.book[0]?.transaction?.id).toBe(dinner.id);
    expect(fourth?.book[0]?.origin).toBe("settlement");
    expect(fourth?.book[0]?.transaction).toBeUndefined();
    expect(fifth?.book[0]?.origin).toBe("bill-payment");
    // A bank line is just a line.
    expect(first?.bank[0]?.origin).toBeUndefined();
    expect(result.bookOnly[0]?.transaction?.description).toBe("Café que paguei em dinheiro");
  });

  it("sums both sides over the statement's days, and gives the app's balance at their end", async () => {
    const result = await check(ws, input);
    expect(result.bankCount).toBe(6);
    expect(result.bankTotalCents).toBe(-4_590 + 250_000 - 10_000 + 6_000 - 30_000 - 1_234);
    // Every entry that took part: the five paired (the dinner, booked the day before the
    // statement begins, among them) and the coffee the bank does not have.
    expect(result.bookCount).toBe(6);
    expect(result.bookTotalCents).toBe(-4_590 + 250_000 - 10_000 + 6_000 - 30_000 - 900);
    // So the difference between the two sides is exactly what was left out on each.
    expect(result.bankTotalCents - result.bookTotalCents).toBe(-1_234 - -900);
    // Nothing paired is booked after the statement's last day.
    expect(result.bookedAfterPeriodCents).toBe(0);
    // 100000 − 4590 + 250000 − 10000 + 6000 − 900 − 30000, through the 12th.
    expect(result.closingBalanceCents).toBe(310_510);
  });

  it("counts apart what was paired but is booked after the statement's last day", async () => {
    // Debited on the 12th, booked on the 14th: the bank's balance of the 12th already has it.
    const late = workspace({
      accounts: [account("a", 50_000)],
      transactions: [expense(2_000, "2026-11-10", "Almoço"), expense(8_000, "2026-11-14", "Mercado")],
    });
    const result = await check(late, {
      target: { type: "account", accountId: "a" },
      lines: [line("2026-11-10", -2_000, "RESTAURANTE"), line("2026-11-12", -8_000, "SUPERMERCADO")],
    });
    expect(result.bankOnly).toEqual([]);
    expect(result.bookOnly).toEqual([]);
    expect(result.closingBalanceCents).toBe(48_000);
    expect(result.bookedAfterPeriodCents).toBe(-8_000);
  });

  it("joins the bank lines booked as one entry", async () => {
    const tolls = workspace({
      accounts: [account("a")],
      transactions: [expense(4_440, "2026-11-28", "Pedágios do mês")],
    });
    const result = await check(tolls, {
      target: { type: "account", accountId: "a" },
      lines: [
        line("2026-11-03", -890, "PEDAGIO SEM PARAR 0012"),
        line("2026-11-11", -1_240, "PEDAGIO SEM PARAR 0458"),
        line("2026-11-28", -2_310, "PEDAGIO SEM PARAR 1002"),
      ],
    });
    expect(brief(result)).toEqual([
      "bank-group: PEDAGIO SEM PARAR 0012 + PEDAGIO SEM PARAR 0458 + PEDAGIO SEM PARAR 1002 = Pedágios do mês",
    ]);
    expect(result.bankOnly).toEqual([]);
    expect(result.bookOnly).toEqual([]);
  });

  it("refuses an account that is not the user's", async () => {
    const result = await reconcileWithStatement(stubRepo(ws), "user", {
      ...input,
      target: { type: "account", accountId: "nope" },
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "account_not_found", message: "Carteira não encontrada." },
    });
  });
});

describe("reconcileWithStatement — a card's fatura", () => {
  // Billed in December (bought from 25 Oct to 24 Nov).
  const market = charge(5_000, "2026-11-01", "Mercado");
  const parcela = charge(19_990, "2026-11-14", "Tênis");
  const refund = income(1_500, "2026-11-10", "Estorno da loja", { accountId: null, cardId: "k" });
  const ws = workspace({
    accounts: [account("a")],
    creditCards: [card()],
    transactions: [
      market,
      charge(2_000, "2026-10-30", "Farmácia"),
      parcela,
      refund,
      // November's fatura.
      charge(7_000, "2026-10-10", "Do mês anterior"),
      // December's, with no line in the file.
      charge(3_300, "2026-11-20", "Streaming"),
    ],
    cardBillPayments: [
      {
        id: "pay",
        cardId: "k",
        competence: "2026-11",
        amountCents: 7_000,
        accountId: "a",
        date: "2026-11-02",
      },
    ],
  });
  // The way a CSV export lists a fatura: purchases positive, credits negative, and a parcela with
  // the date of the purchase.
  const lines = [
    line("2026-11-01", 5_000, "MERCADO X"),
    line("2026-10-30", 2_000, "DROGARIA Y"),
    line("2026-08-14", 19_990, "LOJA Z 03/10"),
    line("2026-11-10", -1_500, "ESTORNO LOJA W"),
    line("2026-11-02", -7_000, "PAGAMENTO RECEBIDO"),
    line("2026-11-05", 990, "ANUIDADE"),
  ];

  it("finds the fatura the file belongs to, and reads a purchase as money out whatever its sign", async () => {
    const result = await check(ws, { target: { type: "card", cardId: "k", month: null }, lines });
    expect(result.target).toEqual({ type: "card", id: "k", label: "Nubank · Gold", month: "2026-12" });
    expect(brief(result)).toEqual([
      "exact: LOJA Z 03/10 = Tênis",
      "exact: DROGARIA Y = Farmácia",
      "exact: MERCADO X = Mercado",
      "exact: PAGAMENTO RECEBIDO = Pagamento da fatura",
      "exact: ESTORNO LOJA W = Estorno da loja",
    ]);
    expect(result.bankOnly.map((r) => [r.amountCents, r.label])).toEqual([[-990, "ANUIDADE"]]);
    expect(result.bookOnly.map((r) => [r.amountCents, r.label])).toEqual([[-3_300, "Streaming"]]);
    expect(result.closingBalanceCents).toBeNull();
    // What took part: the five paired and the streaming the file does not have.
    expect(result.bookCount).toBe(6);
    expect(result.bookTotalCents).toBe(-5_000 - 2_000 - 19_990 + 1_500 + 7_000 - 3_300);
    expect(result.bankTotalCents - result.bookTotalCents).toBe(-990 - -3_300);
    expect(result.bookedAfterPeriodCents).toBe(0);
  });

  it("compares with the fatura it is told to", async () => {
    const result = await check(ws, { target: { type: "card", cardId: "k", month: "2026-11" }, lines });
    expect(result.target).toMatchObject({ month: "2026-11" });
    expect(brief(result)).toEqual(["exact: PAGAMENTO RECEBIDO = Pagamento da fatura"]);
    expect(result.bookOnly.map((r) => r.label)).toEqual(["Do mês anterior"]);
  });

  it("does not report a fatura payment the file does not list", async () => {
    const result = await check(ws, {
      target: { type: "card", cardId: "k", month: "2026-12" },
      lines: lines.filter((l) => l.description !== "PAGAMENTO RECEBIDO"),
    });
    expect(result.bookOnly.map((r) => r.label)).toEqual(["Streaming"]);
  });

  it("refuses a card that is not the user's", async () => {
    const result = await reconcileWithStatement(stubRepo(ws), "user", {
      target: { type: "card", cardId: "nope", month: null },
      lines,
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "card_not_found", message: "Cartão não encontrado." },
    });
  });
});
