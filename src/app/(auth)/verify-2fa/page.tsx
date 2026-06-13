"use client";

import { useActionState } from "react";
import { type AuthFormState, signOutAction, verifyMfaAction } from "@/app/_actions/auth";
import { MfaCodeForm } from "@/presentation/components/auth/mfa-code-form";

const INITIAL: AuthFormState = {};

/**
 * AAL2 step-up guard route. The proxy sends here any session that has a verified
 * TOTP factor but is still at aal1 (e.g. a pre-existing session). On success
 * `verifyMfaAction` redirects to /dashboard.
 */
export default function Verify2faPage() {
  const [state, action, pending] = useActionState(verifyMfaAction, INITIAL);

  return (
    <div className="login">
      <div className="app-aura" />
      <div className="login-grid" style={{ gridTemplateColumns: "1fr", maxWidth: 460, margin: "0 auto" }}>
        <div className="login-form-wrap">
          <MfaCodeForm
            action={action}
            pending={pending}
            error={state.error}
            footer={
              <p className="lf-foot">
                <button type="submit" className="lf-link" formAction={signOutAction} formNoValidate>
                  Sair da conta
                </button>
              </p>
            }
          />
        </div>
      </div>
    </div>
  );
}
