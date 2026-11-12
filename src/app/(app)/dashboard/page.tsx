import Link from "next/link";
import { redirect } from "next/navigation";
import { loadDashboard } from "@/app/_loaders/dashboard";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { DashboardView } from "@/presentation/components/dashboard/dashboard-view";
import { Icon } from "@/presentation/components/ui/icon";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[]; cf?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { data, empty } = await loadDashboard(financeRepository, user.id, await searchParams);

  if (empty) {
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: "56px 24px" }}>
        <span
          className="ii"
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 48,
            height: 48,
            borderRadius: 14,
            background: "var(--purple-soft)",
            color: "var(--purple-300)",
            marginBottom: 14,
          }}
        >
          <Icon name="wallet" size={24} />
        </span>
        <p style={{ color: "var(--text-mid)", marginBottom: 16 }}>
          Comece criando uma carteira ou um cartão — depois seus lançamentos aparecem aqui.
        </p>
        <div className="row gap-2" style={{ justifyContent: "center" }}>
          <Link className="btn btn-primary" href="/wallets">
            <Icon name="plus" size={18} />
            Criar carteira
          </Link>
          <Link className="btn btn-ghost" href="/cards">
            Adicionar cartão
          </Link>
        </div>
      </div>
    );
  }

  return <DashboardView data={data} />;
}
