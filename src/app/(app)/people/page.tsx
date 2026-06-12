import { redirect } from "next/navigation";
import { getDashboard } from "@/application/use-cases/get-dashboard";
import { getReports } from "@/application/use-cases/get-reports";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { PeopleView } from "@/presentation/components/people/people-view";
import { buildReportData } from "@/presentation/components/reports/report-data";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";

export default async function PeoplePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const month = currentMonthInBrazil();
  const today = todayInBrazil();
  const [workspace, transactions, dash, reports] = await Promise.all([
    getWorkspaceView(financeRepository, user.id),
    getTransactions(financeRepository, user.id),
    getDashboard(financeRepository, user.id, month),
    getReports(financeRepository, user.id, month),
  ]);

  const reportData = buildReportData({ dash, reports, workspace, transactions, today });

  return (
    <PeopleView people={workspace.people} transactions={transactions} today={today} reportData={reportData} />
  );
}
