import { settledItemShareCents } from "@/application/use-cases/get-transactions";
import type { StmtGroup } from "@/presentation/components/monthly/stmt-card";

/**
 * Pure personal/general lens logic for the monthly statement groups. Kept in its own module (no
 * server imports) so it stays unit-testable — the statement component imports server actions
 * (pay-fatura) that must not be pulled into a plain vitest import.
 *
 * Recast a group through the personal lens: expenses show only the user's share, income drops
 * reimbursements; settlements ("Acerto") are reimbursements of others' shares, so they're dropped
 * from both directions (mirrors balance.calculator's personal lens, which ignores settlements).
 * Transfers and the general lens pass through unchanged.
 */
export function applyLens(group: StmtGroup, isPersonal: boolean): StmtGroup {
  if (!isPersonal || !group.lens || group.lens === "transfer") return group;
  if (group.lens === "income") {
    const items = group.items.filter((i) => !i.isReimbursement && !i.settlement);
    return {
      ...group,
      items,
      // People receivables are general-only — drop them from the personal lens.
      receivables: undefined,
      totalCents: items.reduce((s, i) => s + i.amountCents, 0),
      countText: `${items.length} ${items.length === 1 ? "entrada" : "entradas"}`,
    };
  }
  // expense: drop settlements, then display only the user's own share per row — scaled to the
  // amount actually PAID when the obligation was settled with a discount (mirrors the dashboard).
  const items = group.items
    .filter((i) => !i.settlement)
    .map((i) => ({
      ...i,
      amountCents: -settledItemShareCents(i),
    }));
  return {
    ...group,
    items,
    totalCents: items.reduce((s, i) => s + Math.abs(i.amountCents), 0),
    // The previsto slice through the same lens: the user's own share of the projected rows.
    projectedCents: items.filter((i) => i.projected).reduce((s, i) => s + Math.abs(i.amountCents), 0),
  };
}

/** Keep a group if it has rows OR (income) people-receivables to show. */
export const keepGroup = (g: StmtGroup): boolean => g.items.length > 0 || (g.receivables?.length ?? 0) > 0;
