"use client";

import { type CSSProperties, type KeyboardEvent, useState } from "react";
import type { MonthlyItem } from "@/application/use-cases/get-monthly";
import type { CardBillPayment } from "@/domain/entities/card-bill-payment";
import type { PayFaturaAccount, PayFaturaTarget } from "@/presentation/components/cards/pay-fatura-modal";
import { Dialog, DialogClose, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { PeopleStack } from "@/presentation/components/ui/people-stack";
import { openSettlePerson, openTxDetail } from "@/presentation/stores/tx-ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { relativeDateLabel } from "@/shared/formatting/dates";

/** A person's "a receber" for the month, shown inside the income group (general lens only). */
export interface ReceivableRow {
  readonly id: string;
  readonly name: string;
  readonly amountCents: number;
}

export interface StmtGroup {
  readonly key: string;
  readonly name: string;
  readonly sub?: string;
  /** Overrides the default "{sub} · {n} lançamentos" subtitle entirely. */
  readonly countText?: string;
  readonly accent: string;
  readonly icon: string;
  readonly items: MonthlyItem[];
  readonly totalCents: number;
  /** Which money bucket this group is — drives the personal-lens recompute. */
  readonly lens?: "income" | "expense" | "transfer";
  /** People who owe you this month — appended to the income card under the general lens.
   * Not part of `totalCents` (which stays transaction-only for the export); the card adds them. */
  readonly receivables?: readonly ReceivableRow[] | undefined;
  /** Set for a credit-card group — enables the "Pagar fatura" / "Fatura paga" affordance. */
  readonly cardId?: string;
  /** Projected ("previsto") slice inside `totalCents` — called out so the tile never reads as a
   * closed figure while forecasts are still part of it. */
  readonly projectedCents?: number;
  /** The full (general-lens) fatura total for a card group, independent of the lens recompute —
   * so "Pagar fatura" always offers the whole bill even under "Apenas meu". */
  readonly faturaCents?: number;
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

  // Every row opens the detail modal — which offers Pagar (with a custom amount), Editar and
  // Excluir — so any obligation is editable and payable directly (not only after it's paid).
  // A projected ("previsto") row opens ITSELF (a `proj:` id → read-only detail) and carries its
  // rule's anchor: opening the anchor instead would let Pagar/Desfazer settle the anchor's OWN
  // month (paying August's projected aluguel would rewrite July's payment).
  const open = () => openTxDetail(item, item.anchor ?? undefined);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className="lrow"
      style={{ cursor: "pointer" }}
    >
      <span className="l-ic" style={icStyle}>
        <Icon name={iconName} size={18} />
      </span>
      <div className="l-main">
        <div className="l-title">
          {item.description || (isTransfer ? "Transferência" : "Lançamento")}
          {item.isPaid && (
            <span
              className="parc-badge"
              style={{ marginLeft: 8, background: "var(--mint-soft)", color: "var(--mint-500)" }}
            >
              <Icon name="check" size={11} />
              pago
            </span>
          )}
          {item.isFixed && (
            <span
              className="parc-badge"
              style={{ marginLeft: 8, background: "var(--purple-soft)", color: "var(--purple-300)" }}
            >
              <Icon name="repeat" size={11} />
              fixo
            </span>
          )}
          {item.source === "overdraft" && (
            // Overdraft debits its account the moment it happens — there is nothing to "pay"
            // later, unlike the boletos/parcelas sharing this group. The badge says why.
            <span
              className="parc-badge"
              style={{ marginLeft: 8, background: "var(--amber-soft)", color: "var(--amber-500)" }}
              title="Cheque especial: o valor já saiu direto da conta — não há nada a pagar."
            >
              <Icon name="landmark" size={11} />
              cheque especial
            </span>
          )}
          {item.projected && (
            <span className="parc-badge futura" style={{ marginLeft: 6 }}>
              previsto
            </span>
          )}
          {item.isReceivable && !item.isReceived && !item.projected && (
            <span
              className="parc-badge"
              style={{ marginLeft: 6, background: "var(--purple-soft)", color: "var(--purple-300)" }}
            >
              a receber
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
      <PeopleStack item={item} />
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

/**
 * Statement card grouped by origin. The card shows a compact, clickable summary (name, subtitle,
 * total); tapping it opens a modal listing the rows — so a long month no longer renders as one
 * giant inline list. A credit-card group surfaces its fatura state: "Pagar fatura" at the top of
 * the modal, or a "Fatura paga" badge once settled.
 */
export function StmtCard({
  group,
  today,
  month,
  competenceLabel,
  accounts,
  cardBillPayments,
  onOpenPayFatura,
}: {
  group: StmtGroup;
  today: string;
  /** The browsed competence month (`YYYY-MM`) — the card group's fatura competence. */
  month: string;
  /** Human label of the month (for the pay-fatura modal). */
  competenceLabel: string;
  accounts: readonly PayFaturaAccount[];
  cardBillPayments: readonly CardBillPayment[];
  onOpenPayFatura: (target: PayFaturaTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const receivables = group.receivables ?? [];
  const recvTotal = receivables.reduce((s, r) => s + r.amountCents, 0);
  // The receivables are shown but not in `totalCents` (kept transaction-only for the export),
  // so the card header adds them back to match the on-screen "Entradas" total.
  const displayTotal = group.totalCents + recvTotal;
  const itemsText = `${group.items.length} ${group.items.length === 1 ? "lançamento" : "lançamentos"}`;
  // A card tile's total anticipates the previstos still to charge — the subtitle owns up to it,
  // so the figure never reads as a closed fatura while forecasts are part of it.
  const projectedNote =
    (group.projectedCents ?? 0) > 0
      ? ` · inclui ${formatBRLAbsolute(group.projectedCents ?? 0)} previstos`
      : "";
  const subtitle =
    receivables.length > 0
      ? `${group.items.length > 0 ? `${group.items.length} ${group.items.length === 1 ? "entrada" : "entradas"} · ` : ""}${receivables.length} a receber`
      : `${group.countText ?? `${group.sub ? `${group.sub} · ` : ""}${itemsText}`}${projectedNote}`;

  // Credit-card group: is this month's fatura already paid? (matched by card + competence).
  const isCard = group.cardId != null;
  const faturaPayment = isCard
    ? (cardBillPayments.find((p) => p.cardId === group.cardId && p.competence === month) ?? null)
    : null;
  const faturaCents = group.faturaCents ?? group.totalCents;
  const payFatura = () => {
    if (group.cardId == null) return;
    // Open the pay-fatura modal STACKED on top of this group modal (don't close it here) — avoids
    // two Radix dialogs transitioning at once; closing the pay modal returns to the fatura list.
    onOpenPayFatura({
      cardId: group.cardId,
      competence: month,
      competenceLabel,
      amountCents: faturaCents,
    });
  };

  const openModal = () => setOpen(true);

  return (
    <div className="card stmt">
      <div
        role="button"
        tabIndex={0}
        onClick={openModal}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openModal();
          }
        }}
        className="stmt-head"
        style={{ ["--accent" as string]: group.accent, cursor: "pointer" } as CSSProperties}
      >
        <span className="sh-ic" style={{ background: `${group.accent}22`, color: group.accent }}>
          <Icon name={group.icon} size={18} />
        </span>
        <div className="sh-main">
          <b>
            {group.name}
            {faturaPayment && (
              <span
                className="parc-badge"
                style={{ marginLeft: 8, background: "var(--mint-soft)", color: "var(--mint-500)" }}
              >
                <Icon name="check" size={11} />
                Fatura paga
              </span>
            )}
          </b>
          <small>{subtitle}</small>
        </div>
        <span className="sh-tot" style={group.key === "income" ? { color: group.accent } : undefined}>
          <Money cents={displayTotal} withSign={false} />
        </span>
        <Icon name="chevron-right" size={18} style={{ color: "var(--text-lo)", flex: "none" }} />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogModal title={group.name} maxWidth={520}>
            <div className="modal-body">
              {isCard &&
                (faturaPayment ? (
                  <div
                    className="summary-box"
                    style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <span className="kpi-ic mint" style={{ width: 38, height: 38, flex: "none" }}>
                      <Icon name="check-circle" size={18} />
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: "var(--text-hi)" }}>
                        Fatura paga · {formatBRLAbsolute(faturaPayment.amountCents)}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--text-lo)" }}>
                        {relativeDateLabel(faturaPayment.date, today)}
                        {(() => {
                          const acc = accounts.find((a) => a.id === faturaPayment.accountId);
                          return acc ? ` · ${acc.bank} · ${acc.name}` : "";
                        })()}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginBottom: 16 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ width: "100%", justifyContent: "center" }}
                      onClick={payFatura}
                    >
                      <Icon name="hand-coins" size={16} />
                      Pagar fatura · {formatBRLAbsolute(faturaCents)}
                    </button>
                    {(group.projectedCents ?? 0) > 0 && (
                      // The payable amount is the booked part; this explains why it is smaller
                      // than the tile's total while previstos are still to charge.
                      <div
                        style={{ fontSize: 12, color: "var(--text-lo)", textAlign: "center", marginTop: 8 }}
                      >
                        + {formatBRLAbsolute(group.projectedCents ?? 0)} previstos ainda vão cair nesta fatura
                      </div>
                    )}
                  </div>
                ))}

              {group.items.map((item) => (
                <StmtRow key={item.id} item={item} today={today} />
              ))}
              {receivables.map((r) => {
                // Tapping a receivable opens the Acerto modal to register the person's payment (custom
                // amount + which account it landed in) — the same flow as the People profile.
                const settle = () =>
                  openSettlePerson({
                    id: r.id,
                    name: r.name,
                    prefillCents: r.amountCents,
                    capCents: r.amountCents,
                  });
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={settle}
                    onKeyDown={(e: KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        settle();
                      }
                    }}
                    className="lrow"
                    style={{ cursor: "pointer" }}
                    key={`recv-${r.id}`}
                  >
                    <span
                      className="l-ic"
                      style={{ background: "var(--mint-soft)", color: "var(--mint-500)" }}
                    >
                      <Icon name="users" size={18} />
                    </span>
                    <div className="l-main">
                      <div className="l-title">{r.name}</div>
                      <div className="l-sub">A receber no mês · toque para receber</div>
                    </div>
                    <div className="l-amt pos">
                      <Money cents={r.amountCents} withSign={false} />
                    </div>
                    <Icon name="chevron-right" size={18} style={{ color: "var(--text-lo)", flex: "none" }} />
                  </div>
                );
              })}
              {group.items.length === 0 && receivables.length === 0 && (
                <div style={{ color: "var(--text-lo)", fontSize: 14, padding: "8px 0" }}>
                  Nenhum lançamento neste grupo.
                </div>
              )}
            </div>
            <div className="modal-foot" style={{ justifyContent: "flex-end" }}>
              <DialogClose asChild>
                <button type="button" className="btn btn-ghost">
                  Fechar
                </button>
              </DialogClose>
            </div>
          </DialogModal>
        )}
      </Dialog>
    </div>
  );
}
