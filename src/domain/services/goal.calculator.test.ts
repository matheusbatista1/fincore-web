import { describe, expect, it } from "vitest";
import { goalProgress } from "./goal.calculator";

describe("goalProgress", () => {
  it("computes ratio and remaining below target", () => {
    const p = goalProgress({ savedCents: 30_00, targetCents: 100_00 });
    expect(p.ratio).toBeCloseTo(0.3);
    expect(p.remainingCents).toBe(70_00);
    expect(p.reached).toBe(false);
  });

  it("clamps ratio at 1 and remaining at 0 once reached", () => {
    const p = goalProgress({ savedCents: 120_00, targetCents: 100_00 });
    expect(p.ratio).toBe(1);
    expect(p.remainingCents).toBe(0);
    expect(p.reached).toBe(true);
  });

  it("treats a non-positive target as zero progress", () => {
    const p = goalProgress({ savedCents: 50_00, targetCents: 0 });
    expect(p.ratio).toBe(0);
  });
});
