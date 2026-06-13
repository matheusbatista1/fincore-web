import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/infrastructure/config/env";

/**
 * Edge proxy (Next 16's renamed middleware). Refreshes the Supabase auth session
 * on every request and enforces route protection.
 */
export async function proxy(request: NextRequest) {
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path === "/login" ||
    path.startsWith("/login/") ||
    path.startsWith("/auth") ||
    path === "/privacy" ||
    path === "/terms" ||
    // PWA surfaces must be reachable without a session.
    path === "/offline" ||
    path === "/sw.js" ||
    path === "/manifest.webmanifest" ||
    path.startsWith("/icons/");

  // Unauthenticated users may only see public routes.
  if (!user && !isPublic) {
    return redirectTo(request, response, "/login");
  }

  // AAL2 step-up: a session with a verified second factor that is still at aal1
  // (e.g. a pre-existing session) may only reach the challenge route until it
  // verifies. Fail-open on errors so the app never hard-locks.
  if (user) {
    let pendingMfa = false;
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      pendingMfa = aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2";
    } catch {
      pendingMfa = false;
    }
    if (pendingMfa && path !== "/verify-2fa" && !path.startsWith("/auth")) {
      return redirectTo(request, response, "/verify-2fa");
    }
    if (!pendingMfa && path === "/verify-2fa") {
      return redirectTo(request, response, "/dashboard");
    }
  }

  // Authenticated users skip the login / landing page.
  if (user && (path === "/login" || path === "/")) {
    return redirectTo(request, response, "/dashboard");
  }

  return response;
}

/** Redirect while preserving the refreshed auth cookies. */
function redirectTo(request: NextRequest, base: NextResponse, pathname: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  const redirect = NextResponse.redirect(url);
  for (const cookie of base.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export const config = {
  // Run on all routes except static assets and image optimization.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
