import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/_actions/auth";
import { getProfileCached } from "@/application/loaders";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { createSupabaseServerClient, getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { CategoryFormDialog } from "@/presentation/components/forms/category-form-dialog";
import { HelpCard } from "@/presentation/components/settings/help-card";
import { MfaCard } from "@/presentation/components/settings/mfa-card";
import { ModulesCard } from "@/presentation/components/settings/modules-card";
import { SettingsTabs } from "@/presentation/components/settings/settings-tabs";
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

  const supabase = await createSupabaseServerClient();
  const [{ categories }, profile, factors] = await Promise.all([
    getWorkspaceView(financeRepository, user.id),
    getProfileCached(financeRepository, user.id),
    supabase.auth.mfa.listFactors(),
  ]);
  const mfaEnabled = (factors.data?.totp ?? []).some((f) => f.status === "verified");
  const email = user.email ?? "";
  const fallback = profileFromEmail(email);
  const name = profile.displayName ?? fallback.name;
  const initials =
    name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase() || fallback.initials;

  const categoriesCard = (
    <div className="card">
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
          </div>
        ))}
      </div>
    </div>
  );

  const importCard = (
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
  );

  const aboutCard = (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <div>
          <h3>Sobre</h3>
          <div className="ch-sub">Documentos legais do FinCore.</div>
        </div>
      </div>
      <div
        className="card-pad"
        style={{ paddingTop: 6, paddingBottom: 14, display: "flex", gap: 10, flexWrap: "wrap" }}
      >
        <Link className="btn btn-ghost btn-sm" href="/privacy">
          <Icon name="lock" size={15} />
          Política de Privacidade
        </Link>
        <Link className="btn btn-ghost btn-sm" href="/terms">
          <Icon name="file-text" size={15} />
          Termos de Uso
        </Link>
      </div>
    </div>
  );

  const signOutCard = (
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
  );

  return (
    <div className="settings-page" style={{ maxWidth: 720 }}>
      <SettingsTabs
        tabs={[
          {
            id: "perfil",
            label: "Perfil",
            icon: "user",
            panel: (
              <SettingsView name={name} email={email} initials={initials} avatarUrl={profile.avatarUrl} />
            ),
          },
          {
            id: "seguranca",
            label: "Segurança",
            icon: "lock",
            panel: <MfaCard initialEnabled={mfaEnabled} />,
          },
          {
            id: "secoes",
            label: "Seções",
            icon: "layout-dashboard",
            panel: <ModulesCard enabled={profile.enabledModules} />,
          },
          {
            id: "mais",
            label: "Mais",
            icon: "ellipsis",
            panel: (
              <>
                {categoriesCard}
                {importCard}
                <HelpCard />
                {aboutCard}
                {signOutCard}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
