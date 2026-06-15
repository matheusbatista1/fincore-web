"use client";

import { useState } from "react";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { CategoryIcon } from "@/presentation/components/ui/category-icon";
import { Dialog, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import {
  csvMoney,
  exportCSV,
  exportPDF,
  type PdfAlign,
  pdfMoney,
  pdfMoneySigned,
} from "@/presentation/lib/export";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { relativeDateLabel } from "@/shared/formatting/dates";

export type ReportMode = "month" | "mine" | "person";

/** Serializable inputs assembled on the server for the report modal. */
export interface ReportData {
  readonly summary: {
    readonly generalIncomeCents: number;
    readonly generalExpenseCents: number;
    readonly personalIncomeCents: number;
    readonly personalExpenseCents: number;
    readonly aReceberCents: number;
    readonly aPagarCents: number;
  };
  readonly categories: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly color: string;
    readonly icon: string;
    readonly totalCents: number;
  }>;
  readonly byCard: ReadonlyArray<{ readonly id: string; readonly name: string; readonly valueCents: number }>;
  readonly people: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly relationship: string;
    readonly color: string;
    readonly balanceCents: number;
  }>;
  readonly transactions: TransactionListItem[];
  readonly today: string;
  /** True when the report window reaches into the future (some figures are projected). */
  readonly includesProjected: boolean;
  /** Human label of the future portion ("jul – set 2026"); "" when none. */
  readonly projectedLabel: string;
  /** Per-month income/expense/net over the window (general lens). */
  readonly months: ReadonlyArray<MonthRow>;
  /** Same per-month breakdown through the personal lens. */
  readonly monthsPersonal: ReadonlyArray<MonthRow>;
  /** Expense-by-category through the personal lens (name + total only — for export). */
  readonly categoriesPersonal: ReadonlyArray<{ readonly name: string; readonly totalCents: number }>;
  /** Human label of the covered window ("Junho de 2026" or "jan – jun 2026"). */
  readonly rangeLabel: string;
  /** First/last competence month of the window (YYYY-MM) — `from === to` means a single month. */
  readonly from: string;
  readonly to: string;
  /** Income/expense/net summed over the whole window (general lens) — the period truth. */
  readonly periodTotals: PeriodTotals;
  /** Same period totals through the personal lens. */
  readonly periodTotalsPersonal: PeriodTotals;
}

interface PeriodTotals {
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly netCents: number;
}

interface MonthRow {
  readonly label: string;
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly netCents: number;
  readonly projected: boolean;
}

const TITLES: Record<ReportMode, string> = {
  month: "Relatório geral do mês",
  mine: "Meu relatório (pessoal)",
  person: "Relatório por pessoa",
};

function useMoney() {
  const privacy = useUIStore((s) => s.privacy);
  return (cents: number): string => (privacy ? "R$ ••••" : formatBRLAbsolute(cents));
}

/** Relatório (3 modos) — ported 1:1 from the prototype (extras.jsx ReportModal). */
export function ReportModal({
  data,
  initialMode,
  initialPersonId,
  onClose,
}: {
  data: ReportData;
  initialMode: ReportMode;
  initialPersonId?: string | undefined;
  onClose: () => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const money = useMoney();
  const [mode, setMode] = useState<ReportMode>(initialMode);
  const [pid, setPid] = useState(
    initialPersonId ?? (data.people.find((p) => p.balanceCents !== 0) ?? data.people[0])?.id ?? "",
  );

  const { summary } = data;
  // Period totals (summed over the whole window) — the source of truth for multi-month ranges.
  const pt = data.periodTotals;
  const ptp = data.periodTotalsPersonal;
  const isRange = data.from !== data.to;
  const resultLabel = isRange ? "Resultado do período" : "Resultado do mês";
  const othersAll = Math.max(0, pt.expenseCents - ptp.expenseCents);
  const reimbAll = Math.max(0, pt.incomeCents - ptp.incomeCents);

  // --- por pessoa ---
  const person = data.people.find((p) => p.id === pid);
  const groups = new Map<
    string,
    {
      label: string;
      icon: string;
      items: { desc: string; date: string; shareCents: number; income: boolean }[];
      totalCents: number;
    }
  >();
  if (person) {
    for (const t of data.transactions) {
      const share = t.shares.find((s) => s.personId === person.id);
      const isPayment = t.kind === "income" && t.fromPersonId === person.id;
      if (!share && !isPayment) continue;
      const key = t.cardId ?? t.accountId ?? t.sourceLabel ?? "outros";
      const label = t.sourceLabel ?? "Outros";
      const icon = t.cardId ? "credit-card" : t.accountId ? "wallet" : "file-text";
      let group = groups.get(key);
      if (!group) {
        group = { label, icon, items: [], totalCents: 0 };
        groups.set(key, group);
      }
      const shareCents = isPayment ? -t.amountCents : (share?.shareCents ?? 0);
      group.items.push({
        desc: t.description,
        date: relativeDateLabel(t.date, data.today),
        shareCents,
        income: isPayment,
      });
      group.totalCents += shareCents;
    }
  }
  const grpList = [...groups.values()];
  const grandTotal = grpList.reduce((s, g) => s + g.totalCents, 0);

  const exportName =
    mode === "person" && person
      ? (person.name.split(" ")[0] ?? person.name)
      : mode === "mine"
        ? "pessoal"
        : "geral do mês";

  // Null when there's no personal income to measure against (avoids a bogus huge %).
  const savingsRate: number | null =
    ptp.incomeCents > 0 ? Math.round((ptp.netCents / ptp.incomeCents) * 100) : null;
  const savingsRateLabel = savingsRate === null ? "—" : `${savingsRate}%`;
  const fileSlug =
    mode === "person" && person
      ? `relatorio-${(person.name.split(" ")[0] ?? "pessoa").toLowerCase()}-${data.today}`
      : mode === "mine"
        ? `relatorio-pessoal-${data.today}`
        : `relatorio-mes-${data.today}`;

  const projectedNote = data.includesProjected
    ? `Inclui valores previstos (meses futuros: ${data.projectedLabel})`
    : "";

  const monthLbl = (m: MonthRow): string => (m.projected ? `${m.label} (previsto)` : m.label);
  /** Full per-month table for the PDF (Mês · Receitas · Despesas · Resultado). */
  const pdfMonthRows = (rows: ReadonlyArray<MonthRow>): string[][] =>
    rows.map((m) => [
      monthLbl(m),
      pdfMoney(m.incomeCents),
      pdfMoney(m.expenseCents),
      pdfMoneySigned(m.netCents),
    ]);

  function onCsv() {
    if (mode === "month") {
      const rows: string[][] = [
        ...(data.includesProjected ? [["Observação", projectedNote, ""]] : []),
        ["Resumo", "Receitas", csvMoney(pt.incomeCents)],
        ["Resumo", "Despesas", csvMoney(pt.expenseCents)],
        ["Resumo", "Resultado", csvMoney(pt.netCents)],
        ...data.months.flatMap((m) => [
          ["Por mês", `${monthLbl(m)} · receitas`, csvMoney(m.incomeCents)],
          ["Por mês", `${monthLbl(m)} · despesas`, csvMoney(m.expenseCents)],
          ["Por mês", `${monthLbl(m)} · resultado`, csvMoney(m.netCents)],
        ]),
        ...data.categories.map((c) => ["Por categoria", c.name, csvMoney(c.totalCents)]),
        ...data.byCard.map((c) => ["Por cartão", c.name, csvMoney(c.valueCents)]),
        ["Pessoas", "A receber", csvMoney(summary.aReceberCents)],
        ["Pessoas", "Você deve", csvMoney(summary.aPagarCents)],
      ];
      exportCSV(`${fileSlug}.csv`, ["Seção", "Item", "Valor (R$)"], rows);
    } else if (mode === "mine") {
      exportCSV(
        `${fileSlug}.csv`,
        ["Item", "Valor"],
        [
          ...(data.includesProjected ? [["Observação", projectedNote]] : []),
          ["Minha renda (sem reembolsos)", csvMoney(ptp.incomeCents)],
          ["Meu gasto real (só minha parte)", csvMoney(ptp.expenseCents)],
          ["Minha sobra real", csvMoney(ptp.netCents)],
          ["Taxa de poupança", savingsRateLabel],
          ...data.categoriesPersonal.map((c) => [`Categoria: ${c.name}`, csvMoney(c.totalCents)]),
          ...data.monthsPersonal.flatMap((m) => [
            [`${monthLbl(m)} · minha renda`, csvMoney(m.incomeCents)],
            [`${monthLbl(m)} · meu gasto`, csvMoney(m.expenseCents)],
            [`${monthLbl(m)} · minha sobra`, csvMoney(m.netCents)],
          ]),
        ],
      );
    } else {
      const rows = grpList.flatMap((g) =>
        g.items.map((it) => [
          g.label,
          it.date,
          it.desc,
          it.income ? "pagamento" : "parte",
          csvMoney(it.shareCents),
        ]),
      );
      rows.push(["", "", "Saldo", "", csvMoney(grandTotal)]);
      exportCSV(`${fileSlug}.csv`, ["Origem", "Data", "Descrição", "Tipo", "Valor (R$)"], rows);
    }
    toast(`Relatório (${exportName}) exportado em CSV`);
  }

  async function onPdf() {
    const title = TITLES[mode];
    if (mode === "month") {
      const catTotal = data.categories.reduce((s, c) => s + c.totalCents, 0);
      const pct = (v: number): string => (catTotal > 0 ? `${Math.round((v / catTotal) * 100)}%` : "0%");
      const peopleNet = summary.aReceberCents - summary.aPagarCents;
      await exportPDF({
        filename: `${fileSlug}.pdf`,
        title,
        subtitle: `${data.rangeLabel}${data.includesProjected ? ` · ${projectedNote}` : ""}`,
        generatedOn: data.today,
        kpis: [
          { label: "Receitas", value: pdfMoney(pt.incomeCents), tone: "pos" },
          { label: "Despesas", value: pdfMoney(pt.expenseCents), tone: "neg" },
          { label: "Resultado", value: pdfMoneySigned(pt.netCents), tone: pt.netCents < 0 ? "neg" : "pos" },
          { label: "Taxa de poupança", value: savingsRateLabel },
        ],
        sections: [
          {
            heading: "Resumo do período",
            head: ["Item", "Valor"],
            align: ["left", "right"],
            body: [
              ["Receitas", pdfMoney(pt.incomeCents)],
              ["Despesas", pdfMoney(pt.expenseCents)],
            ],
            foot: ["Resultado", pdfMoneySigned(pt.netCents)],
          },
          {
            heading: "Resumo por mês",
            head: ["Mês", "Receitas", "Despesas", "Resultado"],
            align: ["left", "right", "right", "right"],
            body: pdfMonthRows(data.months),
            foot: ["Total", pdfMoney(pt.incomeCents), pdfMoney(pt.expenseCents), pdfMoneySigned(pt.netCents)],
          },
          ...(data.categories.length > 0
            ? [
                {
                  heading: "Despesas por categoria",
                  head: ["Categoria", "Valor", "% do total"],
                  align: ["left", "right", "right"] as PdfAlign[],
                  body: data.categories.map((c) => [c.name, pdfMoney(c.totalCents), pct(c.totalCents)]),
                  foot: ["Total", pdfMoney(catTotal), "100%"],
                },
              ]
            : []),
          ...(data.byCard.length > 0
            ? [
                {
                  heading: "Gasto por cartão (fatura aberta atual)",
                  head: ["Cartão", "Valor"],
                  align: ["left", "right"] as PdfAlign[],
                  body: data.byCard.map((c) => [c.name, pdfMoney(c.valueCents)]),
                },
              ]
            : []),
          {
            heading: "Pessoas (saldos atuais)",
            head: ["Item", "Valor"],
            align: ["left", "right"],
            body: [
              ["A receber de pessoas", pdfMoney(summary.aReceberCents)],
              ["Você deve", pdfMoney(summary.aPagarCents)],
            ],
            foot: ["Saldo líquido", pdfMoneySigned(peopleNet)],
          },
        ],
      });
    } else if (mode === "mine") {
      const catTotalP = data.categoriesPersonal.reduce((s, c) => s + c.totalCents, 0);
      const pctP = (v: number): string => (catTotalP > 0 ? `${Math.round((v / catTotalP) * 100)}%` : "0%");
      await exportPDF({
        filename: `${fileSlug}.pdf`,
        title,
        subtitle: `${data.rangeLabel}${data.includesProjected ? ` · ${projectedNote}` : ""}`,
        generatedOn: data.today,
        kpis: [
          { label: "Minha renda", value: pdfMoney(ptp.incomeCents), tone: "pos" },
          { label: "Meu gasto", value: pdfMoney(ptp.expenseCents), tone: "neg" },
          {
            label: "Minha sobra",
            value: pdfMoneySigned(ptp.netCents),
            tone: ptp.netCents < 0 ? "neg" : "pos",
          },
          { label: "Taxa de poupança", value: savingsRateLabel },
        ],
        sections: [
          {
            heading: "Resumo pessoal do período",
            head: ["Item", "Valor"],
            align: ["left", "right"],
            body: [
              ["Minha renda (sem reembolsos)", pdfMoney(ptp.incomeCents)],
              ["Meu gasto real (só minha parte)", pdfMoney(ptp.expenseCents)],
              ["Taxa de poupança", savingsRateLabel],
            ],
            foot: ["Minha sobra real", pdfMoneySigned(ptp.netCents)],
          },
          ...(data.categoriesPersonal.length > 0
            ? [
                {
                  heading: "Despesas por categoria (pessoal)",
                  head: ["Categoria", "Valor", "% do total"],
                  align: ["left", "right", "right"] as PdfAlign[],
                  body: data.categoriesPersonal.map((c) => [
                    c.name,
                    pdfMoney(c.totalCents),
                    pctP(c.totalCents),
                  ]),
                  foot: ["Total", pdfMoney(catTotalP), "100%"],
                },
              ]
            : []),
          {
            heading: "Resumo por mês (pessoal)",
            head: ["Mês", "Minha renda", "Meu gasto", "Minha sobra"],
            align: ["left", "right", "right", "right"],
            body: pdfMonthRows(data.monthsPersonal),
            foot: [
              "Total",
              pdfMoney(ptp.incomeCents),
              pdfMoney(ptp.expenseCents),
              pdfMoneySigned(ptp.netCents),
            ],
          },
        ],
      });
    } else {
      await exportPDF({
        filename: `${fileSlug}.pdf`,
        title: `${title}${person ? ` — ${person.name}` : ""}`,
        sections: [
          ...grpList.map((g) => ({
            heading: `${g.label} — ${pdfMoney(g.totalCents)}`,
            head: ["Data", "Descrição", "Tipo", "Valor"],
            body: g.items.map((it) => [
              it.date,
              it.desc,
              it.income ? "pagamento" : "parte",
              pdfMoney(it.shareCents),
            ]),
          })),
          { heading: "", head: ["", ""], body: [["Saldo", pdfMoney(grandTotal)]] },
        ],
      });
    }
    toast(`Relatório (${exportName}) exportado em PDF`);
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogModal title={TITLES[mode]}>
        <div className="modal-body">
          <div className="seg" style={{ marginBottom: 18 }}>
            <button type="button" className={mode === "month" ? "on" : ""} onClick={() => setMode("month")}>
              Geral do mês
            </button>
            <button type="button" className={mode === "mine" ? "on" : ""} onClick={() => setMode("mine")}>
              Só eu
            </button>
            <button type="button" className={mode === "person" ? "on" : ""} onClick={() => setMode("person")}>
              Por pessoa
            </button>
          </div>

          {mode === "month" && (
            <div className="rep-month">
              {data.includesProjected && (
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text-lo)",
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    marginBottom: 14,
                    lineHeight: 1.45,
                  }}
                >
                  <Icon
                    name="info"
                    size={15}
                    style={{ color: "var(--purple-300)", flex: "none", marginTop: 1 }}
                  />
                  <span>
                    Inclui valores <b>previstos</b> para meses futuros ({data.projectedLabel}).
                  </span>
                </div>
              )}
              <div className="summary-box" style={{ marginTop: 0, marginBottom: 16 }}>
                <div className="sb-row">
                  <span className="k">Receitas</span>
                  <span className="v" style={{ color: "var(--mint-500)" }}>
                    {money(pt.incomeCents)}
                  </span>
                </div>
                <div className="sb-row">
                  <span className="k">Despesas</span>
                  <span className="v" style={{ color: "var(--rose-500)" }}>
                    {money(pt.expenseCents)}
                  </span>
                </div>
                <div className="sb-row total">
                  <span className="k">{resultLabel}</span>
                  <span className="v">{money(pt.netCents)}</span>
                </div>
              </div>
              <div className="rp-group">
                <div className="rp-group-head">
                  <span>Por categoria</span>
                  <span />
                </div>
                {data.categories.map((c) => (
                  <div className="split-row" key={c.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <div className="sr-name" style={{ fontWeight: 500 }}>
                      <span className="pa" style={{ width: 24, height: 24, background: c.color }}>
                        <CategoryIcon name={c.icon} size={12} />
                      </span>
                      {c.name}
                    </div>
                    <div
                      className="sr-share"
                      style={{ width: "auto", color: "var(--text-hi)", fontWeight: 700 }}
                    >
                      {money(c.totalCents)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="rp-group">
                <div className="rp-group-head">
                  <span>Por cartão</span>
                  <span />
                </div>
                {data.byCard.map((c) => (
                  <div className="split-row" key={c.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <div className="sr-name" style={{ fontWeight: 500 }}>
                      <span className="pa" style={{ width: 24, height: 24, background: "var(--surface-4)" }}>
                        <Icon name="credit-card" size={12} />
                      </span>
                      {c.name}
                    </div>
                    <div
                      className="sr-share"
                      style={{ width: "auto", color: "var(--text-hi)", fontWeight: 700 }}
                    >
                      {money(c.valueCents)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="summary-box" style={{ marginTop: 16 }}>
                <div className="sb-row">
                  <span className="k">A receber de pessoas</span>
                  <span className="v" style={{ color: "var(--mint-500)" }}>
                    {money(summary.aReceberCents)}
                  </span>
                </div>
                <div className="sb-row">
                  <span className="k">Você deve</span>
                  <span className="v" style={{ color: "var(--rose-500)" }}>
                    {money(summary.aPagarCents)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {mode === "mine" && (
            <div className="rep-mine">
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-lo)",
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  marginBottom: 14,
                  lineHeight: 1.45,
                }}
              >
                <Icon
                  name="info"
                  size={15}
                  style={{ color: "var(--purple-300)", flex: "none", marginTop: 1 }}
                />
                <span>
                  Considera apenas o que é seu: descontamos {money(othersAll)} de partes de terceiros e{" "}
                  {money(reimbAll)} de reembolsos recebidos.
                </span>
              </div>
              <div className="summary-box" style={{ marginTop: 0 }}>
                <div className="sb-row">
                  <span className="k">Minha renda (sem reembolsos)</span>
                  <span className="v" style={{ color: "var(--mint-500)" }}>
                    {money(ptp.incomeCents)}
                  </span>
                </div>
                <div className="sb-row">
                  <span className="k">Meu gasto real (só minha parte)</span>
                  <span className="v" style={{ color: "var(--rose-500)" }}>
                    {money(ptp.expenseCents)}
                  </span>
                </div>
                <div className="sb-row total">
                  <span className="k">Minha sobra real</span>
                  <span className="v">{money(ptp.netCents)}</span>
                </div>
              </div>
              <div className="summary-box" style={{ marginTop: 14 }}>
                <div className="sb-row">
                  <span className="k">Taxa de poupança</span>
                  <span className="v" style={{ color: "var(--purple-300)" }}>
                    {savingsRateLabel}
                  </span>
                </div>
              </div>
            </div>
          )}

          {mode === "person" && person && (
            <div className="rep-person">
              <div className="report-person-pick">
                {data.people.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className={`person-chip${pid === p.id ? " on" : ""}`}
                    onClick={() => setPid(p.id)}
                  >
                    <span className="pa" style={{ background: p.color }}>
                      {p.name[0]}
                    </span>
                    {p.name.split(" ")[0]}
                  </button>
                ))}
              </div>
              <div className="profile-head" style={{ marginBottom: 18 }}>
                <span
                  className="pava"
                  style={{ width: 56, height: 56, fontSize: 22, background: person.color }}
                >
                  {person.name
                    .split(" ")
                    .slice(0, 2)
                    .map((w) => w[0])
                    .join("")}
                </span>
                <div>
                  <h3 style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600 }}>
                    {person.name}
                  </h3>
                  <div style={{ color: "var(--text-lo)", marginTop: 2, fontSize: 13 }}>
                    {person.relationship} · saldo atual {money(Math.abs(person.balanceCents))}
                  </div>
                </div>
              </div>
              {grpList.length === 0 && (
                <div
                  style={{ color: "var(--text-lo)", fontSize: 14, padding: "20px 0", textAlign: "center" }}
                >
                  Sem movimentações compartilhadas com {person.name.split(" ")[0]}.
                </div>
              )}
              {grpList.map((g) => (
                <div className="rp-group" key={g.label}>
                  <div className="rp-group-head">
                    <span className="row gap-2">
                      <Icon name={g.icon} size={14} />
                      {g.label}
                    </span>
                    <span className="tnum">{money(g.totalCents)}</span>
                  </div>
                  {g.items.map((it, j) => (
                    <div
                      className="split-row"
                      key={`${it.desc}-${it.date}-${it.shareCents}`}
                      style={{ borderBottom: j === g.items.length - 1 ? 0 : "1px solid var(--line)" }}
                    >
                      <div className="sr-name" style={{ fontWeight: 500, color: "var(--text-mid)" }}>
                        {it.income ? "↩ " : ""}
                        {it.desc}
                        <span style={{ fontSize: 12, color: "var(--text-faint)", marginLeft: 8 }}>
                          {it.date}
                        </span>
                      </div>
                      <div
                        className="sr-share"
                        style={{
                          width: "auto",
                          color: it.shareCents < 0 ? "var(--mint-500)" : "var(--text-hi)",
                          fontWeight: 700,
                        }}
                      >
                        {money(Math.abs(it.shareCents))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {grpList.length > 0 && (
                <div className="summary-box" style={{ marginTop: 18 }}>
                  <div className="sb-row total">
                    <span className="k">Saldo com {person.name.split(" ")[0]}</span>
                    <span className="v">{money(grandTotal)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onCsv}>
            <Icon name="file-spreadsheet" size={16} />
            CSV
          </button>
          <button type="button" className="btn btn-primary" onClick={onPdf}>
            <Icon name="file-down" size={16} />
            Exportar PDF
          </button>
        </div>
      </DialogModal>
    </Dialog>
  );
}
