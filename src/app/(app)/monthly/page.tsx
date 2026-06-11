import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { getMonthly, type MonthlyItem } from "@/application/use-cases/get-monthly";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { addMonths, isValidCompetenceMonth } from "@/domain/value-objects/competence-month";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { MonthExportButtons } from "@/presentation/components/monthly/month-export-buttons";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { monthLabel, relativeDateLabel } from "@/shared/formatting/dates";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";
import { resolveBankTheme } from "@/shared/theme/bank-themes";

interface StmtGroup {
  readonly key: string;
  readonly name: string;
  readonly sub?: string;
  readonly accent: string;
  readonly icon: string;
  readonly items: MonthlyItem[];
  readonly totalCents: number;
}

function StmtRow({ item, today }: { item: MonthlyItem; today: string }) {
  const isTransfer = item.kind === "transfer";
  const cat = item.category;
  const icStyle: CSSProperties = isTransfer
    ? { background: "var(--sky-soft)", color: "var(--sky-500)" }
    : cat
      ? { background: `${cat.color}22`, color: cat.color }
      : { background: "var(--mint-soft)", color: "var(--mint-500)" };
  const iconName = isTransfer ? "arrow-left-right" : cat ? cat.icon : "arrow-down-left";
  const sub = isTransfer
    ? item.transferFromName && item.transferToName
      ? `${item.transferFromName} → ${item.transferToName}`
      : ""
    : (item.sourceLabel ?? (cat ? cat.name : ""));

  return (
    <div className="lrow">
      <span className="l-ic" style={icStyle}>
        <Icon name={iconName} size={18} />
      </span>
      <div className="l-main">
        <div className="l-title">
          {item.description || (isTransfer ? "Transferência" : "Lançamento")}
          {item.isFixed && (
            <span
              className="parc-badge"
              style={{ marginLeft: 8, background: "var(--purple-soft)", color: "var(--purple-300)" }}
            >
              <Icon name="repeat" size={11} />
              fixo
            </span>
          )}
          {item.projected && (
            <span className="parc-badge futura" style={{ marginLeft: 6 }}>
              previsto
            </span>
          )}
          {item.parcela && (
            <span className="parc-badge" style={{ marginLeft: 6 }}>
              {item.parcela.number}/{item.parcela.total}
            </span>
          )}
        </div>
        <div className="l-sub">
          {relativeDateLabel(item.date, today)}
          {sub ? ` · ${sub}` : ""}
        </div>
      </div>
      {isTransfer ? (
        <div className="l-amt" style={{ color: "var(--sky-500)" }}>
          <Money cents={item.transferValueCents ?? 0} withSign={false} />
        </div>
      ) : (
        <div className={`l-amt ${item.amountCents < 0 ? "neg" : "pos"}`}>
          <Money cents={item.amountCents} />
        </div>
      )}
    </div>
  );
}

function StmtCard({ group, today }: { group: StmtGroup; today: string }) {
  return (
    <div className="card stmt">
      <div className="stmt-head" style={{ ["--accent" as string]: group.accent } as CSSProperties}>
        <span className="sh-ic" style={{ background: `${group.accent}22`, color: group.accent }}>
          <Icon name={group.icon} size={18} />
        </span>
        <div className="sh-main">
          <b>{group.name}</b>
          <small>
            {group.sub ? `${group.sub} · ` : ""}
            {group.items.length} {group.items.length === 1 ? "lançamento" : "lançamentos"}
          </small>
        </div>
        <span className="sh-tot" style={group.key === "income" ? { color: group.accent } : undefined}>
          <Money cents={group.totalCents} withSign={false} />
        </span>
      </div>
      <div className="stmt-body">
        {group.items.map((item) => (
          <StmtRow key={item.id} item={item} today={today} />
        ))}
      </div>
    </div>
  );
}

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
                sub: "entre contas · não afetam o patrimônio",
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
  );
}
