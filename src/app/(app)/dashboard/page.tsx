import Link from "next/link";
import { redirect } from "next/navigation";
import { getDashboard } from "@/application/use-cases/get-dashboard";
import { getReports } from "@/application/use-cases/get-reports";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { type DashboardData, DashboardView } from "@/presentation/components/dashboard/dashboard-view";
import { Icon } from "@/presentation/components/ui/icon";

function currentMonthInBrazil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);
}
function todayInBrazil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const month = currentMonthInBrazil();
  const [dash, reports, transactions, workspace] = await Promise.all([
    getDashboard(financeRepository, user.id, month),
    getReports(financeRepository, user.id, month),
    getTransactions(financeRepository, user.id),
    getWorkspaceView(financeRepository, user.id),
  ]);

  if (workspace.accounts.length === 0 && workspace.cards.length === 0) {
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

  const debtors = workspace.people
    .filter((p) => p.balanceCents > 0)
    .sort((a, b) => b.balanceCents - a.balanceCents)
    .map((p) => ({ id: p.id, name: p.name, color: p.color, balanceCents: p.balanceCents }));
  const aReceberCents = debtors.reduce((sum, p) => sum + p.balanceCents, 0);
  const othersCents = Math.max(0, dash.general.expenseCents - dash.personal.expenseCents);

  const prev = dash.trend.at(-2)?.valueCents ?? 0;
  const last = dash.trend.at(-1)?.valueCents ?? 0;
  const deltaPct = prev !== 0 ? ((last - prev) / Math.abs(prev)) * 100 : null;

  const data: DashboardData = {
    saldoTotalCents: dash.totalBalanceCents,
    aReceberCents,
    investedCents: 0,
    general: { incomeCents: dash.general.incomeCents, expenseCents: dash.general.expenseCents },
    personal: { incomeCents: dash.personal.incomeCents, expenseCents: dash.personal.expenseCents },
    othersCents,
    deltaPct,
    trend: dash.trend,
    months: reports.months.map((m) => ({
      label: m.label,
      incomeCents: m.incomeCents,
      expenseCents: m.expenseCents,
    })),
    categories: reports.categories.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      valueCents: c.valueCents,
    })),
    totalExpenseCents: reports.totalExpenseCents,
    cards: workspace.cards.map((c) => ({
      id: c.id,
      bank: c.bank,
      product: c.product,
      themeKey: c.themeKey,
      billCents: c.billCents,
      limitCents: c.limitCents,
      dueDay: c.dueDay,
    })),
    debtors,
    recent: transactions.slice(0, 6),
    accountsCount: workspace.accounts.length,
    today: todayInBrazil(),
  };

  return <DashboardView data={data} />;
}
