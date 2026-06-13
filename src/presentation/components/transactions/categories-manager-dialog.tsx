"use client";

import { type ReactNode, useState } from "react";
import { CategoryFormDialog } from "@/presentation/components/forms/category-form-dialog";
import { CategoryIcon } from "@/presentation/components/ui/category-icon";
import { Dialog, DialogClose, DialogModal, DialogTrigger } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";

export interface ManagedCategory {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly icon: string;
}

/** Manage categories (list + create/edit/delete) — reachable from the Transactions toolbar. */
export function CategoriesManagerDialog({
  categories,
  trigger,
}: {
  categories: ManagedCategory[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && (
        <DialogModal title="Categorias" maxWidth={460}>
          <div className="modal-body">
            {categories.length === 0 && (
              <div style={{ color: "var(--text-lo)", padding: "12px 0", fontSize: 14 }}>
                Nenhuma categoria ainda. Crie a primeira abaixo.
              </div>
            )}
            {categories.map((c) => (
              <div className="lrow" key={c.id}>
                <span className="l-ic" style={{ background: `${c.color}22`, color: c.color }}>
                  <CategoryIcon name={c.icon} size={18} />
                </span>
                <div className="l-main">
                  <div className="l-title">{c.name}</div>
                </div>
                <CategoryFormDialog
                  category={c}
                  trigger={
                    <button
                      type="button"
                      className="icon-btn btn-sm"
                      style={{ width: 34, height: 34 }}
                      title="Editar"
                    >
                      <Icon name="pencil" size={15} />
                    </button>
                  }
                />
              </div>
            ))}
          </div>
          <div className="modal-foot" style={{ justifyContent: "space-between" }}>
            <CategoryFormDialog
              trigger={
                <button type="button" className="btn btn-ghost">
                  <Icon name="plus" size={16} />
                  Nova categoria
                </button>
              }
            />
            <DialogClose asChild>
              <button type="button" className="btn btn-primary">
                Fechar
              </button>
            </DialogClose>
          </div>
        </DialogModal>
      )}
    </Dialog>
  );
}
