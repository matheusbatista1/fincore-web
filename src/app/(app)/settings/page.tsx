import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/_actions/auth";
import { deleteCategoryAction } from "@/app/_actions/finance";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { CategoryFormDialog } from "@/presentation/components/forms/category-form-dialog";
import { DeleteButton } from "@/presentation/components/forms/delete-button";
import { SettingsView } from "@/presentation/components/settings/settings-view";
import { CategoryIcon } from "@/presentation/components/ui/category-icon";
import { Icon } from "@/presentation/components/ui/icon";

/** Derive a display name + initials from the account email (no separate profile yet). */
function profileFromEmail(email: string): { name: string; initials: string } {
  const local = email.split("@")[0] ?? email;
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const name = words.join(" ") || email;
  const initials =
    words
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || email.slice(0, 2).toUpperCase();
  return { name, initials };
}

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { categories } = await getWorkspaceView(financeRepository, user.id);
  const email = user.email ?? "";
  const { name, initials } = profileFromEmail(email);

  return (
    <div className="settings-page" style={{ maxWidth: 720 }}>
      <SettingsView name={name} email={email} initials={initials} />

      {/* Categorias (feature real, mesma linguagem visual) */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div>
            <h3>Categorias</h3>
            <div className="ch-sub">
              {categories.length} {categories.length === 1 ? "categoria" : "categorias"} de despesa
            </div>
          </div>
          <CategoryFormDialog
            trigger={
              <button type="button" className="btn btn-ghost btn-sm">
                <Icon name="plus" size={16} />
                Nova categoria
              </button>
            }
          />
        </div>
        <div className="card-pad" style={{ paddingTop: 6, paddingBottom: 8 }}>
          {categories.length === 0 && (
            <div style={{ color: "var(--text-lo)", padding: "16px 0" }}>Nenhuma categoria ainda.</div>
          )}
          {categories.map((category) => (
            <div className="lrow" key={category.id}>
              <span className="l-ic" style={{ background: `${category.color}22`, color: category.color }}>
                <CategoryIcon name={category.icon} size={18} />
              </span>
              <div className="l-main">
                <div className="l-title">{category.name}</div>
              </div>
              <div className="row gap-2">
                <CategoryFormDialog
                  category={category}
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
                <DeleteButton
                  id={category.id}
                  action={deleteCategoryAction}
                  confirmMessage={`Excluir a categoria ${category.name}? As transações não são afetadas.`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Importar (feature real, mesma linguagem visual) */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div>
            <h3>Importar extrato</h3>
            <div className="ch-sub">Traga lançamentos de um arquivo CSV ou OFX do seu banco.</div>
          </div>
          <Link className="btn btn-ghost btn-sm" href="/import">
            <Icon name="file-up" size={16} />
            Importar
          </Link>
        </div>
      </div>

      {/* Sair */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-pad">
          <form action={signOutAction}>
            <button
              type="submit"
              className="danger-row"
              style={{ width: "100%", cursor: "pointer", color: "var(--rose-500)" }}
            >
              <span className="row gap-2">
                <Icon name="log-out" size={17} />
                Sair da conta
              </span>
              <Icon name="chevron-right" size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
