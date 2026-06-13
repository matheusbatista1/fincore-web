import { describe, expect, it } from "vitest";
import { partitionCardLines } from "./card-lines";

const row = (amountCents: number, id: string) => ({ amountCents, id });

describe("partitionCardLines", () => {
  it("treats negative as charges when purchases are negative (OFX fatura)", () => {
    // 4 purchases (negative) + 1 payment received (positive).
    const rows = [row(-60762, "a"), row(-1499, "b"), row(441443, "pay"), row(-62613, "c"), row(-16452, "d")];
    const { charges, credits } = partitionCardLines(rows);
    expect(charges.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(credits.map((r) => r.id)).toEqual(["pay"]);
  });

  it("treats positive as charges when purchases are positive (CSV fatura)", () => {
    // 3 purchases (positive) + 1 refund (negative).
    const rows = [row(5000, "a"), row(3200, "b"), row(-2000, "refund"), row(990, "c")];
    const { charges, credits } = partitionCardLines(rows);
    expect(charges.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(credits.map((r) => r.id)).toEqual(["refund"]);
  });

  it("keeps every line as a charge when all share the dominant sign", () => {
    const rows = [row(-100, "a"), row(-200, "b"), row(-300, "c")];
    const { charges, credits } = partitionCardLines(rows);
    expect(charges).toHaveLength(3);
    expect(credits).toHaveLength(0);
  });

  it("breaks a tie toward negative being the charge", () => {
    const rows = [row(-100, "a"), row(200, "b")];
    const { charges, credits } = partitionCardLines(rows);
    expect(charges.map((r) => r.id)).toEqual(["a"]);
    expect(credits.map((r) => r.id)).toEqual(["b"]);
  });
});
