"use client";

import { useMemo, useState } from "react";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import type { CardView } from "@/application/use-cases/get-workspace-view";
import type { CardBillDate } from "@/domain/entities/card-bill-date";
import { cardBillMonth, cardBillOverridesByCard } from "@/domain/services/card-bill.calculator";
import { addMonths } from "@/domain/value-objects/competence-month";
import { CardBillDatesDialog } from "@/presentation/components/cards/card-bill-dates-dialog";
import { CreditCardFormDialog } from "@/presentation/components/forms/credit-card-form-dialog";
import { AnimatedMoney } from "@/presentation/components/ui/animated-money";
import { CreditCardWidget } from "@/presentation/components/ui/credit-card-widget";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { openTxDetail } from "@/presentation/stores/tx-ui-store";
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
  cardBillDates,
  today,
  currentMonth,
  holderName,
}: {
  cards: CardView[];
  transactions: TransactionListItem[];
  cardBillDates: CardBillDate[];
  today: string;
  currentMonth: string;
  holderName: string;
}) {
  const toast = useUIStore((s) => s.toast);
  const [sel, setSel] = useState<string | undefined>(cards[0]?.id);
  const card = cards.find((c) => c.id === sel) ?? cards[0];
  // Per-bill closing/due overrides for the selected card (month → days).
  const overridesByCard = useMemo(() => cardBillOverridesByCard(cardBillDates), [cardBillDates]);
  const overrides = card ? overridesByCard.get(card.id) : undefined;
  // Navigate whole bills relative to the selected card's currently-open one, so a
  // charge lands in the cycle decided by the card's closing/due days, not its date's month.
  const [offset, setOffset] = useState(0);
  const currentBillMonth = card
    ? cardBillMonth(today, card.closingDay, card.dueDay, overrides)
    : currentMonth;
  const fatKey = addMonths(currentBillMonth, offset);

  const compras = useMemo(
    () =>
      card
        ? transactions.filter(
            (t) =>
              t.cardId === card.id &&
              // Card charges (expense, amount < 0) plus card credits (estorno income, amount > 0).
              (t.kind === "income" || t.amountCents < 0) &&
              (t.billMonthOverride ?? cardBillMonth(t.date, card.closingDay, card.dueDay, overrides)) ===
                fatKey,
          )
        : [],
    [transactions, fatKey, card, overrides],
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

  // Portfolio totals across every card (shown as a strip when there's more than one).
  const totals = useMemo(() => {
    const limit = cards.reduce((s, c) => s + c.limitCents, 0);
    const usedAll = cards.reduce((s, c) => s + c.billCents, 0);
    const pctAll = limit > 0 ? Math.round((usedAll / limit) * 100) : 0;
    return { limit, used: usedAll, available: limit - usedAll, pct: pctAll };
  }, [cards]);

  if (!card) {
    return (
      <div className="coming">
        <div className="ci">
          <Icon name="credit-card" size={32} />
        </div>
        <h3>Nenhum cartão</h3>
        <p>Adicione seu primeiro cartão para acompanhar faturas e limites.</p>
        <CreditCardFormDialog
          holder={holderName}
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
  // Net bill: charges (amount < 0) minus credits (amount > 0) → −Σ amount.
  const faturaMes = compras.reduce((s, t) => s - t.amountCents, 0);
  // Effective closing/due day for the bill being viewed (override for this month or the card default).
  const billOverride = overrides?.get(fatKey);
  const effClosingDay = billOverride?.closingDay ?? card.closingDay;
  const effDueDay = billOverride?.dueDay ?? card.dueDay;

  return (
    <div className="cards-page">
      {cards.length > 1 && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div
            className="row"
            style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}
          >
            <h3 style={{ fontSize: 15 }}>Todos os cartões</h3>
            <span style={{ fontSize: 13, color: "var(--text-lo)" }}>{totals.pct}% do limite total usado</span>
          </div>
          <div
            className={`meter ${totals.pct > 85 ? "danger" : totals.pct > 65 ? "warn" : ""}`}
            style={{ marginTop: 12 }}
          >
            <span style={{ width: `${Math.max(0, Math.min(100, totals.pct))}%` }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 16 }}>
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
                <AnimatedMoney cents={totals.limit} withSign={false} />
              </div>
            </div>
            <div className="summary-box" style={{ margin: 0, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "var(--text-lo)" }}>Utilizado</div>
              <div
                className="tnum"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: 20,
                  color: "var(--rose-500)",
                  marginTop: 3,
                }}
              >
                <AnimatedMoney cents={totals.used} withSign={false} />
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
                <AnimatedMoney cents={totals.available} withSign={false} />
              </div>
            </div>
          </div>
        </div>
      )}
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
              holder={holderName}
            />
          </button>
        ))}
        <CreditCardFormDialog
          holder={holderName}
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
        {/* Esquerda: limite do cartão + parcelamentos ativos */}
        <div className="col gap-4">
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
                holder={holderName}
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
                  <AnimatedMoney cents={used} withSign={false} />
                </span>
              </div>
              <div className={`meter ${meterCls}`}>
                <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
              </div>
              <div
                className="row"
                style={{ justifyContent: "space-between", fontSize: 12.5, color: "var(--text-lo)" }}
              >
                <span>{pct}% do limite</span>
                <span>
                  Disponível <AnimatedMoney cents={avail} withSign={false} />
                </span>
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
                  <AnimatedMoney cents={card.limitCents} withSign={false} />
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
                  <AnimatedMoney cents={avail} withSign={false} />
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
                <AnimatedMoney cents={used} withSign={false} />
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

        {/* Direita: fatura do mês */}
        <div className="col gap-4">
          <div className="card">
            <div className="card-head" style={{ alignItems: "center" }}>
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <button
                  type="button"
                  className="icon-btn btn-sm"
                  style={{ width: 34, height: 34 }}
                  onClick={() => setOffset((o) => o - 1)}
                  title="Fatura anterior"
                >
                  <Icon name="chevron-left" size={17} />
                </button>
                <div style={{ textAlign: "center", minWidth: 132 }}>
                  <h3 style={{ fontSize: 15 }}>Fatura · {monthLabel(fatKey, { long: false })}</h3>
                  <div className="ch-sub">
                    Fecha dia {effClosingDay} · vence dia {effDueDay}
                    {billOverride ? " · ajustado" : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn btn-sm"
                  style={{ width: 34, height: 34 }}
                  onClick={() => setOffset((o) => o + 1)}
                  title="Próxima fatura"
                >
                  <Icon name="chevron-right" size={17} />
                </button>
              </div>
              <div className="row gap-3" style={{ alignItems: "center" }}>
                <CardBillDatesDialog
                  cardId={card.id}
                  month={fatKey}
                  monthLabel={monthLabel(fatKey, { long: false })}
                  closingDay={effClosingDay}
                  dueDay={effDueDay}
                  hasOverride={billOverride !== undefined}
                />
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
                    <AnimatedMoney cents={faturaMes} withSign={false} />
                  </div>
                </div>
              </div>
            </div>
            <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 8 }}>
              {compras.length === 0 && (
                <div style={{ color: "var(--text-lo)", padding: "16px 0" }}>Nenhuma compra nesta fatura.</div>
              )}
              {compras.map((t) => {
                const cat = t.category;
                const isCredit = t.kind === "income";
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    className="lrow"
                    key={t.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => openTxDetail(t)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openTxDetail(t);
                      }
                    }}
                  >
                    <span
                      className="l-ic"
                      style={
                        isCredit
                          ? { background: "var(--mint-soft)", color: "var(--mint-500)" }
                          : cat
                            ? { background: `${cat.color}22`, color: cat.color }
                            : {}
                      }
                    >
                      <Icon name={isCredit ? "arrow-down-left" : cat ? cat.icon : "shopping-bag"} size={18} />
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
                    <div className={`l-amt ${isCredit ? "pos" : "neg"}`}>
                      <Money cents={t.amountCents} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
