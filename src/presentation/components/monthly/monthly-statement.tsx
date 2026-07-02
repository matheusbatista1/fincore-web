"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CardBillPayment } from "@/domain/entities/card-bill-payment";
import {
  type PayFaturaAccount,
  PayFaturaModal,
  type PayFaturaTarget,
} from "@/presentation/components/cards/pay-fatura-modal";
import { MonthExportButtons } from "@/presentation/components/monthly/month-export-buttons";
import { applyLens, keepGroup } from "@/presentation/components/monthly/monthly-lens";
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
  /** Groups for CSV/PDF export (general order; the lens is applied client-side). */
  exportGroups: StmtGroup[];
  /** General-lens header totals (the transaction income/expense; receivables added per lens). */
  totInCents: number;
  totOutCents: number;
  itemCount: number;
  /** Wallets available to pay a card fatura from (the modal's account picker). */
  accounts: PayFaturaAccount[];
  /** Card bill payments — a card group reads its own (cardId, competence) to show "Fatura paga". */
  cardBillPayments: CardBillPayment[];
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
  accounts,
  cardBillPayments,
}: MonthlyStatementProps) {
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const peopleOn = useModuleEnabled("people");
  const isPersonal = peopleOn && view === "personal";
  // "Pagar fatura" is triggered from inside a card group's modal; the modal itself lives here.
  const [payingFatura, setPayingFatura] = useState<PayFaturaTarget | null>(null);

  const left = useMemo(
    () => leftGroups.map((g) => applyLens(g, isPersonal)).filter(keepGroup),
    [leftGroups, isPersonal],
  );
  const right = useMemo(
    () => rightGroups.map((g) => applyLens(g, isPersonal)).filter(keepGroup),
    [rightGroups, isPersonal],
  );
  // Lens-aware, export-ordered groups (carry receivables on the income group under general).
  const exportLensed = useMemo(
    () => exportGroups.map((g) => applyLens(g, isPersonal)).filter(keepGroup),
    [exportGroups, isPersonal],
  );

  // General "Entradas" mirrors the dashboard: own income + what people owe you this
  // month ("a receber", carried on the income group). Personal counts only the user's own.
  const receivablesOf = (g: StmtGroup): number => g.receivables?.reduce((a, r) => a + r.amountCents, 0) ?? 0;
  const aReceberCents = isPersonal
    ? 0
    : [...left, ...right].filter((g) => g.lens === "income").reduce((s, g) => s + receivablesOf(g), 0);
  const totIn = isPersonal
    ? [...left, ...right].filter((g) => g.lens === "income").reduce((s, g) => s + g.totalCents, 0)
    : totInCents + aReceberCents;
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
                {/* Show the sign (− for a deficit) so the result reads without relying on color. */}
                <AnimatedMoney cents={totIn - totOut} withSign />
              </span>
            </div>
          </div>
          <MonthExportButtons
            monthLabel={label}
            month={month}
            groups={exportLensed}
            inCents={totIn}
            outCents={totOut}
            isPersonal={isPersonal}
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
                <StmtCard
                  key={`${g.key}-${month}-${isPersonal ? "p" : "g"}`}
                  group={g}
                  today={today}
                  month={month}
                  competenceLabel={label}
                  accounts={accounts}
                  cardBillPayments={cardBillPayments}
                  onOpenPayFatura={setPayingFatura}
                />
              ))}
            </div>
            <div className="col gap-4">
              {right.map((g) => (
                <StmtCard
                  key={`${g.key}-${month}-${isPersonal ? "p" : "g"}`}
                  group={g}
                  today={today}
                  month={month}
                  competenceLabel={label}
                  accounts={accounts}
                  cardBillPayments={cardBillPayments}
                  onOpenPayFatura={setPayingFatura}
                />
              ))}
            </div>
          </div>
        </MonthFade>
      </div>
      <PayFaturaModal
        target={payingFatura}
        accounts={accounts}
        today={today}
        onClose={() => setPayingFatura(null)}
      />
    </MonthTransition>
  );
}
