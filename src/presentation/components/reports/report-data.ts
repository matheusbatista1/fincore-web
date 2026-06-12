import type { DashboardData } from "@/application/use-cases/get-dashboard";
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
  today,
}: {
  dash: DashboardData;
  reports: ReportsData;
  workspace: WorkspaceView;
  transactions: TransactionListItem[];
  today: string;
}): ReportData {
  const iconById = new Map(workspace.categories.map((c) => [c.id, c.icon]));
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
    byCard: workspace.cards
      .filter((c) => c.billCents > 0)
      .sort((a, b) => b.billCents - a.billCents)
      .map((c) => ({ id: c.id, name: `${c.bank} · ${c.product}`, valueCents: c.billCents })),
    people: workspace.people.map((p) => ({
      id: p.id,
      name: p.name,
      relationship: p.relationship,
      color: p.color,
      balanceCents: p.balanceCents,
    })),
    transactions,
    today,
  };
}
