import Link from "next/link";
import { redirect } from "next/navigation";
import { getMonthly, type MonthlyItem } from "@/application/use-cases/get-monthly";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { addMonths, isValidCompetenceMonth } from "@/domain/value-objects/competence-month";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { MonthExportButtons } from "@/presentation/components/monthly/month-export-buttons";
import { MonthlySwipe } from "@/presentation/components/monthly/monthly-swipe";
import { StmtCard, type StmtGroup } from "@/presentation/components/monthly/stmt-card";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
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

  const [data, workspace] = await Promise.all([
    getMonthly(financeRepository, user.id, month),
    getWorkspaceView(financeRepository, user.id),
  ]);

  const incomes = data.items.filter((e) => e.kind === "income");
  const expenses = data.items.filter((e) => e.kind === "expense");
  const transfers = data.items.filter((e) => e.kind === "transfer");
  const totIn = incomes.reduce((s, e) => s + e.amountCents, 0);
  const totOut = expenses.reduce((s, e) => s + Math.abs(e.amountCents), 0);

  // Groups by origin (mirrors the prototype's MonthlyScreen).
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
          },
        ]
      : [];

  return (
    <MonthlySwipe
      prevHref={`/monthly?m=${addMonths(month, -1)}`}
      nextHref={`/monthly?m=${addMonths(month, 1)}`}
    >
      <div className="monthly-page">
        {/* navegador + resumo */}
        <div className="card card-pad rise" style={{ marginBottom: 18 }}>
          <div className="month-nav">
            <Link
              className="icon-btn"
              href={`/monthly?m=${addMonths(month, -1)}`}
              title="Mês anterior"
              aria-label="Mês anterior"
            >
              <Icon name="chevron-left" size={19} />
            </Link>
            <div className="mn-label">
              <span className="mn-month">{label}</span>
              {isCurrent ? (
                <span className="pill purple" style={{ height: 22 }}>
                  Mês atual
                </span>
              ) : (
                <Link className="card-link" href="/monthly">
                  Voltar para hoje
                </Link>
              )}
            </div>
            <Link
              className="icon-btn"
              href={`/monthly?m=${addMonths(month, 1)}`}
              title="Próximo mês"
              aria-label="Próximo mês"
            >
              <Icon name="chevron-right" size={19} />
            </Link>
          </div>
          <div className="month-totals">
            <div className="mt-cell">
              <span className="mt-lbl">
                <Icon name="arrow-down-left" size={14} />
                Entradas
              </span>
              <span className="mt-val" style={{ color: "var(--mint-500)" }}>
                <Money cents={totIn} withSign={false} />
              </span>
            </div>
            <div className="mt-cell">
              <span className="mt-lbl">
                <Icon name="arrow-up-right" size={14} />
                Saídas
              </span>
              <span className="mt-val" style={{ color: "var(--rose-500)" }}>
                <Money cents={totOut} withSign={false} />
              </span>
            </div>
            <div className="mt-cell">
              <span className="mt-lbl">
                <Icon name="scale" size={14} />
                Resultado
              </span>
              <span
                className="mt-val"
                style={{ color: totIn - totOut >= 0 ? "var(--text-hi)" : "var(--rose-500)" }}
              >
                <Money cents={totIn - totOut} withSign={false} />
              </span>
            </div>
          </div>
          <MonthExportButtons monthLabel={label} />
        </div>

        {data.items.length === 0 && (
          <div className="coming">
            <div className="ci">
              <Icon name="calendar-x" size={32} />
            </div>
            <h3>Nenhum lançamento</h3>
            <p>
              Não há lançamentos em {label}. Lançamentos fixos aparecem automaticamente nos meses seguintes.
            </p>
          </div>
        )}

        <div className="month-cols">
          {/* coluna esquerda: receitas + cartões */}
          <div className="col gap-4">
            {incomes.length > 0 && (
              <StmtCard
                today={today}
                group={{
                  key: "income",
                  name: "Receitas",
                  countText: `${incomes.length} ${incomes.length === 1 ? "entrada" : "entradas"}`,
                  accent: "var(--mint-500)",
                  icon: "arrow-down-left",
                  items: incomes,
                  totalCents: totIn,
                }}
              />
            )}
            {cardGroups.map((g) => (
              <StmtCard key={g.key} group={g} today={today} />
            ))}
          </div>
          {/* coluna direita: contas + compromissos + transferências */}
          <div className="col gap-4">
            {[...acctGroups, ...compromissos].map((g) => (
              <StmtCard key={g.key} group={g} today={today} />
            ))}
            {transfers.length > 0 && (
              <StmtCard
                today={today}
                group={{
                  key: "transfer",
                  name: "Transferências",
                  countText: `${transfers.length} entre contas · não afetam o patrimônio`,
                  accent: "var(--sky-500)",
                  icon: "arrow-left-right",
                  items: transfers,
                  totalCents: sumAbs(transfers),
                }}
              />
            )}
          </div>
        </div>
      </div>
    </MonthlySwipe>
  );
}
