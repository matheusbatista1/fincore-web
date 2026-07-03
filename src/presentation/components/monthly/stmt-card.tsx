"use client";

import { type CSSProperties, type KeyboardEvent, useState } from "react";
import type { MonthlyItem } from "@/application/use-cases/get-monthly";
import type { CardBillPayment } from "@/domain/entities/card-bill-payment";
import type { PayFaturaAccount, PayFaturaTarget } from "@/presentation/components/cards/pay-fatura-modal";
import { Dialog, DialogClose, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { openPayObligation, openTxDetail } from "@/presentation/stores/tx-ui-store";
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
  /** The full (general-lens) fatura total for a card group, independent of the lens recompute —
   * so "Pagar fatura" always offers the whole bill even under "Apenas meu". */
  readonly faturaCents?: number;
}

function StmtRow({
  item,
  today,
  showPay = false,
}: {
  item: MonthlyItem;
  today: string;
  /** In the group modal, render a "Pagar" action for a real, unpaid deferred obligation. */
  showPay?: boolean;
}) {
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

  // A projected ("previsto") row opens its real anchor so the rule can be edited/deleted.
  const target = item.anchor ?? item;
  // In the compromissos modal a real, unpaid deferred obligation (boleto/loan/financing) is
  // settled straight from the row tap (its primary action there); everything else opens detail.
  // The row is the single interactive control — no nested button (keeps it accessible). The
  // detail/pay modal opens STACKED on top of the group modal (which stays open), so there is no
  // simultaneous close+open of two Radix dialogs (no focus-trap race); closing it returns here.
  const canPay = showPay && item.isPayable && !item.isPaid && !item.projected;
  const open = () => {
    if (canPay) openPayObligation(target);
    else openTxDetail(target);
  };

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
      {canPay && (
        <span
          className="parc-badge"
          style={{ marginRight: 8, background: "var(--purple-soft)", color: "var(--purple-300)" }}
        >
          <Icon name="hand-coins" size={11} />
          Pagar
        </span>
      )}
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
  const subtitle =
    receivables.length > 0
      ? `${group.items.length > 0 ? `${group.items.length} ${group.items.length === 1 ? "entrada" : "entradas"} · ` : ""}${receivables.length} a receber`
      : (group.countText ?? `${group.sub ? `${group.sub} · ` : ""}${itemsText}`);

  // Credit-card group: is this month's fatura already paid? (matched by card + competence).
  const isCard = group.cardId != null;
  const faturaPayment = isCard
    ? (cardBillPayments.find((p) => p.cardId === group.cardId && p.competence === month) ?? null)
    : null;
  const isCompromissos = group.key === "compromissos";
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
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: "100%", justifyContent: "center", marginBottom: 16 }}
                    onClick={payFatura}
                  >
                    <Icon name="hand-coins" size={16} />
                    Pagar fatura · {formatBRLAbsolute(faturaCents)}
                  </button>
                ))}

              {group.items.map((item) => (
                <StmtRow key={item.id} item={item} today={today} showPay={isCompromissos} />
              ))}
              {receivables.map((r) => (
                <div className="lrow" key={`recv-${r.id}`}>
                  <span className="l-ic" style={{ background: "var(--mint-soft)", color: "var(--mint-500)" }}>
                    <Icon name="users" size={18} />
                  </span>
                  <div className="l-main">
                    <div className="l-title">{r.name}</div>
                    <div className="l-sub">A receber no mês</div>
                  </div>
                  <div className="l-amt pos">
                    <Money cents={r.amountCents} withSign={false} />
                  </div>
                </div>
              ))}
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
