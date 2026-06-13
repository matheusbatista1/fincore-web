"use client";

import { CategoryFormDialog } from "@/presentation/components/forms/category-form-dialog";
import { CategoryIcon } from "@/presentation/components/ui/category-icon";
import { Icon } from "@/presentation/components/ui/icon";
import { formatBRLAbsolute } from "@/shared/formatting/currency";

export interface CategoryListItem {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly icon: string;
  /** How many transactions reference this category. */
  readonly count: number;
  /** Total spent (absolute cents) across this category's expenses. */
  readonly totalCents: number;
}

/** Full-page categories manager — list with create/edit/delete + per-category usage. */
export function CategoriesView({ categories }: { categories: CategoryListItem[] }) {
  return (
    <div className="col gap-4">
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Categorias</h3>
            <div className="ch-sub">
              {categories.length} {categories.length === 1 ? "categoria" : "categorias"}
            </div>
          </div>
          <CategoryFormDialog
            trigger={
              <button type="button" className="btn btn-primary btn-sm">
                <Icon name="plus" size={16} />
                Nova categoria
              </button>
            }
          />
        </div>

        {categories.length === 0 ? (
          <div className="coming">
            <div className="ci">
              <Icon name="tag" size={30} />
            </div>
            <h3>Nenhuma categoria ainda</h3>
            <p>Crie categorias para organizar seus gastos e ver para onde o dinheiro vai.</p>
          </div>
        ) : (
          <div style={{ padding: "4px 12px 12px" }}>
            {categories.map((c) => (
              <div className="lrow" key={c.id}>
                <span className="l-ic" style={{ background: `${c.color}22`, color: c.color }}>
                  <CategoryIcon name={c.icon} size={18} />
                </span>
                <div className="l-main">
                  <div className="l-title">{c.name}</div>
                  <div className="l-sub">
                    {c.count} {c.count === 1 ? "lançamento" : "lançamentos"}
                    {c.totalCents > 0 ? ` · ${formatBRLAbsolute(c.totalCents)}` : ""}
                  </div>
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
        )}
      </div>
    </div>
  );
}
