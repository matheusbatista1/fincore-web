"use client";

import { useState } from "react";
import type { PersonStatement } from "@/application/use-cases/get-person-statements";
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
import { shortDate } from "@/shared/formatting/dates";
import { buildPersonStatementPdf, closingWords, personStatementSlug, rowLines } from "./person-statement-pdf";

/** ISO "YYYY-MM-DD" -> "DD/MM/YYYY" for statement exports. */
function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

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
  /** The user's first name, for the person statement's copy ("Pagamentos que você fez para …"). */
  readonly issuerFirstName: string | null;
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
  /** Per-person account-receivable statements over the window (drives the "por pessoa" mode). */
  readonly personStatements: ReadonlyArray<PersonStatement>;
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
  person: "Extrato por pessoa",
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

  // --- por pessoa: a reconciled account-receivable statement for the window ---
  const person = data.people.find((p) => p.id === pid);
  const statement = data.personStatements.find((s) => s.id === pid);

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
    mode === "person" && statement
      ? personStatementSlug(statement)
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
    } else if (statement) {
      const compraTotal = statement.rows.reduce((s, r) => (r.cashCents > 0 ? s + r.cashCents : s), 0);
      const pagamentoTotal = statement.rows.reduce((s, r) => (r.cashCents < 0 ? s - r.cashCents : s), 0);
      const closingLabel = closingWords(statement).label;
      const rows: string[][] = [
        [
          "",
          "Saldo anterior",
          statement.openingCents < 0
            ? "crédito que já tinha"
            : statement.openingCents > 0
              ? "já devia de antes"
              : "",
          "",
          "",
          "",
          "",
          "",
          "",
          csvMoney(statement.openingCents),
          "",
        ],
        ...statement.rows.map((r) => {
          const [what, details] = rowLines(r);
          return [
            brDate(r.date),
            what,
            details,
            r.categoryName ?? "",
            r.originLabel,
            r.competence,
            r.parcela ? `${r.parcela.number}/${r.parcela.total}` : "",
            r.cashCents > 0 ? csvMoney(r.cashCents) : "",
            r.cashCents < 0 ? csvMoney(-r.cashCents) : "",
            csvMoney(r.runningCents),
            r.projected ? "previsto" : "realizado",
          ];
        }),
        [
          "",
          "Totais do período",
          closingLabel,
          "",
          "",
          "",
          "",
          csvMoney(compraTotal),
          csvMoney(pagamentoTotal),
          csvMoney(statement.closingCents),
          "",
        ],
      ];
      exportCSV(
        `${fileSlug}.csv`,
        [
          "Data",
          "Descrição",
          "Detalhe",
          "Categoria",
          "Origem",
          "Fatura (mês)",
          "Parcela",
          "Compra (sua parte)",
          "Pagamento",
          "Falta pagar (negativo = crédito)",
          "Situação",
        ],
        rows,
      );
    }
    toast(`Relatório (${exportName}) exportado em CSV`);
  }

  async function onPdf() {
    const title = TITLES[mode];
    try {
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
              foot: [
                "Total",
                pdfMoney(pt.incomeCents),
                pdfMoney(pt.expenseCents),
                pdfMoneySigned(pt.netCents),
              ],
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
      } else if (statement) {
        await exportPDF({
          filename: `${fileSlug}.pdf`,
          ...buildPersonStatementPdf(statement, {
            rangeLabel: data.rangeLabel,
            today: data.today,
            issuerFirstName: data.issuerFirstName,
          }),
        });
      }
      toast(`Relatório (${exportName}) exportado em PDF`);
    } catch {
      toast("Não foi possível gerar o PDF", "error");
    }
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

          {mode === "person" && statement && (
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
                  style={{ width: 56, height: 56, fontSize: 22, background: statement.color }}
                >
                  {statement.name
                    .split(" ")
                    .slice(0, 2)
                    .map((w) => w[0])
                    .join("")}
                </span>
                <div>
                  <h3 style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600 }}>
                    {statement.name}
                  </h3>
                  <div style={{ color: "var(--text-lo)", marginTop: 2, fontSize: 13 }}>
                    {statement.relationship ? `${statement.relationship} · ` : ""}
                    {statement.closingCents > 0
                      ? `falta pagar ${money(statement.closingCents)}`
                      : statement.closingCents < 0
                        ? `crédito de ${money(-statement.closingCents)}`
                        : closingWords(statement).label.toLowerCase()}
                  </div>
                </div>
              </div>

              <div className="summary-box" style={{ marginBottom: 16 }}>
                {statement.openingCents !== 0 && (
                  <div className="sb-row">
                    <span className="k">
                      {statement.openingCents > 0 ? "Já devia de antes" : "Crédito anterior"}
                    </span>
                    <span
                      className="v"
                      style={{ color: statement.openingCents > 0 ? "var(--text-hi)" : "var(--mint-500)" }}
                    >
                      {money(Math.abs(statement.openingCents))}
                    </span>
                  </div>
                )}
                <div className="sb-row">
                  <span className="k">Compras (sua parte)</span>
                  <span className="v" style={{ color: "var(--text-hi)" }}>
                    {money(statement.purchasesCents)}
                  </span>
                </div>
                {statement.carriedCents > 0 && (
                  <div className="sb-row">
                    <span className="k">Saldo adiado de outro mês</span>
                    <span className="v" style={{ color: "var(--text-hi)" }}>
                      {money(statement.carriedCents)}
                    </span>
                  </div>
                )}
                {statement.refundsCents > 0 && (
                  <div className="sb-row">
                    <span className="k">Devoluções recebidas</span>
                    <span className="v" style={{ color: "var(--text-hi)" }}>
                      {money(statement.refundsCents)}
                    </span>
                  </div>
                )}
                <div className="sb-row">
                  <span className="k">Pagamentos</span>
                  <span className="v" style={{ color: "var(--mint-500)" }}>
                    {money(statement.paymentsCents)}
                  </span>
                </div>
                {/* A rollover is neither paid nor forgiven: its own row, no "good news" colour. */}
                {statement.rolloversCents !== 0 && (
                  <div className="sb-row">
                    <span className="k">Adiado para outra data</span>
                    <span className="v" style={{ color: "var(--text-hi)" }}>
                      {money(Math.abs(statement.rolloversCents))}
                    </span>
                  </div>
                )}
                {statement.writeoffsCents !== 0 && (
                  <div className="sb-row">
                    <span className="k">
                      {statement.writeoffsCents < 0 ? "Descontos" : "Crédito abatido"}
                    </span>
                    <span className="v" style={{ color: "var(--mint-500)" }}>
                      {money(Math.abs(statement.writeoffsCents))}
                    </span>
                  </div>
                )}
                <div className="sb-row total">
                  <span className="k">
                    {statement.closingCents > 0
                      ? "Falta pagar"
                      : statement.closingCents < 0
                        ? "Crédito a favor"
                        : closingWords(statement).label}
                  </span>
                  <span
                    className="v"
                    style={{ color: statement.closingCents > 0 ? "var(--rose-500)" : "var(--mint-500)" }}
                  >
                    {money(Math.abs(statement.closingCents))}
                  </span>
                </div>
                {statement.asOf && (
                  <div style={{ fontSize: 12.5, color: "var(--text-lo)", marginTop: 8, lineHeight: 1.45 }}>
                    Hoje:{" "}
                    {statement.asOf.closingCents > 0
                      ? `falta pagar ${money(statement.asOf.closingCents)}`
                      : statement.asOf.closingCents < 0
                        ? `crédito de ${money(-statement.asOf.closingCents)}`
                        : "tudo pago"}{" "}
                    (considera o que entrou depois do período).
                  </div>
                )}
              </div>

              {statement.rows.length === 0 ? (
                <div
                  style={{ color: "var(--text-lo)", fontSize: 14, padding: "20px 0", textAlign: "center" }}
                >
                  Sem movimentações no período.
                </div>
              ) : (
                <div className="rp-group">
                  <div className="rp-group-head">
                    <span>Lançamentos</span>
                    <span />
                  </div>
                  {statement.rows.map((r, j) => {
                    const [what, details] = rowLines(r);
                    return (
                      <div
                        className="split-row"
                        key={`${r.date}-${r.kind}-${r.cashCents}-${r.runningCents}`}
                        style={{
                          borderBottom: j === statement.rows.length - 1 ? 0 : "1px solid var(--line)",
                        }}
                      >
                        {/* `.sr-name` is a flex row: one column child keeps the details UNDER the name. */}
                        <div className="sr-name" style={{ fontWeight: 500, color: "var(--text-mid)" }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span>{what}</span>
                              {r.projected && <span className="pill purple">previsto</span>}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "var(--text-faint)",
                                marginTop: 2,
                                fontWeight: 400,
                                lineHeight: 1.4,
                              }}
                            >
                              {shortDate(r.date)} · {details}
                            </div>
                          </div>
                        </div>
                        <div className="sr-share" style={{ width: "auto", textAlign: "right" }}>
                          <div
                            style={{
                              color: r.cashCents < 0 ? "var(--mint-500)" : "var(--text-hi)",
                              fontWeight: 700,
                            }}
                          >
                            {r.cashCents < 0 ? "− " : ""}
                            {money(Math.abs(r.cashCents))}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                            {r.runningCents < 0
                              ? `crédito ${money(-r.runningCents)}`
                              : `falta pagar ${money(r.runningCents)}`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {mode === "person" && !statement && (
            <div style={{ color: "var(--text-lo)", fontSize: 14, padding: "24px 0", textAlign: "center" }}>
              Nenhuma pessoa cadastrada.
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
