"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { confirmMfaAction, disableMfaAction, enrollMfaAction } from "@/app/_actions/auth";
import { Dialog, DialogClose, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { toast } from "@/presentation/stores/ui-store";

/** A QR-code string from Supabase may be a raw SVG or already a data URI. */
function qrSrc(qr: string): string {
  return qr.startsWith("data:") ? qr : `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`;
}

type Enroll = { factorId: string; qrCode: string; secret: string };

/** Two-factor (TOTP) setup card: opens a modal to enroll (QR + code), or disables. */
export function MfaCard({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function disable() {
    startTransition(async () => {
      const result = await disableMfaAction();
      if (!result.ok) {
        toast(result.error, "error");
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
      <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 12 }}>
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
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
              Ativar
            </button>
          )}
        </div>
      </div>

      {open && (
        <MfaEnrollModal
          onClose={() => setOpen(false)}
          onEnabled={() => {
            setEnabled(true);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Modal that enrolls a TOTP factor: shows the QR + secret, confirms the code. */
function MfaEnrollModal({ onClose, onEnabled }: { onClose: () => void; onEnabled: () => void }) {
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, startConfirm] = useTransition();
  const confirmed = useRef(false);

  useEffect(() => {
    let active = true;
    enrollMfaAction().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(result.error);
      } else {
        setEnroll({ factorId: result.factorId, qrCode: result.qrCode, secret: result.secret });
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  // Closing without confirming removes the freshly created (unverified) factor.
  function handleOpenChange(next: boolean) {
    if (next) return;
    if (!confirmed.current) void disableMfaAction();
    onClose();
  }

  function confirm() {
    if (!enroll) return;
    setError(null);
    startConfirm(async () => {
      const result = await confirmMfaAction(enroll.factorId, code);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      confirmed.current = true;
      toast("Autenticação em duas etapas ativada.");
      onEnabled();
    });
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogModal title="Ativar 2FA" maxWidth={420}>
        <div className="modal-body">
          {loading ? (
            <div style={{ display: "grid", placeItems: "center", padding: "32px 0" }}>
              <Icon name="loader-circle" size={26} className="spin" />
            </div>
          ) : enroll ? (
            <>
              <p style={{ fontSize: 13.5, color: "var(--text-lo)", lineHeight: 1.5, marginBottom: 14 }}>
                Escaneie o QR code no seu app autenticador (Google Authenticator, 1Password, Authy…) ou use o
                código manual. Depois informe os 6 dígitos para confirmar.
              </p>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                {/* biome-ignore lint/performance/noImgElement: dynamic data-URI QR, not a static asset. */}
                <img
                  src={qrSrc(enroll.qrCode)}
                  alt="QR code do 2FA"
                  width={172}
                  height={172}
                  style={{ background: "#fff", borderRadius: 12, padding: 10 }}
                />
              </div>
              <div className="field">
                <label htmlFor="mfa-secret">Código manual</label>
                <code
                  id="mfa-secret"
                  style={{
                    display: "block",
                    fontSize: 13,
                    wordBreak: "break-all",
                    color: "var(--text-hi)",
                    background: "var(--surface-2)",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--r-sm)",
                    padding: "8px 12px",
                  }}
                >
                  {enroll.secret}
                </code>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="mfa-confirm">Código de 6 dígitos</label>
                <input
                  id="mfa-confirm"
                  className="input tnum"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  autoFocus
                />
              </div>
            </>
          ) : null}

          {error && (
            <div className="warn-text" style={{ marginTop: 12 }}>
              <Icon name="alert-triangle" size={14} />
              {error}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <DialogClose asChild>
            <button type="button" className="btn btn-ghost">
              Cancelar
            </button>
          </DialogClose>
          <button
            type="button"
            className="btn btn-primary"
            onClick={confirm}
            disabled={!enroll || code.length !== 6 || confirming}
          >
            {confirming ? <Icon name="loader-circle" size={16} className="spin" /> : "Confirmar"}
          </button>
        </div>
      </DialogModal>
    </Dialog>
  );
}
