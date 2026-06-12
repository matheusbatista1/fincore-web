"use client";

import { type ReactNode, useId, useState } from "react";
import { updateProfileAction } from "@/app/_actions/auth";
import { Dialog, DialogTrigger } from "@/presentation/components/ui/dialog";
import { FormModal } from "@/presentation/components/ui/form-modal";
import { Icon } from "@/presentation/components/ui/icon";
import { toast } from "@/presentation/stores/ui-store";

/** Editar perfil — ported 1:1 from the prototype (forms.jsx ProfileForm); name persists. */
export function ProfileFormDialog({
  name,
  email,
  trigger,
}: {
  name: string;
  email: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const formId = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <ProfileForm key={formId} name={name} email={email} onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

function ProfileForm({ name: initial, email, onDone }: { name: string; email: string; onDone: () => void }) {
  const [name, setName] = useState(initial);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 1;
  const initials = (name.trim() || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  async function save() {
    if (!canSubmit || submitting) return;
    setServerError(null);
    setSubmitting(true);
    const result = await updateProfileAction({ displayName: name.trim() });
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast("Perfil atualizado");
    onDone();
  }

  return (
    <FormModal
      title="Editar perfil"
      submitLabel="Salvar"
      canSubmit={canSubmit}
      submitting={submitting}
      onSubmit={save}
    >
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <span
          className="ava-circle"
          style={{
            width: 72,
            height: 72,
            borderRadius: 22,
            fontSize: 26,
            background: "linear-gradient(135deg,var(--purple-400),var(--purple-700))",
          }}
        >
          {initials}
        </span>
      </div>
      <div className="field">
        <label>Nome completo</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Seu nome"
          // biome-ignore lint/a11y/noAutofocus: name is the primary field of the modal (prototype parity).
          autoFocus
        />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>
          E-mail <span style={{ color: "var(--text-lo)", fontWeight: 400 }}>· da sua conta</span>
        </label>
        <div className="input-ic">
          <Icon name="mail" size={17} />
          <input className="input" type="email" value={email} disabled readOnly />
        </div>
      </div>
      {serverError && (
        <div className="warn-text" style={{ marginTop: 12 }}>
          {serverError}
        </div>
      )}
    </FormModal>
  );
}
