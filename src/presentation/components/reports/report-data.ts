import type { DashboardData } from "@/application/use-cases/get-dashboard";
import type { PersonStatement } from "@/application/use-cases/get-person-statements";
import type { ReportsData } from "@/application/use-cases/get-reports";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import type { WorkspaceView } from "@/application/use-cases/get-workspace-view";
import type { ReportData } from "./report-modal";

/** Assemble the serializable ReportModal payload from the existing use-case outputs. */
export function buildReportData({
  dash,
  reports,
  workspace,
  transactions,
  personStatements,
  today,
}: {
  dash: DashboardData;
  reports: ReportsData;
  workspace: WorkspaceView;
  transactions: TransactionListItem[];
  personStatements: PersonStatement[];
  today: string;
}): ReportData {
  const iconById = new Map(workspace.categories.map((c) => [c.id, c.icon]));
  const sumMonths = (
    rows: ReadonlyArray<{ incomeCents: number; expenseCents: number; netCents: number }>,
  ) => ({
    incomeCents: rows.reduce((s, m) => s + m.incomeCents, 0),
    expenseCents: rows.reduce((s, m) => s + m.expenseCents, 0),
    netCents: rows.reduce((s, m) => s + m.netCents, 0),
  });
  return {
    summary: {
      generalIncomeCents: dash.general.incomeCents,
      generalExpenseCents: dash.general.expenseCents,
      personalIncomeCents: dash.personal.incomeCents,
      personalExpenseCents: dash.personal.expenseCents,
      aReceberCents: workspace.people
        .filter((p) => p.balanceCents > 0)
        .reduce((s, p) => s + p.balanceCents, 0),
      aPagarCents: workspace.people
        .filter((p) => p.balanceCents < 0)
        .reduce((s, p) => s + Math.abs(p.balanceCents), 0),
    },
    categories: reports.categories.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      icon: iconById.get(c.id) ?? "tag",
      totalCents: c.valueCents,
    })),
    // Card spending over the report window (period-aware), not a static current bill.
    byCard: reports.byCard.map((c) => ({ id: c.id, name: c.name, valueCents: c.valueCents })),
    people: workspace.people.map((p) => ({
      id: p.id,
      name: p.name,
      relationship: p.relationship,
      color: p.color,
      balanceCents: p.balanceCents,
    })),
    transactions,
    today,
    includesProjected: reports.includesProjected,
    projectedLabel: reports.projectedLabel,
    rangeLabel: reports.rangeLabel,
    from: reports.from,
    to: reports.to,
    periodTotals: sumMonths(reports.months),
    periodTotalsPersonal: sumMonths(reports.monthsPersonal),
    months: reports.months.map((m) => ({
      label: m.label,
      incomeCents: m.incomeCents,
      expenseCents: m.expenseCents,
      netCents: m.netCents,
      projected: m.projected,
    })),
    monthsPersonal: reports.monthsPersonal.map((m) => ({
      label: m.label,
      incomeCents: m.incomeCents,
      expenseCents: m.expenseCents,
      netCents: m.netCents,
      projected: m.projected,
    })),
    categoriesPersonal: reports.categoriesPersonal.map((c) => ({
      name: c.name,
      totalCents: c.valueCents,
    })),
    personStatements,
  };
}
