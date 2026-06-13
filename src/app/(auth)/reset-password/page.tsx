"use client";

import type { CSSProperties } from "react";
import { useActionState, useState } from "react";
import { type AuthFormState, updatePasswordAction } from "@/app/_actions/auth";
import { Icon } from "@/presentation/components/ui/icon";
import { LogoMark } from "@/presentation/components/ui/logo-mark";

const INITIAL: AuthFormState = {};
const BRAND: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  fontSize: 22,
  color: "var(--text-hi)",
};

/** Set a new password from the recovery session opened by the reset link. */
export default function ResetPasswordPage() {
  const [state, action, pending] = useActionState(updatePasswordAction, INITIAL);
  const [show, setShow] = useState(false);

  return (
    <div className="login">
      <div className="app-aura" />
      <div className="login-grid" style={{ gridTemplateColumns: "1fr", maxWidth: 460, margin: "0 auto" }}>
        <div className="login-form-wrap">
          <form className="login-form" action={action}>
            <div className="lf-mobile-brand">
              <LogoMark size={36} />
              <span style={BRAND}>
                Fin<span style={{ color: "var(--purple-400)" }}>Core</span>
              </span>
            </div>
            <h2>Definir nova senha</h2>
            <p className="lf-sub">Escolha uma nova senha para a sua conta.</p>

            <div className="field">
              <label htmlFor="reset-password">Nova senha</label>
              <div className="input-ic">
                <Icon name="lock" size={17} />
                <input
                  id="reset-password"
                  className="input"
                  name="password"
                  type={show ? "text" : "password"}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="eye-btn"
                  aria-label={show ? "Ocultar senha" : "Mostrar senha"}
                  onClick={() => setShow((s) => !s)}
                >
                  <Icon name={show ? "eye-off" : "eye"} size={17} />
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="reset-confirm">Confirmar senha</label>
              <div className="input-ic">
                <Icon name="lock" size={17} />
                <input
                  id="reset-confirm"
                  className="input"
                  name="confirm"
                  type={show ? "text" : "password"}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {state.error && (
              <div className="warn-text" style={{ marginBottom: 12 }}>
                <Icon name="alert-triangle" size={14} />
                {state.error}
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
                  <Icon name="check" size={18} />
                  Salvar nova senha
                </span>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
