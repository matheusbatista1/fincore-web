import { describe, expect, it, vi } from "vitest";
import type { ExpenseTransaction, Transaction } from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import type { CreateTransactionCommand, FinanceRepository, Workspace } from "../ports/finance-repository";
import { materializeOccurrence } from "./materialize-occurrence";

const das = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: "das",
  description: "Imposto DAS MEI",
  date: "2026-07-20" as IsoDate,
  kind: "expense",
  amountCents: -8605,
  categoryId: null,
  source: "boleto",
  cardId: null,
  accountId: null,
  linkedAccountId: "acc-mei",
  splits: [],
  myShareCents: 8605,
  installment: null,
  recurrence: { dayOfMonth: 20 },
  billMonthOverride: null,
  rolledAt: null,
  paidAt: "2026-07-01" as IsoDate,
  paidAccountId: "acc-mei",
  paidAmountCents: 8605,
  ...over,
});

function stub(transactions: Transaction[]) {
  const ws: Workspace = {
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
  };
  const insert = vi.fn(async (_u: string, _c: CreateTransactionCommand) => "new-id");
  const repo = {
    loadWorkspace: async () => ws,
    createTransactionReturningId: insert,
  } as unknown as FinanceRepository;
  return { repo, insert };
}

describe("materializeOccurrence", () => {
  it("books the occurrence on its own date, unpaid, so the Pagar flow can settle it", async () => {
    // The user wants to pay August's DAS on the 3rd, before its day-20 occurrence exists.
    const { repo, insert } = stub([das()]);
    const result = await materializeOccurrence(repo, "u", { anchorId: "das", date: "2026-08-20" as IsoDate });

    expect(result).toEqual({ ok: true, value: { id: "new-id" } });
    const [, command] = insert.mock.calls[0] as unknown as [string, CreateTransactionCommand];
    expect(command.entries[0]).toMatchObject({
      description: "Imposto DAS MEI",
      date: "2026-08-20",
      amountCents: -8605,
      // A fresh instance: the anchor's July payment must not come along, and it is not a new rule.
      recurrenceDayOfMonth: null,
    });
    expect(command.entries[0]).not.toHaveProperty("paidAt");
  });

  it("returns the existing row when that month is already booked (never duplicates)", async () => {
    const already = das({ id: "das-ago", date: "2026-08-20" as IsoDate, recurrence: null, paidAt: null });
    const { repo, insert } = stub([das(), already]);
    expect(
      await materializeOccurrence(repo, "u", { anchorId: "das", date: "2026-08-20" as IsoDate }),
    ).toEqual({ ok: true, value: { id: "das-ago" } });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a date that is not where the rule falls (never trust the client)", async () => {
    const { repo, insert } = stub([das()]);
    const result = await materializeOccurrence(repo, "u", { anchorId: "das", date: "2026-08-07" as IsoDate });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("bad_date");
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an occurrence at or before the rule's own anchor", async () => {
    const { repo } = stub([das()]);
    const result = await materializeOccurrence(repo, "u", { anchorId: "das", date: "2026-07-20" as IsoDate });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("bad_date");
  });

  it("rejects a row that is not a recurring rule", async () => {
    const oneOff = das({ id: "one-off", recurrence: null });
    const { repo } = stub([oneOff]);
    const result = await materializeOccurrence(repo, "u", {
      anchorId: "one-off",
      date: "2026-08-20" as IsoDate,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_recurring");
  });

  it("returns not_found for an unknown anchor", async () => {
    const { repo } = stub([das()]);
    const result = await materializeOccurrence(repo, "u", {
      anchorId: "ghost",
      date: "2026-08-20" as IsoDate,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});
