import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("lets the limit through and refuses the rest of the window", () => {
    const allow = createRateLimiter(3, 60_000);
    expect([allow(0), allow(10), allow(20), allow(30), allow(59_999)]).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("starts over when the window turns", () => {
    const allow = createRateLimiter(2, 60_000);
    expect([allow(1_000), allow(2_000), allow(3_000)]).toEqual([true, true, false]);
    // A minute after the window's first pass.
    expect([allow(61_000), allow(61_001), allow(61_002)]).toEqual([true, true, false]);
  });

  it("keeps each limiter's count to itself", () => {
    const one = createRateLimiter(1, 1_000);
    const other = createRateLimiter(1, 1_000);
    expect(one(0)).toBe(true);
    expect(other(0)).toBe(true);
    expect(one(1)).toBe(false);
  });

  it("with a limit of zero lets nothing through", () => {
    const allow = createRateLimiter(0, 1_000);
    expect(allow(0)).toBe(false);
    expect(allow(5_000)).toBe(false);
  });
});
