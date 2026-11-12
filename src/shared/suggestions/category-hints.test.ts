import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildCategoryHints,
  descriptionKey,
  type HintSource,
  NO_CATEGORY_HINTS,
  suggestCategory,
} from "./category-hints";

const expense = (description: string, categoryId: string | null, date = "2026-06-10"): HintSource => ({
  kind: "expense",
  description,
  categoryId,
  date,
});

describe("descriptionKey", () => {
  it("ignores case, accents, punctuation and words without a letter", () => {
    expect(descriptionKey("Mercado 12/10")).toBe("mercado");
    expect(descriptionKey("  MERCADO  ")).toBe("mercado");
    expect(descriptionKey("Pão de Açúcar")).toBe("pao de acucar");
    expect(descriptionKey("Uber*Trip #4821")).toBe("uber trip");
    expect(descriptionKey("Parcela 3/10 — TV")).toBe("parcela tv");
    expect(descriptionKey("2x1")).toBe("2x1");
    expect(descriptionKey("12/10")).toBe("");
    expect(descriptionKey("")).toBe("");
  });
});

describe("buildCategoryHints", () => {
  it("keeps, per description, the category used most often", () => {
    const hints = buildCategoryHints([
      expense("Uber", "transport"),
      expense("uber", "transport"),
      expense("UBER", "leisure"),
      expense("Padaria", "food"),
    ]);
    expect(hints.byDescription).toEqual({ uber: "transport", padaria: "food" });
    expect(hints.byFirstWord).toEqual({ uber: "transport", padaria: "food" });
  });

  it("breaks a tie with the most recent use", () => {
    const hints = buildCategoryHints([
      expense("Farmácia", "health", "2026-05-01"),
      expense("Farmácia", "home", "2026-06-20"),
    ]);
    expect(hints.byDescription.farmacia).toBe("home");
  });

  it("counts only categorised expenses with something to go by", () => {
    const hints = buildCategoryHints([
      expense("Uber", null),
      { kind: "income", description: "Salário", categoryId: "x", date: "2026-06-05" },
      { kind: "transfer", description: "Reserva", categoryId: "x", date: "2026-06-05" },
      expense("12/10", "food"),
      expense("Pg", "food"),
    ]);
    expect(hints).toEqual(NO_CATEGORY_HINTS);
  });

  it("learns the first word across different descriptions", () => {
    const hints = buildCategoryHints([
      expense("Uber centro", "transport"),
      expense("Uber aeroporto", "transport"),
      expense("Uber Eats", "food"),
    ]);
    expect(hints.byFirstWord.uber).toBe("transport");
    expect(hints.byDescription["uber eats"]).toBe("food");
  });
});

describe("suggestCategory", () => {
  const hints = buildCategoryHints([
    expense("Uber centro", "transport"),
    expense("Uber aeroporto", "transport"),
    expense("Uber Eats", "food"),
    expense("Mercado Extra", "food"),
    expense("Mercado Livre", "shopping"),
    expense("Mercado Livre", "shopping"),
    expense("Academia", "health"),
  ]);

  it("answers with the same description first", () => {
    expect(suggestCategory("uber eats", hints)).toBe("food");
    expect(suggestCategory("Mercado Livre 3/10", hints)).toBe("shopping");
  });

  it("falls back to the first word", () => {
    expect(suggestCategory("Uber para casa", hints)).toBe("transport");
    expect(suggestCategory("Mercado da esquina", hints)).toBe("shopping");
  });

  it("guesses a first word still being typed only when there is one answer", () => {
    expect(suggestCategory("aca", hints)).toBe("health");
    expect(suggestCategory("ube", hints)).toBe("transport");
    // "mer" could become "mercado" only, which has one dominant category.
    expect(suggestCategory("mer", hints)).toBe("shopping");
  });

  it("stays silent when the history has nothing clear to say", () => {
    expect(suggestCategory("", hints)).toBeNull();
    expect(suggestCategory("ub", hints)).toBeNull();
    expect(suggestCategory("Cinema", hints)).toBeNull();
    expect(suggestCategory("12/10", hints)).toBeNull();
    expect(suggestCategory("Uber", NO_CATEGORY_HINTS)).toBeNull();
    // Two different first words share the prefix and disagree.
    const split = buildCategoryHints([expense("Posto Shell", "car"), expense("Postagem", "office")]);
    expect(suggestCategory("pos", split)).toBeNull();
    expect(suggestCategory("posto", split)).toBe("car");
  });

  it("only ever suggests a category the history used, and repeats a description's own", () => {
    const rowArb = fc.record({
      description: fc.constantFrom(
        "Uber",
        "Uber Eats",
        "Mercado",
        "mercado 2",
        "Farmácia",
        "Posto",
        "Pg",
        "99",
      ),
      categoryId: fc.constantFrom("a", "b", "c", null),
      date: fc.constantFrom("2026-05-01", "2026-06-01", "2026-07-01"),
    });
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 30 }), fc.string({ maxLength: 12 }), (rows, typed) => {
        const history = rows.map((r) => ({ kind: "expense", ...r }));
        const built = buildCategoryHints(history);
        const used = new Set<string | null>(history.map((r) => r.categoryId).filter((id) => id !== null));
        const free = suggestCategory(typed, built);
        if (free !== null) expect(used.has(free)).toBe(true);
        for (const row of history) {
          const suggestion = suggestCategory(row.description, built);
          if (suggestion !== null) expect(used.has(suggestion)).toBe(true);
          // A description filed under one category only is suggested that category.
          const own = new Set(
            history
              .filter((r) => descriptionKey(r.description) === descriptionKey(row.description))
              .map((r) => r.categoryId)
              .filter((id) => id !== null),
          );
          if (own.size === 1 && descriptionKey(row.description).length >= 3) {
            expect(suggestion).toBe([...own][0]);
          }
        }
      }),
    );
  });
});
