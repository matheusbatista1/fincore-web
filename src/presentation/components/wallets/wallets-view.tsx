"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { MonthlyItem, PaidObligationFlow } from "@/application/use-cases/get-monthly";
import type { AccountView } from "@/application/use-cases/get-workspace-view";
import { AccountFormDialog } from "@/presentation/components/forms/account-form-dialog";
import {
  MonthNavButton,
  MonthNavPending,
  MonthTransition,
} from "@/presentation/components/shell/month-transition";
import { AnimatedMoney } from "@/presentation/components/ui/animated-money";
import { CountMoney } from "@/presentation/components/ui/count-money";
import { Icon } from "@/presentation/components/ui/icon";
import { AccountDetailModal } from "@/presentation/components/wallets/account-detail-modal";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { monthLabel } from "@/shared/formatting/dates";
import { resolveBankTheme } from "@/shared/theme/bank-themes";

const themeAccent = (themeKey: string, bank: string): string => resolveBankTheme(themeKey, bank).accent;

/** Carteiras — ported from the prototype (cards.jsx WalletsScreen), now month-navigable. */
export function WalletsView({
  accounts,
  items,
  paidFlows,
  month,
  today,
  isCurrent,
  prevHref,
  nextHref,
}: {
  accounts: AccountView[];
  /** The browsed month's movements (real + projected), from getMonthly. */
  items: MonthlyItem[];
  /** Paid obligations whose payment landed this month (bucketed by paid date, not due date). */
  paidFlows: PaidObligationFlow[];
  month: string;
  today: string;
  isCurrent: boolean;
  prevHref: string;
  nextHref: string;
}) {
  const privacy = useUIStore((s) => s.privacy);
  const togglePrivacy = useUIStore((s) => s.togglePrivacy);
  // Tapping an account opens its detail (movements + Editar), not the edit form directly.
  const [detail, setDetail] = useState<AccountView | null>(null);

  // Balances are "live" (as of today), independent of the browsed month.
  const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
  const posTotal = accounts.reduce((s, a) => s + Math.max(0, a.balanceCents), 0) || 1;
  const sorted = [...accounts].sort((a, b) => b.balanceCents - a.balanceCents);

  // Per-account in/out for the browsed month (getMonthly already scopes the items). Transfers are
  // kept in their OWN channel (tIn/tOut), never folded into entradas/saídas — otherwise moving money
  // between your own accounts (or a round-trip ida-e-volta) inflates both sides and reads as income.
  const flow = useMemo(() => {
    const f = new Map<string, { in: number; out: number; tIn: number; tOut: number }>();
    for (const a of accounts) f.set(a.id, { in: 0, out: 0, tIn: 0, tOut: 0 });
    for (const t of items) {
      if (t.kind === "transfer") {
        const from = t.transferFromAccountId ? f.get(t.transferFromAccountId) : undefined;
        const to = t.transferToAccountId ? f.get(t.transferToAccountId) : undefined;
        if (from) from.tOut += t.transferValueCents ?? 0;
        if (to) to.tIn += t.transferValueCents ?? 0;
        continue;
      }
      if (!t.accountId) continue;
      const acc = f.get(t.accountId);
      if (!acc) continue;
      if (t.amountCents > 0) acc.in += t.amountCents;
      else acc.out += Math.abs(t.amountCents);
    }
    // Paid deferred obligations debit their paying account on the paid date (their row lives in the
    // due month with a null accountId, so they're not in the loop above). Attribute the out-flow to
    // paidAccountId so the per-account "saídas" reconciles with the balance movement.
    for (const pf of paidFlows) {
      const acc = f.get(pf.accountId);
      if (acc) acc.out += pf.outCents;
    }
    return f;
  }, [items, paidFlows, accounts]);

  const cash = (cents: number): string => (privacy ? "•••" : formatBRLAbsolute(cents));

  return (
    <MonthTransition prevHref={prevHref} nextHref={nextHref}>
      <div className="wallets-page">
        {/* navegador de mês */}
        <div className="card card-pad rise" style={{ marginBottom: 18 }}>
          <div className="month-nav">
            <MonthNavButton href={prevHref} dir="prev" title="Mês anterior">
              <Icon name="chevron-left" size={19} />
            </MonthNavButton>
            <div className="mn-label">
              <span className="mn-month">{monthLabel(month, { long: true })}</span>
              <MonthNavPending />
              {isCurrent ? (
                <span className="pill purple" style={{ height: 22 }}>
                  Mês atual
                </span>
              ) : (
                <Link className="card-link" href="/wallets">
                  Voltar para hoje
                </Link>
              )}
            </div>
            <MonthNavButton href={nextHref} dir="next" title="Próximo mês">
              <Icon name="chevron-right" size={19} />
            </MonthNavButton>
          </div>
        </div>

        {/* hero: total + distribuição (saldos ao vivo, não mudam com o mês) */}
        <div className="card card-pad rise" style={{ marginBottom: 18 }}>
          <div
            className="row wallets-hero-head"
            style={{ justifyContent: "space-between", alignItems: "flex-start" }}
          >
            <div>
              <span className="kicker">Patrimônio em contas</span>
              <div
                className="fc-bignum"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 44,
                  fontWeight: 600,
                  color: "var(--text-hi)",
                  letterSpacing: "-0.03em",
                  marginTop: 6,
                  lineHeight: 1,
                }}
              >
                <CountMoney cents={total} />
              </div>
              <div className="row gap-3" style={{ marginTop: 12, flexWrap: "wrap" }}>
                <span style={{ color: "var(--text-lo)", fontSize: 13.5 }}>
                  distribuído em {accounts.length} {accounts.length === 1 ? "carteira" : "carteiras"}
                </span>
              </div>
            </div>
            <div className="row gap-3">
              <button type="button" className="btn btn-ghost" onClick={togglePrivacy}>
                <Icon name={privacy ? "eye-off" : "eye"} size={17} />
                {privacy ? "Mostrar" : "Ocultar"}
              </button>
              <AccountFormDialog
                trigger={
                  <button type="button" className="btn btn-primary">
                    <Icon name="plus" size={17} />
                    Nova carteira
                  </button>
                }
              />
            </div>
          </div>
          {/* barra de distribuição */}
          <div className="dist-bar" style={{ marginTop: 24 }}>
            {sorted
              .filter((a) => a.balanceCents > 0)
              .map((a) => (
                <span
                  key={a.id}
                  title={`${a.bank} · ${cash(a.balanceCents)}`}
                  style={{
                    width: `${(a.balanceCents / posTotal) * 100}%`,
                    background: themeAccent(a.themeKey, a.bank),
                  }}
                />
              ))}
          </div>
          <div className="dist-legend">
            {sorted
              .filter((a) => a.balanceCents > 0)
              .map((a) => (
                <div className="dl" key={a.id}>
                  <span className="dot" style={{ background: themeAccent(a.themeKey, a.bank) }} />
                  {a.bank}
                  <b>{Math.round((a.balanceCents / posTotal) * 100)}%</b>
                </div>
              ))}
          </div>
        </div>

        {/* lista de contas — sem MonthFade: as linhas ficam montadas e os valores animam ao mudar de mês */}
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Suas carteiras</h3>
              <div className="ch-sub">
                {accounts.length} {accounts.length === 1 ? "conta conectada" : "contas conectadas"} ·
                movimento de {monthLabel(month, { long: true })}
              </div>
            </div>
          </div>
          <div className="card-pad" style={{ paddingTop: 6, paddingBottom: 10 }}>
            {sorted.map((a) => {
              const accent = themeAccent(a.themeKey, a.bank);
              const fl = flow.get(a.id) ?? { in: 0, out: 0, tIn: 0, tOut: 0 };
              const netTransfer = fl.tIn - fl.tOut;
              return (
                <button type="button" className="acct-row" key={a.id} onClick={() => setDetail(a)}>
                  <span className="acct-ava" style={{ background: `${accent}22`, color: accent }}>
                    {a.bank.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="acct-info">
                    <div className="acct-name">
                      {a.bank}
                      <span className="type-badge">{a.type}</span>
                      {a.balanceCents < 0 && (
                        <span
                          className="type-badge"
                          style={{ background: "var(--rose-soft)", color: "var(--rose-500)" }}
                        >
                          Cheque especial
                        </span>
                      )}
                    </div>
                    <div className="acct-meta">
                      {a.name} · {a.maskedNumber}
                    </div>
                  </div>
                  <div className="acct-flow">
                    <span className="af up">
                      <Icon name="arrow-down-left" size={13} />
                      <AnimatedMoney cents={fl.in} withSign={false} />
                    </span>
                    <span className="af down">
                      <Icon name="arrow-up-right" size={13} />
                      <AnimatedMoney cents={fl.out} withSign={false} />
                    </span>
                    {netTransfer !== 0 && (
                      <span
                        className="af"
                        style={{ color: "var(--text-lo)" }}
                        title="Transferências (não contam como entrada/saída)"
                      >
                        <Icon name="arrow-left-right" size={13} />
                        {netTransfer > 0 ? "+" : "−"}
                        <AnimatedMoney cents={Math.abs(netTransfer)} withSign={false} />
                      </span>
                    )}
                  </div>
                  <div className="acct-bal">
                    <div className="ab-val" style={a.balanceCents < 0 ? { color: "var(--rose-500)" } : {}}>
                      <AnimatedMoney cents={a.balanceCents} />
                    </div>
                  </div>
                  <span className="acct-edit">
                    <Icon name="chevron-right" size={16} />
                  </span>
                </button>
              );
            })}
            <AccountFormDialog
              trigger={
                <button type="button" className="acct-add">
                  <Icon name="plus" size={18} />
                  Adicionar carteira
                </button>
              }
            />
          </div>
        </div>
      </div>
      <AccountDetailModal
        account={detail}
        items={items}
        paidFlows={paidFlows}
        month={month}
        today={today}
        onClose={() => setDetail(null)}
      />
    </MonthTransition>
  );
}
