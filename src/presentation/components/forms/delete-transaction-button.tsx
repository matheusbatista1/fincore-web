"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteTransactionAction } from "@/app/_actions/finance";
import { Button } from "@/presentation/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/presentation/components/ui/dialog";

type Scope = "one" | "forward" | "all";

const SCOPES: ReadonlyArray<{ id: Scope; label: string; hint: string }> = [
  { id: "one", label: "Apenas esta", hint: "Remove só a parcela selecionada." },
  { id: "forward", label: "Esta e as próximas", hint: "Remove esta parcela e as futuras." },
  { id: "all", label: "Todas as parcelas", hint: "Remove o parcelamento inteiro." },
];

function IconTrigger({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="grid size-9 place-items-center rounded-sm text-text-lo transition hover:bg-rose-soft hover:text-rose-500"
      aria-label={label}
    >
      <Trash2 size={16} />
    </button>
  );
}

export function DeleteTransactionButton({
  id,
  isInstallment,
  description,
}: {
  id: string;
  isInstallment: boolean;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove(scope: Scope) {
    startTransition(async () => {
      await deleteTransactionAction({ id, scope });
      setOpen(false);
    });
  }

  // Single transaction: a Radix confirm dialog (no native window.confirm).
  if (!isInstallment) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <IconTrigger label="Excluir lançamento" />
        </DialogTrigger>
        <DialogContent
          title="Excluir lançamento"
          description={`Remover “${description}”? Esta ação não pode ser desfeita.`}
        >
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancelar</Button>
            </DialogClose>
            <Button variant="danger" disabled={pending} onClick={() => remove("one")}>
              {pending ? "Excluindo…" : "Excluir"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Installment: let the user choose the deletion scope.
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <IconTrigger label="Excluir parcela" />
      </DialogTrigger>
      <DialogContent
        title="Excluir parcelamento"
        description={`“${description}” faz parte de um parcelamento. O que deseja remover?`}
      >
        <div className="flex flex-col gap-2">
          {SCOPES.map((scope) => (
            <button
              key={scope.id}
              type="button"
              disabled={pending}
              onClick={() => remove(scope.id)}
              className="flex flex-col gap-0.5 rounded-md border border-line bg-surface-2 p-3 text-left transition hover:border-rose-500/50 hover:bg-rose-soft disabled:opacity-60"
            >
              <span className="font-medium text-text-hi">{scope.label}</span>
              <span className="text-sm text-text-lo">{scope.hint}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <DialogClose asChild>
            <Button variant="ghost">Cancelar</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
