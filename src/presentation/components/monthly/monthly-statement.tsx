"use client";

import Link from "next/link";
import { useMemo } from "react";
import { MonthExportButtons } from "@/presentation/components/monthly/month-export-buttons";
import { StmtCard, type StmtGroup } from "@/presentation/components/monthly/stmt-card";
import {
  MonthFade,
  MonthNavButton,
  MonthNavPending,
  MonthTransition,
} from "@/presentation/components/shell/month-transition";
import { AnimatedMoney } from "@/presentation/components/ui/animated-money";
import { Icon } from "@/presentation/components/ui/icon";
import { useModuleEnabled } from "@/presentation/providers/modules-provider";
import { useUIStore } from "@/presentation/stores/ui-store";

/**
 * Recast a group through the personal lens: expenses show only the user's share,
 * income drops reimbursements; transfers and the general lens pass through.
 */
function applyLens(group: StmtGroup, isPersonal: boolean): StmtGroup {
  if (!isPersonal || !group.lens || group.lens === "transfer") return group;
  if (group.lens === "income") {
    const items = group.items.filter((i) => !i.isReimbursement);
    return {
      ...group,
      items,
      totalCents: items.reduce((s, i) => s + i.amountCents, 0),
      countText: `${items.length} ${items.length === 1 ? "entrada" : "entradas"}`,
    };
  }
  // expense: display only the user's own share per row.
  const items = group.items.map((i) => ({
    ...i,
    amountCents: -(i.myShareCents ?? Math.abs(i.amountCents)),
  }));
  return { ...group, items, totalCents: items.reduce((s, i) => s + Math.abs(i.amountCents), 0) };
}

export interface MonthlyStatementProps {
  month: string;
  label: string;
  isCurrent: boolean;
  today: string;
  prevHref: string;
  nextHref: string;
  /** Left column (general lens): income + cards. */
  leftGroups: StmtGroup[];
  /** Right column (general lens): accounts + commitments + transfers. */
  rightGroups: StmtGroup[];
  /** Groups for CSV/PDF export — always the general lens. */
  exportGroups: StmtGroup[];
  /** General-lens header totals (export + the default view). */
  totInCents: number;
  totOutCents: number;
  itemCount: number;
}

/** Monthly statement with month navigation, the immersive transition and a Geral/Apenas-meu lens. */
export function MonthlyStatement({
  month,
  label,
  isCurrent,
  today,
  prevHref,
  nextHref,
  leftGroups,
  rightGroups,
  exportGroups,
  totInCents,
  totOutCents,
  itemCount,
}: MonthlyStatementProps) {
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const peopleOn = useModuleEnabled("people");
  const isPersonal = peopleOn && view === "personal";

  const left = useMemo(
    () => leftGroups.map((g) => applyLens(g, isPersonal)).filter((g) => g.items.length > 0),
    [leftGroups, isPersonal],
  );
  const right = useMemo(
    () => rightGroups.map((g) => applyLens(g, isPersonal)).filter((g) => g.items.length > 0),
    [rightGroups, isPersonal],
  );

  const totIn = isPersonal
    ? [...left, ...right].filter((g) => g.lens === "income").reduce((s, g) => s + g.totalCents, 0)
    : totInCents;
  const totOut = isPersonal
    ? [...left, ...right].filter((g) => g.lens === "expense").reduce((s, g) => s + g.totalCents, 0)
    : totOutCents;

  return (
    <MonthTransition prevHref={prevHref} nextHref={nextHref}>
      <div className="monthly-page">
        {/* navegador + resumo */}
        <div className="card card-pad rise" style={{ marginBottom: 18 }}>
          <div className="month-nav">
            <MonthNavButton href={prevHref} dir="prev" title="Mês anterior">
              <Icon name="chevron-left" size={19} />
            </MonthNavButton>
            <div className="mn-label">
              <span className="mn-month">{label}</span>
              <MonthNavPending />
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
            <MonthNavButton href={nextHref} dir="next" title="Próximo mês">
              <Icon name="chevron-right" size={19} />
            </MonthNavButton>
          </div>

          {peopleOn && (
            <div
              className="row"
              style={{ justifyContent: "space-between", marginTop: 14, flexWrap: "wrap", gap: 12 }}
            >
              <div className="view-toggle">
                <button type="button" className={!isPersonal ? "on" : ""} onClick={() => setView("general")}>
                  <Icon name="users" size={15} />
                  Geral
                </button>
                <button type="button" className={isPersonal ? "on" : ""} onClick={() => setView("personal")}>
                  <Icon name="user" size={15} />
                  Apenas meu
                </button>
              </div>
              <span
                style={{
                  fontSize: 13,
                  color: "var(--text-lo)",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                }}
              >
                <Icon name="info" size={14} style={{ color: "var(--purple-300)", flex: "none" }} />
                {isPersonal
                  ? "Só a sua parte — as partes de outras pessoas foram descontadas."
                  : "Tudo, incluindo o que será reembolsado por outras pessoas."}
              </span>
            </div>
          )}

          <div className="month-totals">
            <div className="mt-cell">
              <span className="mt-lbl">
                <Icon name="arrow-down-left" size={14} />
                Entradas
              </span>
              <span className="mt-val" style={{ color: "var(--mint-500)" }}>
                <AnimatedMoney cents={totIn} withSign={false} />
              </span>
            </div>
            <div className="mt-cell">
              <span className="mt-lbl">
                <Icon name="arrow-up-right" size={14} />
                Saídas
              </span>
              <span className="mt-val" style={{ color: "var(--rose-500)" }}>
                <AnimatedMoney cents={totOut} withSign={false} />
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
                <AnimatedMoney cents={totIn - totOut} withSign={false} />
              </span>
            </div>
          </div>
          <MonthExportButtons
            monthLabel={label}
            month={month}
            groups={exportGroups}
            inCents={totInCents}
            outCents={totOutCents}
          />
        </div>

        <MonthFade month={month}>
          {itemCount === 0 && (
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
            <div className="col gap-4">
              {left.map((g) => (
                <StmtCard key={g.key} group={g} today={today} />
              ))}
            </div>
            <div className="col gap-4">
              {right.map((g) => (
                <StmtCard key={g.key} group={g} today={today} />
              ))}
            </div>
          </div>
        </MonthFade>
      </div>
    </MonthTransition>
  );
}
