import type { PushSender } from "@/application/ports/push-sender";
import { env } from "./config/env";
import { db } from "./db/client";
import { createWebPushSender } from "./push/web-push-sender";
import { DrizzleFinanceRepository } from "./repositories/drizzle-finance-repository";

/**
 * Composition root: wires concrete adapters to the application ports. Server-only
 * (imports the DB client). Server Actions and RSC import the repository from here.
 */
export const financeRepository = new DrizzleFinanceRepository(db);

const vapid =
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
    ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }
    : null;

/** The key a browser subscribes with; null while push notifications are not configured. */
export const pushPublicKey: string | null = vapid?.publicKey ?? null;

/** Sends push notifications; null while they are not configured (the feature is then not offered). */
export const pushSender: PushSender | null = vapid ? createWebPushSender(vapid) : null;
