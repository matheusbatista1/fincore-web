import Link from "next/link";
import { redirect } from "next/navigation";
import { getDashboard } from "@/application/use-cases/get-dashboard";
import { getReports } from "@/application/use-cases/get-reports";
import { getStatement } from "@/application/use-cases/get-statement";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { addMonths, isValidCompetenceMonth } from "@/domain/value-objects/competence-month";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { type DashboardData, DashboardView } from "@/presentation/components/dashboard/dashboard-view";
import { Icon } from "@/presentation/components/ui/icon";
import { collapseRowsByInstallments } from "@/presentation/lib/group-installments";

function currentMonthInBrazil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);
}
function todayInBrazil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[]; cf?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { m, cf } = await searchParams;
  const raw = Array.isArray(m) ? m[0] : m;
  const current = currentMonthInBrazil();
  const month = raw && isValidCompetenceMonth(raw) ? raw : current;
  const isCurrent = month === current;
  // "Receitas x Despesas" cash-flow window: forward (default) shows the browsed month
  // through +5 (future months fold in projected recurring); backward shows the trailing
  // 6 months (actuals only). State lives in the URL so the server renders the right window.
  const rawCf = Array.isArray(cf) ? cf[0] : cf;
  const cashflowDir: "forward" | "backward" = rawCf === "backward" ? "backward" : "forward";
  const chartFrom = cashflowDir === "backward" ? addMonths(month, -5) : month;
  const chartTo = cashflowDir === "backward" ? month : addMonths(month, 5);
  const [dash, reports, statement, workspace] = await Promise.all([
    getDashboard(financeRepository, user.id, month),
    // Bars: the 6-month cash-flow window (forward/backward). The donut stays pinned to the
    // browsed month via categoryFrom/categoryTo, so flipping the bars never moves it.
    getReports(financeRepository, user.id, {
      from: chartFrom,
      to: chartTo,
      categoryFrom: month,
      categoryTo: month,
    }),
    getStatement(financeRepository, user.id),
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
  const aReceberCents = dash.aReceberCents;
  const othersCents = Math.max(0, dash.general.expenseCents - dash.personal.expenseCents);

  const prev = dash.trend.at(-2)?.valueCents ?? 0;
  const last = dash.trend.at(-1)?.valueCents ?? 0;
  // Guard against a near-zero base (e.g., empty accounts before a salary lands) and
  // against absurd magnitudes — either way the month-over-month % is meaningless.
  const rawDelta = Math.abs(prev) >= 100 ? ((last - prev) / Math.abs(prev)) * 100 : null;
  const deltaPct = rawDelta !== null && Math.abs(rawDelta) <= 999 ? rawDelta : null;

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
    aReceberCents,
    settlementNetCents: dash.settlementNetCents,
    heldForOthersCents: dash.heldForOthersCents,
    investedCents: 0,
    general: { incomeCents: dash.general.incomeCents, expenseCents: dash.general.expenseCents },
    personal: { incomeCents: dash.personal.incomeCents, expenseCents: dash.personal.expenseCents },
    othersCents,
    deltaPct,
    trend: dash.trend,
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
    isCurrent,
    cashflowDir,
  };

  return <DashboardView data={data} />;
}
