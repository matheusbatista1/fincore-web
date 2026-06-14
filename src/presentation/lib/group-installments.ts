import type { TransactionListItem } from "@/application/use-cases/get-transactions";

/**
 * Collapse installment parcelas into a single representative row per group,
 * preserving the input order. The representative is the first parcela seen of
 * each group (in a newest-first list, the most recent one); the full set is still
 * available elsewhere by filtering on `installmentGroupId`. Non-installment items
 * pass through untouched.
 */
export function collapseRowsByInstallments(items: TransactionListItem[]): TransactionListItem[] {
  const seen = new Set<string>();
  const result: TransactionListItem[] = [];
  for (const item of items) {
    const groupId = item.installmentGroupId;
    if (groupId && item.parcela) {
      if (seen.has(groupId)) continue;
      seen.add(groupId);
    }
    result.push(item);
  }
  return result;
}
