import { NextResponse } from "next/server";
import { reconcileAutoPayments } from "@/application/use-cases/reconcile-auto-payments";
import { createSupabaseAdminClient } from "@/infrastructure/auth/admin";
import { financeRepository } from "@/infrastructure/composition";
import { env } from "@/infrastructure/config/env";

// Drives the RLS-scoped repository per user + reads the service-role users list — Node only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily backstop for automatic payments: books every user's due obligations and faturas even when
 * they don't open the app (the app-load {@link reconcileAutoPayments} trigger is the primary path).
 *
 * Triggered by the Vercel cron (see vercel.json) with `Authorization: Bearer <CRON_SECRET>`.
 * Idempotent per user, so running daily on top of the on-load trigger never double-books.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "Cron disabled: CRON_SECRET is not set." }, { status: 401 });
  }
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  // Service-role read (bypasses RLS): only users who opted in and still have a paying account.
  const { data: users, error } = await admin
    .from("users")
    .select("id")
    .eq("auto_payments_enabled", true)
    .not("default_pay_account_id", "is", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let paidObligations = 0;
  let paidFaturas = 0;
  const failures: { id: string; error: string }[] = [];
  for (const row of users ?? []) {
    const id = row.id as string;
    try {
      const result = await reconcileAutoPayments(financeRepository, id);
      paidObligations += result.paidObligations;
      paidFaturas += result.paidFaturas;
    } catch (e) {
      failures.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    users: users?.length ?? 0,
    paidObligations,
    paidFaturas,
    failed: failures.length,
    failures,
  });
}
