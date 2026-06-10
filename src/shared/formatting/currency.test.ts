import { describe, expect, it } from "vitest";
import { formatBRL, formatBRLAbsolute } from "./currency";

describe("formatBRL", () => {
  it("formats positive and negative cents", () => {
    expect(formatBRL(1234)).toBe("R$ 12,34");
    expect(formatBRL(0)).toBe("R$ 0,00");
    expect(formatBRL(-14_800)).toBe("- R$ 148,00");
  });

  it("groups thousands with a dot", () => {
    expect(formatBRL(100_000_000)).toBe("R$ 1.000.000,00");
    expect(formatBRL(5_696_155)).toBe("R$ 56.961,55");
  });

  it("can suppress the negative sign", () => {
    expect(formatBRL(-14_800, { withSign: false })).toBe("R$ 148,00");
    expect(formatBRLAbsolute(-14_800)).toBe("R$ 148,00");
  });
});
