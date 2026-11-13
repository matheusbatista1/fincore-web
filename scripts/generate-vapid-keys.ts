/**
 * Prints a fresh VAPID key pair for the push notifications. Run it once, on your own machine:
 *
 *   pnpm push:keys
 *
 * and put the three values in the environment of the deployment (they are not committed). The
 * private key is a secret. Generating a new pair later makes every device subscribe again.
 */
import { generateVapidKeys } from "../src/infrastructure/push/vapid";

const { publicKey, privateKey } = generateVapidKeys();

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=https://<the address of the app>   # or mailto:<an address you read>");
