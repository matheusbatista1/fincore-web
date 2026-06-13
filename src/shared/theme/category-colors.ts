/**
 * Color palette for categories. Superset of the people palette (its first 12
 * entries match `PERSON_COLORS`) plus richer/darker tones and two neutrals, so a
 * user can pick a distinct color per category. Kept separate from `PERSON_COLORS`
 * to leave the people-avatar semantics untouched.
 */
export const CATEGORY_COLORS = [
  // The original 12 (parity with PERSON_COLORS).
  "#FB6E83",
  "#56B6F2",
  "#34E1A8",
  "#F5B53F",
  "#9B79FF",
  "#FF8A5B",
  "#E36FD0",
  "#5BD1C9",
  "#A0E060",
  "#F2709C",
  "#7C8CFF",
  "#C9A24B",
  // Extra tones for more range.
  "#EF4444",
  "#D97706",
  "#65A30D",
  "#059669",
  "#0891B2",
  "#2563EB",
  "#7C3AED",
  "#DB2777",
  "#E11D48",
  "#0F766E",
  "#64748B",
  "#78716C",
] as const;

/** Default pick for a new category (purple). */
export const DEFAULT_CATEGORY_COLOR = "#9B79FF";
