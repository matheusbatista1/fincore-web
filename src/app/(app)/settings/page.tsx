import { FileUp, LogOut, Pencil, Plus, Tags } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/_actions/auth";
import { deleteCategoryAction } from "@/app/_actions/finance";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { CategoryFormDialog } from "@/presentation/components/forms/category-form-dialog";
import { DeleteButton } from "@/presentation/components/forms/delete-button";
import { Button } from "@/presentation/components/ui/button";
import { CategoryIcon } from "@/presentation/components/ui/category-icon";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { categories } = await getWorkspaceView(financeRepository, user.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mt-1 text-text-mid">Sua conta e as categorias de despesa.</p>
      </div>

      {/* account */}
      <section className="rounded-lg border border-line bg-surface-1 p-5 shadow-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-text-faint">Conta</h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium text-text-hi">{user.email}</p>
            <p className="text-sm text-text-lo">Sessão autenticada via Supabase</p>
          </div>
          <form action={signOutAction}>
            <Button type="submit" variant="ghost">
              <LogOut size={16} />
              Sair
            </Button>
          </form>
        </div>
      </section>

      {/* data */}
      <section className="rounded-lg border border-line bg-surface-1 p-5 shadow-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-text-faint">Dados</h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-text-hi">Importar extrato</p>
            <p className="text-sm text-text-lo">Traga lançamentos de um arquivo CSV ou OFX do seu banco.</p>
          </div>
          <Link href="/import">
            <Button variant="ghost">
              <FileUp size={16} />
              Importar
            </Button>
          </Link>
        </div>
      </section>

      {/* categories */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-text-hi">
            <Tags size={20} className="text-purple-300" />
            Categorias
          </h2>
          <CategoryFormDialog
            trigger={
              <Button size="sm">
                <Plus size={16} />
                Nova categoria
              </Button>
            }
          />
        </div>

        {categories.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-2 bg-surface-1 p-10 text-center">
            <p className="text-text-mid">Você ainda não cadastrou categorias.</p>
            <div className="mt-4 flex justify-center">
              <CategoryFormDialog
                trigger={
                  <Button>
                    <Plus size={18} />
                    Criar primeira categoria
                  </Button>
                }
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface-1">
            {categories.map((category) => (
              <div key={category.id} className="flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-md text-white"
                    style={{ background: category.color || "#7c5cff" }}
                  >
                    <CategoryIcon name={category.icon} size={18} />
                  </span>
                  <p className="truncate font-medium text-text-hi">{category.name}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <CategoryFormDialog
                    category={category}
                    trigger={
                      <button
                        type="button"
                        className="grid size-9 place-items-center rounded-sm text-text-lo transition hover:bg-surface-2 hover:text-text-hi"
                        aria-label="Editar"
                      >
                        <Pencil size={16} />
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
        )}
      </section>
    </div>
  );
}
