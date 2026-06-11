"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createBudgetAction, updateBudgetAction } from "@/app/_actions/finance";
import { Button } from "@/presentation/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/presentation/components/ui/dialog";
import { Field, Select, TextInput } from "@/presentation/components/ui/field";

interface BudgetCategory {
  readonly id: string;
  readonly name: string;
}

interface EditableBudget {
  readonly id: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly limitCents: number;
}

const formSchema = z.object({
  categoryId: z.string().min(1, "Selecione uma categoria."),
  limitReais: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

function reaisToCents(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function BudgetFormDialog({
  budget,
  availableCategories = [],
  trigger,
}: {
  budget?: EditableBudget;
  availableCategories?: BudgetCategory[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const editing = budget !== undefined;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      categoryId: budget?.categoryId ?? availableCategories[0]?.id ?? "",
      limitReais: budget ? (budget.limitCents / 100).toFixed(2) : "",
    },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const input = { categoryId: values.categoryId, limitCents: reaisToCents(values.limitReais) };
    if (input.limitCents <= 0) {
      setServerError("Informe um limite maior que zero.");
      return;
    }
    const result = editing ? await updateBudgetAction(budget.id, input) : await createBudgetAction(input);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={editing ? "Editar orçamento" : "Novo orçamento"}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {editing ? (
            <Field label="Categoria">
              <TextInput value={budget.categoryName} disabled readOnly />
              <input type="hidden" {...register("categoryId")} />
            </Field>
          ) : (
            <Field label="Categoria" error={errors.categoryId?.message}>
              <Select {...register("categoryId")} autoFocus>
                {availableCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Limite mensal (R$)">
            <TextInput {...register("limitReais")} inputMode="decimal" placeholder="0,00" />
          </Field>

          {serverError && <p className="text-sm text-rose-500">{serverError}</p>}

          <div className="mt-2 flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {editing ? "Salvar" : "Criar orçamento"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
