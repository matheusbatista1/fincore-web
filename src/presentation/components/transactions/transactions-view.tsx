"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import { deleteTransactionAction } from "@/app/_actions/finance";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { byDateDesc } from "@/application/use-cases/get-transactions";
import { SwipeRow } from "@/presentation/components/gestures/swipe-row";
import { Avatar } from "@/presentation/components/ui/avatar";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { useIsMobile } from "@/presentation/lib/use-is-mobile";
import { openTxDetail, useTxUIStore } from "@/presentation/stores/tx-ui-store";
import { toast as fireToast, useUIStore } from "@/presentation/stores/ui-store";
import { relativeDateLabel } from "@/shared/formatting/dates";

type Filter = "all" | "out" | "in" | "xfer";

const FILTERS: ReadonlyArray<[Filter, string]> = [
  ["all", "Todas"],
  ["out", "Despesas"],
  ["in", "Receitas"],
  ["xfer", "Transferências"],
];

async function removeDirect(item: TransactionListItem) {
  const result = await deleteTransactionAction({ id: item.id, scope: "one" });
  if (!result.ok) {
    fireToast(result.error, "error");
    return;
  }
  const reverted = item.shares.length > 0 || item.kind === "income";
  fireToast(`Transação excluída${reverted ? " · saldos revertidos" : ""}`);
}

/** Transações — ported 1:1 from the prototype (more.jsx TransactionsScreen): desktop table + mobile swipe list. */
export function TransactionsView({
  transactions,
  today,
}: {
  transactions: TransactionListItem[];
  today: string;
}) {
  const toast = useUIStore((s) => s.toast);
  const openEdit = useTxUIStore((s) => s.openEdit);
  const openDelete = useTxUIStore((s) => s.openDelete);
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<Filter>("all");
  const rows = transactions
    .filter((t) =>
      filter === "all"
        ? true
        : filter === "xfer"
          ? t.kind === "transfer"
          : filter === "in"
            ? t.kind === "income"
            : t.kind === "expense",
    )
    .sort(byDateDesc);

  const filtersHead = (
    <div className="card-head">
      <div className="row gap-2" style={{ flexWrap: "wrap" }}>
        {FILTERS.map(([k, l]) => (
          <button
            type="button"
            key={k}
            className={`person-chip${filter === k ? " on" : ""}`}
            onClick={() => setFilter(k)}
          >
            {l}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => toast(`Exportando ${rows.length} transações para CSV…`)}
      >
        <Icon name="download" size={16} />
        Exportar
      </button>
    </div>
  );

  // ---- mobile: swipe-to-action list (more.jsx:23-46) ----
  if (isMobile) {
    return (
      <div className="card">
        {filtersHead}
        <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 8 }}>
          {rows.map((t) => {
            const isTransfer = t.kind === "transfer";
            const cat = t.category;
            const icStyle: CSSProperties = isTransfer
              ? { background: "var(--sky-soft)", color: "var(--sky-500)" }
              : cat
                ? { background: `${cat.color}22`, color: cat.color }
                : { background: "var(--mint-soft)", color: "var(--mint-500)" };
            return (
              <SwipeRow
                key={t.id}
                onOpen={() => openTxDetail(t)}
                onEdit={isTransfer ? null : () => openEdit(t)}
                onDelete={() => (t.parcela ? openDelete(t) : void removeDirect(t))}
              >
                <div className="lrow" style={{ background: "var(--surface-1)" }}>
                  <span className="l-ic" style={icStyle}>
                    <Icon
                      name={isTransfer ? "arrow-left-right" : cat ? cat.icon : "arrow-down-left"}
                      size={18}
                    />
                  </span>
                  <div className="l-main">
                    <div className="l-title">
                      {t.description || (isTransfer ? "Transferência" : "Lançamento")}
                    </div>
                    <div className="l-sub">
                      {relativeDateLabel(t.date, today)}
                      {t.note ? ` · ${t.note}` : cat ? ` · ${cat.name}` : ""}
                    </div>
                  </div>
                  {isTransfer ? (
                    <div className="l-amt" style={{ color: "var(--sky-500)" }}>
                      <Money cents={t.transferValueCents ?? 0} withSign={false} />
                    </div>
                  ) : (
                    <div className={`l-amt ${t.amountCents < 0 ? "neg" : "pos"}`}>
                      <Money cents={t.amountCents} />
                    </div>
                  )}
                </div>
              </SwipeRow>
            );
          })}
          {rows.length === 0 && (
            <div style={{ color: "var(--text-lo)", padding: "20px 0", textAlign: "center" }}>
              Nenhuma transação.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {filtersHead}
      <div style={{ padding: "8px 12px 12px" }}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Origem</th>
                <th>Pessoas</th>
                <th>Data</th>
                <th className="r">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const isTransfer = t.kind === "transfer";
                const cat = t.category;
                const avaStyle = isTransfer
                  ? { background: "var(--sky-soft)", color: "var(--sky-500)" }
                  : cat
                    ? { background: `${cat.color}22`, color: cat.color }
                    : { background: "var(--mint-soft)", color: "var(--mint-500)" };
                const iconName = isTransfer ? "arrow-left-right" : cat ? cat.icon : "arrow-down-left";
                const origem = isTransfer
                  ? t.transferFromName && t.transferToName
                    ? `${t.transferFromName} → ${t.transferToName}`
                    : (t.note ?? "—")
                  : (t.sourceLabel ?? "—");
                return (
                  <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => openTxDetail(t)}>
                    <td>
                      <div className="row gap-3">
                        <span className="tx-ava" style={avaStyle}>
                          <Icon name={iconName} size={16} />
                        </span>
                        <span className="t-strong">{t.description}</span>
                      </div>
                    </td>
                    <td>
                      {isTransfer ? (
                        <span className="pill sky">Transferência</span>
                      ) : cat ? (
                        <span className="pill neutral">{cat.name}</span>
                      ) : (
                        <span className="pill mint">Receita</span>
                      )}
                    </td>
                    <td>{origem}</td>
                    <td>
                      {t.shares.length ? (
                        <div className="row">
                          {t.shares.slice(0, 3).map((p, i) => (
                            <span key={p.personId} style={{ marginLeft: i ? -7 : 0 }}>
                              <Avatar name={p.name} color={p.color} size={26} />
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: "var(--text-faint)" }}>—</span>
                      )}
                    </td>
                    <td style={{ color: "var(--text-lo)" }}>{relativeDateLabel(t.date, today)}</td>
                    <td className="r">
                      {isTransfer ? (
                        <span className="tnum" style={{ color: "var(--sky-500)", fontWeight: 700 }}>
                          <Money cents={t.transferValueCents ?? 0} withSign={false} />
                        </span>
                      ) : (
                        <span
                          className="tnum t-strong"
                          style={{ color: t.amountCents < 0 ? "var(--rose-500)" : "var(--mint-500)" }}
                        >
                          <Money cents={t.amountCents} />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--text-lo)", padding: "24px 0", textAlign: "center" }}>
                    Nenhuma transação.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
