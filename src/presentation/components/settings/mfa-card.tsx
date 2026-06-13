"use client";

import { useState, useTransition } from "react";
import { confirmMfaAction, disableMfaAction, enrollMfaAction } from "@/app/_actions/auth";
import { Icon } from "@/presentation/components/ui/icon";
import { toast } from "@/presentation/stores/ui-store";

/** A QR-code string from Supabase may be a raw SVG or already a data URI. */
function qrSrc(qr: string): string {
  return qr.startsWith("data:") ? qr : `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`;
}

type Enroll = { factorId: string; qrCode: string; secret: string };

/** Two-factor (TOTP) setup card: enroll → scan QR → confirm code, or disable. */
export function MfaCard({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function begin() {
    setError(null);
    startTransition(async () => {
      const result = await enrollMfaAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEnroll({ factorId: result.factorId, qrCode: result.qrCode, secret: result.secret });
      setCode("");
    });
  }

  function confirm() {
    if (!enroll) return;
    setError(null);
    startTransition(async () => {
      const result = await confirmMfaAction(enroll.factorId, code);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEnroll(null);
      setEnabled(true);
      toast("Autenticação em duas etapas ativada.");
    });
  }

  function cancelEnroll() {
    setError(null);
    setCode("");
    startTransition(async () => {
      await disableMfaAction();
      setEnroll(null);
    });
  }

  function disable() {
    setError(null);
    startTransition(async () => {
      const result = await disableMfaAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEnabled(false);
      toast("Autenticação em duas etapas desativada.");
    });
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <div>
          <h3>Segurança</h3>
          <div className="ch-sub">Autenticação em duas etapas (2FA) com app autenticador.</div>
        </div>
      </div>
      <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 16 }}>
        {/* Status row */}
        <div className="lrow" style={{ cursor: "default" }}>
          <span
            className="l-ic"
            style={
              enabled
                ? { background: "var(--mint-soft)", color: "var(--mint-500)" }
                : { background: "var(--surface-3)", color: "var(--text-lo)" }
            }
          >
            <Icon name="lock" size={18} />
          </span>
          <div className="l-main">
            <div className="l-title">Login por 2FA</div>
            <div className="l-sub">
              {enabled
                ? "Ativado — pediremos um código ao entrar."
                : "Proteja sua conta com um código temporário."}
            </div>
          </div>
          {enabled ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={disable} disabled={pending}>
              Desativar
            </button>
          ) : (
            !enroll && (
              <button type="button" className="btn btn-primary btn-sm" onClick={begin} disabled={pending}>
                {pending ? <Icon name="loader-circle" size={16} className="spin" /> : "Ativar"}
              </button>
            )
          )}
        </div>

        {/* Enrollment flow */}
        {enroll && (
          <div
            style={{
              marginTop: 14,
              padding: 16,
              borderRadius: "var(--r-md)",
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
            }}
          >
            <p style={{ fontSize: 13.5, color: "var(--text-lo)", lineHeight: 1.5, marginBottom: 12 }}>
              Escaneie o QR code no seu app autenticador (Google Authenticator, 1Password, Authy…) ou digite o
              código manual. Depois informe os 6 dígitos para confirmar.
            </p>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              {/* biome-ignore lint/performance/noImgElement: dynamic data-URI QR, not a static asset. */}
              <img
                src={qrSrc(enroll.qrCode)}
                alt="QR code do 2FA"
                width={148}
                height={148}
                style={{ background: "#fff", borderRadius: 12, padding: 8 }}
              />
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 12, color: "var(--text-faint)", fontWeight: 700, marginBottom: 4 }}>
                  Código manual
                </div>
                <code
                  style={{
                    display: "block",
                    fontSize: 13,
                    wordBreak: "break-all",
                    color: "var(--text-hi)",
                    marginBottom: 12,
                  }}
                >
                  {enroll.secret}
                </code>
                <label htmlFor="mfa-confirm" style={{ fontSize: 13, color: "var(--text-lo)" }}>
                  Código de 6 dígitos
                </label>
                <input
                  id="mfa-confirm"
                  className="input tnum"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  style={{ marginTop: 4 }}
                />
              </div>
            </div>
            {error && (
              <div className="warn-text" style={{ marginTop: 12 }}>
                <Icon name="alert-triangle" size={14} />
                {error}
              </div>
            )}
            <div className="row gap-2" style={{ marginTop: 14, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={cancelEnroll}
                disabled={pending}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={confirm}
                disabled={pending || code.length !== 6}
              >
                {pending ? <Icon name="loader-circle" size={16} className="spin" /> : "Confirmar"}
              </button>
            </div>
          </div>
        )}

        {error && !enroll && (
          <div className="warn-text" style={{ marginTop: 12 }}>
            <Icon name="alert-triangle" size={14} />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
