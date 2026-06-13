import { redirect } from "next/navigation";
import { getProfileCached } from "@/application/loaders";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { isModuleEnabled, type ModuleKey } from "@/shared/modules";

/**
 * Guard for an optional-module route: requires a session and that the module is
 * enabled, otherwise redirects (to /login or /dashboard). Returns the user so
 * callers can keep their existing `user.id` flow. The profile load is memoized
 * (shares the layout's call within the same request).
 */
export async function requireModule(module: ModuleKey): Promise<{ id: string; email: string | null }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const profile = await getProfileCached(financeRepository, user.id);
  if (!isModuleEnabled(profile.enabledModules, module)) redirect("/dashboard");
  return { id: user.id, email: user.email ?? null };
}
