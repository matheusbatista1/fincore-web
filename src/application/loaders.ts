import { cache } from "react";
import type { FinanceRepository, UserProfile, Workspace } from "./ports/finance-repository";

/**
 * Per-request memoized workspace load. React's `cache()` dedupes calls with the
 * same `(repo, userId)` within a single server render, so a page that derives
 * several views (e.g. the dashboard using both the dashboard summary and the
 * form data) loads the workspace ONCE instead of once per use-case.
 */
export const loadWorkspaceCached = cache(
  (repo: FinanceRepository, userId: string): Promise<Workspace> => repo.loadWorkspace(userId),
);

/** Per-request memoized profile/settings load, shared between the layout and route guards. */
export const getProfileCached = cache(
  (repo: FinanceRepository, userId: string): Promise<UserProfile> => repo.getProfile(userId),
);
