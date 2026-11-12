import { getProfileCached, loadWorkspaceCached } from "../loaders";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";

/**
 * A copy of everything the user has recorded, as one document they can keep: every account, card,
 * person, category, transaction, acerto, budget, goal and fatura setting, exactly as the app holds
 * them. It carries no credential and nothing about the sign-in (no e-mail, no avatar).
 */
export interface WorkspaceBackup {
  readonly format: "fincore-backup";
  /** Bumped when the shape of `data` changes in a way a reader must know about. */
  readonly version: 1;
  /** When the copy was taken (ISO-8601, UTC). */
  readonly exportedAt: string;
  /** How many of each thing the copy holds — a quick way to see it is whole. */
  readonly counts: Readonly<Record<keyof Workspace, number>>;
  /** The settings that shape what the app shows and does. */
  readonly settings: {
    readonly displayName: string | null;
    readonly enabledModules: readonly string[];
    readonly autoPaymentsEnabled: boolean;
    readonly defaultPayAccountId: string | null;
  };
  readonly data: Workspace;
}

/**
 * "Baixar meus dados": everything the user has in the app, as a backup document. Read-only.
 *
 * @param now The moment the copy is taken (the clock stays with the caller).
 */
export async function exportWorkspace(
  repo: FinanceRepository,
  userId: string,
  now: Date,
): Promise<WorkspaceBackup> {
  const [data, profile] = await Promise.all([
    loadWorkspaceCached(repo, userId),
    getProfileCached(repo, userId),
  ]);
  return {
    format: "fincore-backup",
    version: 1,
    exportedAt: now.toISOString(),
    counts: {
      accounts: data.accounts.length,
      creditCards: data.creditCards.length,
      people: data.people.length,
      categories: data.categories.length,
      transactions: data.transactions.length,
      settlements: data.settlements.length,
      budgets: data.budgets.length,
      goals: data.goals.length,
      cardBillDates: data.cardBillDates.length,
      cardBillPayments: data.cardBillPayments.length,
    },
    settings: {
      displayName: profile.displayName,
      enabledModules: profile.enabledModules,
      autoPaymentsEnabled: profile.autoPaymentsEnabled,
      defaultPayAccountId: profile.defaultPayAccountId,
    },
    data,
  };
}
