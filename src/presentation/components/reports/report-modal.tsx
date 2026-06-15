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
import { formatBRL, formatBRLAbsolute } from "@/shared/formatting/currency";
import { shortDate } from "@/shared/formatting/dates";

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
  const privacy = useUIStore((s) => s.privacy);
  /** Signed money for balances (> 0 they owe you, < 0 you owe them); masked in privacy mode. */
  const moneySigned = (cents: number): string => (privacy ? "R$ ••••" : formatBRL(cents, { withSign: true }));
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
    } else if (statement) {
      const rows: string[][] = [
        ["", "Saldo anterior", "", "", "", csvMoney(statement.openingCents)],
        ...statement.entries.map((e) => [
          brDate(e.date),
          e.projected ? `${e.description} (previsto)` : e.description,
          e.origin,
          e.kind === "debit" ? csvMoney(e.amountCents) : "",
          e.kind === "credit" ? csvMoney(e.amountCents) : "",
          csvMoney(e.balanceCents),
        ]),
        [
          "",
          "Saldo final",
          "",
          csvMoney(statement.debitTotalCents),
          csvMoney(statement.creditTotalCents),
          csvMoney(statement.closingCents),
        ],
      ];
      exportCSV(`${fileSlug}.csv`, ["Data", "Descrição", "Origem", "Débito", "Crédito", "Saldo"], rows);
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
        const closing = statement.closingCents;
        await exportPDF({
          filename: `${fileSlug}.pdf`,
          title: `Extrato de conta corrente${person ? ` — ${person.name}` : ""}`,
          subtitle: `${person ? `${person.relationship} · ` : ""}${data.rangeLabel}`,
          generatedOn: data.today,
          kpis: [
            { label: "Saldo anterior", value: pdfMoneySigned(statement.openingCents) },
            { label: "Compartilhado", value: pdfMoney(statement.debitTotalCents) },
            { label: "Pago", value: pdfMoney(statement.creditTotalCents), tone: "pos" },
            { label: "Saldo final", value: pdfMoneySigned(closing), tone: closing < 0 ? "neg" : "pos" },
          ],
          sections: [
            {
              heading: "Lançamentos",
              head: ["Data", "Descrição", "Origem", "Débito", "Crédito", "Saldo"],
              align: ["left", "left", "left", "right", "right", "right"],
              body: [
                ["", "Saldo anterior", "", "", "", pdfMoneySigned(statement.openingCents)],
                ...statement.entries.map((e) => [
                  brDate(e.date),
                  e.projected ? `${e.description} (previsto)` : e.description,
                  e.origin,
                  e.kind === "debit" ? pdfMoney(e.amountCents) : "",
                  e.kind === "credit" ? pdfMoney(e.amountCents) : "",
                  pdfMoneySigned(e.balanceCents),
                ]),
              ],
              foot: [
                "",
                "Saldo final",
                "",
                pdfMoney(statement.debitTotalCents),
                pdfMoney(statement.creditTotalCents),
                pdfMoneySigned(closing),
              ],
            },
          ],
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
                    {statement.relationship} ·{" "}
                    {statement.closingCents > 0
                      ? `te deve ${money(statement.closingCents)}`
                      : statement.closingCents < 0
                        ? `você deve ${money(Math.abs(statement.closingCents))}`
                        : "quitado"}
                  </div>
                </div>
              </div>

              <div className="summary-box" style={{ marginBottom: 16 }}>
                <div className="sb-row">
                  <span className="k">Saldo anterior</span>
                  <span className="v">{moneySigned(statement.openingCents)}</span>
                </div>
                <div className="sb-row">
                  <span className="k">Compartilhado no período</span>
                  <span className="v" style={{ color: "var(--text-hi)" }}>
                    {money(statement.debitTotalCents)}
                  </span>
                </div>
                <div className="sb-row">
                  <span className="k">Pago no período</span>
                  <span className="v" style={{ color: "var(--mint-500)" }}>
                    {money(statement.creditTotalCents)}
                  </span>
                </div>
                <div className="sb-row total">
                  <span className="k">Saldo final</span>
                  <span className="v">{moneySigned(statement.closingCents)}</span>
                </div>
              </div>

              {statement.entries.length === 0 ? (
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
                  {statement.entries.map((e, j) => (
                    <div
                      className="split-row"
                      key={`${e.date}-${e.kind}-${e.amountCents}-${e.balanceCents}`}
                      style={{
                        borderBottom: j === statement.entries.length - 1 ? 0 : "1px solid var(--line)",
                      }}
                    >
                      <div className="sr-name" style={{ fontWeight: 500, color: "var(--text-mid)" }}>
                        {e.description}
                        {e.projected && (
                          <span className="pill purple" style={{ marginLeft: 8 }}>
                            previsto
                          </span>
                        )}
                        <span style={{ fontSize: 12, color: "var(--text-faint)", marginLeft: 8 }}>
                          {shortDate(e.date)} · {e.origin}
                        </span>
                      </div>
                      <div className="sr-share" style={{ width: "auto", textAlign: "right" }}>
                        <div
                          style={{
                            color: e.kind === "credit" ? "var(--mint-500)" : "var(--text-hi)",
                            fontWeight: 700,
                          }}
                        >
                          {e.kind === "credit" ? "− " : ""}
                          {money(e.amountCents)}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                          {moneySigned(e.balanceCents)}
                        </div>
                      </div>
                    </div>
                  ))}
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
