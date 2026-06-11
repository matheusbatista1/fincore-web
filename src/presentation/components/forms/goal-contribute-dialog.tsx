"use client";

import { type ReactNode, useState } from "react";
import { contributeToGoalAction } from "@/app/_actions/finance";
import { Button } from "@/presentation/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/presentation/components/ui/dialog";
import { cn } from "@/presentation/lib/cn";
import { formatBRL } from "@/shared/formatting/currency";

export function GoalContributeDialog({
  goal,
  trigger,
}: {
  goal: { id: string; name: string };
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
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
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setCents(0);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={`Contribuir para ${goal.name}`}>
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="sr-only">Valor</span>
            <input
              value={formatBRL(cents, { withSign: false })}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "");
                setCents(digits ? Number.parseInt(digits, 10) : 0);
              }}
              inputMode="numeric"
              className={cn(
                "w-full bg-transparent text-center font-display text-4xl font-semibold tabular-nums text-mint-500 outline-none",
              )}
            />
          </label>

          {error && <p className="text-sm text-rose-500">{error}</p>}

          <div className="mt-1 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancelar</Button>
            </DialogClose>
            <Button onClick={submit} disabled={cents <= 0 || submitting}>
              {submitting ? "Adicionando…" : "Adicionar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
