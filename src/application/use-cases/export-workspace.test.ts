import { describe, expect, it } from "vitest";
import type { FinanceRepository, UserProfile, Workspace } from "../ports/finance-repository";
import { exportWorkspace } from "./export-workspace";

const workspace: Workspace = {
  accounts: [
    {
      id: "a",
      bank: "Banco",
      name: "Conta",
      type: "PF",
      themeKey: "default",
      openingBalanceCents: 100_000,
      maskedNumber: "•• 0000",
    },
  ],
  creditCards: [],
  people: [{ id: "p", name: "Ana", relationship: "Amiga", color: "#000000" }],
  categories: [],
  transactions: [
    {
      id: "t1",
      kind: "income",
      description: "Salário",
      date: "2026-11-05",
      amountCents: 250_000,
      accountId: "a",
      cardId: null,
      fromPersonId: null,
      isReimbursement: false,
      recurrence: null,
    },
    {
      id: "t2",
      kind: "transfer",
      description: "Reserva",
      date: "2026-11-07",
      fromAccountId: "a",
      toAccountId: "b",
      valueCents: 10_000,
    },
  ],
  settlements: [{ id: "s", personId: "p", amountCents: 6_000, date: "2026-11-08", accountId: "a" }],
  budgets: [],
  goals: [],
  cardBillDates: [],
  cardBillPayments: [],
};

const profile: UserProfile = {
  displayName: "Fulano",
  email: "fulano@example.com",
  avatarUrl: "https://example.com/avatar.png",
  enabledModules: ["people"],
  onboardedAt: new Date("2026-01-01T00:00:00Z"),
  autoPaymentsEnabled: true,
  defaultPayAccountId: "a",
  autoPaymentsSince: "2026-06-01",
  recurringMaterializedThrough: "2026-11-01",
};

const repo = {
  loadWorkspace: async () => workspace,
  getProfile: async () => profile,
} as unknown as FinanceRepository;

describe("exportWorkspace", () => {
  const now = new Date("2026-11-12T09:30:00Z");

  it("carries everything the user recorded, as the app holds it", async () => {
    const backup = await exportWorkspace(repo, "user", now);
    expect(backup.format).toBe("fincore-backup");
    expect(backup.version).toBe(1);
    expect(backup.exportedAt).toBe("2026-11-12T09:30:00.000Z");
    expect(backup.data).toEqual(workspace);
    expect(backup.counts).toEqual({
      accounts: 1,
      creditCards: 0,
      people: 1,
      categories: 0,
      transactions: 2,
      settlements: 1,
      budgets: 0,
      goals: 0,
      cardBillDates: 0,
      cardBillPayments: 0,
    });
    // Every collection of the workspace is counted: a new one cannot be left out unnoticed.
    expect(Object.keys(backup.counts).sort()).toEqual(Object.keys(workspace).sort());
  });

  it("keeps the settings that shape the app, and nothing about the sign-in", async () => {
    const backup = await exportWorkspace(repo, "user", now);
    expect(backup.settings).toEqual({
      displayName: "Fulano",
      enabledModules: ["people"],
      autoPaymentsEnabled: true,
      defaultPayAccountId: "a",
    });
    const text = JSON.stringify(backup);
    expect(text).not.toContain("fulano@example.com");
    expect(text).not.toContain("avatar");
  });

  it("survives a trip through JSON unchanged", async () => {
    const backup = await exportWorkspace(repo, "user", now);
    expect(JSON.parse(JSON.stringify(backup))).toEqual(backup);
  });
});
