import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { env } from "@/infrastructure/config/env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Reads/writes the auth session via Next's cookie store.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll was called from a Server Component (read-only cookies);
          // the middleware is responsible for refreshing the session there.
        }
      },
    },
  });
}

/**
 * The authenticated user, or null. Verified against the Supabase auth server.
 * Memoized per request with React `cache()` so the layout and the page share a
 * single `getUser()` round-trip instead of one each.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Check a password without disturbing the current session: a throwaway client
 * with no-op cookies signs in just to validate, persisting nothing. Used to
 * confirm the current password before sensitive actions (change password,
 * delete account).
 */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return !error;
}
