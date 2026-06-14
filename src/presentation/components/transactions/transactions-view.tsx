"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useState } from "react";
import { deleteTransactionAction } from "@/app/_actions/finance";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { byDateDesc } from "@/application/use-cases/get-transactions";
import { SwipeRow } from "@/presentation/components/gestures/swipe-row";
import { Avatar } from "@/presentation/components/ui/avatar";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { csvMoney, exportCSV } from "@/presentation/lib/export";
import { collapseRowsByInstallments } from "@/presentation/lib/group-installments";
import { useIsMobile } from "@/presentation/lib/use-is-mobile";
import { openInstallmentGroup, openTxDetail, useTxUIStore } from "@/presentation/stores/tx-ui-store";
import { toast as fireToast, useUIStore } from "@/presentation/stores/ui-store";
import { relativeDateLabel } from "@/shared/formatting/dates";

type Filter = "all" | "out" | "in" | "xfer";

/** How many rows to reveal per "Ver mais" step (the list loads fully, paginates in the UI). */
const PAGE_SIZE = 30;

const FILTERS: ReadonlyArray<[Filter, string]> = [
  ["all", "Todas"],
  ["out", "Despesas"],
  ["in", "Receitas"],
  ["xfer", "Transferências"],
];

const KIND_LABEL: Record<TransactionListItem["kind"], string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
};

/** `2026-07-02` → `02/07/2026`. */
function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

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
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
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
  // Collapse installment parcelas into one row per group (the modal lists them all).
  const collapsed = collapseRowsByInstallments(rows);
  const shown = collapsed.slice(0, visibleCount);
  const hasMore = collapsed.length > visibleCount;

  function pickFilter(next: Filter) {
    setFilter(next);
    setVisibleCount(PAGE_SIZE); // reset the window whenever the filter changes
  }

  // A collapsed installment row opens the group modal; anything else opens the detail.
  const openRow = (t: TransactionListItem) =>
    t.installmentGroupId && t.parcela ? openInstallmentGroup(t.installmentGroupId) : openTxDetail(t);

  const moreFooter = hasMore ? (
    <div
      className="row"
      style={{
        justifyContent: "center",
        alignItems: "center",
        gap: 12,
        padding: "14px 0 6px",
        flexWrap: "wrap",
      }}
    >
      <span style={{ color: "var(--text-lo)", fontSize: 13 }}>
        Mostrando {shown.length} de {collapsed.length}
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
      >
        <Icon name="chevron-down" size={16} />
        Ver mais ({collapsed.length - shown.length} restantes)
      </button>
    </div>
  ) : null;

  function onExport() {
    const csvRows = rows.map((t) => [
      brDate(t.date),
      t.description || KIND_LABEL[t.kind],
      t.category?.name ?? "",
      t.kind === "transfer"
        ? `${t.transferFromName ?? ""} -> ${t.transferToName ?? ""}`
        : (t.sourceLabel ?? ""),
      t.shares.map((s) => s.name).join(", "),
      KIND_LABEL[t.kind],
      t.parcela ? `${t.parcela.number}/${t.parcela.total}` : "",
      csvMoney(t.kind === "transfer" ? (t.transferValueCents ?? 0) : t.amountCents),
    ]);
    exportCSV(
      `transacoes-${filter}-${today}.csv`,
      ["Data", "Descrição", "Categoria", "Origem", "Pessoas", "Tipo", "Parcela", "Valor (R$)"],
      csvRows,
    );
    toast(`${rows.length} ${rows.length === 1 ? "transação exportada" : "transações exportadas"} em CSV`);
  }

  const filtersHead = (
    <div className="card-head">
      <div className="row gap-2" style={{ flexWrap: "wrap" }}>
        {FILTERS.map(([k, l]) => (
          <button
            type="button"
            key={k}
            className={`person-chip${filter === k ? " on" : ""}`}
            onClick={() => pickFilter(k)}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="row gap-2">
        <Link className="btn btn-ghost btn-sm" href="/import">
          <Icon name="file-up" size={16} />
          Importar
        </Link>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onExport}>
          <Icon name="download" size={16} />
          Exportar
        </button>
      </div>
    </div>
  );

  // ---- mobile: swipe-to-action list (more.jsx:23-46) ----
  if (isMobile) {
    return (
      <div className="card">
        {filtersHead}
        <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 8 }}>
          {shown.map((t) => {
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
                onOpen={() => openRow(t)}
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
                      {t.installmentGroupId && t.parcela && (
                        <span className="parc-badge" style={{ marginLeft: 8 }}>
                          {t.parcela.total}x
                        </span>
                      )}
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
          {moreFooter}
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
              {shown.map((t) => {
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
                  <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => openRow(t)}>
                    <td>
                      <div className="row gap-3">
                        <span className="tx-ava" style={avaStyle}>
                          <Icon name={iconName} size={16} />
                        </span>
                        <span className="t-strong">{t.description}</span>
                        {t.installmentGroupId && t.parcela && (
                          <span className="parc-badge">{t.parcela.total}x</span>
                        )}
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
        {moreFooter}
      </div>
    </div>
  );
}
