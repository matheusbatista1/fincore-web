"use client";

import { useState } from "react";
import { changePasswordAction } from "@/app/_actions/auth";
import { Dialog, DialogTrigger } from "@/presentation/components/ui/dialog";
import { FormModal } from "@/presentation/components/ui/form-modal";
import { Icon } from "@/presentation/components/ui/icon";
import { toast } from "@/presentation/stores/ui-store";

/** Settings card to change the account password (validates the current one). */
export function PasswordCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <div>
          <h3>Senha</h3>
          <div className="ch-sub">Altere a senha de acesso da sua conta.</div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button type="button" className="btn btn-ghost btn-sm">
              <Icon name="lock" size={16} />
              Mudar senha
            </button>
          </DialogTrigger>
          {open && <PasswordForm onDone={() => setOpen(false)} />}
        </Dialog>
      </div>
    </div>
  );
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = current.length > 0 && next.length >= 6 && confirm.length >= 6;

  async function save() {
    if (!canSubmit || submitting) return;
    if (next !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await changePasswordAction({ currentPassword: current, newPassword: next });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast("Senha alterada.");
    onDone();
  }

  return (
    <FormModal
      title="Mudar senha"
      submitLabel="Salvar"
      canSubmit={canSubmit}
      submitting={submitting}
      onSubmit={save}
    >
      <div className="field">
        <label htmlFor="cur-pass">Senha atual</label>
        <div className="input-ic">
          <Icon name="lock" size={17} />
          <input
            id="cur-pass"
            className="input"
            type={show ? "text" : "password"}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
            // biome-ignore lint/a11y/noAutofocus: first field of the password dialog.
            autoFocus
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="new-pass">Nova senha</label>
        <div className="input-ic">
          <Icon name="lock" size={17} />
          <input
            id="new-pass"
            className="input"
            type={show ? "text" : "password"}
            value={next}
            onChange={(e) => setNext(e.target.value)}
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
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="conf-pass">Confirmar nova senha</label>
        <div className="input-ic">
          <Icon name="lock" size={17} />
          <input
            id="conf-pass"
            className="input"
            type={show ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={6}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </div>
      </div>
      {error && (
        <div className="warn-text" style={{ marginTop: 12 }}>
          <Icon name="alert-triangle" size={14} />
          {error}
        </div>
      )}
    </FormModal>
  );
}
