"use client";

import { useState } from "react";
import { deleteAccountAction } from "@/app/_actions/auth";
import { Dialog, DialogClose, DialogModal, DialogTrigger } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";

/** Danger card to delete the account (30-day deactivation, validated by password). */
export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-pad">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="danger-row"
              style={{ width: "100%", cursor: "pointer", color: "var(--rose-500)" }}
            >
              <span className="row gap-2">
                <Icon name="trash-2" size={17} />
                Apagar conta
              </span>
              <Icon name="chevron-right" size={16} />
            </button>
          </DialogTrigger>
          {open && <DeleteAccountForm onClose={() => setOpen(false)} />}
        </Dialog>
      </div>
    </div>
  );
}

function DeleteAccountForm({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (password.length === 0 || submitting) return;
    setError(null);
    setSubmitting(true);
    // On success the action signs out and redirects; only failures return here.
    const result = await deleteAccountAction({ password });
    setSubmitting(false);
    if (result && !result.ok) setError(result.error);
  }

  return (
    <DialogModal title="Apagar conta" maxWidth={460}>
      <div className="modal-body">
        <p style={{ margin: "0 0 16px", color: "var(--text-mid)", fontSize: 14, lineHeight: 1.55 }}>
          Sua conta será <b style={{ color: "var(--text-hi)" }}>desativada agora</b> e apagada definitivamente
          em <b style={{ color: "var(--text-hi)" }}>30 dias</b>. Se você entrar de novo antes disso, ela é
          reativada automaticamente e nada é perdido. Confirme com sua senha.
        </p>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="del-pass">Senha</label>
          <div className="input-ic">
            <Icon name="lock" size={17} />
            <input
              id="del-pass"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
              // biome-ignore lint/a11y/noAutofocus: the password is the only field of this confirm dialog.
              autoFocus
            />
          </div>
        </div>
        {error && (
          <div className="warn-text" style={{ marginTop: 12 }}>
            <Icon name="alert-triangle" size={14} />
            {error}
          </div>
        )}
      </div>
      <div className="modal-foot">
        <DialogClose asChild>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
        </DialogClose>
        <button
          type="button"
          className="btn"
          style={{ background: "var(--rose-500)", color: "#fff" }}
          onClick={submit}
          disabled={password.length === 0 || submitting}
        >
          {submitting ? <Icon name="loader-circle" size={16} className="spin" /> : "Apagar minha conta"}
        </button>
      </div>
    </DialogModal>
  );
}
