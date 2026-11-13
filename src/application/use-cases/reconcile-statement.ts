import { isCardCredit, isExpense, isRolled } from "@/domain/entities/transaction";
import {
  type BalanceMovementOrigin,
  computeAccountBalances,
  forEachBalanceMovement,
} from "@/domain/services/balance.calculator";
import { billingCompetence } from "@/domain/services/card-bill.calculator";
import {
  type Reconciliation,
  type ReconLine,
  type ReconMatchKind,
  reconcileStatement,
} from "@/domain/services/statement-reconciliation";
import {
  addDays,
  addMonths,
  type CompetenceMonth,
  type IsoDate,
  monthOf,
} from "@/domain/value-objects/competence-month";
import { partitionCardLines } from "@/shared/import/card-lines";
import { err, ok, type Result } from "@/shared/result";
import type { ReconcileStatementInput } from "@/shared/schemas/reconcile";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { createTransactionMapper, type TransactionListItem } from "./get-transactions";

/**
 * How many days a bank line and its entry may be apart on an account: a purchase booked on the
 * day it was made and debited after a weekend or a holiday.
 */
const ACCOUNT_DAY_GAP = 4;
/**
 * A fatura's lines all belong to it, whatever their date (a parcela carries the date of the
 * purchase), so one line pairs with one charge on amount alone. Lines booked together as one
 * charge were bought together, so a group still has to be near it.
 */
const FATURA_RULES = { maxDayGap: null, groupDayGap: ACCOUNT_DAY_GAP } as const;
/** A fatura's file shows the payment of the one before it; the day may be off by a little. */
const PAYMENT_DAY_GAP = 5;
/** Faturas tried, around the month of the file's last line, when the caller names none. */
const FATURA_SEARCH = { before: 1, after: 2 } as const;

/** One line of either side, as the screen shows it. */
export interface ReconcileRow {
  readonly id: string;
  readonly date: IsoDate;
  /** Signed: money leaving the account (or charged to the card) is negative. */
  readonly amountCents: number;
  /** The bank's description, or the entry's own. */
  readonly label: string;
  /** An entry of the app: what kind of row it is. Absent on a bank line. */
  readonly origin?: "transaction" | "settlement" | "bill-payment";
  /** The transaction behind an entry, so the screen can open it. */
  readonly transaction?: TransactionListItem;
}

export interface ReconcileMatch {
  readonly kind: ReconMatchKind;
  readonly bank: readonly ReconcileRow[];
  readonly book: readonly ReconcileRow[];
}

export interface ReconcileResult {
  readonly target:
    | { readonly type: "account"; readonly id: string; readonly label: string }
    | {
        readonly type: "card";
        readonly id: string;
        readonly label: string;
        /** The fatura compared (its due month): the one asked for, or the one found. */
        readonly month: CompetenceMonth;
      };
  /** The first and the last day of the file's lines. */
  readonly period: { readonly from: IsoDate; readonly to: IsoDate };
  readonly matches: readonly ReconcileMatch[];
  /** In the file, not in the app. */
  readonly bankOnly: readonly ReconcileRow[];
  /** In the app, not in the file. */
  readonly bookOnly: readonly ReconcileRow[];
  readonly bankCount: number;
  readonly bankTotalCents: number;
  /**
   * The app's entries that took part: each one paired with a line of the file, and those the file
   * should have and does not. So `bankTotalCents − bookTotalCents` is, to the cent, what was left
   * out on the bank's side minus what was left out on the app's.
   */
  readonly bookCount: number;
  readonly bookTotalCents: number;
  /** An account's balance in the app at the end of the period's last day; `null` for a card. */
  readonly closingBalanceCents: number | null;
  /**
   * Entries paired with a line of the file but dated after its last day: the bank's balance on
   * that day already has them, the app's does not yet. Zero for a card.
   */
  readonly bookedAfterPeriodCents: number;
}

export interface ReconcileStatementError {
  readonly code: "account_not_found" | "card_not_found";
  readonly message: string;
}

/** An entry of the app, with what the screen needs to open it. */
interface BookRow extends ReconLine {
  readonly origin: "transaction" | "settlement" | "bill-payment";
  readonly transactionId: string | null;
}

/**
 * "Conferir com o extrato": compares the lines of a statement file with what is booked for one
 * account, or for one fatura of a card, and says what matches, what the app is missing and what the
 * app has that the bank does not. Read-only — it never creates or changes anything.
 *
 * Lines are matched by amount and date, never by name (see `statement-reconciliation`).
 */
export async function reconcileWithStatement(
  repo: FinanceRepository,
  userId: string,
  input: ReconcileStatementInput,
): Promise<Result<ReconcileResult, ReconcileStatementError>> {
  const ws = await loadWorkspaceCached(repo, userId);
  const dates = input.lines.map((line) => line.date).sort();
  const period = { from: dates[0] as IsoDate, to: dates[dates.length - 1] as IsoDate };
  const mapTx = createTransactionMapper(ws);
  const txById = new Map(ws.transactions.map((tx) => [tx.id, tx]));

  const toRow = (line: ReconLine): ReconcileRow => {
    const book = line as Partial<BookRow>;
    if (book.origin === undefined) {
      return { id: line.id, date: line.date, amountCents: line.amountCents, label: line.label };
    }
    const tx = book.transactionId ? txById.get(book.transactionId) : undefined;
    return {
      id: line.id,
      date: line.date,
      amountCents: line.amountCents,
      label: line.label,
      origin: book.origin,
      ...(tx ? { transaction: mapTx(tx) } : {}),
    };
  };
  const present = (
    reconciliation: Reconciliation,
    expected: readonly BookRow[],
    bank: readonly ReconLine[],
  ): Pick<
    ReconcileResult,
    "matches" | "bankOnly" | "bookOnly" | "bankCount" | "bankTotalCents" | "bookCount" | "bookTotalCents"
  > => {
    const expectedIds = new Set(expected.map((row) => row.id));
    // An entry the file was not expected to list (just outside its days, a payment not every bank
    // shows) was only there to be paired: left alone, it is no news.
    const bookOnly = reconciliation.bookOnly.filter((row) => expectedIds.has(row.id));
    const counted = [...reconciliation.matches.flatMap((match) => match.book), ...bookOnly];
    return {
      matches: reconciliation.matches.map((match) => ({
        kind: match.kind,
        bank: match.bank.map(toRow),
        book: match.book.map(toRow),
      })),
      bankOnly: reconciliation.bankOnly.map(toRow),
      bookOnly: bookOnly.map(toRow),
      bankCount: bank.length,
      bankTotalCents: bank.reduce((sum, line) => sum + line.amountCents, 0),
      bookCount: counted.length,
      bookTotalCents: counted.reduce((sum, row) => sum + row.amountCents, 0),
    };
  };

  if (input.target.type === "account") {
    const { accountId } = input.target;
    const account = ws.accounts.find((a) => a.id === accountId);
    if (!account) return err({ code: "account_not_found", message: "Carteira não encontrada." });

    const bank: ReconLine[] = input.lines.map((line, i) => ({
      id: `b${i}`,
      date: line.date,
      amountCents: line.amountCents,
      label: line.description,
    }));
    const book = accountRows(
      ws,
      accountId,
      addDays(period.from, -ACCOUNT_DAY_GAP),
      addDays(period.to, ACCOUNT_DAY_GAP),
    );
    const expected = book.filter((row) => row.date >= period.from && row.date <= period.to);
    const closing = computeAccountBalances(
      [account],
      ws.transactions,
      period.to,
      "general",
      ws.settlements,
      ws.cardBillPayments,
    ).get(accountId);
    const reconciliation = reconcileStatement(bank, book, { maxDayGap: ACCOUNT_DAY_GAP });
    return ok({
      target: { type: "account", id: accountId, label: `${account.bank} · ${account.name}` },
      period,
      ...present(reconciliation, expected, bank),
      closingBalanceCents: closing?.cents ?? account.openingBalanceCents,
      bookedAfterPeriodCents: reconciliation.matches
        .flatMap((match) => match.book)
        .filter((row) => row.date > period.to)
        .reduce((sum, row) => sum + row.amountCents, 0),
    });
  }

  const { cardId } = input.target;
  const card = ws.creditCards.find((c) => c.id === cardId);
  if (!card) return err({ code: "card_not_found", message: "Cartão não encontrado." });

  // Whether a purchase is positive or negative depends on the bank's file: the sign most lines
  // have is the purchases'. Here a purchase is always money out.
  const charges = new Set(partitionCardLines(input.lines).charges);
  const bank: ReconLine[] = input.lines.map((line, i) => ({
    id: `b${i}`,
    date: line.date,
    amountCents: charges.has(line) ? -Math.abs(line.amountCents) : Math.abs(line.amountCents),
    label: line.description,
  }));
  const compare = (month: CompetenceMonth) => {
    const book = faturaRows(
      ws,
      cardId,
      month,
      addDays(period.from, -PAYMENT_DAY_GAP),
      addDays(period.to, PAYMENT_DAY_GAP),
    );
    return { month, book, reconciliation: reconcileStatement(bank, book, FATURA_RULES) };
  };
  const matched = (reconciliation: Reconciliation): number =>
    reconciliation.matches.reduce(
      (count, match) => count + (match.kind === "bank-cancel" ? 0 : match.bank.length),
      0,
    );

  let chosen = compare(input.target.month ?? monthOf(period.to));
  if (input.target.month === null) {
    // The fatura the file belongs to: the one most of its lines are booked in.
    const around = monthOf(period.to);
    for (let step = -FATURA_SEARCH.before; step <= FATURA_SEARCH.after; step++) {
      const candidate = compare(addMonths(around, step));
      if (matched(candidate.reconciliation) > matched(chosen.reconciliation)) chosen = candidate;
    }
  }
  // The payment of an earlier fatura is only there to be paired: not every bank lists it, so one
  // the file does not have is no news.
  const expected = chosen.book.filter((row) => row.origin !== "bill-payment");
  return ok({
    target: { type: "card", id: cardId, label: `${card.bank} · ${card.product}`, month: chosen.month },
    period,
    ...present(chosen.reconciliation, expected, bank),
    closingBalanceCents: null,
    bookedAfterPeriodCents: 0,
  });
}

/** Everything that moved `accountId` between two days: one row per entry and day. */
function accountRows(ws: Workspace, accountId: string, from: IsoDate, to: IsoDate): BookRow[] {
  const personName = new Map(ws.people.map((p) => [p.id, p.name]));
  const cardBank = new Map(ws.creditCards.map((c) => [c.id, c.bank]));
  const rowOf = (origin: BalanceMovementOrigin): Omit<BookRow, "date" | "amountCents"> => {
    if (origin.kind === "transaction") {
      const tx = origin.transaction;
      return { id: `t:${tx.id}`, label: tx.description, origin: "transaction", transactionId: tx.id };
    }
    if (origin.kind === "settlement") {
      const name = personName.get(origin.settlement.personId);
      return {
        id: `s:${origin.settlement.id}`,
        label: name ? `Acerto com ${name}` : "Acerto",
        origin: "settlement",
        transactionId: null,
      };
    }
    const bank = cardBank.get(origin.payment.cardId);
    return {
      id: `p:${origin.payment.id}`,
      label: bank ? `Fatura ${bank}` : "Fatura",
      origin: "bill-payment",
      transactionId: null,
    };
  };

  const rows = new Map<string, { row: Omit<BookRow, "amountCents">; cents: number }>();
  forEachBalanceMovement(
    {
      transactions: ws.transactions,
      settlements: ws.settlements,
      cardBillPayments: ws.cardBillPayments,
      lens: "general",
      upToDate: to,
    },
    (id) => id === accountId,
    (date, _accountId, delta, origin) => {
      if (date < from) return;
      const described = rowOf(origin);
      const key = `${described.id}:${date}`;
      const entry = rows.get(key) ?? { row: { ...described, id: key, date }, cents: 0 };
      entry.cents += delta.cents;
      rows.set(key, entry);
    },
  );
  return [...rows.values()]
    .filter((entry) => entry.cents !== 0)
    .map((entry) => ({ ...entry.row, amountCents: entry.cents }));
}

/**
 * What a fatura's file should list: the card's charges and credits billed in `month`, and the
 * payment of an earlier fatura made around the file's days (banks list it as a credit).
 */
function faturaRows(
  ws: Workspace,
  cardId: string,
  month: CompetenceMonth,
  from: IsoDate,
  to: IsoDate,
): BookRow[] {
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const rows: BookRow[] = [];
  for (const tx of ws.transactions) {
    if (isExpense(tx) && tx.source === "card" && tx.cardId === cardId && !isRolled(tx)) {
      if (competenceOf(tx) !== month) continue;
      rows.push({
        id: `t:${tx.id}`,
        date: tx.date,
        amountCents: -Math.abs(tx.amountCents),
        label: tx.description,
        origin: "transaction",
        transactionId: tx.id,
      });
    } else if (isCardCredit(tx) && tx.cardId === cardId) {
      if (competenceOf(tx) !== month) continue;
      rows.push({
        id: `t:${tx.id}`,
        date: tx.date,
        amountCents: Math.abs(tx.amountCents),
        label: tx.description,
        origin: "transaction",
        transactionId: tx.id,
      });
    }
  }
  for (const payment of ws.cardBillPayments) {
    if (payment.cardId !== cardId || payment.date < from || payment.date > to) continue;
    rows.push({
      id: `p:${payment.id}`,
      date: payment.date,
      amountCents: Math.abs(payment.amountCents),
      label: "Pagamento da fatura",
      origin: "bill-payment",
      transactionId: null,
    });
  }
  return rows.filter((row) => row.amountCents !== 0);
}
