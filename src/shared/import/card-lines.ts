/**
 * Split parsed card-bill lines into charges vs credits by **dominant sign**.
 *
 * A card statement is almost entirely purchases, with at most a few credits
 * (a bill payment or a refund). The amount sign for a purchase is
 * format-dependent — OFX credit-card files usually carry purchases as negative,
 * CSV exports (e.g. Nubank) as positive — so a fixed rule can't cover both.
 * Instead we treat the sign that appears in the **most lines** as the charges;
 * the minority sign is credits (which the domain can't represent as a card
 * transaction, so callers exclude them from the import).
 */
export function partitionCardLines<T extends { amountCents: number }>(
  rows: readonly T[],
): { charges: T[]; credits: T[] } {
  const negatives = rows.filter((row) => row.amountCents < 0).length;
  // Ties (and the all-empty case) treat negative as the charge sign.
  const chargeIsNegative = negatives >= rows.length - negatives;
  const charges: T[] = [];
  const credits: T[] = [];
  for (const row of rows) {
    const isCharge = chargeIsNegative ? row.amountCents < 0 : row.amountCents > 0;
    (isCharge ? charges : credits).push(row);
  }
  return { charges, credits };
}
