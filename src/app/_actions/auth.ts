"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";

export interface AuthFormState {
  readonly error?: string;
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
  redirect("/dashboard");
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp(parsed.data);
  if (error) return { error: error.message };
  // With email confirmation disabled (local dev) a session is returned immediately.
  if (data.user && data.session) {
    await financeRepository.ensureProfile(data.user.id, data.user.email ?? parsed.data.email);
    redirect("/dashboard");
  }
  return { error: "Conta criada. Confirme o e-mail para entrar." };
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
