import { createPrivateKey, generateKeyPairSync, type KeyObject, sign } from "node:crypto";

/**
 * VAPID (RFC 8292): how the server proves to a push service who is sending. Each request to a push
 * endpoint carries a short-lived token signed with the server's private key; the browser was given
 * the matching public key when the device subscribed, so only this server can push to it.
 *
 * Plain `node:crypto` — a P-256 key and an ES256 signature — so no dependency is needed.
 */
export interface VapidKeys {
  /** The public key as a browser takes it: the uncompressed P-256 point (65 bytes), base64url. */
  readonly publicKey: string;
  /** The private scalar (32 bytes), base64url. A secret: it only ever lives in the environment. */
  readonly privateKey: string;
  /** Who to contact about these pushes: a `mailto:` or an `https:` URL. Push services require it. */
  readonly subject: string;
}

/** How long a token is good for. Push services refuse one that lasts more than 24 hours. */
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

const base64url = (data: Buffer | string): string => Buffer.from(data).toString("base64url");

/** The private key as `node:crypto` signs with it, rebuilt from the two configured values. */
function signingKey(keys: VapidKeys): KeyObject {
  const point = Buffer.from(keys.publicKey, "base64url");
  if (point.length !== 65 || point[0] !== 4) {
    throw new Error("VAPID public key must be an uncompressed P-256 point (65 bytes, base64url).");
  }
  return createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: base64url(point.subarray(1, 33)),
      y: base64url(point.subarray(33)),
    },
  });
}

/**
 * The `Authorization` header for one push to `endpoint`: a JWT naming the push service (`aud`, the
 * endpoint's origin), when it stops being valid (`exp`) and who is sending (`sub`), with the public
 * key beside it.
 */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now: Date): string {
  const header = base64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = base64url(
    JSON.stringify({
      aud: new URL(endpoint).origin,
      exp: Math.floor(now.getTime() / 1000) + TOKEN_LIFETIME_SECONDS,
      sub: keys.subject,
    }),
  );
  // JWTs carry the raw r‖s signature (IEEE P1363), not the DER structure `sign` returns by default.
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key: signingKey(keys),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${header}.${claims}.${base64url(signature)}, k=${keys.publicKey}`;
}

/** A fresh key pair, as the two base64url values the app is configured with. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  if (jwk.x === undefined || jwk.y === undefined || jwk.d === undefined) {
    throw new Error("Could not export the generated key.");
  }
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);
  return { publicKey: base64url(point), privateKey: jwk.d };
}
