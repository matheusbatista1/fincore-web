import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addMonths,
  compareMonths,
  dateInMonth,
  dayOf,
  daysInMonth,
  isValidCompetenceMonth,
  isValidIsoDate,
  monthOf,
  monthsBetween,
} from "./competence-month";

const monthArb = () =>
  fc
    .tuple(fc.integer({ min: 2000, max: 2099 }), fc.integer({ min: 1, max: 12 }))
    .map(([y, m]) => `${y}-${String(m).padStart(2, "0")}`);

describe("competence-month basics", () => {
  it("extracts month and day from a date", () => {
    expect(monthOf("2026-06-10")).toBe("2026-06");
    expect(dayOf("2026-06-10")).toBe(10);
    expect(dayOf("2026-06-05")).toBe(5);
  });

  it("counts days in a month, including leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("validates ISO dates and months", () => {
    expect(isValidIsoDate("2026-06-10")).toBe(true);
    expect(isValidIsoDate("2026-13-10")).toBe(false);
    expect(isValidIsoDate("2026-06-32")).toBe(false);
    expect(isValidCompetenceMonth("2026-06")).toBe(true);
    expect(isValidCompetenceMonth("2026-00")).toBe(false);
  });
});

describe("addMonths", () => {
  it("shifts forward and backward across year boundaries", () => {
    expect(addMonths("2026-06", 1)).toBe("2026-07");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-06", 12)).toBe("2027-06");
    expect(addMonths("2026-06", -18)).toBe("2024-12");
  });

  it("is reversible and consistent with monthsBetween", () => {
    fc.assert(
      fc.property(monthArb(), fc.integer({ min: -240, max: 240 }), (m, k) => {
        expect(addMonths(addMonths(m, k), -k)).toBe(m);
        expect(monthsBetween(m, addMonths(m, k))).toBe(k);
      }),
    );
  });
});

describe("dateInMonth", () => {
  it("clamps the day to the last day of the month", () => {
    expect(dateInMonth("2026-06", 5)).toBe("2026-06-05");
    expect(dateInMonth("2026-02", 31)).toBe("2026-02-28");
    expect(dateInMonth("2024-02", 31)).toBe("2024-02-29");
    expect(dateInMonth("2026-04", 31)).toBe("2026-04-30");
    expect(dateInMonth("2026-06", 0)).toBe("2026-06-01");
  });

  it("always produces a valid date inside the requested month", () => {
    fc.assert(
      fc.property(monthArb(), fc.integer({ min: -5, max: 40 }), (m, day) => {
        const date = dateInMonth(m, day);
        expect(isValidIsoDate(date)).toBe(true);
        expect(monthOf(date)).toBe(m);
      }),
    );
  });
});

describe("compareMonths", () => {
  it("orders months chronologically", () => {
    expect(compareMonths("2026-05", "2026-06")).toBe(-1);
    expect(compareMonths("2026-06", "2026-06")).toBe(0);
    expect(compareMonths("2027-01", "2026-12")).toBe(1);
  });
});
