/**
 * Category hints — guess the category of a new expense from how the same description was filed
 * before. Pure and dependency-free: the layout builds the hints once from the history (server),
 * the form asks them for a suggestion as the description is typed (client).
 *
 * Deliberately simple and predictable (no fuzzy scoring): the same description, else the same first
 * word, else nothing. A wrong guess costs one tap; an erratic one costs trust.
 */

/** What the form needs to suggest a category. Plain data, safe to pass to a client component. */
export interface CategoryHints {
  /** Normalised description → the category it was filed under most often. */
  readonly byDescription: Readonly<Record<string, string>>;
  /** First word of a description → the category that word was filed under most often. */
  readonly byFirstWord: Readonly<Record<string, string>>;
}

export const NO_CATEGORY_HINTS: CategoryHints = { byDescription: {}, byFirstWord: {} };

/** A row of the history, as far as the hints care. */
export interface HintSource {
  readonly kind: string;
  readonly description: string;
  readonly categoryId: string | null;
  readonly date: string;
}

/** The shortest text worth guessing from: one or two letters match half the history. */
const MIN_LENGTH = 3;

/**
 * A description reduced to what identifies it: lower case, no accents, and only the words that
 * have a letter — "Mercado 12/10", "MERCADO" and "mercado  " are the same thing.
 */
export function descriptionKey(description: string): string {
  return description
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => /[a-z]/.test(word))
    .join(" ");
}

interface Tally {
  count: number;
  last: string;
}

/** The most used category of a tally; on a tie, the one used most recently. */
function winner(tallies: Map<string, Tally>): string | null {
  let best: [string, Tally] | null = null;
  for (const entry of tallies) {
    const [id, tally] = entry;
    if (
      best === null ||
      tally.count > best[1].count ||
      (tally.count === best[1].count &&
        (tally.last > best[1].last || (tally.last === best[1].last && id < best[0])))
    ) {
      best = entry;
    }
  }
  return best?.[0] ?? null;
}

function bump(index: Map<string, Map<string, Tally>>, key: string, categoryId: string, date: string): void {
  const tallies = index.get(key) ?? new Map<string, Tally>();
  const tally = tallies.get(categoryId) ?? { count: 0, last: "" };
  tally.count += 1;
  if (date > tally.last) tally.last = date;
  tallies.set(categoryId, tally);
  index.set(key, tallies);
}

/** Build the hints from the history: every categorised expense counts once. */
export function buildCategoryHints(rows: readonly HintSource[]): CategoryHints {
  const descriptions = new Map<string, Map<string, Tally>>();
  const firstWords = new Map<string, Map<string, Tally>>();
  for (const row of rows) {
    if (row.kind !== "expense" || row.categoryId === null) continue;
    const key = descriptionKey(row.description);
    if (key.length < MIN_LENGTH) continue;
    bump(descriptions, key, row.categoryId, row.date);
    const first = key.split(" ")[0] ?? "";
    if (first.length >= MIN_LENGTH) bump(firstWords, first, row.categoryId, row.date);
  }
  const collapse = (index: Map<string, Map<string, Tally>>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, tallies] of index) {
      const id = winner(tallies);
      if (id !== null) out[key] = id;
    }
    return out;
  };
  return { byDescription: collapse(descriptions), byFirstWord: collapse(firstWords) };
}

/**
 * The category to suggest for a description being typed, or null when the history has no clear
 * answer: the same description first, then the same first word, then a first word still being
 * typed — but only when every word it could become agrees on the category.
 */
export function suggestCategory(description: string, hints: CategoryHints): string | null {
  const key = descriptionKey(description);
  if (key.length < MIN_LENGTH) return null;
  const exact = hints.byDescription[key];
  if (exact !== undefined) return exact;

  const first = key.split(" ")[0] ?? "";
  if (first.length < MIN_LENGTH) return null;
  const byWord = hints.byFirstWord[first];
  if (byWord !== undefined) return byWord;

  // Still typing the first word ("ube" on the way to "uber"): suggest only if unambiguous.
  if (key !== first) return null;
  let candidate: string | null = null;
  for (const [word, categoryId] of Object.entries(hints.byFirstWord)) {
    if (!word.startsWith(first)) continue;
    if (candidate !== null && candidate !== categoryId) return null;
    candidate = categoryId;
  }
  return candidate;
}
