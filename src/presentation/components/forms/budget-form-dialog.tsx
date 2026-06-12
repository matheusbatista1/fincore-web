"use client";

import { type ReactNode, useId, useState } from "react";
import { createBudgetAction, deleteBudgetAction, updateBudgetAction } from "@/app/_actions/finance";
import { Dialog, DialogTrigger } from "@/presentation/components/ui/dialog";
import { FormModal } from "@/presentation/components/ui/form-modal";
import { toast } from "@/presentation/stores/ui-store";
import { reaisToCents } from "@/shared/formatting/parse-reais";

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

/** Novo/editar orçamento — prototype form language (.field/.input). */
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
  const formId = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && (
        <BudgetForm
          key={formId}
          budget={budget}
          availableCategories={availableCategories}
          onDone={() => setOpen(false)}
        />
      )}
    </Dialog>
  );
}

function BudgetForm({
  budget,
  availableCategories,
  onDone,
}: {
  budget?: EditableBudget | undefined;
  availableCategories: BudgetCategory[];
  onDone: () => void;
}) {
  const editing = budget !== undefined;
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? availableCategories[0]?.id ?? "");
  const [limit, setLimit] = useState(budget ? (budget.limitCents / 100).toFixed(2).replace(".", ",") : "");
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = categoryId.length > 0 && reaisToCents(limit) > 0;

  async function save() {
    if (!canSubmit || submitting) return;
    setServerError(null);
    const input = { categoryId, limitCents: reaisToCents(limit) };
    setSubmitting(true);
    const result = editing ? await updateBudgetAction(budget.id, input) : await createBudgetAction(input);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast("Orçamento salvo");
    onDone();
  }

  async function remove() {
    if (!editing || submitting) return;
    setSubmitting(true);
    const result = await deleteBudgetAction(budget.id);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast(`Orçamento de ${budget.categoryName} removido`);
    onDone();
  }

  return (
    <FormModal
      title={editing ? "Editar orçamento" : "Novo orçamento"}
      submitLabel={editing ? "Salvar" : "Adicionar"}
      canSubmit={canSubmit}
      submitting={submitting}
      onSubmit={save}
      maxWidth={440}
      {...(editing ? { onDelete: remove } : {})}
    >
      <div className="field">
        <label>Categoria</label>
        {editing ? (
          <div className="input" style={{ display: "flex", alignItems: "center", color: "var(--text-lo)" }}>
            {budget.categoryName}
          </div>
        ) : (
          <select
            className="input"
            aria-label="Categoria"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {availableCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Limite mensal (R$)</label>
        <input
          className="input tnum"
          inputMode="decimal"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          placeholder="0,00"
        />
      </div>
      {serverError && (
        <div className="warn-text" style={{ marginTop: 12 }}>
          {serverError}
        </div>
      )}
    </FormModal>
  );
}
