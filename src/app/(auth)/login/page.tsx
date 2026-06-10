"use client";

import { ArrowRight, Eye, EyeOff, LoaderCircle, Lock, Mail } from "lucide-react";
import { useActionState, useState } from "react";
import { type AuthFormState, authenticateAction } from "@/app/_actions/auth";

const INITIAL: AuthFormState = {};

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState(authenticateAction, INITIAL);

  const isSignup = mode === "signup";

  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="app-aura" aria-hidden="true" />

      {/* Brand panel */}
      <aside className="relative z-10 hidden flex-col justify-between p-12 lg:flex">
        <div className="flex items-center gap-3">
          <LogoMark />
          <span className="font-display text-2xl font-semibold text-text-hi">
            Fin<span className="text-purple-400">Core</span>
          </span>
        </div>
        <div className="max-w-md">
          <h1 className="font-display text-4xl font-semibold leading-tight text-text-hi">
            Sua vida financeira inteira, em um só lugar.
          </h1>
          <p className="mt-4 text-text-mid">
            Contas, cartões, pessoas e despesas compartilhadas — organizados e sob controle, em segundos.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-4">
            {[
              { v: "R$ 56,9k", l: "Saldo consolidado" },
              { v: "4", l: "Contas conectadas" },
              { v: "+8,3%", l: "No mês" },
            ].map((stat) => (
              <div key={stat.l}>
                <div className="tnum font-display text-xl font-semibold text-text-hi">{stat.v}</div>
                <div className="mt-1 text-xs text-text-lo">{stat.l}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-text-faint">Protegido com criptografia de ponta a ponta.</p>
      </aside>

      {/* Form panel */}
      <main className="relative z-10 flex items-center justify-center p-6 sm:p-12">
        <form action={formAction} className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark />
            <span className="font-display text-xl font-semibold text-text-hi">
              Fin<span className="text-purple-400">Core</span>
            </span>
          </div>

          <h2 className="font-display text-2xl font-semibold text-text-hi">
            {isSignup ? "Crie sua conta" : "Bem-vindo de volta"}
          </h2>
          <p className="mt-1 text-sm text-text-mid">
            {isSignup
              ? "Comece a organizar suas finanças agora."
              : "Entre para continuar gerenciando suas finanças."}
          </p>

          <input type="hidden" name="intent" value={mode} />

          <div className="mt-7 flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-text-lo">
              E-mail
            </label>
            <div className="flex items-center gap-2 rounded-sm border border-line bg-surface-3 px-3 focus-within:border-purple-400">
              <Mail size={17} className="text-text-lo" aria-hidden="true" />
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="voce@email.com"
                className="h-11 w-full bg-transparent text-text-hi outline-none placeholder:text-text-faint"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-text-lo">
              Senha
            </label>
            <div className="flex items-center gap-2 rounded-sm border border-line bg-surface-3 px-3 focus-within:border-purple-400">
              <Lock size={17} className="text-text-lo" aria-hidden="true" />
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete={isSignup ? "new-password" : "current-password"}
                placeholder="••••••••"
                className="h-11 w-full bg-transparent text-text-hi outline-none placeholder:text-text-faint"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="text-text-lo transition hover:text-text-hi"
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          {state.error && (
            <p className="mt-4 rounded-sm bg-rose-soft px-3 py-2 text-sm text-rose-500">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-pill bg-purple-500 font-semibold text-on-purple shadow-glow transition hover:bg-purple-600 disabled:opacity-60"
          >
            {pending ? (
              <LoaderCircle size={18} className="animate-spin" />
            ) : (
              <>
                <ArrowRight size={18} />
                {isSignup ? "Criar conta" : "Entrar"}
              </>
            )}
          </button>

          <p className="mt-6 text-center text-sm text-text-mid">
            {isSignup ? "Já tem conta?" : "Não tem conta?"}{" "}
            <button
              type="button"
              onClick={() => setMode(isSignup ? "signin" : "signup")}
              className="font-semibold text-purple-300 transition hover:text-purple-200"
            >
              {isSignup ? "Entrar" : "Criar agora"}
            </button>
          </p>
        </form>
      </main>
    </div>
  );
}

function LogoMark() {
  return (
    <span
      className="grid size-10 place-items-center rounded-md bg-gradient-to-br from-purple-400 to-purple-700 font-display text-lg font-bold text-on-purple shadow-glow"
      aria-hidden="true"
    >
      F
    </span>
  );
}
