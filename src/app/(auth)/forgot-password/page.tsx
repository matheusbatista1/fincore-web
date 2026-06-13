"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useActionState } from "react";
import { type AuthFormState, requestPasswordResetAction } from "@/app/_actions/auth";
import { Icon } from "@/presentation/components/ui/icon";
import { LogoMark } from "@/presentation/components/ui/logo-mark";

const INITIAL: AuthFormState = {};
const BRAND: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  fontSize: 22,
  color: "var(--text-hi)",
};

/** Request a password-reset link by e-mail. */
export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, INITIAL);

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
            <h2>Recuperar senha</h2>
            <p className="lf-sub">Enviaremos um link para você redefinir sua senha.</p>

            {state.sent ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  fontSize: 14,
                  color: "var(--mint-500)",
                  lineHeight: 1.5,
                  marginTop: 4,
                }}
              >
                <Icon name="check-circle" size={16} />
                <span>
                  Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha. Confira sua
                  caixa de entrada e o spam.
                </span>
              </div>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="forgot-email">E-mail</label>
                  <div className="input-ic">
                    <Icon name="mail" size={17} />
                    <input
                      id="forgot-email"
                      className="input"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="voce@email.com"
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
                      <Icon name="mail" size={18} />
                      Enviar link
                    </span>
                  )}
                </button>
              </>
            )}

            <p className="lf-foot">
              <Link href="/login" className="lf-link">
                Voltar ao login
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
