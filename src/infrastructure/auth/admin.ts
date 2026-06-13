import { createClient } from "@supabase/supabase-js";
import { env } from "@/infrastructure/config/env";

/**
 * Service-role Supabase client — server-only, bypasses RLS. Used by trusted jobs
 * (the account-purge cron) to read any row and to delete auth users via
 * `auth.admin.deleteUser`. NEVER import this from client code.
 */
export function createSupabaseAdminClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
