"use client";

import { type ReactNode, useId, useState } from "react";
import {
  createCategoryReturningAction,
  deleteCategoryAction,
  updateCategoryAction,
} from "@/app/_actions/finance";
import {
  CATEGORY_ICON_NAMES,
  CategoryIcon,
  DEFAULT_CATEGORY_ICON,
} from "@/presentation/components/ui/category-icon";
import { Dialog, DialogTrigger } from "@/presentation/components/ui/dialog";
import { FormModal } from "@/presentation/components/ui/form-modal";
import { toast } from "@/presentation/stores/ui-store";
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR } from "@/shared/theme/category-colors";

interface CategoryView {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly icon: string;
}

/** Nova/editar categoria — prototype form language (.field/.swatches/.chip-select). */
export function CategoryFormDialog({
  category,
  trigger,
  onCreated,
}: {
  category?: CategoryView;
  trigger: ReactNode;
  /** Called with the created category (create mode only) — used to select it inline. */
  onCreated?: (category: CategoryView) => void;
}) {
  const [open, setOpen] = useState(false);
  const formId = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && (
        <CategoryForm key={formId} category={category} onCreated={onCreated} onDone={() => setOpen(false)} />
      )}
    </Dialog>
  );
}

function CategoryForm({
  category,
  onDone,
  onCreated,
}: {
  category?: CategoryView | undefined;
  onDone: () => void;
  onCreated?: ((category: CategoryView) => void) | undefined;
}) {
  const editing = category !== undefined;
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color || DEFAULT_CATEGORY_COLOR);
  const [icon, setIcon] = useState(category?.icon || DEFAULT_CATEGORY_ICON);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0;

  async function save() {
    if (!canSubmit || submitting) return;
    setServerError(null);
    const input = { name: name.trim(), color, icon };
    setSubmitting(true);
    if (editing) {
      const result = await updateCategoryAction(category.id, input);
      setSubmitting(false);
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      toast(`Categoria ${name.trim()} salva`);
      onDone();
      return;
    }
    const result = await createCategoryReturningAction(input);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast(`Categoria ${name.trim()} criada`);
    onCreated?.(result.category);
    onDone();
  }

  async function remove() {
    if (!editing || submitting) return;
    setSubmitting(true);
    const result = await deleteCategoryAction(category.id);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast(`Categoria ${category.name} removida`);
    onDone();
  }

  return (
    <FormModal
      title={editing ? "Editar categoria" : "Nova categoria"}
      submitLabel={editing ? "Salvar" : "Adicionar"}
      canSubmit={canSubmit}
      submitting={submitting}
      onSubmit={save}
      {...(editing ? { onDelete: remove } : {})}
    >
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <span
          className="l-ic"
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: `${color}22`,
            color,
            display: "grid",
            placeItems: "center",
          }}
        >
          <CategoryIcon name={icon} size={26} />
        </span>
      </div>
      <div className="field">
        <label>Nome</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Alimentação"
          // biome-ignore lint/a11y/noAutofocus: name is the primary field of the modal (prototype parity).
          autoFocus
        />
      </div>
      <div className="field">
        <label>Cor</label>
        <div className="swatches" style={{ maxHeight: 120, overflowY: "auto" }}>
          {CATEGORY_COLORS.map((c) => (
            <button
              type="button"
              key={c}
              className={`swatch${color === c ? " on" : ""}`}
              style={{ background: c }}
              aria-label={`Cor ${c}`}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Ícone</label>
        <div className="chip-select" style={{ maxHeight: 180, overflowY: "auto" }}>
          {CATEGORY_ICON_NAMES.map((n) => (
            <button
              type="button"
              key={n}
              className={`person-chip${icon === n ? " on" : ""}`}
              aria-label={n}
              onClick={() => setIcon(n)}
            >
              <span className="pa" style={{ background: color, width: 24, height: 24 }}>
                <CategoryIcon name={n} size={13} />
              </span>
            </button>
          ))}
        </div>
      </div>
      {serverError && (
        <div className="warn-text" style={{ marginTop: 12 }}>
          {serverError}
        </div>
      )}
    </FormModal>
  );
}
