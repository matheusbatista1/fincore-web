/**
 * BRL currency formatting (pt-BR). Mirrors the prototype's `BRL`/`BRLc` helpers,
 * but operates on integer **cents** (the canonical money representation).
 */

// A single shared formatter instance (creating Intl.NumberFormat is expensive).
const REAIS_FORMAT = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export interface FormatBrlOptions {
  /** Show a leading "- " for negative amounts (default true). */
  readonly withSign?: boolean;
}

/** Format cents as "R$ 1.234,56" (or "- R$ 1.234,56" for negatives). */
export function formatBRL(cents: number, options: FormatBrlOptions = {}): string {
  const withSign = options.withSign ?? true;
  const negative = cents < 0;
  const value = REAIS_FORMAT.format(Math.abs(cents) / 100);
  const prefix = negative && withSign ? "- " : "";
  return `${prefix}R$ ${value}`;
}

/** Format the absolute value, never showing a sign (mirrors the prototype's `BRLc`). */
export function formatBRLAbsolute(cents: number): string {
  return formatBRL(cents, { withSign: false });
}
