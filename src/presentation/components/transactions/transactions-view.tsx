"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { Fragment, useState } from "react";
import { deleteTransactionAction } from "@/app/_actions/finance";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { byDateDesc } from "@/application/use-cases/get-transactions";
import { SwipeRow } from "@/presentation/components/gestures/swipe-row";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { PeopleStack } from "@/presentation/components/ui/people-stack";
import {
  csvMoney,
  exportCSV,
  exportPDF,
  type PdfAlign,
  type PdfKpi,
  pdfMoney,
  pdfMoneySigned,
} from "@/presentation/lib/export";
import { collapseRowsByInstallments } from "@/presentation/lib/group-installments";
import { useIsMobile } from "@/presentation/lib/use-is-mobile";
import { openInstallmentGroup, openTxDetail, useTxUIStore } from "@/presentation/stores/tx-ui-store";
import { toast as fireToast, useUIStore } from "@/presentation/stores/ui-store";
import { monthLabel, relativeDateLabel } from "@/shared/formatting/dates";

type Filter = "all" | "out" | "in" | "xfer";
/** Which statement to show: executed cash movements (the extrato) or upcoming/pending items. */
type StmtView = "executed" | "future";
type Order = "desc" | "asc";

/** Oldest-first comparator (the future view defaults to this). */
const byDateAsc = (a: TransactionListItem, b: TransactionListItem): number => -byDateDesc(a, b);

/** Synthetic rows (settlement / fatura payment / projected) carry a `type:id` id and aren't
 * editable transactions — the detail modal shows them read-only and swipe actions are disabled. */
const isSynthetic = (t: TransactionListItem): boolean => t.id.includes(":");

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
  executed,
  future,
  today,
}: {
  /** Cash movements that already happened (the extrato) — the default view. */
  executed: TransactionListItem[];
  /** Upcoming/pending: future-dated reals, unpaid obligations, projected recurring. */
  future: TransactionListItem[];
  today: string;
}) {
  const toast = useUIStore((s) => s.toast);
  const openEdit = useTxUIStore((s) => s.openEdit);
  const openDelete = useTxUIStore((s) => s.openDelete);
  const isMobile = useIsMobile();
  const [view, setView] = useState<StmtView>("executed");
  const [filter, setFilter] = useState<Filter>("all");
  const [order, setOrder] = useState<Order>("desc");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const transactions = view === "executed" ? executed : future;
  const q = query.trim().toLowerCase();
  const matchesQuery = (t: TransactionListItem): boolean => {
    if (q === "") return true;
    const haystack = [
      t.description,
      t.category?.name,
      t.sourceLabel,
      t.note,
      t.transferFromName,
      t.transferToName,
      ...t.shares.map((s) => s.name),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  };
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
    .filter(matchesQuery)
    .sort(order === "desc" ? byDateDesc : byDateAsc);
  // Collapse installment parcelas into one row per group (the modal lists them all).
  const collapsed = collapseRowsByInstallments(rows);
  const shown = collapsed.slice(0, visibleCount);
  const hasMore = collapsed.length > visibleCount;

  // Per-month totals over the WHOLE filtered set (accurate even while paginating), so each month
  // header shows a stable "resultado do mês" hint.
  const monthAgg = new Map<string, { inCents: number; outCents: number; count: number }>();
  for (const t of collapsed) {
    const key = t.date.slice(0, 7);
    const agg = monthAgg.get(key) ?? { inCents: 0, outCents: 0, count: 0 };
    if (t.kind === "income") agg.inCents += t.amountCents;
    else if (t.kind === "expense") agg.outCents += Math.abs(t.amountCents);
    agg.count += 1;
    monthAgg.set(key, agg);
  }
  // Group the shown rows into consecutive month sections (order follows the sort above:
  // newest-first for the extrato, oldest-first for the future view).
  const sections: { month: string; items: TransactionListItem[] }[] = [];
  for (const t of shown) {
    const key = t.date.slice(0, 7);
    const last = sections[sections.length - 1];
    if (last && last.month === key) last.items.push(t);
    else sections.push({ month: key, items: [t] });
  }

  function pickFilter(next: Filter) {
    setFilter(next);
    setVisibleCount(PAGE_SIZE); // reset the window whenever the filter changes
  }

  function pickView(next: StmtView) {
    setView(next);
    setOrder(next === "executed" ? "desc" : "asc"); // extrato: mais recentes; futuras: mais próximas
    setVisibleCount(PAGE_SIZE);
  }

  function toggleOrder() {
    setOrder((o) => (o === "desc" ? "asc" : "desc"));
    setVisibleCount(PAGE_SIZE);
  }

  // A collapsed installment row opens the group modal; anything else opens the detail.
  const openRow = (t: TransactionListItem) =>
    t.installmentGroupId && t.parcela ? openInstallmentGroup(t.installmentGroupId) : openTxDetail(t);

  /** Status badges for a row: pago (settled), previsto (projected), a vencer (pending, future view). */
  const rowBadges = (t: TransactionListItem) => (
    <>
      {t.isPaid && (
        <span
          className="parc-badge"
          style={{ marginLeft: 6, background: "var(--mint-soft)", color: "var(--mint-500)" }}
        >
          <Icon name="check" size={11} />
          pago
        </span>
      )}
      {t.projected && (
        <span className="parc-badge futura" style={{ marginLeft: 6 }}>
          previsto
        </span>
      )}
      {view === "future" && t.isPayable && !t.isPaid && !t.projected && (
        <span
          className="parc-badge"
          style={{ marginLeft: 6, background: "var(--purple-soft)", color: "var(--purple-300)" }}
        >
          a vencer
        </span>
      )}
    </>
  );

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
      `${view === "executed" ? "extrato" : "futuras"}-${filter}-${today}.csv`,
      ["Data", "Descrição", "Categoria", "Origem", "Pessoas", "Tipo", "Parcela", "Valor (R$)"],
      csvRows,
    );
    toast(`${rows.length} ${rows.length === 1 ? "transação exportada" : "transações exportadas"} em CSV`);
  }

  /** Bank-statement-style PDF (landscape): KPI band + itemized table grouped by month (newest first). */
  async function onExportPdf() {
    const inSum = rows.filter((t) => t.kind === "income").reduce((s, t) => s + t.amountCents, 0);
    const outSum = rows.filter((t) => t.kind === "expense").reduce((s, t) => s + Math.abs(t.amountCents), 0);
    const xferSum = rows
      .filter((t) => t.kind === "transfer")
      .reduce((s, t) => s + (t.transferValueCents ?? 0), 0);
    const net = inSum - outSum;
    // A transfers-only view (e.g. the "xfer" filter) has no income/expense, so show the
    // transferred total instead of an all-zero Entradas/Saídas/Resultado band.
    const onlyTransfers = rows.length > 0 && rows.every((t) => t.kind === "transfer");
    const filterLabel = FILTERS.find(([k]) => k === filter)?.[1] ?? "Todas";

    // Group by calendar month of the transaction date; `rows` is already sorted newest-first.
    const byMonth = new Map<string, TransactionListItem[]>();
    for (const t of rows) {
      const key = t.date.slice(0, 7);
      const list = byMonth.get(key);
      if (list) list.push(t);
      else byMonth.set(key, [t]);
    }

    const itemValue = (t: TransactionListItem): string =>
      t.kind === "transfer" ? pdfMoney(t.transferValueCents ?? 0) : pdfMoneySigned(t.amountCents);

    const sections = [...byMonth.entries()].map(([month, items]) => {
      const mIn = items.filter((t) => t.kind === "income").reduce((s, t) => s + t.amountCents, 0);
      const mOut = items.filter((t) => t.kind === "expense").reduce((s, t) => s + Math.abs(t.amountCents), 0);
      const mXfer = items
        .filter((t) => t.kind === "transfer")
        .reduce((s, t) => s + (t.transferValueCents ?? 0), 0);
      const monthHasFlow = items.some((t) => t.kind !== "transfer");
      const suffix = monthHasFlow
        ? `Resultado ${pdfMoneySigned(mIn - mOut)}`
        : `Transferido ${pdfMoney(mXfer)}`;
      return {
        heading: `${monthLabel(month, { long: true })} — ${suffix}`,
        head: ["Data", "Descrição", "Categoria", "Origem", "Pessoas", "Parcela", "Tipo", "Valor"],
        align: ["left", "left", "left", "left", "left", "left", "left", "right"] as PdfAlign[],
        body: items.map((t) => [
          brDate(t.date),
          t.description || KIND_LABEL[t.kind],
          t.category?.name ?? "",
          t.kind === "transfer"
            ? `${t.transferFromName ?? ""} -> ${t.transferToName ?? ""}`
            : (t.sourceLabel ?? ""),
          t.shares.map((s) => s.name).join(", "),
          t.parcela ? `${t.parcela.number}/${t.parcela.total}` : "",
          KIND_LABEL[t.kind],
          itemValue(t),
        ]),
      };
    });

    const kpis: PdfKpi[] = onlyTransfers
      ? [
          { label: "Total transferido", value: pdfMoney(xferSum), tone: "neutral" },
          { label: "Lançamentos", value: String(rows.length) },
        ]
      : [
          { label: "Entradas", value: pdfMoney(inSum), tone: "pos" },
          { label: "Saídas", value: pdfMoney(outSum), tone: "neg" },
          { label: "Resultado", value: pdfMoneySigned(net), tone: net < 0 ? "neg" : "pos" },
          { label: "Lançamentos", value: String(rows.length) },
        ];

    try {
      await exportPDF({
        filename: `${view === "executed" ? "extrato" : "futuras"}-${filter}-${today}.pdf`,
        title: view === "executed" ? "Extrato de lançamentos" : "Compromissos e previstos",
        subtitle: `${filterLabel} · ${rows.length} ${rows.length === 1 ? "lançamento" : "lançamentos"}`,
        generatedOn: today,
        orientation: "landscape",
        kpis,
        sections,
      });
      toast(`${rows.length} ${rows.length === 1 ? "transação exportada" : "transações exportadas"} em PDF`);
    } catch {
      toast("Não foi possível gerar o PDF", "error");
    }
  }

  const filtersHead = (
    <div className="card-head">
      <div className="row gap-2" style={{ flexWrap: "wrap" }}>
        <div className="view-toggle">
          <button
            type="button"
            className={view === "executed" ? "on" : ""}
            onClick={() => pickView("executed")}
          >
            <Icon name="check-circle" size={15} />
            Executadas
          </button>
          <button type="button" className={view === "future" ? "on" : ""} onClick={() => pickView("future")}>
            <Icon name="calendar-range" size={15} />
            Futuras
          </button>
        </div>
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggleOrder}>
          <Icon name={order === "desc" ? "chevron-down" : "chevron-up"} size={16} />
          {order === "desc" ? "Mais recentes" : "Mais antigas"}
        </button>
        <Link className="btn btn-ghost btn-sm" href="/import">
          <Icon name="file-up" size={16} />
          Importar
        </Link>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onExport}>
          <Icon name="file-spreadsheet" size={16} />
          CSV
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void onExportPdf();
          }}
        >
          <Icon name="file-down" size={16} />
          PDF
        </button>
      </div>
    </div>
  );

  const searchBar = (
    <div className="card-pad" style={{ paddingTop: 0, paddingBottom: 8 }}>
      <div style={{ position: "relative" }}>
        <Icon
          name="search"
          size={16}
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-lo)",
          }}
        />
        <input
          className="input"
          style={{ paddingLeft: 36 }}
          placeholder="Buscar por descrição, categoria, pessoa…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVisibleCount(PAGE_SIZE);
          }}
          aria-label="Buscar lançamentos"
        />
      </div>
    </div>
  );

  /** Month divider label + net-of-month hint (income − expense over the whole filtered set). */
  const monthHead = (month: string): { label: string; net: number; count: number } => {
    const agg = monthAgg.get(month) ?? { inCents: 0, outCents: 0, count: 0 };
    return { label: monthLabel(month, { long: true }), net: agg.inCents - agg.outCents, count: agg.count };
  };

  const emptyState = (
    <div style={{ color: "var(--text-lo)", padding: "28px 12px", textAlign: "center" }}>
      <Icon name="search-x" size={26} style={{ color: "var(--text-faint)" }} />
      <div style={{ marginTop: 8, fontSize: 14 }}>
        {q
          ? `Nada encontrado para “${query.trim()}”.`
          : view === "executed"
            ? "Nenhum movimento executado ainda."
            : "Nada previsto ou a vencer por aqui."}
      </div>
      {!q && view === "executed" && (
        <Link className="btn btn-ghost btn-sm" href="/import" style={{ marginTop: 12 }}>
          <Icon name="file-up" size={15} />
          Importar extrato
        </Link>
      )}
    </div>
  );

  // ---- mobile: swipe-to-action list (more.jsx:23-46) ----
  if (isMobile) {
    return (
      <div className="card">
        {filtersHead}
        {searchBar}
        <div className="card-pad" style={{ paddingTop: 0, paddingBottom: 8 }}>
          {sections.map((section) => {
            const h = monthHead(section.month);
            return (
              <div key={section.month}>
                <div
                  className="row"
                  style={{ justifyContent: "space-between", alignItems: "baseline", padding: "12px 2px 6px" }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 600,
                      fontSize: 13.5,
                      color: "var(--text-hi)",
                    }}
                  >
                    {h.label}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: h.net >= 0 ? "var(--mint-500)" : "var(--rose-500)",
                    }}
                  >
                    <Money cents={h.net} withSign />
                  </span>
                </div>
                {section.items.map((t) => {
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
                      onEdit={isTransfer || isSynthetic(t) ? null : () => openEdit(t)}
                      onDelete={
                        isSynthetic(t) ? null : () => (t.parcela ? openDelete(t) : void removeDirect(t))
                      }
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
                            {rowBadges(t)}
                          </div>
                          <div className="l-sub">
                            {relativeDateLabel(t.date, today)}
                            {t.note ? ` · ${t.note}` : cat ? ` · ${cat.name}` : ""}
                          </div>
                        </div>
                        <PeopleStack item={t} size={22} />
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
              </div>
            );
          })}
          {rows.length === 0 && emptyState}
          {moreFooter}
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {filtersHead}
      {searchBar}
      <div style={{ padding: "0 12px 12px" }}>
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
              {sections.map((section) => {
                const h = monthHead(section.month);
                return (
                  <Fragment key={section.month}>
                    <tr>
                      <td colSpan={6} style={{ padding: "16px 8px 4px" }}>
                        <div
                          className="row"
                          style={{ justifyContent: "space-between", alignItems: "baseline" }}
                        >
                          <span
                            style={{
                              fontFamily: "var(--font-display)",
                              fontWeight: 600,
                              fontSize: 14,
                              color: "var(--text-hi)",
                            }}
                          >
                            {h.label}
                          </span>
                          <span style={{ fontSize: 12.5, color: "var(--text-lo)" }}>
                            {h.count} {h.count === 1 ? "lançamento" : "lançamentos"} ·{" "}
                            <span
                              style={{
                                color: h.net >= 0 ? "var(--mint-500)" : "var(--rose-500)",
                                fontWeight: 600,
                              }}
                            >
                              <Money cents={h.net} withSign />
                            </span>
                          </span>
                        </div>
                      </td>
                    </tr>
                    {section.items.map((t) => {
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
                              {rowBadges(t)}
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
                            {t.shares.length > 0 || (t.fromPersonId && t.fromPersonName) ? (
                              <PeopleStack item={t} size={26} />
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
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6}>{emptyState}</td>
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
