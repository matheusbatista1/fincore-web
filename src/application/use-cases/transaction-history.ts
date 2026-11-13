import type { Transaction } from "@/domain/entities/transaction";
import type { TransactionEventKind } from "@/domain/entities/transaction-event";
import {
  changedFields,
  diffTransactions,
  type TransactionChange,
  type TransactionFieldChange,
} from "@/domain/services/transaction-history";
import type { CreateTransactionCommand, FinanceRepository, Workspace } from "../ports/finance-repository";

/** Where a failure to keep the history is reported: it never reaches the user's write. */
export type HistoryReport = (message: string, error: unknown) => void;

const toServerLog: HistoryReport = (message, error) => {
  console.error(message, error);
};

/**
 * A write being watched so its effect on the user's transactions can be recorded in their history
 * ("Histórico de alterações").
 */
export interface TransactionWatch {
  /**
   * The repository to hand to the write. It behaves exactly like the one it wraps; it only takes
   * note of the first reading of the workspace (the book before the write) and of the ids of the
   * transactions created through it.
   */
  readonly repo: FinanceRepository;
  /**
   * Take the "before" reading now, for a write that reads nothing itself (a delete, an undo).
   * Never throws: without a reading the write still happens, only its history is not kept.
   */
  snapshot(userId: string): Promise<void>;
  /**
   * Read the book again, compare, and add what changed to the history under `action` ("edit",
   * "pay", "import"…). Call it once the write is done. Never throws; resolves to the number of
   * entries recorded.
   */
  record(userId: string, action: string): Promise<number>;
}

/**
 * Watch a write for the history, without the write having to know.
 *
 * Every write path of the app (a form, a payment, an import, a rolled debt, the fixed entries of
 * the month…) ends up changing rows the same way, so instead of each one reporting what it did,
 * the book is read before and after and the two readings are compared
 * ({@link diffTransactions}). Most writes already read the workspace before touching anything:
 * that first reading IS the "before", at no extra cost. A write that only creates rows needs none —
 * the ids it gets back say which rows are new.
 *
 * The history is kept on a best-effort basis by design: a failure here is reported and swallowed,
 * so it can never fail, undo or slow down the write it describes.
 */
export function watchTransactions(
  repo: FinanceRepository,
  report: HistoryReport = toServerLog,
): TransactionWatch {
  let before: readonly Transaction[] | null = null;
  const created = new Set<string>();

  const watched = new Proxy(repo, {
    get(target, property) {
      if (property === "loadWorkspace") {
        return async (userId: string): Promise<Workspace> => {
          const workspace = await target.loadWorkspace(userId);
          before ??= workspace.transactions;
          return workspace;
        };
      }
      if (property === "createTransaction") {
        return async (userId: string, command: CreateTransactionCommand): Promise<string[]> => {
          const ids = await target.createTransaction(userId, command);
          if (Array.isArray(ids)) for (const id of ids) created.add(id);
          return ids;
        };
      }
      if (property === "createTransactionReturningId") {
        return async (userId: string, command: CreateTransactionCommand): Promise<string> => {
          const id = await target.createTransactionReturningId(userId, command);
          created.add(id);
          return id;
        };
      }
      // Everything else goes straight to the repository, bound to it (its methods use `this`).
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return {
    repo: watched,

    async snapshot(userId) {
      if (before !== null) return;
      try {
        before = (await repo.loadWorkspace(userId)).transactions;
      } catch (error) {
        report("transaction history: could not read the book before the write", error);
      }
    },

    async record(userId, action) {
      const earlier = before;
      if (earlier === null && created.size === 0) return 0;
      try {
        const now = (await repo.loadWorkspace(userId)).transactions;
        const changes: TransactionChange[] =
          earlier !== null
            ? diffTransactions(earlier, now)
            : now
                .filter((tx) => created.has(tx.id))
                .map((tx) => ({ transactionId: tx.id, kind: "created", before: null, after: tx }));
        if (changes.length === 0) return 0;
        await repo.recordTransactionEvents(
          userId,
          changes.map((change) => ({ ...change, action })),
        );
        return changes.length;
      } catch (error) {
        report("transaction history: could not record what changed", error);
        return 0;
      }
    },
  };
}

/** One entry of a transaction's history, ready for a screen. */
export interface TransactionHistoryEntry {
  readonly id: string;
  readonly kind: TransactionEventKind;
  /** What was being done ("edit", "pay", "import"…): the screen words it, or falls back to the kind. */
  readonly action: string;
  /** When it was recorded: an ISO instant. */
  readonly at: string;
  /**
   * For a change: the fields that differ, in reading order, each with its value before and after
   * (ids are left for the screen to name). Empty for a creation or a removal.
   */
  readonly changes: readonly TransactionFieldChange[];
}

/** Two recorded versions of a transaction are the same when nothing a person edits differs. */
const sameVersion = (a: Transaction | null, b: Transaction | null): boolean =>
  a === null || b === null ? a === b : changedFields(a, b).length === 0;

/**
 * The history of one transaction, the most recent entry first.
 *
 * Two writes that end almost together can both report the same new state; such a repeat reads as
 * one entry (the earlier one). A change with nothing to show is left out.
 */
export async function getTransactionHistory(
  repo: FinanceRepository,
  userId: string,
  transactionId: string,
): Promise<TransactionHistoryEntry[]> {
  const events = await repo.listTransactionEvents(userId, transactionId);
  const entries: TransactionHistoryEntry[] = [];
  for (const [index, event] of events.entries()) {
    const older = events[index + 1];
    if (older !== undefined && older.kind === event.kind && sameVersion(older.after, event.after)) continue;
    const changes =
      event.kind === "updated" && event.before !== null && event.after !== null
        ? changedFields(event.before, event.after)
        : [];
    if (event.kind === "updated" && changes.length === 0) continue;
    entries.push({
      id: event.id,
      kind: event.kind,
      action: event.action,
      at: event.at.toISOString(),
      changes,
    });
  }
  return entries;
}
