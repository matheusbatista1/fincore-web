import { getDashboard } from "@/application/use-cases/get-dashboard";
import { getReports } from "@/application/use-cases/get-reports";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { financeRepository } from "@/infrastructure/composition";
import { BarList } from "@/presentation/components/charts/bar-list";
import { BarsChart } from "@/presentation/components/charts/bars-chart";
import { DonutChart } from "@/presentation/components/charts/donut-chart";
import { buildReportData } from "@/presentation/components/reports/report-data";
import { ReportPickButtons } from "@/presentation/components/reports/report-pick-buttons";
import { Icon } from "@/presentation/components/ui/icon";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";
import { requireModule } from "../_guards";

export default async function ReportsPage() {
  const user = await requireModule("reports");

  const month = currentMonthInBrazil();
  const [data, workspace, dash, transactions] = await Promise.all([
    getReports(financeRepository, user.id, month),
    getWorkspaceView(financeRepository, user.id),
    getDashboard(financeRepository, user.id, month),
    getTransactions(financeRepository, user.id),
  ]);
  const { cards } = workspace;

  const byCard = cards
    .map((c) => ({
      id: c.id,
      name: `${c.bank} · ${c.product}`,
      color: "#7C5CFF",
      valueCents: c.billCents,
    }))
    .sort((a, b) => b.valueCents - a.valueCents);

  const topCategories = data.categories.slice(0, 5);
  const reportData = buildReportData({
    dash,
    reports: data,
    workspace,
    transactions,
    today: todayInBrazil(),
  });

  return (
    <div className="reports-page">
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Fluxo de caixa</h3>
              <div className="ch-sub">Receitas x despesas · 6 meses</div>
            </div>
            <div className="legend">
              <div className="lg">
                <span className="sw" style={{ background: "#34E1A8" }} />
                Receitas
              </div>
              <div className="lg">
                <span className="sw" style={{ background: "#9B79FF" }} />
                Despesas
              </div>
            </div>
          </div>
          <div className="card-pad">
            <BarsChart months={data.months} />
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Por categoria</h3>
            </div>
          </div>
          <div className="card-pad">
            <DonutChart slices={data.categories} totalCents={data.totalExpenseCents} />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ fontSize: 16, marginBottom: 18 }}>Gasto por cartão</h3>
          <BarList items={byCard} />
        </div>
        <div className="card card-pad">
          <h3 style={{ fontSize: 16, marginBottom: 18 }}>Top categorias</h3>
          <BarList items={topCategories} />
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <div className="row gap-4" style={{ marginBottom: 16 }}>
          <span className="kpi-ic purple" style={{ width: 46, height: 46 }}>
            <Icon name="file-down" size={22} />
          </span>
          <div>
            <h3 style={{ fontSize: 16 }}>Gerar relatório</h3>
            <div className="ch-sub" style={{ marginTop: 3 }}>
              Exporte em PDF ou CSV. Escolha o recorte:
            </div>
          </div>
        </div>
        <ReportPickButtons data={reportData} />
      </div>
    </div>
  );
}
