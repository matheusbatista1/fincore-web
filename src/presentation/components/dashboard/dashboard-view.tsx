"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { AreaChart } from "@/presentation/components/charts/area-chart";
import { BarsChart } from "@/presentation/components/charts/bars-chart";
import { DonutChart } from "@/presentation/components/charts/donut-chart";
import { TxRow } from "@/presentation/components/transactions/tx-row";
import { Avatar } from "@/presentation/components/ui/avatar";
import { CountMoney } from "@/presentation/components/ui/count-money";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { useModuleEnabled } from "@/presentation/providers/modules-provider";
import { useUIStore } from "@/presentation/stores/ui-store";
import { resolveThemeKey } from "@/shared/theme/bank-themes";

interface Totals {
  readonly incomeCents: number;
  readonly expenseCents: number;
}
interface MiniCardData {
  readonly id: string;
  readonly bank: string;
  readonly product: string;
  readonly themeKey: string;
  readonly billCents: number;
  readonly limitCents: number;
  readonly dueDay: number;
}
interface DebtorData {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly relationship: string;
  readonly balanceCents: number;
}
export interface DashboardData {
  readonly saldoTotalCents: number;
  readonly aReceberCents: number;
  readonly investedCents: number;
  readonly general: Totals;
  readonly personal: Totals;
  readonly othersCents: number;
  readonly deltaPct: number | null;
  readonly trend: { label: string; valueCents: number }[];
  readonly months: { label: string; incomeCents: number; expenseCents: number }[];
  readonly categories: { id: string; name: string; color: string; valueCents: number }[];
  readonly totalExpenseCents: number;
  readonly cards: MiniCardData[];
  readonly debtors: DebtorData[];
  readonly recent: TransactionListItem[];
  readonly accountsCount: number;
  readonly today: string;
}

/** Approx. days from `today` (ISO) to the next occurrence of `dueDay` (1–31). */
function daysUntilDue(dueDay: number, today: string): number {
  const day = Number(today.split("-")[2] ?? "1");
  return dueDay >= day ? dueDay - day : 31 - day + dueDay;
}

function MiniCard({ card }: { card: MiniCardData }) {
  const pct = card.limitCents > 0 ? Math.round((card.billCents / card.limitCents) * 100) : 0;
  const theme = resolveThemeKey(card.themeKey, card.bank);
  return (
    <Link href="/cards" className={`cc mini ${theme}`}>
      <div className="cc-top">
        <span className="cc-bank">{card.bank}</span>
        <span className="cc-flag">{card.product}</span>
      </div>
      <div className="cc-bottom" style={{ alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 2 }}>Fatura atual</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            <Money cents={card.billCents} withSign={false} />
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, opacity: 0.75 }}>{pct}% do limite</div>
          <div className="meter" style={{ width: 90, marginTop: 5, background: "rgba(255,255,255,0.22)" }}>
            <span
              style={{
                width: `${Math.min(100, pct)}%`,
                background: pct > 80 ? "#FB6E83" : "rgba(255,255,255,0.9)",
              }}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

function KpiCard({
  icon,
  tone,
  label,
  valueCents,
  delta,
  dir,
  sub,
}: {
  icon: string;
  tone: string;
  label: string;
  valueCents: number;
  delta?: string;
  dir?: "up" | "down";
  sub?: ReactNode;
}) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className={`kpi-ic ${tone}`}>
          <Icon name={icon} size={19} />
        </span>
        {delta && (
          <span className={`delta ${dir}`}>
            <Icon name={dir === "up" ? "trending-up" : "trending-down"} size={14} />
            {delta}
          </span>
        )}
      </div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-val">
        <Money cents={valueCents} withSign={false} />
      </div>
      {sub && <div className="kpi-foot">{sub}</div>}
    </div>
  );
}

export function DashboardView({ data }: { data: DashboardData }) {
  const view = useUIStore((s) => s.view);
  const privacy = useUIStore((s) => s.privacy);
  const togglePrivacy = useUIStore((s) => s.togglePrivacy);
  const setView = useUIStore((s) => s.setView);
  const peopleOn = useModuleEnabled("people");
  const reportsOn = useModuleEnabled("reports");
  // Without the People module there are no shares to discount, so the
  // general/personal lens is meaningless — force the general view.
  const isPersonal = peopleOn && view === "personal";

  const personalInc = Math.max(0, data.personal.incomeCents);
  const personalExp = Math.max(0, data.personal.expenseCents);
  const receitaMes = isPersonal ? personalInc : data.general.incomeCents;
  const gastoMes = isPersonal ? personalExp : data.general.expenseCents;
  const economia = receitaMes - gastoMes;
  const savingsPct = Math.round((economia / (receitaMes || 1)) * 100);
  const topCat = data.categories[0];

  return (
    <div className="dash-page">
      {peopleOn && (
        <div
          className="row"
          style={{ justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}
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
              maxWidth: 460,
            }}
          >
            <Icon name="info" size={14} style={{ color: "var(--purple-300)", flex: "none" }} />
            {isPersonal
              ? "Mostrando só o que é seu — as partes de outras pessoas foram descontadas."
              : "Mostrando tudo, incluindo o que será reembolsado por outras pessoas."}
          </span>
        </div>
      )}

      {/* HERO */}
      <div className="card rise" style={{ overflow: "hidden", marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.05fr", gap: 0 }} className="dash-hero">
          <div className="card-pad" style={{ padding: "28px 28px 26px" }}>
            <div className="row gap-2" style={{ justifyContent: "space-between" }}>
              <span className="kicker">Saldo total disponível</span>
              <button type="button" className="eye-btn" onClick={togglePrivacy} title="Ocultar valores">
                <Icon name={privacy ? "eye-off" : "eye"} size={18} />
              </button>
            </div>
            <div
              className="fc-bignum"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 52,
                fontWeight: 600,
                color: "var(--text-hi)",
                letterSpacing: "-0.03em",
                marginTop: 6,
                lineHeight: 1,
              }}
            >
              <CountMoney cents={data.saldoTotalCents} />
            </div>
            <div className="row gap-3" style={{ marginTop: 12 }}>
              {data.deltaPct !== null && (
                <span className={`delta ${data.deltaPct >= 0 ? "up" : "down"}`}>
                  <Icon name={data.deltaPct >= 0 ? "trending-up" : "trending-down"} size={15} />
                  {data.deltaPct >= 0 ? "+" : ""}
                  {data.deltaPct.toFixed(1).replace(".", ",")}%
                </span>
              )}
              <span style={{ color: "var(--text-lo)", fontSize: 13.5 }}>
                em {data.accountsCount} {data.accountsCount === 1 ? "conta" : "contas"}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: peopleOn ? "1fr 1fr 1fr" : "1fr 1fr",
                gap: 14,
                marginTop: 26,
                paddingTop: 22,
                borderTop: "1px solid var(--line)",
              }}
            >
              <div>
                <div
                  className="row gap-2"
                  style={{ color: "var(--text-lo)", fontSize: 12.5, marginBottom: 5 }}
                >
                  <Icon name="trending-up" size={14} />
                  Investido
                </div>
                <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text-hi)" }}>
                  <Money cents={data.investedCents} withSign={false} />
                </div>
              </div>
              {peopleOn && (
                <div>
                  <div
                    className="row gap-2"
                    style={{ color: "var(--text-lo)", fontSize: 12.5, marginBottom: 5 }}
                  >
                    <Icon name="hand-coins" size={14} />A receber
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: "var(--mint-500)" }}>
                    <Money cents={data.aReceberCents} withSign={false} />
                  </div>
                </div>
              )}
              <div>
                <div
                  className="row gap-2"
                  style={{ color: "var(--text-lo)", fontSize: 12.5, marginBottom: 5 }}
                >
                  <Icon name="landmark" size={14} />
                  Patrimônio
                </div>
                <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text-hi)" }}>
                  <Money cents={data.saldoTotalCents + data.investedCents} withSign={false} />
                </div>
              </div>
            </div>
          </div>
          <div
            className="dash-hero-spark"
            style={{
              background: "linear-gradient(180deg, rgba(124,92,255,0.05), transparent)",
              borderLeft: "1px solid var(--line)",
              padding: "22px 24px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <span className="kicker">Evolução do patrimônio</span>
              <span className="pill purple">6 meses</span>
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
              <AreaChart data={data.trend} />
            </div>
          </div>
        </div>
      </div>

      {/* MINI CARDS */}
      {data.cards.length > 0 && (
        <>
          <div className="row" style={{ justifyContent: "space-between", margin: "26px 2px 12px" }}>
            <span className="kicker">Seus cartões</span>
            <Link className="card-link" href="/cards">
              Ver todos
              <Icon name="arrow-right" size={14} />
            </Link>
          </div>
          <div
            className="cards-row-scroll"
            style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 26 }}
          >
            {data.cards.map((c) => (
              <MiniCard key={c.id} card={c} />
            ))}
          </div>
        </>
      )}

      {/* KPIs */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KpiCard
          icon="arrow-down-left"
          tone="mint"
          label={isPersonal ? "Minha renda no mês" : "Receitas do mês"}
          valueCents={receitaMes}
          sub={
            <span className="row gap-2">
              <Icon name="calendar" size={14} />
              {isPersonal ? "Sem reembolsos" : "Tudo que entrou"}
            </span>
          }
        />
        <KpiCard
          icon="arrow-up-right"
          tone="rose"
          label={isPersonal ? "Meu gasto real" : "Gasto do mês"}
          valueCents={gastoMes}
          sub={
            <span className="row gap-2">
              <Icon name="receipt" size={14} />
              {isPersonal ? "Só a sua parte" : "Inclui partes de outros"}
            </span>
          }
        />
        <KpiCard
          icon="piggy-bank"
          tone="purple"
          label={isPersonal ? "Sobra real" : "Economia do mês"}
          valueCents={economia}
          sub={
            <span className="row gap-2">
              <Icon name="target" size={14} />
              <span>{savingsPct}% da renda</span>
            </span>
          }
        />
      </div>

      {/* INSIGHTS */}
      <div
        className="insight-grid"
        style={{
          display: "grid",
          gridTemplateColumns: peopleOn ? "repeat(4,1fr)" : "repeat(2,1fr)",
          gap: 14,
          marginBottom: 26,
        }}
      >
        <div className="insight">
          <span className="ii" style={{ background: "var(--mint-soft)", color: "var(--mint-500)" }}>
            <Icon name="piggy-bank" size={17} />
          </span>
          <p>
            Sua taxa de poupança é <b>{savingsPct}%</b> da renda do mês.
          </p>
        </div>
        {peopleOn && (
          <>
            <div className="insight">
              <span className="ii" style={{ background: "var(--amber-soft)", color: "var(--amber-500)" }}>
                <Icon name="handshake" size={17} />
              </span>
              <p>
                Você tem{" "}
                <b>
                  <Money cents={data.aReceberCents} withSign={false} />
                </b>{" "}
                a receber de outras pessoas.
              </p>
            </div>
            <div className="insight">
              <span className="ii" style={{ background: "var(--purple-soft)", color: "var(--purple-300)" }}>
                <Icon name="wallet" size={17} />
              </span>
              <p>
                <b>
                  <Money cents={data.othersCents} withSign={false} />
                </b>{" "}
                dos gastos são partes de outras pessoas.
              </p>
            </div>
          </>
        )}
        <div className="insight">
          <span className="ii" style={{ background: "var(--rose-soft)", color: "var(--rose-500)" }}>
            <Icon name="chart-pie" size={17} />
          </span>
          <p>
            {topCat ? (
              <>
                <b>{topCat.name}</b> é sua maior categoria de gasto.
              </>
            ) : (
              "Cadastre lançamentos para ver insights por categoria."
            )}
          </p>
        </div>
      </div>

      {/* MAIN GRID */}
      <div
        className="dash-grid"
        style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 16, alignItems: "start" }}
      >
        <div className="col gap-4">
          <div className="card">
            <div className="card-head">
              <div>
                <h3>Receitas x Despesas</h3>
                <div className="ch-sub">Comparativo dos últimos 6 meses</div>
              </div>
            </div>
            <div className="card-pad">
              <BarsChart months={data.months} />
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <div>
                <h3>Atividade recente</h3>
              </div>
              <Link className="card-link" href="/transactions">
                Ver tudo
                <Icon name="arrow-right" size={14} />
              </Link>
            </div>
            <div className="card-pad" style={{ paddingTop: 6, paddingBottom: 6 }}>
              {data.recent.length === 0 ? (
                <div style={{ color: "var(--text-lo)", fontSize: 14, padding: "14px 0" }}>
                  Nenhum lançamento ainda.
                </div>
              ) : (
                data.recent.map((t) => <TxRow key={t.id} item={t} today={data.today} />)
              )}
            </div>
          </div>
        </div>

        <div className="col gap-4">
          <div className="card">
            <div className="card-head">
              <div>
                <h3>Gastos por categoria</h3>
              </div>
              {reportsOn && (
                <Link className="card-link" href="/reports">
                  Relatório
                  <Icon name="arrow-right" size={14} />
                </Link>
              )}
            </div>
            <div className="card-pad">
              {data.totalExpenseCents > 0 ? (
                <DonutChart slices={data.categories} totalCents={data.totalExpenseCents} />
              ) : (
                <div style={{ color: "var(--text-lo)", fontSize: 14, padding: "14px 0" }}>
                  Sem gastos neste mês.
                </div>
              )}
            </div>
          </div>

          {data.cards.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h3>Próximos vencimentos</h3>
                </div>
              </div>
              <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 8 }}>
                {data.cards.map((c) => {
                  const soon = daysUntilDue(c.dueDay, data.today) <= 7;
                  return (
                    <div className="lrow" key={c.id}>
                      <span className="l-ic" style={{ background: "var(--surface-3)" }}>
                        <Icon name="credit-card" size={18} />
                      </span>
                      <div className="l-main">
                        <div className="l-title">
                          {c.bank} · {c.product}
                        </div>
                        <div className="l-sub">Vence dia {c.dueDay}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className="l-amt">
                          <Money cents={c.billCents} withSign={false} />
                        </div>
                        <span className={`pill ${soon ? "amber" : "neutral"}`} style={{ marginTop: 4 }}>
                          {soon ? "Em breve" : "Em dia"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {peopleOn && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h3>Pessoas com pendências</h3>
                </div>
                <Link className="card-link" href="/people">
                  Ver todas
                  <Icon name="arrow-right" size={14} />
                </Link>
              </div>
              <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 8 }}>
                {data.debtors.length === 0 ? (
                  <div style={{ color: "var(--text-lo)", fontSize: 14, padding: "14px 0" }}>
                    Ninguém te deve no momento.
                  </div>
                ) : (
                  data.debtors.map((p) => (
                    <Link className="lrow" href="/people" key={p.id}>
                      <Avatar name={p.name} color={p.color} size={40} radius={12} />
                      <div className="l-main">
                        <div className="l-title">{p.name}</div>
                        <div className="l-sub">{p.relationship || "te deve"}</div>
                      </div>
                      <div className="l-amt pos">
                        <Money cents={p.balanceCents} withSign={false} />
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
