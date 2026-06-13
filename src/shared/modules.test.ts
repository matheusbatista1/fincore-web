import { describe, expect, it } from "vitest";
import {
  ALL_MODULE_KEYS,
  isHrefEnabled,
  isModuleEnabled,
  type ModuleKey,
  moduleForHref,
  sanitizeModules,
} from "./modules";

describe("modules", () => {
  describe("isModuleEnabled", () => {
    it("is true only when the key is in the enabled set", () => {
      expect(isModuleEnabled(["people"], "people")).toBe(true);
      expect(isModuleEnabled(["people"], "budgets")).toBe(false);
      expect(isModuleEnabled([], "people")).toBe(false);
    });
  });

  describe("moduleForHref", () => {
    it("maps optional routes to their module, with nested paths", () => {
      expect(moduleForHref("/people")).toBe("people");
      expect(moduleForHref("/budgets/new")).toBe("budgets");
      expect(moduleForHref("/goals")).toBe("goals");
      expect(moduleForHref("/reports")).toBe("reports");
    });

    it("returns null for core routes", () => {
      for (const href of ["/dashboard", "/wallets", "/cards", "/transactions", "/monthly", "/settings"]) {
        expect(moduleForHref(href)).toBeNull();
      }
    });
  });

  describe("isHrefEnabled", () => {
    it("core routes are always enabled", () => {
      expect(isHrefEnabled([], "/dashboard")).toBe(true);
      expect(isHrefEnabled([], "/transactions")).toBe(true);
    });

    it("optional routes follow the enabled set", () => {
      expect(isHrefEnabled(["people"], "/people")).toBe(true);
      expect(isHrefEnabled([], "/people")).toBe(false);
      expect(isHrefEnabled(["budgets"], "/reports")).toBe(false);
    });
  });

  describe("sanitizeModules", () => {
    it("keeps only valid, de-duplicated module keys", () => {
      expect(sanitizeModules(["people", "budgets", "people"])).toEqual(["people", "budgets"]);
    });

    it("drops unknown values and non-arrays", () => {
      expect(sanitizeModules(["people", "nope", 42, null])).toEqual(["people"]);
      expect(sanitizeModules("people")).toEqual([]);
      expect(sanitizeModules(undefined)).toEqual([]);
    });

    it("accepts every declared module key", () => {
      expect(sanitizeModules([...ALL_MODULE_KEYS])).toEqual([...ALL_MODULE_KEYS] satisfies ModuleKey[]);
    });
  });
});
