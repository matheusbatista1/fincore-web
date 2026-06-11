"use client";

import { useMemo, useState } from "react";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import type { CardView } from "@/application/use-cases/get-workspace-view";
import { addMonths, monthOf } from "@/domain/value-objects/competence-month";
import { CreditCardFormDialog } from "@/presentation/components/forms/credit-card-form-dialog";
import { CreditCardWidget } from "@/presentation/components/ui/credit-card-widget";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { monthLabel, relativeDateLabel } from "@/shared/formatting/dates";

interface ActiveInstallment {
  readonly desc: string;
  readonly of: number;
  readonly value: number;
  readonly n: number;
  readonly total: number;
}

/** Cartões — ported 1:1 from the prototype (cards.jsx CardsScreen). */
export function CardsView({
  cards,
  transactions,
  today,
  currentMonth,
}: {
  cards: CardView[];
  transactions: TransactionListItem[];
  today: string;
  currentMonth: string;
}) {
  const toast = useUIStore((s) => s.toast);
  const [sel, setSel] = useState<string | undefined>(cards[0]?.id);
  const card = cards.find((c) => c.id === sel) ?? cards[0];
  const [fatKey, setFatKey] = useState(currentMonth);

  const compras = useMemo(
    () =>
      card
        ? transactions.filter((t) => t.cardId === card.id && t.amountCents < 0 && monthOf(t.date) === fatKey)
        : [],
    [transactions, fatKey, card],
  );

  const parcelas = useMemo<ActiveInstallment[]>(() => {
    if (!card) return [];
    const groups = new Map<
      string,
      { desc: string; of: number; value: number; nos: number[]; cur: number | null }
    >();
    for (const t of transactions) {
      if (t.cardId !== card.id || !t.installmentGroupId || !t.parcela) continue;
      let g = groups.get(t.installmentGroupId);
      if (!g) {
        g = {
          desc: t.description.replace(/\s*·?\s*Parcela.*$/i, ""),
          of: t.parcela.total,
          value: Math.abs(t.amountCents),
          nos: [],
          cur: null,
        };
        groups.set(t.installmentGroupId, g);
      }
      g.nos.push(t.parcela.number);
      if (t.parcela.status === "atual") g.cur = t.parcela.number;
    }
    return [...groups.values()].map((g) => ({
      desc: g.desc,
      of: g.of,
      value: g.value,
      n: g.cur ?? Math.min(...g.nos),
      total: g.value * g.of,
    }));
  }, [transactions, card]);

  if (!card) {
    return (
      <div className="coming">
        <div className="ci">
          <Icon name="credit-card" size={32} />
        </div>
        <h3>Nenhum cartão</h3>
        <p>Adicione seu primeiro cartão para acompanhar faturas e limites.</p>
        <CreditCardFormDialog
          trigger={
            <button type="button" className="btn btn-primary" style={{ marginTop: 20 }}>
              <Icon name="plus" size={17} />
              Adicionar cartão
            </button>
          }
        />
      </div>
    );
  }

  const used = card.billCents;
  const avail = card.limitCents - used;
  const pct = card.limitCents > 0 ? Math.round((used / card.limitCents) * 100) : 0;
  const meterCls = pct > 85 ? "danger" : pct > 65 ? "warn" : "";
  const faturaMes = compras.reduce((s, t) => s + Math.abs(t.amountCents), 0);
  const isFatAtual = fatKey === currentMonth;

  return (
    <div className="cards-page">
      <div
        className="cards-row-scroll"
        style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 28 }}
      >
        {cards.map((c) => (
          <button
            type="button"
            key={c.id}
            onClick={() => setSel(c.id)}
            style={{
              border: 0,
              background: "none",
              padding: 0,
              borderRadius: "var(--r-md)",
              outline: c.id === sel ? "2px solid var(--purple-500)" : "none",
              outlineOffset: 4,
              transition: "transform .2s",
              transform: c.id === sel ? "translateY(-4px)" : "none",
              cursor: "pointer",
            }}
          >
            <CreditCardWidget
              bank={c.bank}
              product={c.product}
              flag={c.flag}
              themeKey={c.themeKey}
              maskedNumber={c.maskedNumber}
            />
          </button>
        ))}
        <CreditCardFormDialog
          trigger={
            <button
              type="button"
              className="card"
              style={{
                aspectRatio: "1.586/1",
                border: "1.5px dashed var(--line-3)",
                background: "transparent",
                display: "grid",
                placeItems: "center",
                color: "var(--text-lo)",
                gap: 8,
              }}
            >
              <Icon name="plus" size={26} />
              <span style={{ fontWeight: 600 }}>Novo cartão</span>
            </button>
          }
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.7fr", gap: 16, alignItems: "start" }}>
        {/* Limite */}
        <div className="card card-pad rise">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div className="kicker" style={{ marginBottom: 4 }}>
                {card.bank} · {card.product}
              </div>
              <h3 style={{ fontSize: 19, marginBottom: 18 }}>Limite do cartão</h3>
            </div>
            <CreditCardFormDialog
              card={card}
              trigger={
                <button
                  type="button"
                  className="icon-btn btn-sm"
                  style={{ width: 36, height: 36 }}
                  title="Editar cartão"
                >
                  <Icon name="pencil" size={16} />
                </button>
              }
            />
          </div>
          <div className="cc-detail-meter">
            <div className="row" style={{ justifyContent: "space-between", fontSize: 13.5 }}>
              <span style={{ color: "var(--text-lo)" }}>Utilizado</span>
              <span className="tnum" style={{ color: "var(--text-hi)", fontWeight: 700 }}>
                {formatBRLAbsolute(used)}
              </span>
            </div>
            <div className={`meter ${meterCls}`}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <div
              className="row"
              style={{ justifyContent: "space-between", fontSize: 12.5, color: "var(--text-lo)" }}
            >
              <span>{pct}% do limite</span>
              <span>Disponível {formatBRLAbsolute(avail)}</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 22 }}>
            <div className="summary-box" style={{ margin: 0, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "var(--text-lo)" }}>Limite total</div>
              <div
                className="tnum"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: 20,
                  color: "var(--text-hi)",
                  marginTop: 3,
                }}
              >
                {formatBRLAbsolute(card.limitCents)}
              </div>
            </div>
            <div className="summary-box" style={{ margin: 0, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "var(--text-lo)" }}>Disponível</div>
              <div
                className="tnum"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: 20,
                  color: "var(--mint-500)",
                  marginTop: 3,
                }}
              >
                {formatBRLAbsolute(avail)}
              </div>
            </div>
          </div>
          <hr className="divider" style={{ margin: "20px 0" }} />
          <div className="lrow" style={{ borderBottom: 0, padding: "6px 0" }}>
            <span className="l-ic" style={{ background: "var(--amber-soft)", color: "var(--amber-500)" }}>
              <Icon name="calendar-clock" size={18} />
            </span>
            <div className="l-main">
              <div className="l-title">Fatura atual</div>
              <div className="l-sub">
                Fecha dia {card.closingDay} · vence dia {card.dueDay}
              </div>
            </div>
            <div className="l-amt">
              <Money cents={used} withSign={false} />
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 16 }}
            onClick={() =>
              toast(`Pagamento de ${formatBRLAbsolute(used)} agendado para o dia ${card.dueDay}`)
            }
          >
            <Icon name="check-circle" size={17} />
            Pagar fatura
          </button>
        </div>

        {/* Compras + parcelamentos */}
        <div className="col gap-4">
          <div className="card">
            <div className="card-head" style={{ alignItems: "center" }}>
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <button
                  type="button"
                  className="icon-btn btn-sm"
                  style={{ width: 34, height: 34 }}
                  onClick={() => setFatKey(addMonths(fatKey, -1))}
                  title="Mês anterior"
                >
                  <Icon name="chevron-left" size={17} />
                </button>
                <div style={{ textAlign: "center", minWidth: 132 }}>
                  <h3 style={{ fontSize: 15 }}>Fatura · {monthLabel(fatKey, { long: true })}</h3>
                  <div className="ch-sub">
                    {compras.length} {compras.length === 1 ? "lançamento" : "lançamentos"} ·{" "}
                    {isFatAtual ? "aberta" : "fechada"}
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn btn-sm"
                  style={{ width: 34, height: 34 }}
                  onClick={() => setFatKey(addMonths(fatKey, 1))}
                  title="Próximo mês"
                >
                  <Icon name="chevron-right" size={17} />
                </button>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="ch-sub">Total</div>
                <div
                  className="tnum"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    fontSize: 18,
                    color: "var(--text-hi)",
                  }}
                >
                  <Money cents={faturaMes} withSign={false} />
                </div>
              </div>
            </div>
            <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 8 }}>
              {compras.length === 0 && (
                <div style={{ color: "var(--text-lo)", padding: "16px 0" }}>Nenhuma compra nesta fatura.</div>
              )}
              {compras.map((t) => {
                const cat = t.category;
                return (
                  <div className="lrow" key={t.id}>
                    <span
                      className="l-ic"
                      style={cat ? { background: `${cat.color}22`, color: cat.color } : {}}
                    >
                      <Icon name={cat ? cat.icon : "shopping-bag"} size={18} />
                    </span>
                    <div className="l-main">
                      <div className="l-title">
                        {t.description}
                        {t.parcela && (
                          <span className="parc-badge" style={{ marginLeft: 8 }}>
                            {t.parcela.number}/{t.parcela.total}
                          </span>
                        )}
                        {t.isFixed && (
                          <span
                            className="parc-badge"
                            style={{
                              marginLeft: 6,
                              background: "var(--purple-soft)",
                              color: "var(--purple-300)",
                            }}
                          >
                            <Icon name="repeat" size={11} />
                            fixo
                          </span>
                        )}
                      </div>
                      <div className="l-sub">
                        {relativeDateLabel(t.date, today)}
                        {t.note ? ` · ${t.note}` : ""}
                      </div>
                    </div>
                    <div className="l-amt neg">
                      <Money cents={t.amountCents} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <div>
                <h3>Parcelamentos ativos</h3>
              </div>
            </div>
            <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 8 }}>
              {parcelas.length === 0 && (
                <div style={{ color: "var(--text-lo)", padding: "16px 0", fontSize: 14 }}>
                  Nenhum parcelamento neste cartão.
                </div>
              )}
              {parcelas.map((p) => (
                <div className="lrow" key={`${p.desc}-${p.of}`}>
                  <span
                    className="l-ic"
                    style={{ background: "var(--purple-soft)", color: "var(--purple-300)" }}
                  >
                    <Icon name="layers" size={18} />
                  </span>
                  <div className="l-main">
                    <div className="l-title">{p.desc}</div>
                    <div className="l-sub">
                      Parcela {p.n} de {p.of} · total {formatBRLAbsolute(p.total)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="l-amt">
                      <Money cents={p.value} withSign={false} />
                      /mês
                    </div>
                    <div className="meter" style={{ width: 90, marginTop: 6 }}>
                      <span style={{ width: `${(p.n / p.of) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
