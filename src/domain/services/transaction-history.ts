/**
 * transaction-history — what changed in a user's book between two readings of it.
 *
 * Pure: it compares two lists of transactions and says which rows appeared, which are gone and,
 * for the ones still there, which of the things a person edits are now different. The history of a
 * transaction is built by taking such a reading before and after every write, so no write path has
 * to remember to report what it did.
 *
 * Only what a person can change counts. A parcela's status ("paga", "atual", "futura") and the
 * user's own share move on their own (the calendar, the split), so a row that differs in nothing
 * else did not change.
 */

import type {
  ExpenseSource,
  ExpenseTransaction,
  IncomeTransaction,
  Transaction,
  TransactionSplit,
  TransferTransaction,
} from "../entities/transaction";
import type { TransactionEventKind } from "../entities/transaction-event";
import type { CompetenceMonth, IsoDate } from "../value-objects/competence-month";

/** One transaction that is not the same in the two readings. */
export interface TransactionChange {
  readonly transactionId: string;
  readonly kind: TransactionEventKind;
  /** The row as it was; null when it did not exist yet. */
  readonly before: Transaction | null;
  /** The row as it is now; null when it is gone. */
  readonly after: Transaction | null;
}

/** The things a person edits in a transaction, in the order a history lists them. */
export const TRANSACTION_FIELDS = [
  "description",
  "amount",
  "date",
  "category",
  "source",
  "card",
  "account",
  "linkedAccount",
  "transferFrom",
  "transferTo",
  "fromPerson",
  "reimbursement",
  "splits",
  "recurrence",
  "billMonth",
  "payment",
  "receipt",
  "rolled",
  "note",
] as const;

export type TransactionField = (typeof TRANSACTION_FIELDS)[number];

/** What a field held, typed so a screen can format it (money, a date, a name to look up…). */
export type HistoryValue =
  | { readonly type: "none" }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "money"; readonly cents: number }
  | { readonly type: "date"; readonly date: IsoDate }
  | { readonly type: "month"; readonly month: CompetenceMonth }
  /** Fixed every month, on this day. */
  | { readonly type: "day"; readonly day: number }
  | { readonly type: "flag"; readonly on: boolean }
  | { readonly type: "source"; readonly source: ExpenseSource }
  /** Another record, by id: the reader resolves its name. */
  | {
      readonly type: "ref";
      readonly entity: "account" | "card" | "category" | "person";
      readonly id: string;
    }
  /** Who shares the expense, and for how much. */
  | { readonly type: "splits"; readonly splits: readonly TransactionSplit[] }
  /** A payment made or a receipt: the day, the account and the amount that moved. */
  | {
      readonly type: "settled";
      readonly date: IsoDate;
      readonly accountId: string | null;
      readonly cents: number | null;
    };

/** One field that differs between two versions of a transaction. */
export interface TransactionFieldChange {
  readonly field: TransactionField;
  readonly before: HistoryValue;
  readonly after: HistoryValue;
}

const NONE: HistoryValue = { type: "none" };

const text = (value: string | null | undefined): HistoryValue =>
  value == null || value === "" ? NONE : { type: "text", text: value };

const money = (cents: number): HistoryValue => ({ type: "money", cents });

const date = (value: IsoDate | null | undefined): HistoryValue =>
  value == null ? NONE : { type: "date", date: value };

const ref = (
  entity: "account" | "card" | "category" | "person",
  id: string | null | undefined,
): HistoryValue => (id == null ? NONE : { type: "ref", entity, id });

const fixedOn = (recurrence: { readonly dayOfMonth: number } | null | undefined): HistoryValue =>
  recurrence == null ? NONE : { type: "day", day: recurrence.dayOfMonth };

const settled = (
  on: IsoDate | null | undefined,
  accountId: string | null | undefined,
  cents: number | null | undefined,
): HistoryValue =>
  on == null ? NONE : { type: "settled", date: on, accountId: accountId ?? null, cents: cents ?? null };

/** The same people in the same order whatever order the rows were read in. */
const shares = (splits: readonly TransactionSplit[] | null | undefined): HistoryValue => {
  if (splits == null || splits.length === 0) return NONE;
  const sorted = splits
    .map((split) => ({ personId: split.personId, shareCents: split.shareCents }))
    .sort((a, b) => (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0));
  return { type: "splits", splits: sorted };
};

type Facts = Partial<Record<TransactionField, HistoryValue>>;

const expenseFacts = (tx: ExpenseTransaction): Facts => ({
  description: text(tx.description),
  amount: money(Math.abs(tx.amountCents)),
  date: date(tx.date),
  category: ref("category", tx.categoryId),
  source: { type: "source", source: tx.source },
  card: ref("card", tx.cardId),
  account: ref("account", tx.accountId),
  linkedAccount: ref("account", tx.linkedAccountId),
  splits: shares(tx.splits),
  recurrence: fixedOn(tx.recurrence),
  billMonth: tx.billMonthOverride == null ? NONE : { type: "month", month: tx.billMonthOverride },
  payment: settled(tx.paidAt, tx.paidAccountId, tx.paidAmountCents),
  rolled: date(tx.rolledAt),
  note: text(tx.note),
});

const incomeFacts = (tx: IncomeTransaction): Facts => ({
  description: text(tx.description),
  amount: money(Math.abs(tx.amountCents)),
  date: date(tx.date),
  card: ref("card", tx.cardId),
  account: ref("account", tx.accountId),
  fromPerson: ref("person", tx.fromPersonId),
  reimbursement: { type: "flag", on: tx.isReimbursement === true },
  recurrence: fixedOn(tx.recurrence),
  receipt: settled(tx.receivedAt, tx.receivedAccountId, tx.receivedAmountCents),
  note: text(tx.note),
});

const transferFacts = (tx: TransferTransaction): Facts => ({
  description: text(tx.description),
  amount: money(Math.abs(tx.valueCents)),
  date: date(tx.date),
  transferFrom: ref("account", tx.fromAccountId),
  transferTo: ref("account", tx.toAccountId),
  note: text(tx.note),
});

const factsOf = (tx: Transaction): Facts =>
  tx.kind === "expense" ? expenseFacts(tx) : tx.kind === "income" ? incomeFacts(tx) : transferFacts(tx);

/** Values are built here with their keys always in the same order, so their text compares them. */
const same = (a: HistoryValue, b: HistoryValue): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The fields that differ between two versions of a transaction, in the order of
 * {@link TRANSACTION_FIELDS}. A field one version does not have (a transfer has no category) reads
 * as "none" there. Empty when nothing a person edits is different.
 */
export function changedFields(before: Transaction, after: Transaction): TransactionFieldChange[] {
  const was = factsOf(before);
  const is = factsOf(after);
  const changes: TransactionFieldChange[] = [];
  for (const field of TRANSACTION_FIELDS) {
    const from = was[field] ?? NONE;
    const to = is[field] ?? NONE;
    if (!same(from, to)) changes.push({ field, before: from, after: to });
  }
  return changes;
}

/**
 * What is different between two readings of the same user's transactions: the rows that appeared
 * and the rows that changed, in the order of `after`, then the rows that are gone, in the order of
 * `before`. A row whose editable fields are all the same is not listed.
 */
export function diffTransactions(
  before: readonly Transaction[],
  after: readonly Transaction[],
): TransactionChange[] {
  const earlier = new Map(before.map((tx) => [tx.id, tx]));
  const changes: TransactionChange[] = [];
  for (const tx of after) {
    const was = earlier.get(tx.id);
    if (was === undefined) {
      changes.push({ transactionId: tx.id, kind: "created", before: null, after: tx });
      continue;
    }
    earlier.delete(tx.id);
    if (changedFields(was, tx).length > 0) {
      changes.push({ transactionId: tx.id, kind: "updated", before: was, after: tx });
    }
  }
  for (const tx of earlier.values()) {
    changes.push({ transactionId: tx.id, kind: "deleted", before: tx, after: null });
  }
  return changes;
}
