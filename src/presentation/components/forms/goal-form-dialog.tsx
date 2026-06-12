"use client";

import { type ReactNode, useId, useState } from "react";
import { createGoalAction, deleteGoalAction, updateGoalAction } from "@/app/_actions/finance";
import { Dialog, DialogTrigger } from "@/presentation/components/ui/dialog";
import { FormModal } from "@/presentation/components/ui/form-modal";
import { toast } from "@/presentation/stores/ui-store";
import { reaisToCents } from "@/shared/formatting/parse-reais";

interface EditableGoal {
  readonly id: string;
  readonly name: string;
  readonly targetCents: number;
  readonly savedCents: number;
}

/** Nova/editar meta — prototype form language (.field/.input). */
export function GoalFormDialog({ goal, trigger }: { goal?: EditableGoal; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const formId = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <GoalForm key={formId} goal={goal} onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

function GoalForm({ goal, onDone }: { goal?: EditableGoal | undefined; onDone: () => void }) {
  const editing = goal !== undefined;
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? (goal.targetCents / 100).toFixed(2).replace(".", ",") : "");
  const [saved, setSaved] = useState(goal ? (goal.savedCents / 100).toFixed(2).replace(".", ",") : "0");
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && reaisToCents(target) > 0;

  async function save() {
    if (!canSubmit || submitting) return;
    setServerError(null);
    const input = {
      name: name.trim(),
      targetCents: reaisToCents(target),
      savedCents: reaisToCents(saved),
    };
    setSubmitting(true);
    const result = editing ? await updateGoalAction(goal.id, input) : await createGoalAction(input);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast(`Meta ${name.trim()} salva`);
    onDone();
  }

  async function remove() {
    if (!editing || submitting) return;
    setSubmitting(true);
    const result = await deleteGoalAction(goal.id);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast(`Meta ${goal.name} removida`);
    onDone();
  }

  return (
    <FormModal
      title={editing ? "Editar meta" : "Nova meta"}
      submitLabel={editing ? "Salvar" : "Adicionar"}
      canSubmit={canSubmit}
      submitting={submitting}
      onSubmit={save}
      maxWidth={440}
      {...(editing ? { onDelete: remove } : {})}
    >
      <div className="field">
        <label>Nome</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Reserva de emergência"
          // biome-ignore lint/a11y/noAutofocus: name is the primary field of the modal (prototype parity).
          autoFocus
        />
      </div>
      <div className="form-grid-2">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Alvo (R$)</label>
          <input
            className="input tnum"
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="10000,00"
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Já guardado (R$)</label>
          <input
            className="input tnum"
            inputMode="decimal"
            value={saved}
            onChange={(e) => setSaved(e.target.value)}
            placeholder="0,00"
          />
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
