import { getPushMessage } from "@/application/use-cases/push-notifications";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { todayInBrazil } from "@/shared/formatting/now";

// Reads the user's book through the RLS-scoped repository — Node only, never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * What the notification should say right now. A push carries no content: when one arrives, the
 * device's service worker asks here, with the person's own session — so the names and amounts go
 * straight from this server to the device and through no push service.
 *
 * Without a session (it ended, or the request is not from the person's device) it answers 401 and
 * the worker shows a notification with no detail.
 */
export async function GET(): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
    const message = await getPushMessage(financeRepository, user.id, todayInBrazil());
    return Response.json(
      { title: message.title, body: message.body, url: message.url },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("push digest failed", error);
    return Response.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
