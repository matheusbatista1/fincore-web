import { getDashboard } from "@/application/use-cases/get-dashboard";
import { getPeople } from "@/application/use-cases/get-people";
import { getReports } from "@/application/use-cases/get-reports";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { addMonths, isValidCompetenceMonth } from "@/domain/value-objects/competence-month";
import { financeRepository } from "@/infrastructure/composition";
import { PeopleView } from "@/presentation/components/people/people-view";
import { buildReportData } from "@/presentation/components/reports/report-data";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";
import { requireModule } from "../_guards";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[] }>;
}) {
  const user = await requireModule("people");

  const { m } = await searchParams;
  const raw = Array.isArray(m) ? m[0] : m;
  const current = currentMonthInBrazil();
  const month = raw && isValidCompetenceMonth(raw) ? raw : current;
  const today = todayInBrazil();
  const [people, workspace, transactions, dash, reports] = await Promise.all([
    getPeople(financeRepository, user.id, month),
    getWorkspaceView(financeRepository, user.id),
    getTransactions(financeRepository, user.id),
    getDashboard(financeRepository, user.id, month),
    getReports(financeRepository, user.id, { from: month, to: month }),
  ]);

  const reportData = buildReportData({ dash, reports, workspace, transactions, today });

  return (
    <PeopleView
      people={people}
      transactions={transactions}
      today={today}
      month={month}
      isCurrent={month === current}
      prevHref={`/people?m=${addMonths(month, -1)}`}
      nextHref={`/people?m=${addMonths(month, 1)}`}
      reportData={reportData}
    />
  );
}
