import { getDashboard } from "@/application/use-cases/get-dashboard";
import { getPeople } from "@/application/use-cases/get-people";
import { getPersonStatements } from "@/application/use-cases/get-person-statements";
import { getReports } from "@/application/use-cases/get-reports";
import { getRollableDebts } from "@/application/use-cases/get-rollable-debts";
import { getSettlements } from "@/application/use-cases/get-settlements";
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
  const [people, workspace, transactions, dash, reports, personStatements, settlements, rollableDebts] =
    await Promise.all([
      getPeople(financeRepository, user.id, month),
      getWorkspaceView(financeRepository, user.id),
      getTransactions(financeRepository, user.id),
      getDashboard(financeRepository, user.id, month),
      getReports(financeRepository, user.id, { from: month, to: month }),
      getPersonStatements(financeRepository, user.id, { from: month, to: month }),
      getSettlements(financeRepository, user.id),
      getRollableDebts(financeRepository, user.id, month),
    ]);
  const accounts = workspace.accounts.map((a) => ({ id: a.id, label: `${a.bank} · ${a.name}` }));
  const cards = workspace.cards.map((c) => ({ id: c.id, label: `${c.bank} · ${c.product}` }));

  const reportData = buildReportData({
    dash,
    reports,
    workspace,
    transactions,
    personStatements,
    today,
  });

  return (
    <PeopleView
      people={people}
      transactions={transactions}
      accounts={accounts}
      cards={cards}
      rollableDebts={rollableDebts}
      settlements={settlements}
      today={today}
      month={month}
      isCurrent={month === current}
      prevHref={`/people?m=${addMonths(month, -1)}`}
      nextHref={`/people?m=${addMonths(month, 1)}`}
      reportData={reportData}
    />
  );
}
