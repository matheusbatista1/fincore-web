import type { ClientErrorReport } from "@/shared/schemas/client-error";

const ENDPOINT = "/api/client-error";
/** Reports sent per page load: a loop of failures must not become a loop of requests. */
const MAX_REPORTS = 5;
const MAX_MESSAGE = 500;
const MAX_STACK = 4_000;

/**
 * Noise that is nobody's bug: a benign layout notice every browser emits now and then, and the
 * placeholder a browser gives for an error inside a script of another origin (an extension).
 */
const IGNORED = [/^ResizeObserver loop/i, /^Script error\.?$/i];

/** What was already reported since the page loaded. */
const reported = new Set<string>();

/** What can be said about anything that was thrown: an Error, a string, or whatever it was. */
export function describeError(thrown: unknown): { message: string; stack?: string } {
  if (thrown instanceof Error) {
    const message = thrown.message || thrown.name || "Error";
    return thrown.stack ? { message, stack: thrown.stack } : { message };
  }
  if (typeof thrown === "string") return { message: thrown || "Error" };
  try {
    return { message: JSON.stringify(thrown) ?? String(thrown) };
  } catch {
    return { message: String(thrown) };
  }
}

/** The report for something thrown on `path`, cut to what the endpoint accepts. */
export function buildReport(
  source: ClientErrorReport["source"],
  thrown: unknown,
  path: string,
  digest?: string,
): ClientErrorReport {
  const { message, stack } = describeError(thrown);
  return {
    source,
    message: message.trim().slice(0, MAX_MESSAGE) || "Error",
    ...(stack ? { stack: stack.slice(0, MAX_STACK) } : {}),
    ...(digest ? { digest: digest.slice(0, 100) } : {}),
    path: path.slice(0, 200),
  };
}

/**
 * Tells the server that something broke in the browser, so it lands in the server log. Each
 * failure is reported once, a handful per page load at most, and reporting can never make things
 * worse: whatever goes wrong here is swallowed.
 */
export function reportClientError(
  source: ClientErrorReport["source"],
  thrown: unknown,
  digest?: string,
): void {
  if (typeof window === "undefined") return;
  try {
    const report = buildReport(source, thrown, window.location.pathname, digest);
    if (IGNORED.some((noise) => noise.test(report.message))) return;
    const key = `${report.source}|${report.message}`;
    if (reported.has(key) || reported.size >= MAX_REPORTS) return;
    reported.add(key);

    const body = JSON.stringify(report);
    // A beacon survives the page going away (an error is often followed by a reload).
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting is a courtesy: it must not throw in the middle of a failure.
  }
}
