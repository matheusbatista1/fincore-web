"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createGoalAction, updateGoalAction } from "@/app/_actions/finance";
import { Button } from "@/presentation/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/presentation/components/ui/dialog";
import { Field, TextInput } from "@/presentation/components/ui/field";

interface EditableGoal {
  readonly id: string;
  readonly name: string;
  readonly targetCents: number;
  readonly savedCents: number;
}

const formSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome."),
  targetReais: z.string(),
  savedReais: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

function reaisToCents(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function GoalFormDialog({ goal, trigger }: { goal?: EditableGoal; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const editing = goal !== undefined;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: goal?.name ?? "",
      targetReais: goal ? (goal.targetCents / 100).toFixed(2) : "",
      savedReais: goal ? (goal.savedCents / 100).toFixed(2) : "0",
    },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const input = {
      name: values.name,
      targetCents: reaisToCents(values.targetReais),
      savedCents: reaisToCents(values.savedReais),
    };
    if (input.targetCents <= 0) {
      setServerError("Informe um alvo maior que zero.");
      return;
    }
    const result = editing ? await updateGoalAction(goal.id, input) : await createGoalAction(input);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={editing ? "Editar meta" : "Nova meta"}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Field label="Nome" error={errors.name?.message}>
            <TextInput {...register("name")} placeholder="Reserva de emergência, viagem…" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Alvo (R$)">
              <TextInput {...register("targetReais")} inputMode="decimal" placeholder="0,00" />
            </Field>
            <Field label="Já guardado (R$)">
              <TextInput {...register("savedReais")} inputMode="decimal" placeholder="0,00" />
            </Field>
          </div>

          {serverError && <p className="text-sm text-rose-500">{serverError}</p>}

          <div className="mt-2 flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {editing ? "Salvar" : "Criar meta"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
