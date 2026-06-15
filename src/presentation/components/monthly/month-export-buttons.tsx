"use client";

import type { MonthlyItem } from "@/application/use-cases/get-monthly";
import type { StmtGroup } from "@/presentation/components/monthly/stmt-card";
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

const KIND_LABEL: Record<MonthlyItem["kind"], string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
};

/** `2026-07-02` → `02/07/2026`. */
function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const itemValueCents = (i: MonthlyItem): number =>
  i.kind === "transfer" ? (i.transferValueCents ?? 0) : i.amountCents;

/** CSV/PDF export of the monthly statement, grouped by origin (real files, not toasts). */
export function MonthExportButtons({
  monthLabel,
  month,
  groups,
  inCents,
  outCents,
  isPersonal,
}: {
  monthLabel: string;
  month: string;
  groups: StmtGroup[];
  inCents: number;
  outCents: number;
  /** Whether the active lens is "Apenas meu" — drives the lens label/slug and which totals come in. */
  isPersonal: boolean;
}) {
  const toast = useUIStore((s) => s.toast);
  const lensLabel = isPersonal ? "Apenas meu" : "Geral";
  const fileSlug = isPersonal ? "-apenas-meu" : "";

  function onCsv() {
    const rows = groups.flatMap((g) => [
      ...g.items.map((i) => [
        brDate(i.date),
        i.description || KIND_LABEL[i.kind],
        g.name,
        i.category?.name ?? "",
        KIND_LABEL[i.kind],
        i.projected ? "previsto" : "realizado",
        i.parcela ? `${i.parcela.number}/${i.parcela.total}` : "",
        csvMoney(itemValueCents(i)),
      ]),
      // People who owe you this month (income group, general lens only).
      ...(g.receivables ?? []).map((r) => [
        "",
        r.name,
        "A receber de pessoas",
        "",
        "Receita",
        "previsto",
        "",
        csvMoney(r.amountCents),
      ]),
    ]);
    exportCSV(
      `extrato-${month}${fileSlug}.csv`,
      ["Data", "Descrição", "Origem", "Categoria", "Tipo", "Situação", "Parcela", "Valor (R$)"],
      rows,
    );
    toast(`Extrato de ${monthLabel} (${lensLabel.toLowerCase()}) exportado em CSV`);
  }

  async function onPdf() {
    const net = inCents - outCents;
    try {
      await exportPDF({
        filename: `extrato-${month}${fileSlug}.pdf`,
        title: `Extrato de ${monthLabel}`,
        subtitle: `${lensLabel} · agrupado por origem`,
        kpis: [
          { label: "Entradas", value: pdfMoney(inCents), tone: "pos" },
          { label: "Saídas", value: pdfMoney(outCents), tone: "neg" },
          { label: "Resultado", value: pdfMoneySigned(net), tone: net < 0 ? "neg" : "pos" },
        ],
        sections: groups.map((g) => {
          const recv = g.receivables ?? [];
          const recvTotal = recv.reduce((s, r) => s + r.amountCents, 0);
          return {
            heading: `${g.name} — ${pdfMoney(g.totalCents + recvTotal)}`,
            head: ["Data", "Descrição", "Categoria", "Situação", "Valor"],
            align: ["left", "left", "left", "left", "right"] as PdfAlign[],
            body: [
              ...g.items.map((i) => [
                brDate(i.date),
                i.description || KIND_LABEL[i.kind],
                i.category?.name ?? "",
                i.projected ? "previsto" : "realizado",
                pdfMoney(itemValueCents(i)),
              ]),
              ...recv.map((r) => ["", r.name, "A receber", "previsto", pdfMoney(r.amountCents)]),
            ],
          };
        }),
      });
      toast(`Extrato de ${monthLabel} (${lensLabel.toLowerCase()}) exportado em PDF`);
    } catch {
      toast("Não foi possível gerar o PDF", "error");
    }
  }

  return (
    <div
      className="row gap-2 month-export"
      style={{
        marginTop: 18,
        paddingTop: 16,
        borderTop: "1px solid var(--line)",
        justifyContent: "flex-end",
      }}
    >
      <span
        style={{
          flex: 1,
          fontSize: 12.5,
          color: "var(--text-lo)",
          display: "flex",
          alignItems: "center",
          gap: 7,
        }}
      >
        <Icon name="file-down" size={14} />
        Exportar o extrato de {monthLabel} agrupado por origem
      </span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCsv}>
        <Icon name="file-spreadsheet" size={16} />
        CSV
      </button>
      <button type="button" className="btn btn-primary btn-sm" onClick={onPdf}>
        <Icon name="file-down" size={16} />
        Exportar PDF
      </button>
    </div>
  );
}
