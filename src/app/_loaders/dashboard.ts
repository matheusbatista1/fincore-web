import type { FinanceRepository } from "@/application/ports/finance-repository";
import { getDashboard } from "@/application/use-cases/get-dashboard";
import { getReports } from "@/application/use-cases/get-reports";
import { getStatement } from "@/application/use-cases/get-statement";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { addMonths, isValidCompetenceMonth } from "@/domain/value-objects/competence-month";
import type { DashboardData } from "@/presentation/components/dashboard/dashboard-view";
import { collapseRowsByInstallments } from "@/presentation/lib/group-installments";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";

type Param = string | string[] | undefined;
const first = (value: Param): string | undefined => (Array.isArray(value) ? value[0] : value);

export interface LoadedDashboard {
  readonly data: DashboardData;
  /** No account and no card yet: there is nothing to show. */
  readonly empty: boolean;
}

/**
 * Everything the dashboard shows, for one user and the month in the URL. Shared by the real page
 * and the demo, so both go through the very same code.
 *
 * @param params The page's search params: `m` (the month browsed) and `cf` (the cash-flow window).
 */
export async function loadDashboard(
  repo: FinanceRepository,
  userId: string,
  params: { readonly m?: Param; readonly cf?: Param },
): Promise<LoadedDashboard> {
  const raw = first(params.m);
  const current = currentMonthInBrazil();
  const month = raw && isValidCompetenceMonth(raw) ? raw : current;
  // "Receitas x Despesas" cash-flow window: forward (default) shows the browsed month
  // through +5 (future months fold in projected recurring); backward shows the trailing
  // 6 months (actuals only). State lives in the URL so the server renders the right window.
  const cashflowDir: "forward" | "backward" = first(params.cf) === "backward" ? "backward" : "forward";
  const chartFrom = cashflowDir === "backward" ? addMonths(month, -5) : month;
  const chartTo = cashflowDir === "backward" ? month : addMonths(month, 5);
  const [dash, reports, statement, workspace] = await Promise.all([
    getDashboard(repo, userId, month),
    // Bars: the 6-month cash-flow window (forward/backward). The donut stays pinned to the
    // browsed month via categoryFrom/categoryTo, so flipping the bars never moves it.
    getReports(repo, userId, { from: chartFrom, to: chartTo, categoryFrom: month, categoryTo: month }),
    getStatement(repo, userId),
    getWorkspaceView(repo, userId),
  ]);

  // Debtors + "a receber" are scoped to the browsed month (from the dashboard use-case).
  const debtors = dash.people
    .filter((p) => p.balanceCents > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      relationship: p.relationship,
      balanceCents: p.balanceCents,
    }));
  const toBar = (m: { label: string; incomeCents: number; expenseCents: number; projected: boolean }) => ({
    label: m.label,
    incomeCents: m.incomeCents,
    expenseCents: m.expenseCents,
    projected: m.projected,
  });
  const toSlice = (c: { id: string; name: string; color: string; valueCents: number }) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    valueCents: c.valueCents,
  });

  const data: DashboardData = {
    saldoTotalCents: dash.totalBalanceCents,
    saldoTotalPersonalCents: dash.totalBalancePersonalCents,
    projectedBalanceCents: dash.projectedBalanceCents,
    projectedBalancePersonalCents: dash.projectedBalancePersonalCents,
    isPast: month < current,
    aReceberCents: dash.aReceberCents,
    settlementNetCents: dash.settlementNetCents,
    projectedIncomeCents: dash.projectedIncomeCents,
    projectedExpenseCents: dash.projectedExpenseCents,
    projectedIncomePersonalCents: dash.projectedIncomePersonalCents,
    projectedExpensePersonalCents: dash.projectedExpensePersonalCents,
    heldForOthersCents: dash.heldForOthersCents,
    investedCents: 0,
    general: { incomeCents: dash.general.incomeCents, expenseCents: dash.general.expenseCents },
    personal: { incomeCents: dash.personal.incomeCents, expenseCents: dash.personal.expenseCents },
    othersCents: Math.max(0, dash.general.expenseCents - dash.personal.expenseCents),
    monthChangeCents: dash.monthEndTotals.currentCents - dash.monthEndTotals.previousCents,
    netWorth: dash.netWorthDaily,
    netWorthForecast: {
      valuesCents: dash.netWorthForecast.valuesCents,
      events: dash.netWorthForecast.events.map((event) => ({
        date: event.date,
        deltaCents: event.deltaCents,
        label: event.label,
        late: event.late,
      })),
    },
    months: reports.months.map(toBar),
    monthsPersonal: reports.monthsPersonal.map(toBar),
    categories: reports.categories.map(toSlice),
    categoriesPersonal: reports.categoriesPersonal.map(toSlice),
    totalExpenseCents: reports.totalExpenseCents,
    totalExpensePersonalCents: reports.totalExpensePersonalCents,
    // From the dashboard use-case (month-aware): billCents follows the browsed month,
    // outstandingCents is the total committed against the limit.
    cards: dash.cards.map((c) => ({
      id: c.id,
      bank: c.bank,
      product: c.product,
      themeKey: c.themeKey,
      billCents: c.billCents,
      billCompetence: c.billCompetence,
      billProjectedCents: c.billProjectedCents,
      outstandingCents: c.outstandingCents,
      limitCents: c.limitCents,
      dueDay: c.dueDay,
    })),
    debtors,
    // The last executed cash movements (extrato) — the same source as Transações.
    recent: collapseRowsByInstallments(statement.executed).slice(0, 10),
    accountsCount: workspace.accounts.length,
    today: todayInBrazil(),
    month,
    isCurrent: month === current,
    cashflowDir,
  };

  return { data, empty: workspace.accounts.length === 0 && workspace.cards.length === 0 };
}
