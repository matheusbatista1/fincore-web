import { redirect } from "next/navigation";
import { getDashboard } from "@/application/use-cases/get-dashboard";
import { getMonthly, type MonthlyItem } from "@/application/use-cases/get-monthly";
import { settledItemCents } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { addMonths, isValidCompetenceMonth } from "@/domain/value-objects/competence-month";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { MonthlyStatement } from "@/presentation/components/monthly/monthly-statement";
import type { StmtGroup } from "@/presentation/components/monthly/stmt-card";
import { monthLabel } from "@/shared/formatting/dates";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";
import { resolveBankTheme } from "@/shared/theme/bank-themes";

// Expense rows count at what was actually PAID (settled amount) — a paid obligation with a discount
// weighs its paid value, matching the dashboard "Economia do mês". Transfers use their moved value.
const sumAbs = (items: MonthlyItem[]): number =>
  items.reduce((s, e) => s + (e.kind === "transfer" ? (e.transferValueCents ?? 0) : settledItemCents(e)), 0);

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
  // An income counts at what actually LANDED when it was received for a different value —
  // mirroring the dashboard's settledIncomeCents, so the two screens' bases agree.
  const incomeCents = (e: MonthlyItem): number =>
    e.isReceived && e.receivedAmountCents != null ? e.receivedAmountCents : e.amountCents;
  const totIn = incomes.reduce((s, e) => s + incomeCents(e), 0);
  const totOut = expenses.reduce((s, e) => s + settledItemCents(e), 0);
  // The projected ("previsto") slice inside each header total, called out so the statement's
  // forward-looking numbers never read as already-realized figures.
  const totInProjected = incomes.filter((e) => e.projected).reduce((s, e) => s + incomeCents(e), 0);
  const totOutProjected = expenses.filter((e) => e.projected).reduce((s, e) => s + settledItemCents(e), 0);

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
      const total = sumAbs(items);
      // The fatura actually paid is charges MINUS card credits (estornos) of the same bill —
      // mirroring computeCardBillForMonth server-side, so "Pagar fatura · R$X" matches what's
      // charged. Estornos are card-bound incomes; they're excluded from the group's row list
      // (shown on the Cards screen) but must still net down the amount to pay.
      const credits = data.items
        .filter((e) => e.kind === "income" && e.cardId === c.id && !e.projected)
        .reduce((s, e) => s + e.amountCents, 0);
      // A projected ("previsto") charge is a forecast, not something the bank will bill: the
      // payable fatura counts REAL charges only, matching what the server computes on payment
      // (and what the Cards screen offers) — otherwise "Pagar fatura · R$X" overshoots.
      const faturaBase = sumAbs(items.filter((e) => !e.projected));
      const projectedCents = total - faturaBase;
      return {
        key: `card-${c.id}`,
        name: `${c.bank} · ${c.product}`,
        accent,
        icon: "credit-card",
        items,
        // The tile shows the fatura's expected TOTAL: booked + previstos, net of estornos —
        // the same figure the Cards screen calls "Total".
        totalCents: total - credits,
        // The previsto slice inside totalCents, so the tile/modal can call it out.
        projectedCents,
        lens: "expense" as const,
        cardId: c.id,
        // Full (general) fatura total — kept independent of the personal-lens recompute so
        // "Pagar fatura" always offers the whole bill.
        faturaCents: Math.max(0, faturaBase - credits),
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
      totInProjectedCents={totInProjected}
      totOutProjectedCents={totOutProjected}
      itemCount={data.items.length}
      accounts={workspace.accounts.map((a) => ({ id: a.id, bank: a.bank, name: a.name }))}
      cardBillPayments={workspace.cardBillPayments}
    />
  );
}
