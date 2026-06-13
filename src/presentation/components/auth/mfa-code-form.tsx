"use client";

import type { CSSProperties, ReactNode } from "react";
import { Icon } from "@/presentation/components/ui/icon";
import { LogoMark } from "@/presentation/components/ui/logo-mark";

const BRAND: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  fontSize: 22,
  color: "var(--text-hi)",
};

/**
 * Second-factor (TOTP) code form, shared between the login step-up and the
 * `/verify-2fa` guard route. `footer` lets the caller add e.g. a "sign out" link.
 */
export function MfaCodeForm({
  action,
  pending,
  error,
  footer,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  error?: string | undefined;
  footer?: ReactNode;
}) {
  return (
    <form className="login-form" action={action}>
      <div className="lf-mobile-brand">
        <LogoMark size={36} />
        <span style={BRAND}>
          Fin<span style={{ color: "var(--purple-400)" }}>Core</span>
        </span>
      </div>
      <h2>Verificação em duas etapas</h2>
      <p className="lf-sub">Digite o código de 6 dígitos do seu app autenticador.</p>

      <div className="field">
        <label htmlFor="mfa-code">Código</label>
        <div className="input-ic">
          <Icon name="lock" size={17} />
          <input
            id="mfa-code"
            className="input"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            pattern="\d{6}"
            placeholder="000000"
            required
            // biome-ignore lint/a11y/noAutofocus: the code field is the only action on this step.
            autoFocus
          />
        </div>
      </div>

      {error && (
        <div className="warn-text" style={{ marginBottom: 12 }}>
          <Icon name="alert-triangle" size={14} />
          {error}
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary"
        style={{ width: "100%", height: 50, marginTop: 4 }}
        disabled={pending}
      >
        {pending ? (
          <Icon name="loader-circle" size={18} className="spin" />
        ) : (
          <span className="row gap-2">
            <Icon name="arrow-right" size={18} />
            Verificar
          </span>
        )}
      </button>

      {footer}
    </form>
  );
}
