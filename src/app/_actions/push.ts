"use server";

import {
  forgetPushDevice,
  registerPushDevice,
  sendTestPush,
} from "@/application/use-cases/push-notifications";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository, pushSender } from "@/infrastructure/composition";
import { pushEndpointSchema, pushSubscriptionSchema } from "@/shared/schemas/push";

export type PushActionState = { ok: true } | { ok: false; error: string };

const UNAUTHORIZED: PushActionState = { ok: false, error: "Sessão expirada. Entre novamente." };
const INVALID: PushActionState = { ok: false, error: "Dados inválidos." };
const NOT_CONFIGURED: PushActionState = {
  ok: false,
  error: "Os avisos ainda não foram configurados no servidor.",
};

/**
 * "Ativar avisos": remembers this device so the daily notification reaches it. The browser has
 * already asked the person for permission and created the subscription; this stores it.
 */
export async function subscribePushAction(raw: unknown): Promise<PushActionState> {
  const user = await getCurrentUser();
  if (!user) return UNAUTHORIZED;
  if (pushSender === null) return NOT_CONFIGURED;
  const parsed = pushSubscriptionSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  try {
    const result = await registerPushDevice(financeRepository, user.id, {
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error.message };
  } catch (error) {
    console.error("subscribePushAction failed", error);
    return { ok: false, error: "Não foi possível ativar os avisos agora. Tente de novo." };
  }
}

/** "Desativar": forgets this device. The page unsubscribes the browser itself. */
export async function unsubscribePushAction(raw: unknown): Promise<PushActionState> {
  const user = await getCurrentUser();
  if (!user) return UNAUTHORIZED;
  const parsed = pushEndpointSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  try {
    await forgetPushDevice(financeRepository, user.id, parsed.data.endpoint);
    return { ok: true };
  } catch (error) {
    console.error("unsubscribePushAction failed", error);
    return { ok: false, error: "Não foi possível desativar os avisos agora. Tente de novo." };
  }
}

/** "Enviar um aviso de teste": a push to this device, showing what the daily one would show now. */
export async function sendTestPushAction(raw: unknown): Promise<PushActionState> {
  const user = await getCurrentUser();
  if (!user) return UNAUTHORIZED;
  if (pushSender === null) return NOT_CONFIGURED;
  const parsed = pushEndpointSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  try {
    const result = await sendTestPush(financeRepository, pushSender, user.id, parsed.data.endpoint);
    return result.ok ? { ok: true } : { ok: false, error: result.error.message };
  } catch (error) {
    console.error("sendTestPushAction failed", error);
    return { ok: false, error: "Não foi possível enviar o aviso agora. Tente de novo." };
  }
}
