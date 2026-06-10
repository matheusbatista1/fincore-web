import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Money } from "./money";

// Bounded so intermediate products in allocate() stay well within Number.MAX_SAFE_INTEGER.
const cents = () => fc.integer({ min: -100_000_000_000, max: 100_000_000_000 });
const money = () => cents().map((c) => Money.fromCents(c));
const weights = () => fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 12 });

const sumCents = (parts: Money[]) => parts.reduce((s, p) => s + p.cents, 0);

describe("Money construction", () => {
  it("round-trips integer cents", () => {
    fc.assert(
      fc.property(cents(), (c) => {
        expect(Money.fromCents(c).cents).toBe(c);
      }),
    );
  });

  it("rejects non-integer or unsafe cents", () => {
    expect(() => Money.fromCents(1.5)).toThrow(RangeError);
    expect(() => Money.fromCents(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => Money.fromCents(Number.NaN)).toThrow(RangeError);
  });

  it("converts Reais to cents with half-up rounding", () => {
    expect(Money.fromReais(12.34).cents).toBe(1234);
    expect(Money.fromReais(0.1).cents).toBe(10);
    expect(Money.fromReais(-148).cents).toBe(-14_800);
    // Classic float trap: 0.1 + 0.2 worth of cents must be exact.
    expect(Money.fromReais(0.1).add(Money.fromReais(0.2)).cents).toBe(30);
  });

  it("rejects non-finite Reais", () => {
    expect(() => Money.fromReais(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("Money arithmetic", () => {
  it("addition is commutative", () => {
    fc.assert(
      fc.property(money(), money(), (a, b) => {
        expect(a.add(b).equals(b.add(a))).toBe(true);
      }),
    );
  });

  it("subtraction is the inverse of addition", () => {
    fc.assert(
      fc.property(money(), money(), (a, b) => {
        expect(a.add(b).subtract(b).equals(a)).toBe(true);
      }),
    );
  });

  it("zero is the additive identity", () => {
    fc.assert(
      fc.property(money(), (a) => {
        expect(a.add(Money.zero()).equals(a)).toBe(true);
      }),
    );
  });

  it("negate composes to identity and sums to zero", () => {
    fc.assert(
      fc.property(money(), (a) => {
        expect(a.negate().negate().equals(a)).toBe(true);
        expect(a.add(a.negate()).isZero()).toBe(true);
      }),
    );
  });

  it("abs is non-negative and magnitude-preserving", () => {
    fc.assert(
      fc.property(money(), (a) => {
        expect(a.abs().isNegative()).toBe(false);
        expect(a.abs().cents).toBe(Math.abs(a.cents));
      }),
    );
  });

  it("multiply by an integer scales exactly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000, max: 10_000 }),
        fc.integer({ min: -10_000, max: 10_000 }),
        (c, k) => {
          expect(Money.fromCents(c).multiply(k).cents).toBe(c * k);
        },
      ),
    );
  });

  it("sum() reduces a list and handles the empty case", () => {
    expect(Money.sum([]).isZero()).toBe(true);
    expect(Money.sum([Money.fromCents(100), Money.fromCents(250)]).cents).toBe(350);
  });
});

describe("Money comparison", () => {
  it("compareTo agrees with the boolean comparators", () => {
    fc.assert(
      fc.property(money(), money(), (a, b) => {
        const cmp = a.compareTo(b);
        expect(cmp === 0).toBe(a.equals(b));
        expect(cmp < 0).toBe(a.lessThan(b));
        expect(cmp > 0).toBe(a.greaterThan(b));
      }),
    );
  });
});

describe("Money.allocate", () => {
  it("preserves every cent (parts always sum to the whole)", () => {
    fc.assert(
      fc.property(money(), weights(), (amount, ws) => {
        const parts = amount.allocate(ws);
        expect(sumCents(parts)).toBe(amount.cents);
        expect(parts).toHaveLength(ws.length);
      }),
    );
  });

  it("preserves the sign and yields integer cents", () => {
    fc.assert(
      fc.property(money(), weights(), (amount, ws) => {
        for (const part of amount.allocate(ws)) {
          expect(Number.isInteger(part.cents)).toBe(true);
          if (amount.isPositive()) expect(part.cents).toBeGreaterThanOrEqual(0);
          if (amount.isNegative()) expect(part.cents).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it("splitEvenly keeps slices within one cent of each other", () => {
    fc.assert(
      fc.property(money(), fc.integer({ min: 1, max: 50 }), (amount, n) => {
        const parts = amount.splitEvenly(n);
        expect(sumCents(parts)).toBe(amount.cents);
        const magnitudes = parts.map((p) => Math.abs(p.cents));
        expect(Math.max(...magnitudes) - Math.min(...magnitudes)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("distributes remainder cents to the earliest largest fractions", () => {
    // 100 / 3 = 33.33… → floors 33, one leftover cent to the first slice.
    expect(
      Money.fromCents(100)
        .splitEvenly(3)
        .map((m) => m.cents),
    ).toEqual([34, 33, 33]);
    // Negative amounts keep the sign.
    expect(
      Money.fromCents(-100)
        .splitEvenly(3)
        .map((m) => m.cents),
    ).toEqual([-34, -33, -33]);
    // Weighted: 1000 cents across 1:1:2 → 250, 250, 500.
    expect(
      Money.fromCents(1000)
        .allocate([1, 1, 2])
        .map((m) => m.cents),
    ).toEqual([250, 250, 500]);
  });

  it("rejects invalid weights", () => {
    expect(() => Money.fromCents(100).allocate([])).toThrow(RangeError);
    expect(() => Money.fromCents(100).allocate([0, 0])).toThrow(RangeError);
    expect(() => Money.fromCents(100).allocate([1, -1])).toThrow(RangeError);
    expect(() => Money.fromCents(100).splitEvenly(0)).toThrow(RangeError);
  });
});
