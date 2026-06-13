"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { type AuthFormState, authenticateAction, verifyMfaAction } from "@/app/_actions/auth";
import { MfaCodeForm } from "@/presentation/components/auth/mfa-code-form";
import { Icon } from "@/presentation/components/ui/icon";
import { LogoMark } from "@/presentation/components/ui/logo-mark";

const INITIAL: AuthFormState = {};

/** Tela de login — ported 1:1 from the prototype (login.jsx), wired to Supabase auth. */
export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [show, setShow] = useState(false);
  const [state, formAction, pending] = useActionState(authenticateAction, INITIAL);
  const [mfaState, mfaAction, mfaPending] = useActionState(verifyMfaAction, INITIAL);
  const isSignup = mode === "signup";
  const mfaMode = Boolean(state.mfaRequired) || Boolean(mfaState.mfaRequired);

  return (
    <div className="login">
      <div className="app-aura" />
      <div className="login-grid">
        {/* painel marca */}
        <div className="login-brand">
          <div className="lb-top">
            <div className="row gap-3" style={{ alignItems: "center" }}>
              <LogoMark size={40} />
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: 26,
                  color: "var(--text-hi)",
                }}
              >
                Fin<span style={{ color: "var(--purple-400)" }}>Core</span>
              </span>
            </div>
          </div>
          <div className="lb-mid">
            <h1>
              Sua vida financeira inteira,
              <br />
              em um só lugar.
            </h1>
            <p>
              Contas, cartões, pessoas e despesas compartilhadas — organizados e sob controle, em segundos.
            </p>
            <div className="lb-stats">
              <div>
                <div className="lbs-v tnum">R$ 56.9k</div>
                <div className="lbs-l">Saldo consolidado</div>
              </div>
              <div>
                <div className="lbs-v tnum">4</div>
                <div className="lbs-l">Contas conectadas</div>
              </div>
              <div>
                <div className="lbs-v tnum">+8,3%</div>
                <div className="lbs-l">No mês</div>
              </div>
            </div>
          </div>
          <div className="lb-foot">Protegido com criptografia de ponta a ponta.</div>
        </div>

        {/* painel form */}
        <div className="login-form-wrap">
          {mfaMode ? (
            <MfaCodeForm action={mfaAction} pending={mfaPending} error={mfaState.error} />
          ) : (
            <form className="login-form" action={formAction}>
              <div className="lf-mobile-brand">
                <LogoMark size={36} />
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    fontSize: 22,
                    color: "var(--text-hi)",
                  }}
                >
                  Fin<span style={{ color: "var(--purple-400)" }}>Core</span>
                </span>
              </div>
              <h2>{isSignup ? "Crie sua conta" : "Bem-vindo de volta"}</h2>
              <p className="lf-sub">
                {isSignup
                  ? "Comece a organizar suas finanças agora."
                  : "Entre para continuar gerenciando suas finanças."}
              </p>

              <input type="hidden" name="intent" value={mode} />

              <div className="field">
                <label htmlFor="login-email">E-mail</label>
                <div className="input-ic">
                  <Icon name="mail" size={17} />
                  <input
                    id="login-email"
                    className="input"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="voce@email.com"
                  />
                </div>
              </div>
              <div className="field">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <label htmlFor="login-password">Senha</label>
                  <Link href="/forgot-password" className="lf-link">
                    Esqueceu?
                  </Link>
                </div>
                <div className="input-ic">
                  <Icon name="lock" size={17} />
                  <input
                    id="login-password"
                    className="input"
                    name="password"
                    type={show ? "text" : "password"}
                    required
                    autoComplete={isSignup ? "new-password" : "current-password"}
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

              <label className="lf-check">
                <input type="checkbox" defaultChecked />
                <span>Manter conectado neste dispositivo</span>
              </label>

              {isSignup && (
                <label className="lf-check">
                  <input type="checkbox" name="accept" required />
                  <span>
                    Li e aceito os{" "}
                    <Link href="/terms" className="lf-link" target="_blank">
                      Termos de Uso
                    </Link>{" "}
                    e a{" "}
                    <Link href="/privacy" className="lf-link" target="_blank">
                      Política de Privacidade
                    </Link>
                    .
                  </span>
                </label>
              )}

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
                    <Icon name="arrow-right" size={18} />
                    {isSignup ? "Criar conta" : "Entrar"}
                  </span>
                )}
              </button>

              <p className="lf-foot">
                {isSignup ? "Já tem conta? " : "Não tem conta? "}
                <button
                  type="button"
                  className="lf-link"
                  onClick={() => setMode(isSignup ? "signin" : "signup")}
                >
                  {isSignup ? "Entrar" : "Criar agora"}
                </button>
              </p>

              <div style={{ marginTop: 14, display: "flex", gap: 16, justifyContent: "center" }}>
                <Link href="/privacy" className="lf-link" target="_blank">
                  Privacidade
                </Link>
                <Link href="/terms" className="lf-link" target="_blank">
                  Termos
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
