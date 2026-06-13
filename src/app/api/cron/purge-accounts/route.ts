import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/infrastructure/auth/admin";
import { env } from "@/infrastructure/config/env";

// Talks to Supabase Auth admin + service-role Postgres — must run on Node, never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Days a deactivated account is kept before it is permanently purged. */
const GRACE_DAYS = 30;

/**
 * Daily purge of accounts whose 30-day deletion grace period has elapsed.
 *
 * Triggered by the Vercel cron (see vercel.json). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; we reject anything else. Deleting the
 * Supabase auth user cascades through `public.users` and every child table
 * (all FKs are `on delete cascade`), so no per-table cleanup is needed here.
 */
export async function GET(request: Request): Promise<NextResponse> {
  // The cron stays disabled until CRON_SECRET is configured, so a missing secret
  // can never be mistaken for "anyone may purge".
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "Cron disabled: CRON_SECRET is not set." }, { status: 401 });
  }
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const admin = createSupabaseAdminClient();

  const { data: due, error } = await admin
    .from("users")
    .select("id")
    .not("deactivated_at", "is", null)
    .lt("deactivated_at", cutoff);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let purged = 0;
  const failures: { id: string; error: string }[] = [];
  for (const row of due ?? []) {
    const id = row.id as string;
    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (deleteError) failures.push({ id, error: deleteError.message });
    else purged += 1;
  }

  return NextResponse.json({ purged, failed: failures.length, failures });
}
