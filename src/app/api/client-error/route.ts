import { createRateLimiter } from "@/shared/rate-limit";
import { clientErrorSchema } from "@/shared/schemas/client-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The largest body read: a report is a message and a stack, never more. */
const MAX_BYTES = 8_192;
/** Reports logged per minute by one server instance; the rest are dropped. */
const allow = createRateLimiter(30, 60_000);

const noContent = (): Response => new Response(null, { status: 204 });

/** Whether the request comes from a page of this very site. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin === null || host === null) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Receives what the browser reports when something breaks (see `report-error.ts`) and writes it
 * to the server log as one JSON line, where the platform's logs — and a log drain, if there is
 * one — pick it up.
 *
 * It is open to signed-out pages on purpose (the login page can break too), so it trusts
 * nothing: same origin only, a small body, a strict shape, a cap per minute. And it answers 204
 * whatever happened: the answer must not tell a caller what was accepted.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return noContent();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return noContent();

  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) return noContent();
    payload = JSON.parse(text);
  } catch {
    return noContent();
  }
  const report = clientErrorSchema.safeParse(payload);
  if (!report.success || !allow(Date.now())) return noContent();

  // One line of JSON: nothing in it can break out of its line, and a log search finds the kind.
  console.error(
    JSON.stringify({
      kind: "client-error",
      at: new Date().toISOString(),
      ...report.data,
      // Which browser: half of what breaks, breaks in one of them only.
      userAgent: request.headers.get("user-agent")?.slice(0, 200) ?? null,
    }),
  );
  return noContent();
}
