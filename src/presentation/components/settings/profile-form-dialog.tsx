"use client";

import { type ChangeEvent, type ReactNode, useId, useRef, useState } from "react";
import { removeAvatarAction, updateProfileAction, uploadAvatarAction } from "@/app/_actions/auth";
import { Dialog, DialogTrigger } from "@/presentation/components/ui/dialog";
import { FormModal } from "@/presentation/components/ui/form-modal";
import { Icon } from "@/presentation/components/ui/icon";
import { toast } from "@/presentation/stores/ui-store";

const AVATAR_MAX_BYTES = 3 * 1024 * 1024;

/** Editar perfil — ported from the prototype (forms.jsx ProfileForm); name + photo persist. */
export function ProfileFormDialog({
  name,
  email,
  avatarUrl,
  trigger,
}: {
  name: string;
  email: string;
  avatarUrl: string | null;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const formId = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && (
        <ProfileForm
          key={formId}
          name={name}
          email={email}
          avatarUrl={avatarUrl}
          onDone={() => setOpen(false)}
        />
      )}
    </Dialog>
  );
}

function ProfileForm({
  name: initial,
  email,
  avatarUrl,
  onDone,
}: {
  name: string;
  email: string;
  avatarUrl: string | null;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(avatarUrl);
  const [removed, setRemoved] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSubmit = name.trim().length > 1;
  const initials = (name.trim() || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > AVATAR_MAX_BYTES) {
      setServerError("A imagem deve ter até 3 MB.");
      return;
    }
    setServerError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setRemoved(false);
  }

  function clearPhoto() {
    setFile(null);
    setPreview(null);
    setRemoved(true);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save() {
    if (!canSubmit || submitting) return;
    setServerError(null);
    setSubmitting(true);

    const profile = await updateProfileAction({ displayName: name.trim() });
    if (!profile.ok) {
      setSubmitting(false);
      setServerError(profile.error);
      return;
    }
    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      const up = await uploadAvatarAction(fd);
      if (!up.ok) {
        setSubmitting(false);
        setServerError(up.error);
        return;
      }
    } else if (removed && avatarUrl) {
      await removeAvatarAction();
    }
    setSubmitting(false);
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
      <div
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginBottom: 20 }}
      >
        {preview ? (
          // biome-ignore lint/performance/noImgElement: user-uploaded avatar from Supabase Storage / object URL.
          <img
            src={preview}
            alt="Foto de perfil"
            width={72}
            height={72}
            style={{ width: 72, height: 72, borderRadius: 22, objectFit: "cover" }}
          />
        ) : (
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
        )}
        <div className="row gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
            <Icon name="pencil" size={15} />
            {preview ? "Trocar foto" : "Adicionar foto"}
          </button>
          {preview && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={clearPhoto}>
              Remover
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={pickFile}
        />
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
