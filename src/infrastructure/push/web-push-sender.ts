import type { PushOutcome, PushSender } from "@/application/ports/push-sender";
import { isPushEndpoint } from "@/shared/push/endpoints";
import { type VapidKeys, vapidAuthorization } from "./vapid";

/** How long the push service keeps an undelivered push (a phone that is off): one day. */
const TTL_SECONDS = 24 * 60 * 60;
/** Pushes of the same topic replace one another while undelivered: only the latest arrives. */
const TOPIC = "fincore-digest";
/** A push service that does not answer in this long is treated as away. */
const TIMEOUT_MS = 10_000;

interface SenderOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

/**
 * Web Push (RFC 8030) with no payload: an authenticated, empty POST to the device's endpoint.
 * The endpoint was handed in by a browser, so it is checked again here, right before the request:
 * the server only ever calls a known push service ({@link isPushEndpoint}), and never follows a
 * redirect away from it.
 */
export function createWebPushSender(keys: VapidKeys, options: SenderOptions = {}): PushSender {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    async send(endpoint): Promise<PushOutcome> {
      // An address that is not a push service can never be delivered to: the same as "gone".
      if (!isPushEndpoint(endpoint)) return "gone";
      try {
        const response = await request(endpoint, {
          method: "POST",
          headers: {
            Authorization: vapidAuthorization(endpoint, keys, now()),
            TTL: String(TTL_SECONDS),
            Urgency: "normal",
            Topic: TOPIC,
          },
          redirect: "error",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.status === 404 || response.status === 410) return "gone";
        return response.ok ? "sent" : "failed";
      } catch {
        return "failed";
      }
    },
  };
}
