import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";

/**
 * Auth callback — exchanges the email-confirmation / OAuth `code` for a session
 * (PKCE) and continues into the app. Supabase redirects here after the user
 * clicks the confirmation link, with `?code=...`.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requested = searchParams.get("next") ?? "/dashboard";
  const next = requested.startsWith("/") ? requested : "/dashboard";

  // Behind Vercel's proxy the public host is in x-forwarded-host; use it in prod
  // so the redirect lands on the real domain, not the internal origin.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocal = process.env.NODE_ENV === "development";
  const base = isLocal || !forwardedHost ? origin : `https://${forwardedHost}`;

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      await financeRepository.ensureProfile(data.user.id, data.user.email ?? "");
      return NextResponse.redirect(`${base}${next}`);
    }
  }

  return NextResponse.redirect(`${base}/login?error=auth`);
}
