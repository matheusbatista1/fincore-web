"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient, getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { sanitizeModules } from "@/shared/modules";

/** The request's public origin (works on localhost, Vercel preview and prod). */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export interface AuthFormState {
  readonly error?: string;
  /** Set when the password was accepted but a second factor (TOTP) is still required. */
  readonly mfaRequired?: boolean;
}

const credentialsSchema = z.object({
  email: z.string().trim().min(3, "Informe um e-mail."),
  password: z.string().min(6, "A senha precisa de ao menos 6 caracteres."),
});

function parse(formData: FormData) {
  return credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) return { error: "E-mail ou senha incorretos." };

  await financeRepository.ensureProfile(data.user.id, data.user.email ?? parsed.data.email);

  // Step-up: if the account has a verified TOTP factor, the password alone only
  // reaches aal1 — ask for the code (verified client-side) before entering.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal1" && aal.nextLevel === "aal2") {
    return { mfaRequired: true };
  }
  redirect("/dashboard");
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const emailRedirectTo = `${await requestOrigin()}/auth/callback`;
  const { data, error } = await supabase.auth.signUp({ ...parsed.data, options: { emailRedirectTo } });
  if (error) return { error: error.message };
  // With email confirmation disabled (local dev) a session is returned immediately.
  if (data.user && data.session) {
    await financeRepository.ensureProfile(data.user.id, data.user.email ?? parsed.data.email);
    redirect("/dashboard");
  }
  return { error: "Conta criada. Confirme o e-mail para entrar." };
}

const profileSchema = z.object({
  displayName: z.string().trim().min(2, "Informe seu nome.").max(80),
});

export async function updateProfileAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  await financeRepository.updateProfile(user.id, parsed.data);
  revalidatePath("/", "layout");
  return { ok: true };
}

const modulesSchema = z.object({ modules: z.array(z.string()) });

/** Persist the set of optional modules the user has turned on (settings toggle). */
export async function updateModulesAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
  const parsed = modulesSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  await financeRepository.updateEnabledModules(user.id, sanitizeModules(parsed.data.modules));
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Finish first-run onboarding: save the chosen modules and stamp the flag. */
export async function markOnboardedAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
  const parsed = modulesSchema.safeParse(raw);
  await financeRepository.updateEnabledModules(
    user.id,
    parsed.success ? sanitizeModules(parsed.data.modules) : [],
  );
  await financeRepository.markOnboarded(user.id);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Second-factor (TOTP) verification during login — challenges + verifies, then enters. */
export async function verifyMfaAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const code = String(formData.get("code") ?? "").trim();
  if (!/^\d{6}$/.test(code)) return { mfaRequired: true, error: "Digite o código de 6 dígitos." };

  const supabase = await createSupabaseServerClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((f) => f.status === "verified") ?? factors?.totp?.[0];
  if (!factor) return { error: "Sessão expirada. Entre novamente." };

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: factor.id,
  });
  if (challengeError || !challenge) {
    return { mfaRequired: true, error: "Não foi possível validar agora. Tente de novo." };
  }
  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) return { mfaRequired: true, error: "Código inválido. Tente de novo." };
  redirect("/dashboard");
}

type EnrollResult =
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | { ok: false; error: string };

/** Start TOTP enrollment: clears stale unverified factors, returns the QR + secret. */
export async function enrollMfaAction(): Promise<EnrollResult> {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const f of existing?.totp ?? []) {
    if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error || !data) return { ok: false, error: error?.message ?? "Não foi possível iniciar o 2FA." };
  return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Confirm enrollment by verifying the first TOTP code. */
export async function confirmMfaAction(
  factorId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d{6}$/.test(code.trim())) return { ok: false, error: "Digite o código de 6 dígitos." };
  const supabase = await createSupabaseServerClient();
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError || !challenge) return { ok: false, error: "Não foi possível validar. Tente de novo." };
  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: code.trim(),
  });
  if (verifyError) return { ok: false, error: "Código inválido. Confira o relógio do app autenticador." };
  return { ok: true };
}

/** Disable 2FA by unenrolling every TOTP factor. */
export async function disableMfaAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  for (const f of data?.totp ?? []) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  return { ok: true };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Dispatches sign-in vs sign-up based on the form's `intent` field (for useActionState). */
export async function authenticateAction(prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return formData.get("intent") === "signup" ? signUpAction(prev, formData) : signInAction(prev, formData);
}
