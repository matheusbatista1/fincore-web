import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

/** A recorded person payment (acerto), enriched with its account label, for the UI. */
export interface SettlementView {
  readonly id: string;
  readonly personId: string;
  readonly amountCents: number;
  readonly date: string;
  readonly accountId: string | null;
  /** "Bank · Name" of the account the money moved through, or null for a pure ledger acerto. */
  readonly accountLabel: string | null;
  readonly note: string | null;
}

/** All of a user's settlements (newest first), so the People screen can edit/undo them. */
export async function getSettlements(repo: FinanceRepository, userId: string): Promise<SettlementView[]> {
  const ws = await loadWorkspaceCached(repo, userId);
  const accountLabelById = new Map(ws.accounts.map((a) => [a.id, `${a.bank} · ${a.name}`]));
  return ws.settlements
    .map((s) => ({
      id: s.id,
      personId: s.personId,
      amountCents: s.amountCents,
      date: s.date,
      accountId: s.accountId,
      accountLabel: s.accountId ? (accountLabelById.get(s.accountId) ?? null) : null,
      note: s.note ?? null,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
