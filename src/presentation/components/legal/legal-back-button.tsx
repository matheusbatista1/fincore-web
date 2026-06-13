"use client";

import { useRouter } from "next/navigation";

/**
 * Context-aware "back" for the legal pages: returns the user to wherever they
 * came from (login, settings, signup…) instead of always linking to /login.
 * Falls back to /dashboard when there's no in-app history to go back to.
 */
export function LegalBackButton() {
  const router = useRouter();

  function back() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={back}>
      Voltar
    </button>
  );
}
