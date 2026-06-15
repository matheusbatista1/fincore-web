"use client";

import { type ReactNode, useId, useState } from "react";
import { createPersonAction, deletePersonAction, updatePersonAction } from "@/app/_actions/finance";
import type { Person } from "@/domain/entities/person";
import { Dialog, DialogTrigger } from "@/presentation/components/ui/dialog";
import { FormModal } from "@/presentation/components/ui/form-modal";
import { toast } from "@/presentation/stores/ui-store";
import { DEFAULT_PERSON_COLOR, PERSON_COLORS } from "@/shared/theme/person-colors";

/** Adicionar/editar pessoa — ported 1:1 from the prototype (forms.jsx PersonForm). */
export function PersonFormDialog({ person, trigger }: { person?: Person; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const formId = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <PersonForm key={formId} person={person} onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

function PersonForm({ person, onDone }: { person?: Person | undefined; onDone: () => void }) {
  const editing = person !== undefined;
  const [name, setName] = useState(person?.name ?? "");
  const [rel, setRel] = useState(person?.relationship ?? "");
  const [color, setColor] = useState(person?.color || DEFAULT_PERSON_COLOR);
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
    const input = { name: name.trim(), relationship: rel.trim() || "Contato", color };
    setSubmitting(true);
    const result = editing ? await updatePersonAction(person.id, input) : await createPersonAction(input);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast(`${name.trim()} ${editing ? "salvo" : "adicionado"}`);
    onDone();
  }

  async function remove() {
    if (!editing || submitting) return;
    setSubmitting(true);
    const result = await deletePersonAction(person.id);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast(`${person.name} removido`);
    onDone();
  }

  return (
    <FormModal
      title={editing ? "Editar pessoa" : "Adicionar pessoa"}
      submitLabel={editing ? "Salvar" : "Adicionar"}
      canSubmit={canSubmit}
      submitting={submitting}
      onSubmit={save}
      {...(editing ? { onDelete: remove } : {})}
    >
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <span
          className="ava-circle"
          style={{ width: 64, height: 64, borderRadius: 20, fontSize: 24, background: color }}
        >
          {initials}
        </span>
      </div>
      <div className="field">
        <label>Nome</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Mariana Costa"
          // biome-ignore lint/a11y/noAutofocus: name is the primary field of the modal (prototype parity).
          autoFocus
        />
      </div>
      <div className="field">
        <label>
          Relação <span style={{ color: "var(--text-lo)", fontWeight: 400 }}>· opcional</span>
        </label>
        <input
          className="input"
          value={rel}
          onChange={(e) => setRel(e.target.value)}
          placeholder="Amigo, família, colega…"
        />
      </div>
      <div className="field">
        <label>Cor</label>
        <div className="swatches">
          {PERSON_COLORS.map((c) => (
            <button
              type="button"
              key={c}
              className={`swatch${color === c ? " on" : ""}`}
              style={{ background: c }}
              aria-label={`Cor ${c}`}
              onClick={() => setColor(c)}
            />
          ))}
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
