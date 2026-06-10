"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createAccountAction, updateAccountAction } from "@/app/_actions/finance";
import type { AccountView } from "@/application/use-cases/get-workspace-view";
import { Button } from "@/presentation/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/presentation/components/ui/dialog";
import { Field, Select, TextInput } from "@/presentation/components/ui/field";

const formSchema = z.object({
  bank: z.string().trim().min(1, "Informe o banco."),
  name: z.string().trim().min(1, "Informe um nome."),
  type: z.enum(["PF", "PJ"]),
  openingBalanceReais: z.string(),
  maskedNumber: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

function reaisToCents(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function AccountFormDialog({ account, trigger }: { account?: AccountView; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const editing = account !== undefined;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      bank: account?.bank ?? "",
      name: account?.name ?? "",
      type: account?.type ?? "PF",
      openingBalanceReais: account ? (account.openingBalanceCents / 100).toFixed(2) : "0",
      maskedNumber: account?.maskedNumber ?? "",
    },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const input = {
      bank: values.bank,
      name: values.name,
      type: values.type,
      themeKey: account?.themeKey ?? "",
      openingBalanceCents: reaisToCents(values.openingBalanceReais),
      maskedNumber: values.maskedNumber,
    };
    const result = editing ? await updateAccountAction(account.id, input) : await createAccountAction(input);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={editing ? "Editar carteira" : "Nova carteira"}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Field label="Banco" error={errors.bank?.message}>
            <TextInput {...register("bank")} placeholder="Nubank" autoFocus />
          </Field>
          <Field label="Nome" error={errors.name?.message}>
            <TextInput {...register("name")} placeholder="Conta principal" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tipo">
              <Select {...register("type")}>
                <option value="PF">Pessoa Física</option>
                <option value="PJ">Pessoa Jurídica</option>
              </Select>
            </Field>
            <Field label="Saldo inicial (R$)">
              <TextInput {...register("openingBalanceReais")} inputMode="decimal" placeholder="0,00" />
            </Field>
          </div>
          <Field label="Final do número">
            <TextInput {...register("maskedNumber")} placeholder="•• 4821" />
          </Field>

          {serverError && <p className="text-sm text-rose-500">{serverError}</p>}

          <div className="mt-2 flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {editing ? "Salvar" : "Criar carteira"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
