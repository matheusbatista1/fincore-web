import { NextResponse } from "next/server";
import { notifyDue } from "@/application/use-cases/push-notifications";
import { createSupabaseAdminClient } from "@/infrastructure/auth/admin";
import { financeRepository, pushSender } from "@/infrastructure/composition";
import { env } from "@/infrastructure/config/env";
import { todayInBrazil } from "@/shared/formatting/now";

// Drives the RLS-scoped repository per user + reads the service-role users list — Node only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The daily notification: for every user with a device subscribed, a push when something is due
 * today or tomorrow, or late since a few days — and nothing at all on a quiet day.
 *
 * Runs in the morning (see vercel.json; São Paulo is UTC−3), after the passes that book the fixed
 * entries and the automatic payments, so what those settled is not announced.
 *
 * Triggered by the Vercel cron with `Authorization: Bearer <CRON_SECRET>`. Does nothing until the
 * VAPID keys are configured.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "Cron disabled: CRON_SECRET is not set." }, { status: 401 });
  }
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (pushSender === null) {
    return NextResponse.json({ disabled: "Push notifications are not configured (VAPID keys)." });
  }

  const admin = createSupabaseAdminClient();
  // Service-role read (bypasses RLS): every active user. Paged, because an unfiltered select is
  // capped (PostgREST max-rows) and would silently skip the tail.
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

  const today = todayInBrazil();
  const totals = { devices: 0, sent: 0, removed: 0, failed: 0 };
  const failures: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      const result = await notifyDue(financeRepository, pushSender, id, today);
      totals.devices += result.devices;
      totals.sent += result.sent;
      totals.removed += result.removed;
      totals.failed += result.failed;
    } catch (e) {
      failures.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ users: ids.length, ...totals, errors: failures.length, failures });
}
