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
  // Service-role read (bypasses RLS): every active user — recurring rules are not opt-in.
  const { data: users, error } = await admin.from("users").select("id").is("deactivated_at", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let created = 0;
  const failures: { id: string; error: string }[] = [];
  for (const row of users ?? []) {
    const id = row.id as string;
    try {
      created += (await materializeRecurring(financeRepository, id)).created;
    } catch (e) {
      failures.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ users: users?.length ?? 0, created, failed: failures.length, failures });
}
