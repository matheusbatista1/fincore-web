import { type DueDigest, type DueItem, dueDigest } from "@/domain/services/due-digest";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { isPushEndpoint } from "@/shared/push/endpoints";
import { err, ok, type Result } from "@/shared/result";
import type { FinanceRepository, PushDeviceData } from "../ports/finance-repository";
import type { PushSender } from "../ports/push-sender";

/** What a notification says, and where a tap on it leads. */
export interface PushMessage {
  readonly title: string;
  readonly body: string;
  /** A path inside the app. */
  readonly url: string;
  /** Whether there is anything to pay: the daily notification is only sent when there is. */
  readonly due: boolean;
}

/** Where a tap on the notification leads: the month's list, where each row can be paid. */
const DIGEST_URL = "/monthly";
/** How many items a line names before it says "e mais N". */
const NAMED_PER_LINE = 3;

const list = (items: readonly DueItem[]): string => {
  const named = items
    .slice(0, NAMED_PER_LINE)
    .map((item) => `${item.label} ${formatBRLAbsolute(item.cents)}`);
  const rest = items.length - named.length;
  return rest > 0 ? `${named.join(", ")} e mais ${rest}` : named.join(", ");
};

const total = (items: readonly DueItem[]): number => items.reduce((sum, item) => sum + item.cents, 0);

/**
 * The words of the daily notification. The title carries the most pressing group and its total
 * (today, then what is late, then tomorrow); the body lists each group on its own line. With
 * nothing to pay it still says something — it is what a test notification shows on a quiet day.
 */
export function digestMessage(digest: DueDigest): PushMessage {
  const lines: string[] = [];
  if (digest.today.length > 0) lines.push(`Hoje: ${list(digest.today)}`);
  if (digest.tomorrow.length > 0) lines.push(`Amanhã: ${list(digest.tomorrow)}`);
  if (digest.overdue.length > 0) lines.push(`Em atraso: ${list(digest.overdue)}`);
  if (lines.length === 0) {
    return {
      title: "FinCore",
      body: "Tudo em dia: nada vence hoje nem amanhã.",
      url: DIGEST_URL,
      due: false,
    };
  }
  const title =
    digest.today.length > 0
      ? `Vence hoje: ${formatBRLAbsolute(total(digest.today))}`
      : digest.overdue.length > 0
        ? `Em atraso: ${formatBRLAbsolute(total(digest.overdue))}`
        : `Vence amanhã: ${formatBRLAbsolute(total(digest.tomorrow))}`;
  return { title, body: lines.join("\n"), url: DIGEST_URL, due: true };
}

/** What the user's notification says today. */
export async function getPushMessage(
  repo: FinanceRepository,
  userId: string,
  today: IsoDate,
): Promise<PushMessage> {
  const ws = await repo.loadWorkspace(userId);
  return digestMessage(
    dueDigest({
      creditCards: ws.creditCards,
      cardBillDates: ws.cardBillDates,
      cardBillPayments: ws.cardBillPayments,
      transactions: ws.transactions,
      today,
    }),
  );
}

export type PushError =
  | { readonly code: "invalid-endpoint"; readonly message: string }
  | { readonly code: "unknown-device"; readonly message: string }
  | { readonly code: "gone"; readonly message: string }
  | { readonly code: "failed"; readonly message: string };

/**
 * Remember a device to notify. The endpoint is where the server will later send a request, so one
 * that is not a known push service is refused here, before it is ever stored.
 */
export async function registerPushDevice(
  repo: FinanceRepository,
  userId: string,
  input: PushDeviceData,
): Promise<Result<void, PushError>> {
  if (!isPushEndpoint(input.endpoint)) {
    return err({
      code: "invalid-endpoint",
      message: "Este navegador não tem um serviço de avisos conhecido.",
    });
  }
  await repo.savePushDevice(userId, input);
  return ok(undefined);
}

/** Forget a device: it asked not to be notified any more. */
export async function forgetPushDevice(
  repo: FinanceRepository,
  userId: string,
  endpoint: string,
): Promise<void> {
  await repo.deletePushDevice(userId, endpoint);
}

export interface NotifyResult {
  /** The devices the user has subscribed. */
  readonly devices: number;
  readonly sent: number;
  /** Devices that are no longer subscribed, and were forgotten. */
  readonly removed: number;
  readonly failed: number;
}

/**
 * The daily notification for one user: a push to each of their devices, but only when there is
 * something to pay today or tomorrow, or something late. A device that is gone is forgotten.
 */
export async function notifyDue(
  repo: FinanceRepository,
  sender: PushSender,
  userId: string,
  today: IsoDate,
): Promise<NotifyResult> {
  const devices = await repo.listPushDevices(userId);
  const result = { devices: devices.length, sent: 0, removed: 0, failed: 0 };
  if (devices.length === 0) return result;
  const message = await getPushMessage(repo, userId, today);
  if (!message.due) return result;

  for (const device of devices) {
    const outcome = await sender.send(device.endpoint);
    if (outcome === "sent") result.sent += 1;
    else if (outcome === "failed") result.failed += 1;
    else {
      await repo.deletePushDevice(userId, device.endpoint);
      result.removed += 1;
    }
  }
  return result;
}

/**
 * "Enviar um aviso de teste": a push to one of the user's own devices, whatever there is to pay —
 * it shows exactly what the daily one would show right now.
 */
export async function sendTestPush(
  repo: FinanceRepository,
  sender: PushSender,
  userId: string,
  endpoint: string,
): Promise<Result<void, PushError>> {
  const devices = await repo.listPushDevices(userId);
  if (!devices.some((device) => device.endpoint === endpoint)) {
    return err({ code: "unknown-device", message: "Este aparelho não está com os avisos ativados." });
  }
  const outcome = await sender.send(endpoint);
  if (outcome === "sent") return ok(undefined);
  if (outcome === "gone") {
    await repo.deletePushDevice(userId, endpoint);
    return err({ code: "gone", message: "Este aparelho deixou de receber avisos. Ative de novo." });
  }
  return err({
    code: "failed",
    message: "O serviço de avisos não aceitou o envio. Tente de novo em instantes.",
  });
}
