"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createPersonAction, updatePersonAction } from "@/app/_actions/finance";
import type { PersonView } from "@/application/use-cases/get-workspace-view";
import { Button } from "@/presentation/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/presentation/components/ui/dialog";
import { Field, TextInput } from "@/presentation/components/ui/field";

const formSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome."),
  relationship: z.string(),
  color: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

export function PersonFormDialog({ person, trigger }: { person?: PersonView; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const editing = person !== undefined;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: person?.name ?? "",
      relationship: person?.relationship ?? "",
      color: person?.color || "#7c5cff",
    },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const input = { name: values.name, relationship: values.relationship, color: values.color };
    const result = editing ? await updatePersonAction(person.id, input) : await createPersonAction(input);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={editing ? "Editar pessoa" : "Nova pessoa"}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Field label="Nome" error={errors.name?.message}>
            <TextInput {...register("name")} placeholder="Mariana Costa" autoFocus />
          </Field>
          <Field label="Relação">
            <TextInput {...register("relationship")} placeholder="Amiga, irmão, namorada…" />
          </Field>
          <Field label="Cor">
            <input
              type="color"
              {...register("color")}
              className="h-11 w-20 rounded-sm border border-line bg-surface-3"
            />
          </Field>

          {serverError && <p className="text-sm text-rose-500">{serverError}</p>}

          <div className="mt-2 flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {editing ? "Salvar" : "Criar pessoa"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
