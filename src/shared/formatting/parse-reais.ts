/** Parse a pt-BR reais string ("1.234,56" or "1234.56") into integer cents (0 when invalid). */
export function reaisToCents(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}
