import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/infrastructure/config/env";

/** Supabase client for browser (client component) use. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
