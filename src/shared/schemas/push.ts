import { z } from "zod";

/** A key as a browser serialises it: base64url, short. */
const browserKey = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+=*$/);

/** The longest endpoint accepted: push services hand out a few hundred characters. */
const endpoint = z.string().min(1).max(2048);

/**
 * What `PushSubscription.toJSON()` gives the page when a device turns notifications on. Whether the
 * endpoint is a real push service is decided by the use case (it is where the server will POST).
 */
export const pushSubscriptionSchema = z.object({
  endpoint,
  keys: z.object({ p256dh: browserKey, auth: browserKey }),
});

/** A device named by its endpoint: to turn its notifications off, or to send it a test. */
export const pushEndpointSchema = z.object({ endpoint });
