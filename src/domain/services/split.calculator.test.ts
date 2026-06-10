import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Money } from "../money/money";
import { calculateSplit, type SplitInput } from "./split.calculator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const reais = (n: number) => Money.fromReais(n);
const sumShares = (shares: ReadonlyMap<string, Money>) => Money.sum([...shares.values()]).cents;

// A small pool of distinct person ids for property tests.
const personIds = ["p-mar", "p-joao", "p-mae", "p-ped", "p-cam"] as const;

// Unique, ordered subsets of the id pool (order is significant for remainder placement).
const selectedArb = fc
  .subarray([...personIds], { minLength: 0, maxLength: personIds.length })
  .chain((ids) => fc.constant(ids));

// Positive unit amounts up to R$ 1,000,000.00, in cents.
const unitCentsArb = fc.integer({ min: 1, max: 100_000_000 });

// ---------------------------------------------------------------------------
// Concrete examples taken from the prototype seed data (data.js)
// ---------------------------------------------------------------------------

describe("calculateSplit — concrete examples from data.js", () => {
  it('"Pizzaria Bráz" R$ 148,00 split with Mariana → 74,00 each, myShare 74,00', () => {
    const r = calculateSplit({
      unit: reais(148),
      method: "equal",
      meIn: true,
      selected: ["p-mar"],
    });
    expect(r.valid).toBe(true);
    expect(r.shares.get("p-mar")?.cents).toBe(7400);
    expect(r.myShare.cents).toBe(7400);
    expect(r.othersTotal.cents).toBe(7400);
    expect(r.partCount).toBe(2);
  });

  it('"Passagem aérea (Mãe)" R$ 500,00 with 100% Sofia → myShare 0', () => {
    // meIn = false, single selected absorbs the whole amount.
    const r = calculateSplit({
      unit: reais(500),
      method: "equal",
      meIn: false,
      selected: ["p-mae"],
    });
    expect(r.valid).toBe(true);
    expect(r.shares.get("p-mae")?.cents).toBe(50000);
    expect(r.myShare.cents).toBe(0);
    expect(r.othersTotal.cents).toBe(50000);
    expect(r.partCount).toBe(1);
  });

  it('"Bar do Juarez" R$ 276,00 split 3 ways (você + joão + cam) → 92,00 each', () => {
    const r = calculateSplit({
      unit: reais(276),
      method: "equal",
      meIn: true,
      selected: ["p-joao", "p-cam"],
    });
    expect(r.valid).toBe(true);
    expect(r.shares.get("p-joao")?.cents).toBe(9200);
    expect(r.shares.get("p-cam")?.cents).toBe(9200);
    expect(r.myShare.cents).toBe(9200);
    expect(r.othersTotal.cents).toBe(18400);
    expect(r.partCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Equal method
// ---------------------------------------------------------------------------

describe("calculateSplit — equal method", () => {
  it("places the rounding remainder on 'você' when meIn (R$ 100 / 3)", () => {
    // 10000 / 3 = 3333.33 → each rounds to 3333. me = 10000 - 3333*2 = 3334.
    const r = calculateSplit({
      unit: reais(100),
      method: "equal",
      meIn: true,
      selected: ["p-joao", "p-cam"],
    });
    expect(r.shares.get("p-joao")?.cents).toBe(3333);
    expect(r.shares.get("p-cam")?.cents).toBe(3333);
    expect(r.myShare.cents).toBe(3334);
    // reconciles exactly to unit
    expect(r.myShare.cents + sumShares(r.shares)).toBe(10000);
  });

  it("places the rounding remainder on the LAST selected when meIn is false (R$ 100 / 3)", () => {
    // partCount = 3, each = round(10000/3) = 3333.
    // first two get 3333; last = 10000 - 3333*2 = 3334.
    const r = calculateSplit({
      unit: reais(100),
      method: "equal",
      meIn: false,
      selected: ["p-joao", "p-cam", "p-mae"],
    });
    expect(r.shares.get("p-joao")?.cents).toBe(3333);
    expect(r.shares.get("p-cam")?.cents).toBe(3333);
    expect(r.shares.get("p-mae")?.cents).toBe(3334);
    expect(r.myShare.cents).toBe(0);
    expect(sumShares(r.shares)).toBe(10000);
  });

  it("pins 'each' to round(unit/partCount) for odd cents, meIn false (R$ 99,99 / 4)", () => {
    // partCount = 4, each = round(9999 / 4) = round(2499.75) = 2500.
    // The first three each get 2500; the LAST absorbs the rest: 9999 - 2500*3 = 2499.
    const r = calculateSplit({
      unit: Money.fromCents(9999),
      method: "equal",
      meIn: false,
      selected: ["p-mar", "p-joao", "p-mae", "p-ped"],
    });
    expect(r.shares.get("p-mar")?.cents).toBe(2500);
    expect(r.shares.get("p-joao")?.cents).toBe(2500);
    expect(r.shares.get("p-mae")?.cents).toBe(2500);
    expect(r.shares.get("p-ped")?.cents).toBe(2499);
    expect(r.myShare.cents).toBe(0);
    expect(sumShares(r.shares)).toBe(9999);
  });

  it("is invalid with no participants", () => {
    const r = calculateSplit({
      unit: reais(50),
      method: "equal",
      meIn: false,
      selected: [],
    });
    expect(r.valid).toBe(false);
    expect(r.partCount).toBe(0);
    expect(r.warning).toBe("Adicione pelo menos uma pessoa ao rateio.");
  });

  it("is invalid when unit <= 0", () => {
    const r = calculateSplit({
      unit: Money.zero(),
      method: "equal",
      meIn: true,
      selected: ["p-mar"],
    });
    expect(r.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Custom method
// ---------------------------------------------------------------------------

describe("calculateSplit — custom method", () => {
  it("gives the leftover to 'você' when meIn", () => {
    const r = calculateSplit({
      unit: reais(100),
      method: "custom",
      meIn: true,
      selected: ["p-mar"],
      custom: new Map([["p-mar", reais(30)]]),
    });
    expect(r.valid).toBe(true);
    expect(r.shares.get("p-mar")?.cents).toBe(3000);
    expect(r.myShare.cents).toBe(7000);
    expect(r.othersTotal.cents).toBe(3000);
  });

  it("treats a selected person without a custom amount as 0", () => {
    const r = calculateSplit({
      unit: reais(100),
      method: "custom",
      meIn: true,
      selected: ["p-mar", "p-joao"],
      custom: new Map([["p-mar", reais(40)]]),
    });
    expect(r.shares.get("p-mar")?.cents).toBe(4000);
    expect(r.shares.get("p-joao")?.cents).toBe(0);
    expect(r.myShare.cents).toBe(6000);
  });

  it("is invalid when the sum exceeds the unit (meIn) and reports the overflow", () => {
    const r = calculateSplit({
      unit: reais(100),
      method: "custom",
      meIn: true,
      selected: ["p-mar"],
      custom: new Map([["p-mar", reais(120)]]),
    });
    expect(r.valid).toBe(false);
    expect(r.myShare.cents).toBe(-2000); // unit - sum, can go negative
    expect(r.warning).toContain("excede a parcela");
  });

  it("requires the people to cover exactly unit when meIn is false (under → invalid)", () => {
    const r = calculateSplit({
      unit: reais(100),
      method: "custom",
      meIn: false,
      selected: ["p-mar", "p-joao"],
      custom: new Map([
        ["p-mar", reais(40)],
        ["p-joao", reais(50)],
      ]),
    });
    expect(r.valid).toBe(false);
    expect(r.myShare.cents).toBe(0);
    expect(r.warning).toContain("Faltam");
  });

  it("is valid when the people cover exactly unit (meIn false)", () => {
    const r = calculateSplit({
      unit: reais(100),
      method: "custom",
      meIn: false,
      selected: ["p-mar", "p-joao"],
      custom: new Map([
        ["p-mar", reais(40)],
        ["p-joao", reais(60)],
      ]),
    });
    expect(r.valid).toBe(true);
    expect(r.myShare.cents).toBe(0);
    expect(r.othersTotal.cents).toBe(10000);
  });

  it("is invalid (over) when meIn is false and the sum exceeds unit", () => {
    const r = calculateSplit({
      unit: reais(100),
      method: "custom",
      meIn: false,
      selected: ["p-mar", "p-joao"],
      custom: new Map([
        ["p-mar", reais(70)],
        ["p-joao", reais(60)],
      ]),
    });
    expect(r.valid).toBe(false);
    expect(r.warning).toContain("excede a parcela");
  });
});

// ---------------------------------------------------------------------------
// Property tests — business invariants
// ---------------------------------------------------------------------------

describe("calculateSplit — invariants (property tests)", () => {
  it("equal split: shares + myShare always reconcile to unit when valid", () => {
    fc.assert(
      fc.property(unitCentsArb, fc.boolean(), selectedArb, (unitCents, meIn, selected) => {
        const r = calculateSplit({
          unit: Money.fromCents(unitCents),
          method: "equal",
          meIn,
          selected,
        });
        // Only meaningful configurations reconcile (must have at least one participant).
        fc.pre(r.valid);
        expect(r.myShare.cents + sumShares(r.shares)).toBe(unitCents);
      }),
    );
  });

  it("equal split distributes evenly: every person's share is `each`, within 1 cent of unit/partCount", () => {
    // The prototype gives EVERY selected person exactly `each = r2(unit/partCount)`,
    // so the people's shares are identical to one another and each lies within one
    // cent of the exact quotient. The remainder is concentrated in the absorber
    // ("você" when meIn, the last selected otherwise) — see the dedicated remainder
    // test below — so the absorber may differ by more than one cent and is excluded
    // from this even-distribution check.
    fc.assert(
      fc.property(unitCentsArb, fc.boolean(), selectedArb, (unitCents, meIn, selected) => {
        const r = calculateSplit({
          unit: Money.fromCents(unitCents),
          method: "equal",
          meIn,
          selected,
        });
        fc.pre(r.valid);

        const partCount = (meIn ? 1 : 0) + selected.length;
        const exact = unitCents / partCount;

        // Non-absorbing people each get the same rounded `each`, within 1 cent of exact.
        const absorberId = meIn ? null : (selected[selected.length - 1] as string);
        for (const [id, share] of r.shares) {
          if (id === absorberId) continue;
          expect(Math.abs(share.cents - exact)).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it("equal split: remainder lands on 'você' when meIn, on the last selected otherwise", () => {
    fc.assert(
      fc.property(
        unitCentsArb,
        fc
          .subarray([...personIds], { minLength: 1, maxLength: personIds.length })
          .chain((ids) => fc.constant(ids)),
        fc.boolean(),
        (unitCents, selected, meIn) => {
          const unit = Money.fromCents(unitCents);
          const r = calculateSplit({ unit, method: "equal", meIn, selected });
          fc.pre(r.valid);

          const partCount = (meIn ? 1 : 0) + selected.length;
          const each = unit.multiply(1 / partCount);

          if (meIn) {
            // Every selected person gets exactly `each`; remainder is in myShare.
            for (const id of selected) {
              expect(r.shares.get(id)?.cents).toBe(each.cents);
            }
            expect(r.myShare.cents).toBe(unit.subtract(each.multiply(selected.length)).cents);
          } else {
            // All but the last get `each`; the last absorbs the remainder.
            const lastId = selected[selected.length - 1] as string;
            for (let i = 0; i < selected.length - 1; i++) {
              const id = selected[i] as string;
              expect(r.shares.get(id)?.cents).toBe(each.cents);
            }
            expect(r.shares.get(lastId)?.cents).toBe(unit.subtract(each.multiply(selected.length - 1)).cents);
            expect(r.myShare.cents).toBe(0);
          }
        },
      ),
    );
  });

  it("custom split (meIn): myShare = unit − Σ shares, so everything reconciles to unit", () => {
    const customAmountArb = fc.integer({ min: 0, max: 50_000_000 });
    fc.assert(
      fc.property(
        unitCentsArb,
        fc
          .subarray([...personIds], { minLength: 1, maxLength: personIds.length })
          .chain((ids) => fc.constant(ids)),
        fc.array(customAmountArb, { minLength: personIds.length, maxLength: personIds.length }),
        (unitCents, selected, amounts) => {
          const custom = new Map<string, Money>();
          selected.forEach((id, i) => {
            custom.set(id, Money.fromCents(amounts[i] ?? 0));
          });
          const r = calculateSplit({
            unit: Money.fromCents(unitCents),
            method: "custom",
            meIn: true,
            selected,
            custom,
          });
          // Regardless of validity, the user always absorbs the leftover, so the
          // pieces reconcile to the unit exactly.
          expect(r.myShare.cents + sumShares(r.shares)).toBe(unitCents);
        },
      ),
    );
  });

  it("othersTotal always equals the sum of the people's shares", () => {
    fc.assert(
      fc.property(
        unitCentsArb,
        fc.constantFrom("equal", "custom") as fc.Arbitrary<SplitInput["method"]>,
        fc.boolean(),
        selectedArb,
        (unitCents, method, meIn, selected) => {
          const custom = new Map<string, Money>();
          for (const id of selected) custom.set(id, Money.fromCents(unitCents % 1000));
          const r = calculateSplit({
            unit: Money.fromCents(unitCents),
            method,
            meIn,
            selected,
            ...(method === "custom" ? { custom } : {}),
          });
          expect(r.othersTotal.cents).toBe(sumShares(r.shares));
        },
      ),
    );
  });

  it("myShare is zero whenever the user is excluded", () => {
    fc.assert(
      fc.property(
        unitCentsArb,
        fc.constantFrom("equal", "custom") as fc.Arbitrary<SplitInput["method"]>,
        selectedArb,
        (unitCents, method, selected) => {
          const custom = new Map<string, Money>();
          for (const id of selected) custom.set(id, Money.fromCents(100));
          const r = calculateSplit({
            unit: Money.fromCents(unitCents),
            method,
            meIn: false,
            selected,
            ...(method === "custom" ? { custom } : {}),
          });
          expect(r.myShare.cents).toBe(0);
        },
      ),
    );
  });
});
