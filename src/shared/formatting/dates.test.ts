import { describe, expect, it } from "vitest";
import { monthLabel, relativeDateLabel, shortDate } from "./dates";

describe("relativeDateLabel", () => {
  const today = "2026-06-10";

  it("labels today and yesterday", () => {
    expect(relativeDateLabel("2026-06-10", today)).toBe("Hoje");
    expect(relativeDateLabel("2026-06-09", today)).toBe("Ontem");
  });

  it("falls back to DD/MM for other days", () => {
    expect(relativeDateLabel("2026-06-05", today)).toBe("05/06");
    expect(relativeDateLabel("2026-05-31", today)).toBe("31/05");
  });
});

describe("shortDate", () => {
  it("renders day/month", () => {
    expect(shortDate("2026-06-10")).toBe("10/06");
  });
});

describe("monthLabel", () => {
  it("renders short and long month names", () => {
    expect(monthLabel("2026-06")).toBe("Jun 2026");
    expect(monthLabel("2026-06", { long: true })).toBe("Junho 2026");
    expect(monthLabel("2026-01", { long: true })).toBe("Janeiro 2026");
    expect(monthLabel("2026-12", { long: true })).toBe("Dezembro 2026");
  });
});
