"use client";

import type { CSSProperties } from "react";
import type { PaymentsData } from "@/application/use-cases/get-payments";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { useTxUIStore } from "@/presentation/stores/tx-ui-store";
import { relativeDateLabel } from "@/shared/formatting/dates";

const IC_STYLE: CSSProperties = { background: "var(--purple-soft)", color: "var(--purple-300)" };

/** Pagamentos — settle deferred obligations (boleto/loan/financing) individually. */
export function PaymentsView({ payments, today }: { payments: PaymentsData; today: string }) {
  const openDetail = useTxUIStore((s) => s.openDetail);
  const openPay = useTxUIStore((s) => s.openPay);
  const { pending, paid, pendingTotalCents } = payments;
  const isEmpty = pending.length === 0 && paid.length === 0;

  return (
    <div className="wallets-page">
      {/* resumo */}
      <div className="card card-pad rise" style={{ marginBottom: 18 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div className="kicker" style={{ marginBottom: 6 }}>
              A vencer
            </div>
            <div className="balance-big neg" style={{ fontSize: 30 }}>
              <Money cents={-pendingTotalCents} withSign={false} />
            </div>
            <div style={{ fontSize: 13, color: "var(--text-lo)", marginTop: 2 }}>
              {pending.length === 0
                ? "Nada a pagar por aqui."
                : `${pending.length} ${pending.length === 1 ? "conta a pagar" : "contas a pagar"}`}
            </div>
          </div>
          <span className="tx-detail-ic" style={IC_STYLE}>
            <Icon name="hand-coins" size={24} />
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-lo)", marginTop: 14, display: "flex", gap: 7 }}>
          <Icon name="info" size={14} style={{ color: "var(--purple-300)", flex: "none" }} />
          Boletos, empréstimos e financiamentos. Ao pagar, o valor sai da conta escolhida na data do pagamento
          — o vencimento e o valor original ficam registrados. Faturas de cartão são pagas na seção Cartões.
        </div>
      </div>

      {isEmpty && (
        <div className="coming">
          <div className="ci">
            <Icon name="hand-coins" size={32} />
          </div>
          <h3>Nenhuma conta a pagar</h3>
          <p>Boletos, empréstimos e financiamentos aparecem aqui para você pagar e acompanhar.</p>
        </div>
      )}

      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-pad" style={{ paddingTop: 14, paddingBottom: 8 }}>
            <div className="kicker" style={{ marginBottom: 6 }}>
              A vencer
            </div>
            {pending.map((t) => (
              <PendingRow key={t.id} tx={t} today={today} onOpen={openDetail} onPay={openPay} />
            ))}
          </div>
        </div>
      )}

      {paid.length > 0 && (
        <div className="card">
          <div className="card-pad" style={{ paddingTop: 14, paddingBottom: 8 }}>
            <div className="kicker" style={{ marginBottom: 6 }}>
              Pagos
            </div>
            {paid.map((t) => (
              <PaidRow key={t.id} tx={t} today={today} onOpen={openDetail} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const rowIcStyle = (tx: TransactionListItem): CSSProperties =>
  tx.category
    ? { background: `${tx.category.color}22`, color: tx.category.color }
    : { background: "var(--rose-soft)", color: "var(--rose-500)" };

function PendingRow({
  tx,
  today,
  onOpen,
  onPay,
}: {
  tx: TransactionListItem;
  today: string;
  onOpen: (t: TransactionListItem) => void;
  onPay: (t: TransactionListItem) => void;
}) {
  const overdue = tx.date < today;
  // The row's text is the open-detail control (a div role=button — it holds block children, so it
  // can't be a native <button>, mirroring tx-row.tsx). "Pagar" is a sibling control, never nested.
  const open = () => onOpen(tx);
  return (
    <div className="lrow">
      <span className="l-ic" style={rowIcStyle(tx)}>
        <Icon name={tx.category?.icon ?? "receipt"} size={18} />
      </span>
      <div
        role="button"
        tabIndex={0}
        className="l-main"
        style={{ cursor: "pointer" }}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
      >
        <div className="l-title tx-title">
          <span className="lt-text">{tx.description || "Lançamento"}</span>
          {overdue && (
            <span className="parc-badge" style={{ background: "var(--rose-soft)", color: "var(--rose-500)" }}>
              atrasado
            </span>
          )}
        </div>
        <div className="l-sub">
          {`${overdue ? "venceu" : "vence"} ${relativeDateLabel(tx.date, today)}`}
          {tx.sourceLabel ? ` · ${tx.sourceLabel}` : ""}
        </div>
      </div>
      <div className="row gap-2" style={{ alignItems: "center", flex: "none" }}>
        <div className="l-amt neg">
          <Money cents={tx.amountCents} />
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onPay(tx)}>
          <Icon name="wallet" size={14} />
          Pagar
        </button>
      </div>
    </div>
  );
}

function PaidRow({
  tx,
  today,
  onOpen,
}: {
  tx: TransactionListItem;
  today: string;
  onOpen: (t: TransactionListItem) => void;
}) {
  const open = () => onOpen(tx);
  return (
    <div
      role="button"
      tabIndex={0}
      className="lrow"
      style={{ cursor: "pointer" }}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <span className="l-ic" style={{ background: "var(--mint-soft)", color: "var(--mint-500)" }}>
        <Icon name="check" size={18} />
      </span>
      <div className="l-main">
        <div className="l-title tx-title">
          <span className="lt-text">{tx.description || "Lançamento"}</span>
        </div>
        <div className="l-sub">
          {`pago ${relativeDateLabel(tx.paidAt ?? today, today)}`}
          {tx.paidAccountLabel ? ` · ${tx.paidAccountLabel}` : ""}
        </div>
      </div>
      <div className="l-amt" style={{ color: "var(--text-mid)", flex: "none" }}>
        <Money cents={-(tx.paidAmountCents ?? Math.abs(tx.amountCents))} withSign={false} />
      </div>
    </div>
  );
}
