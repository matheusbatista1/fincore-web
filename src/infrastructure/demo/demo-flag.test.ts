import { afterEach, describe, expect, it, vi } from "vitest";

// `notFound()` throws Next's own signal; here it is enough to know it was called.
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

import { demoEnabled, requireDemo } from "./demo-flag";

describe("the demo switch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is on only when FINCORE_DEMO is exactly 1", () => {
    vi.stubEnv("FINCORE_DEMO", "1");
    expect(demoEnabled()).toBe(true);
    for (const value of ["", "0", "true", "yes", " 1", "11"]) {
      vi.stubEnv("FINCORE_DEMO", value);
      expect(demoEnabled()).toBe(false);
    }
  });

  it("is off when the variable is not set at all", () => {
    vi.stubEnv("FINCORE_DEMO", undefined as unknown as string);
    expect(demoEnabled()).toBe(false);
  });

  it("makes a demo route not exist while it is off, and lets it through while it is on", () => {
    vi.stubEnv("FINCORE_DEMO", "");
    expect(() => requireDemo()).toThrow("NEXT_NOT_FOUND");
    vi.stubEnv("FINCORE_DEMO", "1");
    expect(() => requireDemo()).not.toThrow();
  });
});
