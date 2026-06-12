"use client";

import { useState } from "react";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { byDateDesc } from "@/application/use-cases/get-transactions";
import { Avatar } from "@/presentation/components/ui/avatar";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { openTxDetail } from "@/presentation/stores/tx-ui-store";
import { useUIStore } from "@/presentation/stores/ui-store";
import { relativeDateLabel } from "@/shared/formatting/dates";

type Filter = "all" | "out" | "in" | "xfer";

const FILTERS: ReadonlyArray<[Filter, string]> = [
  ["all", "Todas"],
  ["out", "Despesas"],
  ["in", "Receitas"],
  ["xfer", "Transferências"],
];

/** Transações — ported 1:1 from the prototype (more.jsx TransactionsScreen, desktop table). */
export function TransactionsView({
  transactions,
  today,
}: {
  transactions: TransactionListItem[];
  today: string;
}) {
  const toast = useUIStore((s) => s.toast);
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

  return (
    <div className="card">
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
