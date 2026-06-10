"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createCreditCardAction, updateCreditCardAction } from "@/app/_actions/finance";
import type { CardView } from "@/application/use-cases/get-workspace-view";
import { Button } from "@/presentation/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/presentation/components/ui/dialog";
import { Field, Select, TextInput } from "@/presentation/components/ui/field";

const FLAGS = ["mastercard", "visa", "elo", "amex", "hipercard", "other"] as const;

const dayField = z
  .string()
  .refine((value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 31, "1–31");

const formSchema = z.object({
  bank: z.string().trim().min(1, "Informe o banco."),
  product: z.string().trim().min(1, "Informe o produto."),
  flag: z.enum(FLAGS),
  limitReais: z.string(),
  closingDay: dayField,
  dueDay: dayField,
  maskedNumber: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

function reaisToCents(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function CreditCardFormDialog({ card, trigger }: { card?: CardView; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const editing = card !== undefined;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      bank: card?.bank ?? "",
      product: card?.product ?? "",
      flag: card?.flag ?? "mastercard",
      limitReais: card ? (card.limitCents / 100).toFixed(2) : "0",
      closingDay: String(card?.closingDay ?? 1),
      dueDay: String(card?.dueDay ?? 10),
      maskedNumber: card?.maskedNumber ?? "",
    },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const input = {
      bank: values.bank,
      product: values.product,
      flag: values.flag,
      themeKey: card?.themeKey ?? "",
      maskedNumber: values.maskedNumber,
      limitCents: reaisToCents(values.limitReais),
      closingDay: Number(values.closingDay),
      dueDay: Number(values.dueDay),
    };
    const result = editing
      ? await updateCreditCardAction(card.id, input)
      : await createCreditCardAction(input);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={editing ? "Editar cartão" : "Novo cartão"}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Banco" error={errors.bank?.message}>
              <TextInput {...register("bank")} placeholder="Nubank" autoFocus />
            </Field>
            <Field label="Produto" error={errors.product?.message}>
              <TextInput {...register("product")} placeholder="Ultravioleta" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Bandeira">
              <Select {...register("flag")}>
                {FLAGS.map((flag) => (
                  <option key={flag} value={flag}>
                    {flag === "other" ? "Outra" : flag.charAt(0).toUpperCase() + flag.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Limite (R$)">
              <TextInput {...register("limitReais")} inputMode="decimal" placeholder="0,00" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Dia de fechamento" error={errors.closingDay?.message}>
              <TextInput type="number" min={1} max={31} {...register("closingDay")} />
            </Field>
            <Field label="Dia de vencimento" error={errors.dueDay?.message}>
              <TextInput type="number" min={1} max={31} {...register("dueDay")} />
            </Field>
          </div>
          <Field label="Final do número">
            <TextInput {...register("maskedNumber")} placeholder="•••• 4821" />
          </Field>

          {serverError && <p className="text-sm text-rose-500">{serverError}</p>}

          <div className="mt-2 flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {editing ? "Salvar" : "Criar cartão"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
