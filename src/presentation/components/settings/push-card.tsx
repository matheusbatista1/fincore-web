"use client";

import { useEffect, useState } from "react";
import {
  type PushActionState,
  sendTestPushAction,
  subscribePushAction,
  unsubscribePushAction,
} from "@/app/_actions/push";
import { Icon } from "@/presentation/components/ui/icon";
import { toast } from "@/presentation/stores/ui-store";

/** What the card asks of the server. */
export interface PushCardActions {
  readonly subscribe: (subscription: PushSubscriptionJSON) => Promise<PushActionState>;
  readonly unsubscribe: (input: { endpoint: string }) => Promise<PushActionState>;
  readonly test: (input: { endpoint: string }) => Promise<PushActionState>;
}

const SERVER: PushCardActions = {
  subscribe: subscribePushAction,
  unsubscribe: unsubscribePushAction,
  test: sendTestPushAction,
};

/** The worker that receives the pushes (it does nothing else: see `public/sw.js`). */
const WORKER_URL = "/sw.js";

type Status =
  /** Looking at what this device and browser can do. */
  | "checking"
  /** The server has no keys yet: nothing to offer. */
  | "unconfigured"
  /** This browser cannot receive pushes at all. */
  | "unsupported"
  /** An iPhone/iPad in a browser tab: pushes only reach the app on the Home Screen. */
  | "needs-home-screen"
  /** The person (or the system) said no to notifications from this site. */
  | "blocked"
  | "off"
  | "on";

/** The server's public key as the browser wants it: the bytes behind the base64url text. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** iOS delivers web pushes only to an app added to the Home Screen, never to a browser tab. */
function isIosBrowserTab(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

async function detect(publicKey: string | null): Promise<Status> {
  if (publicKey === null) return "unconfigured";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return isIosBrowserTab() ? "needs-home-screen" : "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";
  return (await currentSubscription()) ? "on" : "off";
}

const EXPLAIN: Record<Exclude<Status, "checking" | "off" | "on">, string> = {
  unconfigured: "Os avisos ainda não foram configurados no servidor.",
  unsupported: "Este navegador não recebe avisos.",
  "needs-home-screen":
    "No iPhone, os avisos só chegam pelo app da Tela de Início: abra o FinCore pelo ícone (Compartilhar › Adicionar à Tela de Início) e ative por lá.",
  blocked:
    "Os avisos do FinCore estão bloqueados neste aparelho. Libere nas notificações do sistema e volte aqui.",
};

/**
 * Settings card to turn the daily notification on for THIS device: one push in the morning, only
 * when a bill or a fatura is due today or tomorrow, or something is late. Each device is turned on
 * (and off) on its own — a phone and a computer are two subscriptions.
 */
export function PushCard({
  publicKey,
  actions = SERVER,
}: {
  /** The server's VAPID public key; null while push notifications are not configured. */
  publicKey: string | null;
  /** The server calls; a screen with no session (a preview, a demo) passes its own. */
  actions?: PushCardActions;
}) {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    detect(publicKey)
      .then((found) => {
        if (alive) setStatus(found);
      })
      .catch(() => {
        if (alive) setStatus("unsupported");
      });
    return () => {
      alive = false;
    };
  }, [publicKey]);

  /** One step at a time; `work` answers with what went wrong, or `null` when it is done. */
  async function run(work: () => Promise<string | null>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      setError(await work());
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const enable = () =>
    run(async () => {
      if (publicKey === null) return EXPLAIN.unconfigured;
      // First thing after the tap: iOS only asks when the request comes straight from a gesture.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "off");
        return permission === "denied" ? null : "Sem a permissão, o aparelho não mostra os avisos.";
      }
      const registration = await navigator.serviceWorker.register(WORKER_URL, { updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      const saved = await actions.subscribe(subscription.toJSON());
      if (!saved.ok) {
        // Not stored: leave the device as it was, with no subscription and no worker.
        await subscription.unsubscribe().catch(() => undefined);
        await registration.unregister().catch(() => undefined);
        return saved.error;
      }
      setStatus("on");
      toast("Avisos ativados neste aparelho");
      return null;
    }, "Não foi possível ativar os avisos neste aparelho.");

  const disable = () =>
    run(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = (await registration?.pushManager.getSubscription()) ?? null;
      if (subscription) {
        const forgotten = await actions.unsubscribe({ endpoint: subscription.endpoint });
        if (!forgotten.ok) return forgotten.error;
        await subscription.unsubscribe();
      }
      await registration?.unregister();
      setStatus("off");
      toast("Avisos desativados neste aparelho");
      return null;
    }, "Não foi possível desativar os avisos agora.");

  const test = () =>
    run(async () => {
      const subscription = await currentSubscription();
      if (!subscription) {
        setStatus("off");
        return "Este aparelho não está com os avisos ativados.";
      }
      const sent = await actions.test({ endpoint: subscription.endpoint });
      if (!sent.ok) return sent.error;
      toast("Aviso enviado: ele chega em alguns segundos");
      return null;
    }, "Não foi possível enviar o aviso agora.");

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <div>
          <h3>Avisos no celular</h3>
          <div className="ch-sub">
            Um aviso por dia, de manhã, só quando há conta ou fatura vencendo hoje ou amanhã, ou alguma em
            atraso. Ele mostra os nomes e os valores na tela do aparelho.
          </div>
        </div>
      </div>
      <div
        className="card-pad"
        style={{ paddingTop: 6, paddingBottom: 14, display: "flex", gap: 10, flexWrap: "wrap" }}
      >
        {status === "checking" && (
          <span style={{ fontSize: 13.5, color: "var(--text-lo)" }}>Verificando este aparelho…</span>
        )}
        {status === "off" && (
          <button type="button" className="btn btn-primary btn-sm" onClick={enable} disabled={busy}>
            <Icon name="bell" size={15} />
            {busy ? "Ativando…" : "Ativar avisos neste aparelho"}
          </button>
        )}
        {status === "on" && (
          <>
            <span
              className="row gap-2"
              style={{ width: "100%", fontSize: 13.5, color: "var(--mint-500)", fontWeight: 600 }}
            >
              <Icon name="check" size={15} />
              Avisos ativados neste aparelho.
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={test} disabled={busy}>
              <Icon name="bell" size={15} />
              Enviar um aviso de teste
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={disable} disabled={busy}>
              Desativar
            </button>
          </>
        )}
        {status !== "checking" && status !== "off" && status !== "on" && (
          <span style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--text-mid)" }}>{EXPLAIN[status]}</span>
        )}
        {error && (
          <div className="warn-text" role="alert" style={{ width: "100%", marginTop: 0 }}>
            <Icon name="alert-triangle" size={14} />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
