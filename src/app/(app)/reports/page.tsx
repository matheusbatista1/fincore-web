import { getDashboard } from "@/application/use-cases/get-dashboard";
import { getPersonStatements } from "@/application/use-cases/get-person-statements";
import { getReports } from "@/application/use-cases/get-reports";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import {
  addMonths,
  type CompetenceMonth,
  isValidCompetenceMonth,
  monthsBetween,
} from "@/domain/value-objects/competence-month";
import { financeRepository } from "@/infrastructure/composition";
import { ReportCharts } from "@/presentation/components/reports/report-charts";
import { ReportControls } from "@/presentation/components/reports/report-controls";
import { buildReportData } from "@/presentation/components/reports/report-data";
import { ReportPickButtons } from "@/presentation/components/reports/report-pick-buttons";
import { Icon } from "@/presentation/components/ui/icon";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";
import { requireModule } from "../_guards";

const pick = (v?: string | string[]): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[]; range?: string | string[] }>;
}) {
  const user = await requireModule("reports");
  const sp = await searchParams;
  const current = currentMonthInBrazil();

  const rawTo = pick(sp.to);
  const rawFrom = pick(sp.from);
  const rawRange = pick(sp.range);

  // Presets are forward-looking: N months starting at the current month
  // (current → current+N-1), so the cash flow shows what's coming, not the past.
  const presetN = /^(1|3|6|12)$/.test(rawRange ?? "") ? Number(rawRange) : null;
  let from: CompetenceMonth;
  let to: CompetenceMonth;
  if (presetN !== null) {
    from = current;
    to = addMonths(current, presetN - 1);
  } else {
    from = rawFrom && isValidCompetenceMonth(rawFrom) ? rawFrom : current;
    to = rawTo && isValidCompetenceMonth(rawTo) ? rawTo : addMonths(current, 5);
  }
  if (monthsBetween(from, to) < 0) [from, to] = [to, from];

  const [data, workspace, dash, transactions, personStatements] = await Promise.all([
    getReports(financeRepository, user.id, { from, to, categoryFrom: from, categoryTo: to }),
    getWorkspaceView(financeRepository, user.id),
    // The export "Resumo" is the current-month snapshot, independent of the report window.
    getDashboard(financeRepository, user.id, current),
    getTransactions(financeRepository, user.id),
    getPersonStatements(financeRepository, user.id, { from, to }),
  ]);

  // "Gasto por cartão" over the selected window (period-aware, follows from/to).
  const byCard = data.byCard.map((c) => ({ ...c, color: "#7C5CFF" }));

  const reportData = buildReportData({
    dash,
    reports: data,
    workspace,
    transactions,
    personStatements,
    today: todayInBrazil(),
  });

  return (
    <div className="reports-page">
      <ReportControls from={from} to={to} current={current} />

      <ReportCharts
        months={data.months}
        monthsPersonal={data.monthsPersonal}
        categories={data.categories}
        categoriesPersonal={data.categoriesPersonal}
        totalExpenseCents={data.totalExpenseCents}
        totalExpensePersonalCents={data.totalExpensePersonalCents}
        byCard={byCard}
        includesProjected={data.includesProjected}
        projectedLabel={data.projectedLabel}
      />

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <div className="row gap-4" style={{ marginBottom: 16 }}>
          <span className="kpi-ic purple" style={{ width: 46, height: 46 }}>
            <Icon name="file-down" size={22} />
          </span>
          <div>
            <h3 style={{ fontSize: 16 }}>Gerar relatório</h3>
            <div className="ch-sub" style={{ marginTop: 3 }}>
              {data.rangeLabel} · exporte em PDF ou CSV. Escolha o recorte:
            </div>
          </div>
        </div>
        <ReportPickButtons data={reportData} />
      </div>
    </div>
  );
}
