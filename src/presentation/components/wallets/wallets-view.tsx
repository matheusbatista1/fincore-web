"use client";

import { useMemo } from "react";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import type { AccountView } from "@/application/use-cases/get-workspace-view";
import { monthOf } from "@/domain/value-objects/competence-month";
import { AccountFormDialog } from "@/presentation/components/forms/account-form-dialog";
import { CountMoney } from "@/presentation/components/ui/count-money";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { monthLabel } from "@/shared/formatting/dates";
import { resolveBankTheme } from "@/shared/theme/bank-themes";

const themeAccent = (themeKey: string, bank: string): string => resolveBankTheme(themeKey, bank).accent;

/** Carteiras — ported 1:1 from the prototype (cards.jsx WalletsScreen). */
export function WalletsView({
  accounts,
  transactions,
  currentMonth,
}: {
  accounts: AccountView[];
  transactions: TransactionListItem[];
  currentMonth: string;
}) {
  const privacy = useUIStore((s) => s.privacy);
  const togglePrivacy = useUIStore((s) => s.togglePrivacy);

  const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
  const posTotal = accounts.reduce((s, a) => s + Math.max(0, a.balanceCents), 0) || 1;
  const sorted = [...accounts].sort((a, b) => b.balanceCents - a.balanceCents);

  const flow = useMemo(() => {
    const f = new Map<string, { in: number; out: number }>();
    for (const a of accounts) f.set(a.id, { in: 0, out: 0 });
    for (const t of transactions) {
      if (monthOf(t.date) !== currentMonth) continue;
      if (t.kind === "transfer") {
        const from = t.transferFromAccountId ? f.get(t.transferFromAccountId) : undefined;
        const to = t.transferToAccountId ? f.get(t.transferToAccountId) : undefined;
        if (from) from.out += t.transferValueCents ?? 0;
        if (to) to.in += t.transferValueCents ?? 0;
        continue;
      }
      if (!t.accountId) continue;
      const acc = f.get(t.accountId);
      if (!acc) continue;
      if (t.amountCents > 0) acc.in += t.amountCents;
      else acc.out += Math.abs(t.amountCents);
    }
    return f;
  }, [transactions, accounts, currentMonth]);

  const cash = (cents: number): string => (privacy ? "•••" : formatBRLAbsolute(cents));

  return (
    <div className="wallets-page">
      {/* hero: total + distribuição */}
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
            <div className="row gap-3" style={{ marginTop: 12 }}>
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

      {/* lista de contas */}
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Suas carteiras</h3>
            <div className="ch-sub">
              {accounts.length} {accounts.length === 1 ? "conta conectada" : "contas conectadas"} · movimento
              de {monthLabel(currentMonth, { long: true })}
            </div>
          </div>
        </div>
        <div className="card-pad" style={{ paddingTop: 6, paddingBottom: 10 }}>
          {sorted.map((a) => {
            const accent = themeAccent(a.themeKey, a.bank);
            const fl = flow.get(a.id) ?? { in: 0, out: 0 };
            return (
              <AccountFormDialog
                account={a}
                key={a.id}
                trigger={
                  <button type="button" className="acct-row">
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
                        {cash(fl.in)}
                      </span>
                      <span className="af down">
                        <Icon name="arrow-up-right" size={13} />
                        {cash(fl.out)}
                      </span>
                    </div>
                    <div className="acct-bal">
                      <div className="ab-val" style={a.balanceCents < 0 ? { color: "var(--rose-500)" } : {}}>
                        <Money cents={a.balanceCents} />
                      </div>
                      <div className="ab-pct">
                        {a.balanceCents < 0
                          ? "negativada"
                          : `${Math.round((a.balanceCents / posTotal) * 100)}% do total`}
                      </div>
                    </div>
                    <span className="acct-edit">
                      <Icon name="pencil" size={16} />
                    </span>
                  </button>
                }
              />
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
  );
}
