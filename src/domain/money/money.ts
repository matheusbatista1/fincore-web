/**
 * Money — value object for amounts in Brazilian Real, stored as integer **cents**.
 *
 * All arithmetic stays in integer cents (never floats), so there is no rounding
 * drift. Allocation preserves every cent: the parts always sum back to the whole.
 */
export class Money {
  private constructor(private readonly _cents: number) {}

  /** Build from an integer number of cents. Throws on non-integer / unsafe input. */
  static fromCents(cents: number): Money {
    if (!Number.isInteger(cents)) {
      throw new RangeError(`Money requires integer cents, received ${cents}`);
    }
    if (!Number.isSafeInteger(cents)) {
      throw new RangeError(`Money cents outside the safe integer range: ${cents}`);
    }
    return new Money(cents);
  }

  /** Build from a Real amount (e.g. 12.34), rounding half-up to the nearest cent. */
  static fromReais(reais: number): Money {
    if (!Number.isFinite(reais)) {
      throw new RangeError(`Money requires a finite amount, received ${reais}`);
    }
    return Money.fromCents(Math.round(reais * 100));
  }

  static zero(): Money {
    return new Money(0);
  }

  /** Sum a list of Money values (empty list → zero). */
  static sum(values: readonly Money[]): Money {
    return values.reduce<Money>((acc, m) => acc.add(m), Money.zero());
  }

  get cents(): number {
    return this._cents;
  }

  /** The amount in Reais as a float — for display/formatting only, never for math. */
  get reais(): number {
    return this._cents / 100;
  }

  add(other: Money): Money {
    return Money.fromCents(this._cents + other._cents);
  }

  subtract(other: Money): Money {
    return Money.fromCents(this._cents - other._cents);
  }

  /** Multiply by a scalar, rounding half-up to the nearest cent. */
  multiply(factor: number): Money {
    if (!Number.isFinite(factor)) {
      throw new RangeError(`Money.multiply requires a finite factor, received ${factor}`);
    }
    return Money.fromCents(Math.round(this._cents * factor));
  }

  /**
   * Divide by a scalar, rounding half-up to the nearest cent — the integer-cent
   * equivalent of the prototype's `r2(value / n)`. Prefer `allocate` when the
   * resulting parts must sum back to the whole without losing a cent.
   */
  divide(divisor: number): Money {
    if (!Number.isFinite(divisor) || divisor === 0) {
      throw new RangeError(`Money.divide requires a finite non-zero divisor, received ${divisor}`);
    }
    return Money.fromCents(Math.round(this._cents / divisor));
  }

  negate(): Money {
    return new Money(-this._cents);
  }

  abs(): Money {
    return new Money(Math.abs(this._cents));
  }

  isZero(): boolean {
    return this._cents === 0;
  }

  isPositive(): boolean {
    return this._cents > 0;
  }

  isNegative(): boolean {
    return this._cents < 0;
  }

  equals(other: Money): boolean {
    return this._cents === other._cents;
  }

  greaterThan(other: Money): boolean {
    return this._cents > other._cents;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this._cents >= other._cents;
  }

  lessThan(other: Money): boolean {
    return this._cents < other._cents;
  }

  lessThanOrEqual(other: Money): boolean {
    return this._cents <= other._cents;
  }

  compareTo(other: Money): -1 | 0 | 1 {
    if (this._cents < other._cents) return -1;
    if (this._cents > other._cents) return 1;
    return 0;
  }

  /** The larger / smaller of two amounts. */
  max(other: Money): Money {
    return this._cents >= other._cents ? this : other;
  }

  min(other: Money): Money {
    return this._cents <= other._cents ? this : other;
  }

  /**
   * Allocate this amount across `weights`, preserving every cent — the returned
   * parts always sum back to this amount exactly. Leftover cents from integer
   * division are distributed one-by-one to the largest fractional remainders
   * (largest-remainder method), with ties broken by earliest index, so the result
   * is deterministic. The sign of the amount is preserved.
   */
  allocate(weights: readonly number[]): Money[] {
    if (weights.length === 0) {
      throw new RangeError("Money.allocate requires at least one weight");
    }
    if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
      throw new RangeError("Money.allocate weights must be finite and non-negative");
    }
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (totalWeight <= 0) {
      throw new RangeError("Money.allocate weights must sum to a positive value");
    }

    const sign = this._cents < 0 ? -1 : 1;
    const absCents = Math.abs(this._cents);

    const raw = weights.map((w) => (absCents * w) / totalWeight);
    const parts = raw.map((r) => Math.floor(r));
    const distributed = parts.reduce((s, p) => s + p, 0);
    let remainder = absCents - distributed;

    const byFraction = raw
      .map((r, index) => ({ index, frac: r - Math.floor(r) }))
      .sort((a, b) => b.frac - a.frac || a.index - b.index);

    let cursor = 0;
    while (remainder > 0) {
      const target = byFraction[cursor % byFraction.length];
      if (target !== undefined) {
        parts[target.index] = (parts[target.index] ?? 0) + 1;
      }
      cursor += 1;
      remainder -= 1;
    }

    return parts.map((c) => new Money(sign * c));
  }

  /** Split evenly into `parts` slices, preserving every cent. */
  splitEvenly(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new RangeError(`Money.splitEvenly requires a positive integer, received ${parts}`);
    }
    return this.allocate(new Array<number>(parts).fill(1));
  }
}
