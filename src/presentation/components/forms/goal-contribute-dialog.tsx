"use client";

import { type ReactNode, useId, useState } from "react";
import { contributeToGoalAction } from "@/app/_actions/finance";
import { Dialog, DialogTrigger } from "@/presentation/components/ui/dialog";
import { FormModal } from "@/presentation/components/ui/form-modal";
import { toast } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";

/** Contribuição para uma meta — prototype modal language (.amount-input). */
export function GoalContributeDialog({
  goal,
  trigger,
}: {
  goal: { id: string; name: string };
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const formId = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <ContributeForm key={formId} goal={goal} onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

function ContributeForm({ goal, onDone }: { goal: { id: string; name: string }; onDone: () => void }) {
  const [cents, setCents] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (cents <= 0 || submitting) return;
    setError(null);
    setSubmitting(true);
    const result = await contributeToGoalAction(goal.id, { amountCents: cents });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast(`${formatBRLAbsolute(cents)} guardados em ${goal.name}`);
    onDone();
  }

  return (
    <FormModal
      title={`Contribuir para ${goal.name}`}
      submitLabel="Adicionar"
      canSubmit={cents > 0}
      submitting={submitting}
      onSubmit={submit}
      maxWidth={440}
    >
      <input
        className="amount-input"
        value={formatBRLAbsolute(cents)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          setCents(digits ? Number.parseInt(digits, 10) : 0);
        }}
        inputMode="numeric"
        // biome-ignore lint/a11y/noAutofocus: amount is the primary field of the modal (prototype parity).
        autoFocus
        aria-label="Valor"
        style={{ color: "var(--mint-500)" }}
      />
      {error && (
        <div className="warn-text" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </FormModal>
  );
}
