/**
 * What became of one push:
 * - `sent`: the push service took it and will deliver it to the device;
 * - `gone`: the device is no longer subscribed (the app was removed, the permission withdrawn) —
 *   the subscription is of no use any more;
 * - `failed`: anything else (the service is away, it refused the request): worth trying again later.
 */
export type PushOutcome = "sent" | "gone" | "failed";

/**
 * Sends a push to a device. The push carries no content: it wakes the device, which then asks the
 * server what to show (so nothing about the user's money travels through a third party).
 */
export interface PushSender {
  send(endpoint: string): Promise<PushOutcome>;
}
