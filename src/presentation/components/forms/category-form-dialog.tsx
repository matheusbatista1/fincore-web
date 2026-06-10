"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createCategoryAction, updateCategoryAction } from "@/app/_actions/finance";
import { Button } from "@/presentation/components/ui/button";
import {
  CATEGORY_ICON_NAMES,
  CategoryIcon,
  DEFAULT_CATEGORY_ICON,
} from "@/presentation/components/ui/category-icon";
import { Dialog, DialogContent, DialogTrigger } from "@/presentation/components/ui/dialog";
import { Field, TextInput } from "@/presentation/components/ui/field";
import { cn } from "@/presentation/lib/cn";

interface CategoryView {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly icon: string;
}

const formSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome."),
  color: z.string(),
  icon: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

export function CategoryFormDialog({ category, trigger }: { category?: CategoryView; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const editing = category !== undefined;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: category?.name ?? "",
      color: category?.color || "#7c5cff",
      icon: category?.icon || DEFAULT_CATEGORY_ICON,
    },
  });
  const icon = watch("icon");

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const input = { name: values.name, color: values.color, icon: values.icon };
    const result = editing
      ? await updateCategoryAction(category.id, input)
      : await createCategoryAction(input);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={editing ? "Editar categoria" : "Nova categoria"}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Field label="Nome" error={errors.name?.message}>
            <TextInput {...register("name")} placeholder="Alimentação" autoFocus />
          </Field>
          <Field label="Cor">
            <input
              type="color"
              {...register("color")}
              className="h-11 w-20 rounded-sm border border-line bg-surface-3"
            />
          </Field>
          <div>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-text-lo">
              Ícone
            </span>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_ICON_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setValue("icon", name)}
                  aria-label={name}
                  className={cn(
                    "grid size-10 place-items-center rounded-md border transition",
                    icon === name
                      ? "border-purple-400 bg-purple-soft text-text-hi"
                      : "border-line bg-surface-2 text-text-mid hover:text-text-hi",
                  )}
                >
                  <CategoryIcon name={name} />
                </button>
              ))}
            </div>
          </div>

          {serverError && <p className="text-sm text-rose-500">{serverError}</p>}

          <div className="mt-2 flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {editing ? "Salvar" : "Criar categoria"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
