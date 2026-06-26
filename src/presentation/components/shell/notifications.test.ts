import { describe, expect, it } from "vitest";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { deriveNotifications, type NotifData } from "./notifications";

const base: NotifData = { cards: [], debtors: [], today: "2026-06-24" };

describe("deriveNotifications", () => {
  it("shows the bill DUE soon with its due amount (not the open cycle)", () => {
    const data: NotifData = {
      ...base,
      cards: [{ id: "c1", bank: "Caixa", dueDay: 28, dueBillCents: 117119, utilization: 0.3 }],
    };
    const items = deriveNotifications(data);
    const due = items.find((i) => i.id === "due-c1");
    expect(due).toBeDefined();
    expect(due?.title).toContain("Fatura Caixa vence");
    expect(due?.sub).toBe(formatBRLAbsolute(117119)); // R$ 1.171,19
  });

  it("hides the bill notification when the due bill is zero", () => {
    const data: NotifData = {
      ...base,
      cards: [{ id: "c1", bank: "Caixa", dueDay: 26, dueBillCents: 0, utilization: 0.1 }],
    };
    expect(deriveNotifications(data).some((i) => i.id === "due-c1")).toBe(false);
  });

  it("hides the bill notification when the due date is more than 7 days away", () => {
    // dueDay 2 with today=24 → next occurrence ~9 days away.
    const data: NotifData = {
      ...base,
      cards: [{ id: "c1", bank: "Nubank", dueDay: 2, dueBillCents: 50000, utilization: 0.1 }],
    };
    expect(deriveNotifications(data).some((i) => i.id === "due-c1")).toBe(false);
  });

  it("warns when utilization exceeds 85%", () => {
    const data: NotifData = {
      ...base,
      cards: [{ id: "c1", bank: "C6", dueDay: 2, dueBillCents: 0, utilization: 0.9 }],
    };
    const util = deriveNotifications(data).find((i) => i.id === "util-c1");
    expect(util?.title).toBe("C6 em 90% do limite");
  });

  it("shows who owes you, using the value provided (month-scoped by the caller)", () => {
    const data: NotifData = {
      ...base,
      debtors: [{ id: "p1", name: "Nenê Silva", relationship: "Família", balanceCents: 35519 }],
    };
    const debtor = deriveNotifications(data).find((i) => i.id === "debtor-p1");
    expect(debtor?.title).toBe(`Nenê te deve ${formatBRLAbsolute(35519)}`);
    expect(debtor?.sub).toBe("Família");
  });
});
