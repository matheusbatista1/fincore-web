import type { PersonStatement, PersonStatementRow } from "@/application/use-cases/get-person-statements";
import { type IsoDate, monthOf } from "@/domain/value-objects/competence-month";
import type {
  PdfCell,
  PdfDocument,
  PdfSection,
  PdfSummaryLine,
  PdfTableSection,
  PdfTone,
} from "@/presentation/lib/export";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { monthLabel, shortDate } from "@/shared/formatting/dates";

/**
 * The per-person statement as a PDF document spec — pure (no jsPDF), so the copy and the figures
 * are unit-tested in node. Written for the PERSON who receives it (his mother, a friend): plain
 * words, the arithmetic spelled out, "falta pagar" instead of "saldo", and never a bare sign.
 * Every string must be WinAnsi-safe (the PDF font has no "→" and no U+2212 minus: use "–").
 */
export interface PersonStatementPdfContext {
  readonly rangeLabel: string;
  readonly today: IsoDate;
  /** The user's first name, for "Pagamentos que você fez para {Nome}"; omitted when unknown. */
  readonly issuerFirstName?: string | null;
}

const money = formatBRLAbsolute;
const firstName = (full: string): string => full.split(" ")[0] ?? full;

/** ISO "YYYY-MM-DD" -> "DD/MM/YYYY". */
export function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** A balance in words: what it means for the person, never a signed number. */
export function balanceWords(cents: number): { label: string; value: string; tone: PdfTone } {
  if (cents > 0) return { label: "Falta pagar", value: money(cents), tone: "neg" };
  if (cents < 0) return { label: "Crédito a seu favor", value: money(-cents), tone: "pos" };
  return { label: "Tudo pago", value: money(0), tone: "pos" };
}

/**
 * The running figure after a row: "R$ x" still open, or the amount over "crédito" (two lines, like
 * the description cell, so the narrow column never wraps mid-number) when it is in their favour.
 */
export function runningWords(cents: number): PdfCell {
  if (cents < 0) return { content: [money(-cents), "crédito"], tone: "pos" };
  return money(cents);
}

/** The two lines of a row's description cell: what it was, and the details that explain it. */
export function rowLines(row: PersonStatementRow): readonly [string, string] {
  const parts: string[] = [row.originLabel];
  if (row.parcela) {
    const { number, total, remaining } = row.parcela;
    parts.push(
      remaining === 0
        ? `última parcela (${number} de ${total})`
        : `parcela ${number} de ${total} · ${remaining === 1 ? "falta 1" : `faltam ${remaining}`}`,
    );
  }
  if (row.kind === "purchase") {
    if (row.parcela && row.groupTotalCents !== null && row.groupCount !== null && row.groupCount > 1) {
      parts.push(`compra de ${money(row.groupTotalCents)} em ${row.parcela.total}x`);
    } else if (!row.parcela && row.purchaseTotalCents !== null && row.cashCents < row.purchaseTotalCents) {
      parts.push(`compra de ${money(row.purchaseTotalCents)}`);
    }
  }
  if (monthOf(row.date) !== row.competence) parts.push(`fatura de ${monthLabel(row.competence)}`);
  if (row.projected) parts.push("previsto: ainda não cobrado");
  if (row.note) parts.push(row.note);
  return [row.description, parts.join(" · ")];
}

/** Lower-case, accent-free, hyphenated: "João Pé" -> "joao-pe". */
function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `extrato-{nome}-{from}[-{to}]` — the period in the name, so two exports never collide. */
export function personStatementSlug(st: PersonStatement): string {
  const period = st.from === st.to ? st.from : `${st.from}-${st.to}`;
  return `extrato-${slugify(firstName(st.name)) || "pessoa"}-${period}`;
}

export const personStatementFilename = (st: PersonStatement): string => `${personStatementSlug(st)}.pdf`;

const HOW_TO_READ = (issuer: string | null): string[] => [
  "Compra (sua parte): só a sua parte em cada gasto. Quando a compra foi dividida, a segunda linha mostra o valor total dela.",
  `Pagamento: o que você já pagou${issuer ? ` para ${issuer}` : ""}. Um pagamento feito antes da compra vira crédito e abate as próximas.`,
  'Falta pagar: o que ainda está em aberto depois de cada linha. "Crédito" quer dizer que você pagou mais do que gastou: o valor fica a seu favor.',
  "Compras no cartão entram no mês em que a fatura vence. Por isso compras de um mês podem aparecer no extrato do mês seguinte, com a fatura indicada na segunda linha.",
  'Parcelas: "parcela 3 de 10 · faltam 7" diz qual parcela é esta e quantas ainda vêm. Previsto: gasto fixo ou parcela que ainda vai ser cobrado; o valor é uma estimativa.',
];

/** Build the PDF spec for one person's statement. */
export function buildPersonStatementPdf(st: PersonStatement, ctx: PersonStatementPdfContext): PdfDocument {
  const issuer = ctx.issuerFirstName ? firstName(ctx.issuerFirstName) : null;
  const headline = balanceWords(st.closingCents);

  const lines: PdfSummaryLine[] = [];
  if (st.openingCents > 0)
    lines.push({ label: "Você já devia de antes", value: `+ ${money(st.openingCents)}` });
  else if (st.openingCents < 0) {
    lines.push({ label: "Crédito que você já tinha", value: `– ${money(-st.openingCents)}`, tone: "pos" });
  }
  lines.push({ label: "Suas compras no período (sua parte)", value: `+ ${money(st.purchasesCents)}` });
  if (st.refundsCents > 0)
    lines.push({ label: "Devoluções que você recebeu", value: `+ ${money(st.refundsCents)}` });
  lines.push({
    label: issuer ? `Pagamentos que você fez para ${issuer}` : "Pagamentos que você fez",
    value: `– ${money(st.paymentsCents)}`,
    tone: "pos",
  });
  if (st.writeoffsCents < 0)
    lines.push({ label: "Descontos", value: `– ${money(-st.writeoffsCents)}`, tone: "pos" });
  else if (st.writeoffsCents > 0)
    lines.push({ label: "Crédito abatido", value: `+ ${money(st.writeoffsCents)}` });
  lines.push({
    label: headline.label,
    value: headline.value,
    tone: headline.tone,
    bold: true,
    ruleAbove: true,
  });

  const notes: string[] = [];
  if (st.lastPaymentBefore) {
    notes.push(
      `Último pagamento antes do período: ${money(st.lastPaymentBefore.amountCents)} em ${brDate(st.lastPaymentBefore.date)}.`,
    );
  }
  const n = st.rows.length;
  const previstos =
    st.projectedCount > 0
      ? ` · ${st.projectedCount} ${st.projectedCount === 1 ? "previsto" : "previstos"} (${money(st.projectedCents)} ainda não cobrados)`
      : "";
  notes.push(`${n} ${n === 1 ? "lançamento" : "lançamentos"}${previstos}.`);
  if (st.asOf) {
    const today = balanceWords(st.asOf.closingCents);
    const figure =
      st.asOf.closingCents === 0 ? today.label.toLowerCase() : `${today.label.toLowerCase()} ${today.value}`;
    notes.push(
      `Hoje (${brDate(ctx.today)}): ${figure} — considera o que entrou depois de ${monthLabel(st.to)}.`,
    );
  }

  const subtitle = [
    st.relationship.trim() || null,
    ctx.rangeLabel,
    st.rowsDateSpan
      ? `lançamentos de ${shortDate(st.rowsDateSpan.first)} a ${shortDate(st.rowsDateSpan.last)}`
      : null,
  ]
    .filter((s): s is string => s !== null)
    .join(" · ");

  let compraTotal = 0;
  let pagamentoTotal = 0;
  const body: PdfCell[][] = st.rows.map((r) => {
    const [what, details] = rowLines(r);
    if (r.cashCents > 0) compraTotal += r.cashCents;
    else pagamentoTotal -= r.cashCents;
    const cells: PdfCell[] = [
      shortDate(r.date),
      { content: [what, details] },
      r.categoryName ?? "—",
      r.cashCents > 0 ? money(r.cashCents) : "",
      r.cashCents < 0 ? { content: money(-r.cashCents), tone: "pos" } : "",
      runningWords(r.runningCents),
    ];
    return r.projected
      ? cells.map((c) => (typeof c === "string" ? { content: c, tone: "muted" } : { ...c, tone: "muted" }))
      : cells;
  });

  const table: PdfTableSection = {
    heading: "Lançamentos",
    head: ["Data", "Descrição", "Categoria", "Compra (sua parte)", "Pagamento", "Falta pagar"],
    align: ["left", "left", "left", "right", "right", "right"],
    columnWidths: [46, undefined, 70, 64, 62, 62], // Descrição takes the rest
    showFoot: "lastPage",
    fontSize: 8.5,
    body:
      body.length > 0
        ? body
        : [
            [
              "",
              { content: "Sem lançamentos no período.", tone: "muted" },
              "",
              "",
              "",
              runningWords(st.closingCents),
            ],
          ],
    foot: [
      "",
      `Totais do período — ${headline.label.toLowerCase()}`,
      "",
      money(compraTotal),
      money(pagamentoTotal),
      headline.value,
    ],
  };

  const sections: PdfSection[] = [table];
  if (st.byCategory.length >= 2 && st.purchasesCents > 0) {
    sections.push({
      heading: "Por categoria",
      head: ["Categoria", "Compras", "Total", "%"],
      align: ["left", "right", "right", "right"],
      columnWidths: [undefined, 80, 100, 60],
      body: st.byCategory.map((c) => [
        c.name,
        String(c.count),
        money(c.totalCents),
        `${Math.round((c.totalCents / st.purchasesCents) * 100)}%`,
      ]),
    });
  }
  sections.push({ heading: "Como ler este extrato", paragraphs: HOW_TO_READ(issuer) });

  return {
    title: `Extrato — ${st.name}`,
    documentTitle: `Extrato — ${st.name} · ${ctx.rangeLabel}`,
    subtitle,
    summary: { headline, lines, notes },
    sections,
    generatedOn: ctx.today,
  };
}
