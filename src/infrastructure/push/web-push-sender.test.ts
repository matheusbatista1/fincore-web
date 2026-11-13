import { describe, expect, it, vi } from "vitest";
import { generateVapidKeys, type VapidKeys } from "./vapid";
import { createWebPushSender } from "./web-push-sender";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-1";
const NOW = new Date("2026-11-12T12:00:00Z");
const keys: VapidKeys = { ...generateVapidKeys(), subject: "https://fincore.example" };

const answering = (status: number) => vi.fn(async () => new Response(null, { status }));

describe("createWebPushSender", () => {
  it("POSTs an empty, signed request to the endpoint", async () => {
    const fetch = answering(201);
    const sender = createWebPushSender(keys, { fetch, now: () => NOW });
    expect(await sender.send(ENDPOINT)).toBe("sent");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    // Never follows the push service anywhere else.
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(headers.Authorization?.endsWith(`k=${keys.publicKey}`)).toBe(true);
    expect(headers.TTL).toBe("86400");
    expect(headers.Topic).toBe("fincore-digest");
    expect(headers.Urgency).toBe("normal");
  });

  it("tells a device that is gone from a push that merely failed", async () => {
    const outcome = (status: number) =>
      createWebPushSender(keys, { fetch: answering(status) }).send(ENDPOINT);
    expect(await outcome(200)).toBe("sent");
    expect(await outcome(404)).toBe("gone");
    expect(await outcome(410)).toBe("gone");
    expect(await outcome(400)).toBe("failed");
    expect(await outcome(403)).toBe("failed");
    expect(await outcome(429)).toBe("failed");
    expect(await outcome(500)).toBe("failed");
  });

  it("treats a push service that cannot be reached as a failure, not as an error", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await createWebPushSender(keys, { fetch }).send(ENDPOINT)).toBe("failed");
  });

  it("never calls an address that is not a push service", async () => {
    const fetch = answering(201);
    const sender = createWebPushSender(keys, { fetch });
    for (const endpoint of [
      "https://example.com/push",
      "http://fcm.googleapis.com/fcm/send/x",
      "https://169.254.169.254/latest/meta-data",
      "https://fcm.googleapis.com.evil.example/x",
      "nonsense",
    ]) {
      expect(await sender.send(endpoint), endpoint).toBe("gone");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails, rather than throwing, when the keys are not usable", async () => {
    const fetch = answering(201);
    const broken = createWebPushSender({ ...keys, publicKey: "AAAA" }, { fetch });
    expect(await broken.send(ENDPOINT)).toBe("failed");
    expect(fetch).not.toHaveBeenCalled();
  });
});
