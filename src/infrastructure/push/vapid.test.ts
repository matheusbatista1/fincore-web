import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateVapidKeys, type VapidKeys, vapidAuthorization } from "./vapid";

const ENDPOINT = "https://web.push.apple.com/QGuAyLwlxo5XOW9hAXv3cVO0lCnUI-M3lqqbm2Jwo8h";
const NOW = new Date("2026-11-12T12:00:00Z");

const keysWith = (subject = "https://fincore.example"): VapidKeys => ({ ...generateVapidKeys(), subject });

/** The public key a browser would hold, as `node:crypto` verifies with it. */
function publicKeyObject(publicKey: string) {
  const point = Buffer.from(publicKey, "base64url");
  return createPublicKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33).toString("base64url"),
    },
  });
}

function parse(authorization: string) {
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(authorization);
  if (!match) throw new Error(`not a vapid header: ${authorization}`);
  const [, header = "", claims = "", signature = "", key = ""] = match;
  const json = (part: string): Record<string, unknown> =>
    JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  return { header: json(header), claims: json(claims), signed: `${header}.${claims}`, signature, key };
}

describe("generateVapidKeys", () => {
  it("gives the two values in the sizes a browser and the signer expect", () => {
    const { publicKey, privateKey } = generateVapidKeys();
    const point = Buffer.from(publicKey, "base64url");
    expect(point).toHaveLength(65);
    expect(point[0]).toBe(4);
    expect(Buffer.from(privateKey, "base64url")).toHaveLength(32);
    // base64url: nothing a URL or an environment variable would trip on.
    expect(publicKey).toMatch(/^[\w-]+$/);
    expect(privateKey).toMatch(/^[\w-]+$/);
    expect(generateVapidKeys().privateKey).not.toBe(privateKey);
  });
});

describe("vapidAuthorization", () => {
  it("names the push service, an expiry within a day and the sender, in an ES256 JWT", () => {
    const keys = keysWith("mailto:someone@fincore.example");
    const { header, claims, key } = parse(vapidAuthorization(ENDPOINT, keys, NOW));
    expect(header).toEqual({ typ: "JWT", alg: "ES256" });
    expect(claims).toEqual({
      aud: "https://web.push.apple.com",
      exp: NOW.getTime() / 1000 + 12 * 60 * 60,
      sub: "mailto:someone@fincore.example",
    });
    expect(key).toBe(keys.publicKey);
  });

  it("is signed with the private key: the public one verifies it, and only it", () => {
    const keys = keysWith();
    const { signed, signature } = parse(vapidAuthorization(ENDPOINT, keys, NOW));
    const raw = Buffer.from(signature, "base64url");
    // The raw r‖s form a JWT carries: 64 bytes for P-256.
    expect(raw).toHaveLength(64);
    const check = (publicKey: string, data: string): boolean =>
      verify(
        "sha256",
        Buffer.from(data),
        { key: publicKeyObject(publicKey), dsaEncoding: "ieee-p1363" },
        raw,
      );
    expect(check(keys.publicKey, signed)).toBe(true);
    expect(check(keys.publicKey, `${signed}x`)).toBe(false);
    expect(check(generateVapidKeys().publicKey, signed)).toBe(false);
  });

  it("names each push service by its own origin, whatever the rest of the endpoint", () => {
    const keys = keysWith();
    const audience = (endpoint: string) => parse(vapidAuthorization(endpoint, keys, NOW)).claims.aud;
    expect(audience("https://fcm.googleapis.com/fcm/send/abc:def")).toBe("https://fcm.googleapis.com");
    expect(audience("https://wns2-by3p.notify.windows.com/w/?token=BQYAAAC%2f")).toBe(
      "https://wns2-by3p.notify.windows.com",
    );
  });

  it("refuses a public key that is not an uncompressed point", () => {
    const keys = keysWith();
    expect(() => vapidAuthorization(ENDPOINT, { ...keys, publicKey: "AAAA" }, NOW)).toThrow(/P-256/);
    const compressed = Buffer.from(keys.publicKey, "base64url");
    compressed[0] = 2;
    expect(() =>
      vapidAuthorization(ENDPOINT, { ...keys, publicKey: compressed.toString("base64url") }, NOW),
    ).toThrow(/P-256/);
  });
});
