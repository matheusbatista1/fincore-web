import { describe, expect, it } from "vitest";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { collapseRowsByInstallments } from "./group-installments";

const item = (id: string, groupId: string | null, number?: number, total?: number): TransactionListItem =>
  ({
    id,
    installmentGroupId: groupId,
    parcela: number !== undefined && total !== undefined ? { number, total, status: "atual" } : null,
  }) as unknown as TransactionListItem;

describe("collapseRowsByInstallments", () => {
  it("keeps one row per installment group, dropping the rest, order preserved", () => {
    const rows = [item("a1", "A", 1, 3), item("b", null), item("a2", "A", 2, 3), item("c1", "C", 1, 2)];
    expect(collapseRowsByInstallments(rows).map((r) => r.id)).toEqual(["a1", "b", "c1"]);
  });

  it("passes non-installment items through unchanged", () => {
    const rows = [item("x", null), item("y", null)];
    expect(collapseRowsByInstallments(rows).map((r) => r.id)).toEqual(["x", "y"]);
  });
});
