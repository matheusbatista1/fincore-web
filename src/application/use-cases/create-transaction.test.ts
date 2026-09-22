import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import type { CreateTransactionInput } from "@/shared/schemas/transaction";
import { buildCommand } from "./create-transaction";

const TODAY = "2026-07-02" as IsoDate;

const incomeInput = (over: Partial<Extract<CreateTransactionInput, { kind: "income" }>> = {}) =>
  ({
    kind: "income",
    description: "Salário",
    date: TODAY,
    amountCents: 500000,
    accountId: "acc-1",
    cardId: null,
    fromPersonId: null,
    fixed: false,
    ...over,
  }) as CreateTransactionInput;

/** Grab the single income entry from a successful buildCommand result. */
function entryOf(input: CreateTransactionInput, today?: IsoDate) {
  const result = buildCommand(input, today);
  if (!result.ok) throw new Error(result.error.message);
  const entry = result.value.entries[0];
  if (!entry) throw new Error("no entry");
  return entry;
}

describe("buildCommand — income receipt default (pela data)", () => {
  it("marks an income dated today as received on booking (credits immediately)", () => {
    const entry = entryOf(incomeInput({ date: TODAY }), TODAY);
    expect(entry.receivedAt).toBe(TODAY);
    expect(entry.receivedAccountId).toBe("acc-1");
    expect(entry.receivedAmountCents).toBe(500000);
  });

  it("marks a past-dated income as received on its own date", () => {
    const entry = entryOf(incomeInput({ date: "2026-06-20" as IsoDate }), TODAY);
    expect(entry.receivedAt).toBe("2026-06-20");
    expect(entry.receivedAccountId).toBe("acc-1");
  });

  it("leaves a future-dated income as a pending receivable (received fields null)", () => {
    const entry = entryOf(incomeInput({ date: "2026-09-10" as IsoDate }), TODAY);
    expect(entry.receivedAt ?? null).toBeNull();
    expect(entry.receivedAccountId ?? null).toBeNull();
    expect(entry.receivedAmountCents ?? null).toBeNull();
  });

  it("never marks a card credit (estorno) as received", () => {
    const entry = entryOf(incomeInput({ accountId: null, cardId: "card-1", date: TODAY }), TODAY);
    expect(entry.receivedAt ?? null).toBeNull();
    expect(entry.cardId).toBe("card-1");
  });

  it("treats income as received-on-booking when no `today` is provided (legacy/immediate)", () => {
    const entry = entryOf(incomeInput({ date: "2026-09-10" as IsoDate }));
    expect(entry.receivedAt).toBe("2026-09-10");
  });
});
