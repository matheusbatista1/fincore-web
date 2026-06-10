import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/infrastructure/config/env";

/**
 * Keeps the Supabase auth session fresh on every request by rotating the
 * access/refresh tokens through cookies. Route protection (redirect to /login)
 * is added in the presentation phase once auth screens exist.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Resilience: until Supabase is configured (env vars set), skip auth refresh so
  // pages still render. This guard is a no-op once real credentials are present.
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response;
  }

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: refreshes the session; do not run code between client creation and this call.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Run on all routes except static assets and image optimization.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
