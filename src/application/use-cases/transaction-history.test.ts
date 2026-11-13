import { describe, expect, it, vi } from "vitest";
import type { ExpenseTransaction, Transaction } from "@/domain/entities/transaction";
import type { TransactionEvent } from "@/domain/entities/transaction-event";
import type {
  CreateTransactionCommand,
  FinanceRepository,
  TransactionEventData,
  Workspace,
} from "../ports/finance-repository";
import { getTransactionHistory, watchTransactions } from "./transaction-history";

const expense = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: "t1",
  kind: "expense",
  description: "Mercado",
  date: "2026-11-10",
  amountCents: -5000,
  categoryId: null,
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

const workspaceOf = (transactions: Transaction[]): Workspace => ({
  accounts: [],
  creditCards: [],
  people: [],
  categories: [],
  transactions,
  settlements: [],
  budgets: [],
  goals: [],
  cardBillDates: [],
  cardBillPayments: [],
});

const NO_COMMAND: CreateTransactionCommand = { entries: [] };

/**
 * A repository holding a book in memory: `book` is what the next reading returns, and every history
 * entry recorded lands in `recorded`.
 */
function memoryRepo(initial: Transaction[]) {
  const state = { book: initial, loads: 0 };
  const recorded: TransactionEventData[] = [];
  const repo = {
    marker: "the real one",
    loadWorkspace: vi.fn(async () => {
      state.loads += 1;
      return workspaceOf(state.book);
    }),
    createTransaction: vi.fn(async () => {
      const id = `new-${state.book.length}`;
      state.book = [...state.book, expense({ id })];
      return [id];
    }),
    createTransactionReturningId: vi.fn(async () => {
      state.book = [...state.book, expense({ id: "booked" })];
      return "booked";
    }),
    deleteTransaction: vi.fn(async (_userId: string, id: string) => {
      state.book = state.book.filter((tx) => tx.id !== id);
      return 1;
    }),
    recordTransactionEvents: vi.fn(async (_userId: string, events: readonly TransactionEventData[]) => {
      recorded.push(...events);
    }),
    /** A method that depends on `this`, like the real repository's. */
    whoAmI(this: { marker: string }) {
      return this.marker;
    },
  };
  return { repo: repo as unknown as FinanceRepository & { whoAmI(): string }, raw: repo, state, recorded };
}

describe("watchTransactions", () => {
  it("uses the write's own first reading as the 'before', and records what differs afterwards", async () => {
    const { repo, raw, state, recorded } = memoryRepo([expense(), expense({ id: "t2" })]);
    const report = vi.fn();
    const watch = watchTransactions(repo, report);

    // The write: reads the book, edits one row, removes another, adds one.
    const seen = await watch.repo.loadWorkspace("u");
    expect(seen.transactions).toHaveLength(2);
    state.book = [expense({ amountCents: -6000 }), expense({ id: "t3" })];

    expect(await watch.record("u", "edit")).toBe(3);
    expect(recorded.map((e) => [e.transactionId, e.kind, e.action])).toEqual([
      ["t1", "updated", "edit"],
      ["t3", "created", "edit"],
      ["t2", "deleted", "edit"],
    ]);
    expect(recorded[0]).toMatchObject({
      before: { amountCents: -5000 },
      after: { amountCents: -6000 },
    });
    expect(recorded[2]).toMatchObject({ before: { id: "t2" }, after: null });
    // One reading by the write, one to compare: nothing extra.
    expect(raw.loadWorkspace).toHaveBeenCalledTimes(2);
    expect(report).not.toHaveBeenCalled();
  });

  it("keeps the FIRST reading: a later one by the same write does not move the baseline", async () => {
    const { repo, state, recorded } = memoryRepo([expense()]);
    const watch = watchTransactions(repo);
    await watch.repo.loadWorkspace("u");
    state.book = [expense({ description: "Feira" })];
    await watch.repo.loadWorkspace("u");
    expect(await watch.record("u", "edit")).toBe(1);
    expect(recorded[0]).toMatchObject({ kind: "updated", before: { description: "Mercado" } });
  });

  it("needs no 'before' for a write that only creates: the ids it gets back say which rows are new", async () => {
    const { repo, raw, recorded } = memoryRepo([expense()]);
    const watch = watchTransactions(repo);

    expect(await watch.repo.createTransaction("u", NO_COMMAND)).toEqual(["new-1"]);
    expect(await watch.repo.createTransactionReturningId("u", NO_COMMAND)).toBe("booked");
    // Nothing was read before the write…
    expect(raw.loadWorkspace).not.toHaveBeenCalled();

    expect(await watch.record("u", "import")).toBe(2);
    expect(recorded.map((e) => [e.transactionId, e.kind, e.action, e.before])).toEqual([
      ["new-1", "created", "import", null],
      ["booked", "created", "import", null],
    ]);
    expect(recorded[0]?.after).toMatchObject({ id: "new-1" });
    // …and only once after it.
    expect(raw.loadWorkspace).toHaveBeenCalledTimes(1);
  });

  it("tolerates a repository that answers a creation with nothing", async () => {
    const { repo, raw } = memoryRepo([]);
    raw.createTransaction.mockResolvedValueOnce(undefined as unknown as string[]);
    const watch = watchTransactions(repo);
    await watch.repo.createTransaction("u", NO_COMMAND);
    expect(await watch.record("u", "create")).toBe(0);
    expect(raw.loadWorkspace).not.toHaveBeenCalled();
  });

  it("takes the 'before' itself for a write that reads nothing", async () => {
    const { repo, raw, recorded } = memoryRepo([expense(), expense({ id: "t2" })]);
    const watch = watchTransactions(repo);
    await watch.snapshot("u");
    await watch.snapshot("u"); // already taken: not read again
    expect(raw.loadWorkspace).toHaveBeenCalledTimes(1);

    expect(await watch.repo.deleteTransaction("u", "t2", "one")).toBe(1);
    expect(await watch.record("u", "delete")).toBe(1);
    expect(recorded).toEqual([
      { transactionId: "t2", kind: "deleted", action: "delete", before: expense({ id: "t2" }), after: null },
    ]);
  });

  it("records nothing when nothing changed, and reads nothing when it has nothing to compare", async () => {
    const quiet = memoryRepo([expense()]);
    const watching = watchTransactions(quiet.repo);
    await watching.repo.loadWorkspace("u");
    expect(await watching.record("u", "edit")).toBe(0);
    expect(quiet.raw.recordTransactionEvents).not.toHaveBeenCalled();

    const blind = memoryRepo([expense()]);
    expect(await watchTransactions(blind.repo).record("u", "edit")).toBe(0);
    expect(blind.raw.loadWorkspace).not.toHaveBeenCalled();
  });

  it("hands every other call to the repository itself", async () => {
    const { repo } = memoryRepo([]);
    const watch = watchTransactions(repo);
    expect((watch.repo as typeof repo).whoAmI()).toBe("the real one");
    expect((watch.repo as unknown as { marker: string }).marker).toBe("the real one");
  });

  it("never lets the history fail the write: a failure is reported and swallowed", async () => {
    const report = vi.fn();

    // The reading taken for the write fails: the write goes on, with no history.
    const first = memoryRepo([expense()]);
    first.raw.loadWorkspace.mockRejectedValueOnce(new Error("database away"));
    const unread = watchTransactions(first.repo, report);
    await expect(unread.snapshot("u")).resolves.toBeUndefined();
    expect(await unread.record("u", "delete")).toBe(0);
    expect(report).toHaveBeenCalledTimes(1);

    // The reading afterwards fails.
    const second = memoryRepo([expense()]);
    const unreadAfter = watchTransactions(second.repo, report);
    await unreadAfter.snapshot("u");
    second.raw.loadWorkspace.mockRejectedValueOnce(new Error("database away"));
    expect(await unreadAfter.record("u", "delete")).toBe(0);
    expect(report).toHaveBeenCalledTimes(2);

    // The history table refuses the rows (say, its migration was not applied yet).
    const third = memoryRepo([expense()]);
    third.raw.recordTransactionEvents.mockRejectedValueOnce(new Error("relation does not exist"));
    const unwritten = watchTransactions(third.repo, report);
    await unwritten.snapshot("u");
    third.state.book = [];
    expect(await unwritten.record("u", "delete")).toBe(0);
    expect(report).toHaveBeenCalledTimes(3);
    expect(report.mock.calls.map((call) => call[1])).toEqual([
      expect.any(Error),
      expect.any(Error),
      expect.any(Error),
    ]);
  });

  it("reports to the server log when no reporter is given", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { repo, raw } = memoryRepo([]);
    raw.loadWorkspace.mockRejectedValueOnce(new Error("database away"));
    await watchTransactions(repo).snapshot("u");
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("lets a failing write fail as it would have", async () => {
    const { repo, raw } = memoryRepo([expense()]);
    raw.deleteTransaction.mockRejectedValueOnce(new Error("constraint"));
    const watch = watchTransactions(repo);
    await expect(watch.repo.deleteTransaction("u", "t1", "one")).rejects.toThrow("constraint");
  });
});

describe("getTransactionHistory", () => {
  const event = (over: Partial<TransactionEvent>): TransactionEvent => ({
    id: "e",
    transactionId: "t1",
    kind: "updated",
    action: "edit",
    before: expense(),
    after: expense(),
    at: new Date("2026-11-12T21:40:00Z"),
    ...over,
  });
  const repoWith = (events: TransactionEvent[]) => {
    const listTransactionEvents = vi.fn(async () => events);
    return { repo: { listTransactionEvents } as unknown as FinanceRepository, listTransactionEvents };
  };

  it("lists the entries as recorded, the most recent first, with what changed in each", async () => {
    const paid = expense({ amountCents: -6000, paidAt: "2026-11-12", paidAccountId: "acc-1" });
    const { repo, listTransactionEvents } = repoWith([
      event({ id: "e3", action: "pay", before: expense({ amountCents: -6000 }), after: paid }),
      event({ id: "e2", after: expense({ amountCents: -6000 }), at: new Date("2026-11-11T12:00:00Z") }),
      event({
        id: "e1",
        kind: "created",
        action: "create",
        before: null,
        at: new Date("2026-11-10T09:00:00Z"),
      }),
    ]);
    const history = await getTransactionHistory(repo, "u", "t1");
    expect(listTransactionEvents).toHaveBeenCalledWith("u", "t1");
    expect(history.map((entry) => [entry.id, entry.kind, entry.action, entry.at])).toEqual([
      ["e3", "updated", "pay", "2026-11-12T21:40:00.000Z"],
      ["e2", "updated", "edit", "2026-11-11T12:00:00.000Z"],
      ["e1", "created", "create", "2026-11-10T09:00:00.000Z"],
    ]);
    expect(history[0]?.changes).toEqual([
      {
        field: "payment",
        before: { type: "none" },
        after: { type: "settled", date: "2026-11-12", accountId: "acc-1", cents: null },
      },
    ]);
    expect(history[1]?.changes.map((change) => change.field)).toEqual(["amount"]);
    expect(history[2]?.changes).toEqual([]);
  });

  it("reads the same state reported twice as one entry, the earlier one", async () => {
    const edited = expense({ amountCents: -6000 });
    const { repo } = repoWith([
      event({ id: "again", after: edited }),
      event({ id: "first", after: edited }),
      event({ id: "created-again", kind: "created", before: null }),
      event({ id: "created", kind: "created", before: null }),
    ]);
    const history = await getTransactionHistory(repo, "u", "t1");
    expect(history.map((entry) => entry.id)).toEqual(["first", "created"]);
  });

  it("keeps a removal, and reads two reports of it as one", async () => {
    const { repo } = repoWith([
      event({ id: "gone-again", kind: "deleted", action: "delete", after: null }),
      event({ id: "gone", kind: "deleted", action: "delete", after: null }),
      event({ id: "made", kind: "created", action: "create", before: null }),
    ]);
    const history = await getTransactionHistory(repo, "u", "t1");
    expect(history.map((entry) => [entry.id, entry.changes.length])).toEqual([
      ["gone", 0],
      ["made", 0],
    ]);
  });

  it("leaves out a change with nothing to show, and one missing a side", async () => {
    const { repo } = repoWith([
      event({ id: "nothing", after: expense({ myShareCents: 1 }) }),
      event({ id: "half", before: null, after: expense({ description: "Outro" }) }),
    ]);
    expect(await getTransactionHistory(repo, "u", "t1")).toEqual([]);
  });

  it("is empty for a transaction with no history", async () => {
    expect(await getTransactionHistory(repoWith([]).repo, "u", "t1")).toEqual([]);
  });
});
