import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfileCached } from "@/application/loaders";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { createSupabaseServerClient, getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { AutoPaymentsCard } from "@/presentation/components/settings/auto-payments-card";
import { DeleteAccountCard } from "@/presentation/components/settings/delete-account-card";
import { HelpCard } from "@/presentation/components/settings/help-card";
import { MfaCard } from "@/presentation/components/settings/mfa-card";
import { ModulesCard } from "@/presentation/components/settings/modules-card";
import { PasswordCard } from "@/presentation/components/settings/password-card";
import { SettingsTabs } from "@/presentation/components/settings/settings-tabs";
import { SettingsView } from "@/presentation/components/settings/settings-view";
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
  const [profile, factors, { accounts }] = await Promise.all([
    getProfileCached(financeRepository, user.id),
    supabase.auth.mfa.listFactors(),
    getWorkspaceView(financeRepository, user.id),
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

  return (
    <div className="settings-page" style={{ maxWidth: 720 }}>
      <SettingsTabs
        tabs={[
          {
            id: "perfil",
            label: "Perfil",
            icon: "user",
            panel: (
              <>
                <SettingsView name={name} email={email} initials={initials} avatarUrl={profile.avatarUrl} />
                <PasswordCard />
              </>
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
            id: "pagamentos",
            label: "Pagamentos",
            icon: "hand-coins",
            panel: (
              <AutoPaymentsCard
                enabled={profile.autoPaymentsEnabled}
                defaultAccountId={profile.defaultPayAccountId}
                accounts={accounts}
              />
            ),
          },
          {
            id: "mais",
            label: "Mais",
            icon: "ellipsis",
            panel: (
              <>
                <HelpCard />
                {aboutCard}
                <DeleteAccountCard />
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
