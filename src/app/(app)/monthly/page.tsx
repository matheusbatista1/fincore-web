import { redirect } from "next/navigation";
import { getDashboard } from "@/application/use-cases/get-dashboard";
import { getMonthly, type MonthlyItem } from "@/application/use-cases/get-monthly";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { addMonths, isValidCompetenceMonth } from "@/domain/value-objects/competence-month";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { MonthlyStatement } from "@/presentation/components/monthly/monthly-statement";
import type { StmtGroup } from "@/presentation/components/monthly/stmt-card";
import { monthLabel } from "@/shared/formatting/dates";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";
import { resolveBankTheme } from "@/shared/theme/bank-themes";

const sumAbs = (items: MonthlyItem[]): number =>
  items.reduce(
    (s, e) => s + (e.kind === "transfer" ? (e.transferValueCents ?? 0) : Math.abs(e.amountCents)),
    0,
  );

export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { m } = await searchParams;
  const raw = Array.isArray(m) ? m[0] : m;
  const current = currentMonthInBrazil();
  const month = raw && isValidCompetenceMonth(raw) ? raw : current;
  const isCurrent = month === current;
  const today = todayInBrazil();
  const label = monthLabel(month, { long: true });

  const [data, workspace, dash] = await Promise.all([
    getMonthly(financeRepository, user.id, month),
    getWorkspaceView(financeRepository, user.id),
    // For the general "Entradas" total: reuse the exact same month "a receber" the dashboard shows.
    getDashboard(financeRepository, user.id, month),
  ]);

  // Card credits (estornos) live on the Cards screen, not in the monthly cash flow.
  const incomes = data.items.filter((e) => e.kind === "income" && e.cardId === null);
  const expenses = data.items.filter((e) => e.kind === "expense");
  const transfers = data.items.filter((e) => e.kind === "transfer");
  const totIn = incomes.reduce((s, e) => s + e.amountCents, 0);
  const totOut = expenses.reduce((s, e) => s + Math.abs(e.amountCents), 0);

  // People who owe you this month ("a receber") — shown inside the income group under
  // the general lens (the same month-scoped, projection-aware value the dashboard uses).
  const peopleReceivables = dash.people
    .filter((p) => p.balanceCents > 0)
    .map((p) => ({ id: p.id, name: p.name.split(" ")[0] ?? p.name, amountCents: p.balanceCents }));
  const hasIncomeBlock = incomes.length > 0 || peopleReceivables.length > 0;

  // Groups by origin (mirrors the prototype's MonthlyScreen). `lens` lets the
  // client recast each group through the personal view.
  const cardGroups: StmtGroup[] = workspace.cards
    .map((c) => {
      const items = expenses.filter((e) => e.cardId === c.id);
      const accent = resolveBankTheme(c.themeKey, c.bank).accent;
      return {
        key: `card-${c.id}`,
        name: `${c.bank} · ${c.product}`,
        accent,
        icon: "credit-card",
        items,
        totalCents: sumAbs(items),
        lens: "expense" as const,
      };
    })
    .filter((g) => g.items.length > 0);

  const acctGroups: StmtGroup[] = workspace.accounts
    .map((a) => {
      const items = expenses.filter((e) => e.accountId === a.id);
      const accent = resolveBankTheme(a.themeKey, a.bank).accent;
      return {
        key: `acct-${a.id}`,
        name: `${a.bank} · ${a.name}`,
        sub: "Débito / Pix",
        accent,
        icon: "wallet",
        items,
        totalCents: sumAbs(items),
        lens: "expense" as const,
      };
    })
    .filter((g) => g.items.length > 0);

  const compromissoItems = expenses.filter((e) => !e.cardId && !e.accountId);
  const compromissos: StmtGroup[] =
    compromissoItems.length > 0
      ? [
          {
            key: "compromissos",
            name: "Contas & compromissos",
            sub: "Boletos, financiamentos, empréstimos",
            accent: "#8A93A6",
            icon: "file-text",
            items: compromissoItems,
            totalCents: sumAbs(compromissoItems),
            lens: "expense" as const,
          },
        ]
      : [];

  const incomeGroup: StmtGroup = {
    key: "income",
    name: "Receitas",
    countText: `${incomes.length} ${incomes.length === 1 ? "entrada" : "entradas"}`,
    accent: "var(--mint-500)",
    icon: "arrow-down-left",
    items: incomes,
    totalCents: totIn,
    lens: "income",
    receivables: peopleReceivables,
  };
  const transferGroup: StmtGroup = {
    key: "transfer",
    name: "Transferências",
    countText: `${transfers.length} entre contas · não afetam o patrimônio`,
    accent: "var(--sky-500)",
    icon: "arrow-left-right",
    items: transfers,
    totalCents: sumAbs(transfers),
    lens: "transfer",
  };

  const leftGroups: StmtGroup[] = [...(hasIncomeBlock ? [incomeGroup] : []), ...cardGroups];
  const rightGroups: StmtGroup[] = [
    ...acctGroups,
    ...compromissos,
    ...(transfers.length > 0 ? [transferGroup] : []),
  ];

  // Export order mirrors the on-screen layout (left column then right column).
  const exportGroups: StmtGroup[] = [
    ...(hasIncomeBlock ? [incomeGroup] : []),
    ...cardGroups,
    ...acctGroups,
    ...compromissos,
    ...(transfers.length > 0 ? [transferGroup] : []),
  ];

  return (
    <MonthlyStatement
      month={month}
      label={label}
      isCurrent={isCurrent}
      today={today}
      prevHref={`/monthly?m=${addMonths(month, -1)}`}
      nextHref={`/monthly?m=${addMonths(month, 1)}`}
      leftGroups={leftGroups}
      rightGroups={rightGroups}
      exportGroups={exportGroups}
      totInCents={totIn}
      totOutCents={totOut}
      itemCount={data.items.length}
    />
  );
}
