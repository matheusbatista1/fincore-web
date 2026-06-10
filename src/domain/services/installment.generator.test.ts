import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Money } from "../money/money";
import type { IsoDate } from "../value-objects/competence-month";
import { addMonths, dateInMonth, dayOf, monthOf } from "../value-objects/competence-month";
import { generateInstallments, type InstallmentInput } from "./installment.generator";

/**
 * Arbitrary for a full, internally-consistent installment input. The base date
 * is constrained to a valid ISO `YYYY-MM-DD` so the competence-month helpers
 * behave deterministically.
 */
const inputArb = fc
  .record({
    cents: fc.integer({ min: 1, max: 5_000_000 }), // magnitude in cents (>= 1)
    sign: fc.constantFrom(-1, 1), // expense (-) or income (+)
    count: fc.integer({ min: 1, max: 60 }),
    year: fc.integer({ min: 2000, max: 2099 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 31 }),
    includePrevious: fc.boolean(),
    includeNext: fc.boolean(),
  })
  .chain((r) =>
    fc.record({
      base: fc.constant(r),
      current: fc.integer({ min: 1, max: r.count }),
    }),
  )
  .map(({ base, current }): InstallmentInput => {
    const pad2 = (n: number): string => String(n).padStart(2, "0");
    const baseDate = `${base.year}-${pad2(base.month)}-${pad2(base.day)}` as IsoDate;
    return {
      total: Money.fromCents(base.sign * base.cents),
      count: base.count,
      current,
      includePrevious: base.includePrevious,
      includeNext: base.includeNext,
      baseDate,
    };
  });

describe("generateInstallments", () => {
  describe("property: full schedule", () => {
    it("the full N-installment schedule sums EXACTLY to the principal", () => {
      fc.assert(
        fc.property(inputArb, (input) => {
          // Force the full schedule by including both directions.
          const full = generateInstallments({
            ...input,
            includePrevious: true,
            includeNext: true,
          });
          expect(full).toHaveLength(input.count);
          const summed = Money.sum(full.map((p) => p.amount));
          expect(summed.cents).toBe(input.total.cents);
        }),
      );
    });

    it("every parcela keeps the sign of the principal (or is zero)", () => {
      fc.assert(
        fc.property(inputArb, (input) => {
          const full = generateInstallments({
            ...input,
            includePrevious: true,
            includeNext: true,
          });
          for (const p of full) {
            if (input.total.isNegative()) {
              expect(p.amount.cents).toBeLessThanOrEqual(0);
            } else {
              expect(p.amount.cents).toBeGreaterThanOrEqual(0);
            }
          }
        }),
      );
    });

    it("per-parcela amounts differ by at most one cent (even allocation)", () => {
      fc.assert(
        fc.property(inputArb, (input) => {
          const full = generateInstallments({
            ...input,
            includePrevious: true,
            includeNext: true,
          });
          const magnitudes = full.map((p) => Math.abs(p.amount.cents));
          const min = Math.min(...magnitudes);
          const max = Math.max(...magnitudes);
          expect(max - min).toBeLessThanOrEqual(1);
        }),
      );
    });
  });

  describe("property: statuses", () => {
    it("status is paga (<current), atual (===current), futura (>current)", () => {
      fc.assert(
        fc.property(inputArb, (input) => {
          const list = generateInstallments(input);
          for (const p of list) {
            const expected =
              p.number < input.current ? "paga" : p.number === input.current ? "atual" : "futura";
            expect(p.status).toBe(expected);
          }
        }),
      );
    });

    it("the `atual` installment is present whenever it lies inside [start..end]", () => {
      fc.assert(
        fc.property(inputArb, (input) => {
          // current always lies within [start..end] regardless of the flags,
          // because start <= current <= end by construction.
          const list = generateInstallments(input);
          const atual = list.filter((p) => p.status === "atual");
          expect(atual).toHaveLength(1);
          expect(atual[0]?.number).toBe(input.current);
        }),
      );
    });
  });

  describe("property: dates", () => {
    it("each date equals dateInMonth(addMonths(base, i-current), day)", () => {
      fc.assert(
        fc.property(inputArb, (input) => {
          const baseMonth = monthOf(input.baseDate);
          const baseDay = dayOf(input.baseDate);
          const list = generateInstallments(input);
          for (const p of list) {
            const expected = dateInMonth(addMonths(baseMonth, p.number - input.current), baseDay);
            expect(p.date).toBe(expected);
          }
        }),
      );
    });

    it("consecutive installments are exactly one competence-month apart", () => {
      fc.assert(
        fc.property(inputArb, (input) => {
          const full = generateInstallments({
            ...input,
            includePrevious: true,
            includeNext: true,
          });
          for (let i = 1; i < full.length; i += 1) {
            const prev = full[i - 1];
            const cur = full[i];
            if (prev === undefined || cur === undefined) continue;
            expect(monthOf(cur.date)).toBe(addMonths(monthOf(prev.date), 1));
          }
        }),
      );
    });
  });

  describe("property: flags / slicing", () => {
    it("respects start = includePrevious ? 1 : current and end = includeNext ? N : current", () => {
      fc.assert(
        fc.property(inputArb, (input) => {
          const list = generateInstallments(input);
          const expectedStart = input.includePrevious ? 1 : input.current;
          const expectedEnd = input.includeNext ? input.count : input.current;
          const numbers = list.map((p) => p.number);
          expect(numbers[0]).toBe(expectedStart);
          expect(numbers[numbers.length - 1]).toBe(expectedEnd);
          expect(list).toHaveLength(expectedEnd - expectedStart + 1);
          // strictly increasing, contiguous
          for (let i = 1; i < numbers.length; i += 1) {
            expect(numbers[i]).toBe((numbers[i - 1] ?? 0) + 1);
          }
        }),
      );
    });

    it("the slice [start..end] is a faithful sub-sequence of the full schedule", () => {
      fc.assert(
        fc.property(inputArb, (input) => {
          const full = generateInstallments({
            ...input,
            includePrevious: true,
            includeNext: true,
          });
          const sliced = generateInstallments(input);
          const start = input.includePrevious ? 1 : input.current;
          const end = input.includeNext ? input.count : input.current;
          const expected = full.filter((p) => p.number >= start && p.number <= end);
          expect(sliced).toEqual(expected);
        }),
      );
    });
  });

  describe("validation", () => {
    it("rejects a non-positive or non-integer count", () => {
      const base: Omit<InstallmentInput, "count" | "current"> = {
        total: Money.fromReais(-100),
        includePrevious: false,
        includeNext: true,
        baseDate: "2026-06-10",
      };
      expect(() => generateInstallments({ ...base, count: 0, current: 1 })).toThrow(RangeError);
      expect(() => generateInstallments({ ...base, count: 2.5, current: 1 })).toThrow(RangeError);
    });

    it("rejects a current outside [1, count]", () => {
      const base: Omit<InstallmentInput, "current"> = {
        total: Money.fromReais(-100),
        count: 5,
        includePrevious: false,
        includeNext: true,
        baseDate: "2026-06-10",
      };
      expect(() => generateInstallments({ ...base, current: 0 })).toThrow(RangeError);
      expect(() => generateInstallments({ ...base, current: 6 })).toThrow(RangeError);
      expect(() => generateInstallments({ ...base, current: 2.5 })).toThrow(RangeError);
    });
  });

  describe("concrete examples (prototype seed data)", () => {
    // Seed "Notebook Dell": N=10, current=4 (atual) on 2026-06-15.
    // Parcela 3 (paga) -> 2026-03-15, parcela 5 (futura) -> 2026-07-15.
    const notebook: InstallmentInput = {
      total: Money.fromReais(-4800), // 10 x 480.00 (full purchase principal)
      count: 10,
      current: 4,
      includePrevious: true,
      includeNext: true,
      baseDate: "2026-06-15",
    };

    it("reproduces the Notebook Dell schedule (10x, current=4)", () => {
      const list = generateInstallments(notebook);
      expect(list).toHaveLength(10);

      // Even 4800.00 / 10 -> exactly 480.00 each.
      for (const p of list) {
        expect(p.amount.cents).toBe(-48000);
        expect(p.total).toBe(10);
      }

      // Dates: month-stepped from June 2026 on day 15.
      expect(list.map((p) => p.date)).toEqual([
        "2026-03-15", // 1
        "2026-04-15", // 2
        "2026-05-15", // 3
        "2026-06-15", // 4 (atual)
        "2026-07-15", // 5
        "2026-08-15", // 6
        "2026-09-15", // 7
        "2026-10-15", // 8
        "2026-11-15", // 9
        "2026-12-15", // 10
      ]);

      // Status matches the prototype's seed (3=paga, 4=atual, 5=futura).
      const byNo = new Map(list.map((p) => [p.number, p.status]));
      expect(byNo.get(3)).toBe("paga");
      expect(byNo.get(4)).toBe("atual");
      expect(byNo.get(5)).toBe("futura");

      // Sum is exactly the principal.
      expect(Money.sum(list.map((p) => p.amount)).cents).toBe(-480000);
    });

    it("default UI flags (next only, current=1) emit current..N", () => {
      // split.jsx defaults: parcCur='1', parcNext=true, parcPrev=false.
      const list = generateInstallments({
        total: Money.fromReais(-120), // default 12000 cents in the UI
        count: 3,
        current: 1,
        includePrevious: false,
        includeNext: true,
        baseDate: "2026-06-10",
      });
      expect(list.map((p) => p.number)).toEqual([1, 2, 3]);
      // 120.00 / 3 = exactly 40.00 each.
      expect(list.map((p) => p.amount.cents)).toEqual([-4000, -4000, -4000]);
      expect(list.map((p) => p.status)).toEqual(["atual", "futura", "futura"]);
      expect(list.map((p) => p.date)).toEqual(["2026-06-10", "2026-07-10", "2026-08-10"]);
    });

    it("distributes leftover cents to the earliest installments (largest-remainder)", () => {
      // 100.00 / 3 = 33.333..., so cents = 3334, 3333, 3333 and sum = 10000.
      const list = generateInstallments({
        total: Money.fromReais(-100),
        count: 3,
        current: 1,
        includePrevious: false,
        includeNext: true,
        baseDate: "2026-01-31",
      });
      expect(list.map((p) => p.amount.cents)).toEqual([-3334, -3333, -3333]);
      expect(Money.sum(list.map((p) => p.amount)).cents).toBe(-10000);
    });

    it("clamps end-of-month dates (Jan 31 -> Feb 28/29)", () => {
      // Base 2024-01-31 (leap year): step forward one month clamps to Feb 29.
      const list = generateInstallments({
        total: Money.fromReais(-300),
        count: 4,
        current: 1,
        includePrevious: false,
        includeNext: true,
        baseDate: "2024-01-31",
      });
      expect(list.map((p) => p.date)).toEqual([
        "2024-01-31",
        "2024-02-29", // leap-year clamp
        "2024-03-31",
        "2024-04-30", // 30-day month clamp
      ]);
    });

    it("includePrevious only (prev=true, next=false) emits 1..current", () => {
      const list = generateInstallments({
        total: Money.fromReais(-90),
        count: 6,
        current: 4,
        includePrevious: true,
        includeNext: false,
        baseDate: "2026-06-15",
      });
      expect(list.map((p) => p.number)).toEqual([1, 2, 3, 4]);
      expect(list.map((p) => p.status)).toEqual(["paga", "paga", "paga", "atual"]);
    });

    it("no flags emits only the current installment", () => {
      const list = generateInstallments({
        total: Money.fromReais(-90),
        count: 6,
        current: 4,
        includePrevious: false,
        includeNext: false,
        baseDate: "2026-06-15",
      });
      expect(list).toHaveLength(1);
      expect(list[0]?.number).toBe(4);
      expect(list[0]?.status).toBe("atual");
      // The slice still carries the per-parcela amount from the full plan.
      expect(list[0]?.amount.cents).toBe(-1500); // 90.00 / 6 = 15.00
    });
  });
});
