import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/domain/entities/account";
import type { Person } from "@/domain/entities/person";
import type { Settlement } from "@/domain/entities/settlement";
import type { ExpenseTransaction, IncomeTransaction, Transaction } from "@/domain/entities/transaction";
import type { SettlePersonInput } from "@/shared/schemas/transaction";
import type {
  CreateTransactionCommand,
  FinanceRepository,
  SettlementData,
  Workspace,
} from "../ports/finance-repository";

// Freeze "today" so the horizon (browsed month vs. today) and the receipt default are deterministic.
vi.mock("@/shared/formatting/now", () => ({
  todayInBrazil: () => "2026-10-15",
  currentMonthInBrazil: () => "2026-10",
}));

const { settlePerson } = await import("./settle-person");

const ana: Person = { id: "p1", name: "Ana Souza", relationship: "Amiga", color: "#000000" };
const nubank: Account = {
  id: "acc-1",
  bank: "Nubank",
  name: "Conta",
  type: "PF",
  themeKey: "nubank",
  openingBalanceCents: 0,
  maskedNumber: "•• 0001",
  isReserve: false,
};

const share = (over: Partial<ExpenseTransaction> = {}): ExpenseTransaction => ({
  id: "e1",
  description: "Mercado",
  date: "2026-09-10",
  kind: "expense",
  amountCents: -59_640,
  categoryId: null,
  source: "account",
  cardId: null,
  accountId: "acc-1",
  linkedAccountId: null,
  splits: [{ personId: "p1", shareCents: 59_640 }],
  myShareCents: 0,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
  ...over,
});

const paymentFromAna = (amountCents: number): IncomeTransaction => ({
  id: "i1",
  description: "Pagamento recebido",
  date: "2026-09-12",
  kind: "income",
  amountCents,
  accountId: "acc-1",
  cardId: null,
  fromPersonId: "p1",
  isReimbursement: true,
  recurrence: null,
});

function stub(transactions: Transaction[], settlements: Settlement[] = []) {
  const ws: Workspace = {
    accounts: [nubank],
    creditCards: [],
    people: [ana],
    categories: [],
    transactions,
    settlements,
    budgets: [],
    goals: [],
    cardBillDates: [],
    cardBillPayments: [],
  };
  const createSettlement = vi.fn(async (_userId: string, _input: SettlementData) => {});
  const createSettlementWithTransaction = vi.fn(
    async (_userId: string, _settlement: SettlementData, _command: CreateTransactionCommand) => {},
  );
  const createTransaction = vi.fn(async (_userId: string, _command: CreateTransactionCommand) => {});
  const repo = {
    loadWorkspace: async () => ws,
    createSettlement,
    createSettlementWithTransaction,
    createTransaction,
  } as unknown as FinanceRepository;
  return { repo, createSettlement, createSettlementWithTransaction, createTransaction };
}

const input = (over: Partial<SettlePersonInput> = {}): SettlePersonInput => ({
  personId: "p1",
  amountCents: 60_000,
  date: "2026-10-10",
  accountId: "acc-1",
  ...over,
});

describe("settlePerson — within the pending", () => {
  it("writes the acerto as is when the payment does not exceed what the person owes", async () => {
    const s = stub([share()]);
    const result = await settlePerson(s.repo, "u", input({ amountCents: 59_640 }));
    expect(result).toEqual({ ok: true, value: { settledCents: 59_640, tipCents: 0, creditCents: 0 } });
    expect(s.createSettlement).toHaveBeenCalledWith("u", {
      personId: "p1",
      amountCents: 59_640,
      date: "2026-10-10",
      accountId: "acc-1",
    });
    expect(s.createSettlementWithTransaction).not.toHaveBeenCalled();
    expect(s.createTransaction).not.toHaveBeenCalled();
  });

  it("ignores a surplus decision when there is no surplus", async () => {
    const s = stub([share()]);
    await settlePerson(s.repo, "u", input({ amountCents: 30_000, surplus: "tip" }));
    expect(s.createSettlement).toHaveBeenCalledTimes(1);
    expect(s.createTransaction).not.toHaveBeenCalled();
  });

  it("passes a note through untouched", async () => {
    const s = stub([share()]);
    await settlePerson(s.repo, "u", input({ amountCents: 59_640, note: "Pix" }));
    expect(s.createSettlement.mock.calls[0]?.[1]).toMatchObject({ note: "Pix" });
  });

  it("writes an acerto YOU pay (negative pending) as is — the rule is one-directional", async () => {
    // Ana paid 100,00 with no share behind it → you owe her 100,00; you pay 150,00 back.
    const s = stub([paymentFromAna(10_000)]);
    const result = await settlePerson(s.repo, "u", input({ amountCents: 15_000 }));
    expect(result.ok).toBe(true);
    expect(s.createSettlement).toHaveBeenCalledWith("u", expect.objectContaining({ amountCents: 15_000 }));
  });
});

describe("settlePerson — a payment above the pending", () => {
  it("refuses to guess: returns the figures so the client can ask, and writes nothing", async () => {
    const s = stub([share()]);
    const result = await settlePerson(s.repo, "u", input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("surplus_undecided");
      expect(result.error.surplus).toEqual({ owedCents: 59_640, surplusCents: 360 });
      expect(result.error.message).toBe(
        "Ana deve R$ 596,40; sobram R$ 3,60. Escolha o que fazer com a sobra.",
      );
    }
    expect(s.createSettlement).not.toHaveBeenCalled();
    expect(s.createSettlementWithTransaction).not.toHaveBeenCalled();
    expect(s.createTransaction).not.toHaveBeenCalled();
  });

  it("crédito: keeps the full amount in the acerto and notes the excess", async () => {
    const s = stub([share()]);
    const result = await settlePerson(s.repo, "u", input({ surplus: "credit" }));
    expect(result).toEqual({ ok: true, value: { settledCents: 60_000, tipCents: 0, creditCents: 360 } });
    expect(s.createSettlement).toHaveBeenCalledWith("u", {
      personId: "p1",
      amountCents: 60_000,
      date: "2026-10-10",
      accountId: "acc-1",
      note: "Acerto · R$ 3,60 de crédito",
    });
    expect(s.createSettlementWithTransaction).not.toHaveBeenCalled();
  });

  it("gorjeta: caps the acerto at the pending and books the surplus as the user's income, atomically", async () => {
    const s = stub([share()]);
    const result = await settlePerson(s.repo, "u", input({ surplus: "tip" }));
    expect(result).toEqual({ ok: true, value: { settledCents: 59_640, tipCents: 360, creditCents: 0 } });
    expect(s.createSettlement).not.toHaveBeenCalled();
    expect(s.createTransaction).not.toHaveBeenCalled();
    expect(s.createSettlementWithTransaction).toHaveBeenCalledTimes(1);
    const call = s.createSettlementWithTransaction.mock.calls[0];
    expect(call?.[1]).toEqual({
      personId: "p1",
      amountCents: 59_640,
      date: "2026-10-10",
      accountId: "acc-1",
      note: "Recebeu R$ 600,00 · R$ 3,60 de gorjeta",
    });
    // A plain own income: no person behind it (the ledger never sees it), received on the acerto's
    // date into the acerto's account, so both lenses count it as the user's money.
    expect(call?.[2]).toEqual({
      entries: [
        {
          kind: "income",
          description: "Gorjeta — Ana",
          date: "2026-10-10",
          amountCents: 360,
          note: "Sobra do acerto de Ana em 10/10",
          accountId: "acc-1",
          cardId: null,
          fromPersonId: null,
          isReimbursement: false,
          recurrenceDayOfMonth: null,
          myShareCents: 360,
          receivedAt: "2026-10-10",
          receivedAccountId: "acc-1",
          receivedAmountCents: 360,
        },
      ],
    });
  });

  it("a 'sem conta' acerto cannot carry a surplus (no cash arrived)", async () => {
    const s = stub([share()]);
    const result = await settlePerson(s.repo, "u", input({ accountId: null, surplus: "tip" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("surplus_without_account");
      expect(result.error.message).toBe("Sem conta, o acerto fica limitado ao que Ana deve (R$ 596,40).");
    }
    expect(s.createSettlement).not.toHaveBeenCalled();
    expect(s.createSettlementWithTransaction).not.toHaveBeenCalled();
  });

  it("nothing pending + gorjeta: only the income is written (the DB refuses a zero acerto)", async () => {
    const s = stub([]);
    const result = await settlePerson(s.repo, "u", input({ amountCents: 2_000, surplus: "tip" }));
    expect(result).toEqual({ ok: true, value: { settledCents: 0, tipCents: 2_000, creditCents: 0 } });
    expect(s.createTransaction).toHaveBeenCalledTimes(1);
    expect(s.createTransaction.mock.calls[0]?.[1]).toEqual({
      entries: [expect.objectContaining({ kind: "income", amountCents: 2_000, fromPersonId: null })],
    });
    expect(s.createSettlement).not.toHaveBeenCalled();
    expect(s.createSettlementWithTransaction).not.toHaveBeenCalled();
  });

  it("nothing pending + crédito: the whole amount is the person's credit", async () => {
    const s = stub([]);
    const result = await settlePerson(s.repo, "u", input({ amountCents: 2_000, surplus: "credit" }));
    expect(result).toEqual({ ok: true, value: { settledCents: 2_000, tipCents: 0, creditCents: 2_000 } });
    expect(s.createSettlement).toHaveBeenCalledWith(
      "u",
      expect.objectContaining({ amountCents: 2_000, note: "Acerto · R$ 20,00 de crédito" }),
    );
  });
});

describe("settlePerson — what counts as pending", () => {
  it("a past browsed month still measures through today (a later share is pending too)", async () => {
    const october = share({ id: "e2", date: "2026-10-05", splits: [{ personId: "p1", shareCents: 10_000 }] });
    const s = stub([share(), october]);
    // 596,40 (September) + 100,00 (October) = 696,40 pending: paying 696,40 is no sobra…
    const exact = await settlePerson(s.repo, "u", input({ amountCents: 69_640, throughMonth: "2026-09" }));
    expect(exact.ok).toBe(true);
    // …and 700,00 leaves 3,60 over.
    const over = await settlePerson(s.repo, "u", input({ amountCents: 70_000, throughMonth: "2026-09" }));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.surplus).toEqual({ owedCents: 69_640, surplusCents: 360 });
  });

  it("a future browsed month counts its projected recurring share (a prepayment is not a sobra)", async () => {
    const rule = share({ id: "rule", date: "2026-10-05", recurrence: { dayOfMonth: 5 } });
    const s = stub([rule]);
    // Through November: October (real) + November (projected) = 2 × 596,40.
    const withMonth = await settlePerson(
      s.repo,
      "u",
      input({ amountCents: 119_280, throughMonth: "2026-11" }),
    );
    expect(withMonth.ok).toBe(true);
    // Without a browsed month the horizon is today: only October counts, so the same amount is over.
    const withoutMonth = await settlePerson(s.repo, "u", input({ amountCents: 119_280 }));
    expect(withoutMonth.ok).toBe(false);
    if (!withoutMonth.ok) {
      expect(withoutMonth.error.surplus).toEqual({ owedCents: 59_640, surplusCents: 59_640 });
    }
  });

  it("an earlier acerto already counts against the pending", async () => {
    const paid: Settlement = {
      id: "s0",
      personId: "p1",
      amountCents: 50_000,
      date: "2026-09-20",
      accountId: "acc-1",
    };
    const s = stub([share()], [paid]);
    const result = await settlePerson(s.repo, "u", input({ amountCents: 10_000 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.surplus).toEqual({ owedCents: 9_640, surplusCents: 360 });
  });
});

describe("settlePerson — guards", () => {
  it("rejects an unknown person", async () => {
    const s = stub([share()]);
    const result = await settlePerson(s.repo, "u", input({ personId: "p9" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("rejects an unknown account", async () => {
    const s = stub([share()]);
    const result = await settlePerson(s.repo, "u", input({ accountId: "acc-9", amountCents: 59_640 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_account");
    expect(s.createSettlement).not.toHaveBeenCalled();
  });

  it("rejects a future date", async () => {
    const s = stub([share()]);
    const result = await settlePerson(s.repo, "u", input({ date: "2026-10-16", amountCents: 59_640 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_date");
    expect(s.createSettlement).not.toHaveBeenCalled();
  });
});
