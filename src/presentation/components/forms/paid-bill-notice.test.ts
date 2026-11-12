import { describe, expect, it } from "vitest";
import type { CardBilling } from "@/domain/services/card-bill.calculator";
import { paidBillNotice } from "./paid-bill-notice";

// Closes on the 2nd, due on the 9th: a charge of 26/06 is on the fatura due 09/07 (2026-07).
const billing: CardBilling = {
  closingDay: 2,
  dueDay: 9,
  overrides: [],
  paid: [
    { competence: "2026-07", amountCents: 193_267, paidOn: "2026-07-11" },
    { competence: "2026-10", amountCents: 329_633, paidOn: "2026-10-20" },
  ],
};

const typing = (over: Partial<Parameters<typeof paidBillNotice>[0]> = {}) => ({
  billing,
  cardId: "nubank",
  date: "2026-06-26",
  amountCents: 5_000,
  original: null,
  ...over,
});

describe("paidBillNotice — a new row", () => {
  it("warns when the date lands on a fatura already paid (the mistyped-month case)", () => {
    expect(paidBillNotice(typing())).toEqual({
      competence: "2026-07",
      amountCents: 193_267,
      paidOn: "2026-07-11",
    });
  });

  it("stays quiet on a bill still to be paid", () => {
    // 26/10 is on the fatura due in November, which has no payment.
    expect(paidBillNotice(typing({ date: "2026-10-26" }))).toBeNull();
  });

  it("stays quiet when the row is not a card row or the date is not a date yet", () => {
    expect(paidBillNotice(typing({ billing: undefined }))).toBeNull();
    expect(paidBillNotice(typing({ cardId: null }))).toBeNull();
    expect(paidBillNotice(typing({ date: "" }))).toBeNull();
    expect(paidBillNotice(typing({ date: "2026-06" }))).toBeNull();
  });
});

describe("paidBillNotice — editing a row", () => {
  const onPaidBill = { cardId: "nubank", billMonth: "2026-07", amountCents: 5_000, billMonthOverride: null };

  it("stays quiet when nothing is added to the paid bill it already sits on", () => {
    // Same card, same bill, same amount: changing the category or the description adds nothing.
    expect(paidBillNotice(typing({ original: onPaidBill }))).toBeNull();
    // Another day of the same cycle is still the same bill.
    expect(paidBillNotice(typing({ date: "2026-06-20", original: onPaidBill }))).toBeNull();
  });

  it("warns when the amount changes on a paid bill: the payment no longer matches", () => {
    expect(paidBillNotice(typing({ amountCents: 5_500, original: onPaidBill }))?.competence).toBe("2026-07");
  });

  it("warns when the row moves onto a paid bill, by date or by card", () => {
    const open = { cardId: "nubank", billMonth: "2026-11", amountCents: 5_000, billMonthOverride: null };
    expect(paidBillNotice(typing({ original: open }))?.competence).toBe("2026-07");
    const otherCard = { cardId: "c6", billMonth: "2026-07", amountCents: 5_000, billMonthOverride: null };
    expect(paidBillNotice(typing({ original: otherCard }))?.competence).toBe("2026-07");
    // It was not a card row before (an account expense turned into a card charge).
    const notCard = { cardId: null, billMonth: null, amountCents: 5_000, billMonthOverride: null };
    expect(paidBillNotice(typing({ original: notCard }))?.competence).toBe("2026-07");
  });

  it("stays quiet when the row leaves a paid bill for an open one", () => {
    expect(paidBillNotice(typing({ date: "2026-10-26", original: onPaidBill }))).toBeNull();
  });

  it("follows a manual bill override: the row stays on that bill whatever the date", () => {
    const pinned = {
      cardId: "nubank",
      billMonth: "2026-10",
      amountCents: 5_000,
      billMonthOverride: "2026-10",
    };
    // The date alone would put it on the open November bill; the override keeps it on October's.
    expect(paidBillNotice(typing({ date: "2026-10-26", original: pinned }))).toBeNull();
    expect(
      paidBillNotice(typing({ date: "2026-10-26", amountCents: 9_000, original: pinned }))?.competence,
    ).toBe("2026-10");
  });
});
