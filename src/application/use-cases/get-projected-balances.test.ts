import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/domain/entities/account";
import type { Person } from "@/domain/entities/person";
import type { Settlement } from "@/domain/entities/settlement";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { getProjectedBalances } from "./get-projected-balances";

vi.mock("@/shared/formatting/now", () => ({ currentMonthInBrazil: () => "2026-06" }));

const account: Account = {
  id: "acc-a",
  bank: "Nubank",
  name: "Principal",
  type: "PF",
  themeKey: "nubank",
  openingBalanceCents: 0,
  maskedNumber: "0000",
};
const person: Person = { id: "p", name: "Isa", relationship: "Amiga", color: "#000000" };

function stubRepo(settlements: Settlement[]): FinanceRepository {
  const ws: Workspace = {
    accounts: [account],
    creditCards: [],
    people: [person],
    categories: [],
    transactions: [],
    settlements,
    budgets: [],
    goals: [],
    cardBillDates: [],
  };
  return { loadWorkspace: async () => ws } as unknown as FinanceRepository;
}

describe("getProjectedBalances", () => {
  it("includes a person's settlement in the per-account projection (general lens + settlements)", async () => {
    // Isa paid R$ 500 into the account — the projection must credit it (the live saldo does),
    // otherwise "fim do mês" would diverge from the balance. The old personal lens dropped it.
    const repo = stubRepo([
      { id: "s1", personId: "p", amountCents: 50000, date: "2026-06-10" as IsoDate, accountId: "acc-a" },
    ]);
    const { byAccountCents } = await getProjectedBalances(repo, "u", "2026-06");
    expect(byAccountCents["acc-a"]).toBe(50000);
  });

  it("does not credit a settlement that names no account", async () => {
    const repo = stubRepo([
      { id: "s1", personId: "p", amountCents: 50000, date: "2026-06-10" as IsoDate, accountId: null },
    ]);
    const { byAccountCents } = await getProjectedBalances(repo, "u", "2026-06");
    expect(byAccountCents["acc-a"]).toBe(0);
  });
});
