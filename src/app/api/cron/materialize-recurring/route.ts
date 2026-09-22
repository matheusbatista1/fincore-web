import { NextResponse } from "next/server";
import { materializeRecurring } from "@/application/use-cases/materialize-recurring";
import { createSupabaseAdminClient } from "@/infrastructure/auth/admin";
import { financeRepository } from "@/infrastructure/composition";
import { env } from "@/infrastructure/config/env";

// Drives the RLS-scoped repository per user + reads the service-role users list — Node only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily backstop for materialising recurring rules: books every user's fixos whose day has arrived
 * even when they don't open the app (the app-load trigger is the primary path). Runs before the
 * auto-payments cron so a boleto booked today can still be auto-paid on the same day.
 *
 * Triggered by the Vercel cron (see vercel.json) with `Authorization: Bearer <CRON_SECRET>`.
 * Idempotent per user (watermark + optimistic lock), so it never double-books.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "Cron disabled: CRON_SECRET is not set." }, { status: 401 });
  }
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  // Service-role read (bypasses RLS): every active user — recurring rules are not opt-in. Paged,
  // because an unfiltered select is capped (PostgREST max-rows) and would silently skip the tail.
  const PAGE = 500;
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("users")
      .select("id")
      .is("deactivated_at", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of data ?? []) ids.push(row.id as string);
    if ((data?.length ?? 0) < PAGE) break;
  }

  let created = 0;
  const skipped: string[] = [];
  const failures: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      const result = await materializeRecurring(financeRepository, id);
      created += result.created;
      skipped.push(...result.skipped);
    } catch (e) {
      failures.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    users: ids.length,
    created,
    skipped,
    failed: failures.length,
    failures,
  });
}
