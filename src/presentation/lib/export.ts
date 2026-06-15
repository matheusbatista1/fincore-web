/**
 * Client-side CSV/PDF export helpers. CSV is pure + tiny; the PDF path
 * dynamically imports jsPDF + autotable on first use so the ~350 KB never lands
 * in the route bundles. All money is formatted via the shared formatter so
 * exports always show real values (privacy mode is for the screen, not the file).
 */
import { formatBRL } from "@/shared/formatting/currency";

export type CsvCell = string | number;

/** A cell needs quoting if it contains the delimiter, a quote, or a line break. */
function csvField(value: CsvCell): string {
  const s = String(value);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a semicolon-delimited CSV body (CRLF rows, RFC-4180 quoting). Semicolon
 * is pt-BR Excel's native list separator (comma is the decimal mark). Pure — no BOM.
 */
export function buildCsv(headers: readonly string[], rows: ReadonlyArray<readonly CsvCell[]>): string {
  const lines = [headers, ...rows].map((row) => row.map(csvField).join(";"));
  return lines.join("\r\n");
}

/** Cents → "1234,56" / "-1234,56": a bare number pt-BR Excel parses (no "R$"). */
export function csvMoney(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** Trigger a client download of `content` as a file. */
function download(filename: string, content: BlobPart, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Build the CSV (UTF-8 BOM so Excel decodes accents) and download it. */
export function exportCSV(
  filename: string,
  headers: readonly string[],
  rows: ReadonlyArray<readonly CsvCell[]>,
): void {
  const bom = String.fromCharCode(0xfeff); // UTF-8 BOM so Excel decodes accents
  download(filename, bom + buildCsv(headers, rows), "text/csv;charset=utf-8");
}

/** Per-column horizontal alignment for an autoTable section. */
export type PdfAlign = "left" | "right" | "center";

export interface PdfSection {
  readonly heading?: string;
  readonly head: readonly string[];
  readonly body: ReadonlyArray<readonly string[]>;
  readonly foot?: readonly string[];
  /** Per-column horizontal alignment (index-matched). Omitted columns stay "left". */
  readonly align?: readonly PdfAlign[];
}

/** A headline figure rendered as a boxed card in the KPI band above the tables. */
export interface PdfKpi {
  readonly label: string;
  readonly value: string;
  /** Colours the value: positive (mint), negative (rose) or neutral (default). */
  readonly tone?: "pos" | "neg" | "neutral";
}

const KPI_TONE: Record<NonNullable<PdfKpi["tone"]>, readonly [number, number, number]> = {
  pos: [31, 197, 145],
  neg: [225, 90, 110],
  neutral: [37, 31, 51],
};

/** ISO "YYYY-MM-DD" -> "DD/MM/YYYY" for the footer stamp. */
function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/**
 * Render an A4 PDF: title, optional subtitle, an optional KPI band, stacked
 * autoTable sections, and a per-page footer (generation date + page numbers).
 * Then download it. jsPDF's built-in font is WinAnsi (CP-1252) — pt-BR accents
 * are fine, but avoid glyphs outside it (use "->" instead of "→"). Money cells
 * should be `pdfMoney`/`pdfMoneySigned`-formatted and right-aligned via `align`.
 */
export async function exportPDF(options: {
  readonly filename: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly sections: readonly PdfSection[];
  /** Headline figures drawn as a band of cards above the first section. */
  readonly kpis?: readonly PdfKpi[];
  /** ISO date stamped in the per-page footer; defaults to today. */
  readonly generatedOn?: string;
}): Promise<void> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(options.title, margin, 48);
  let y = 64;
  if (options.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(options.subtitle, margin, y);
    doc.setTextColor(0);
    y = 78;
  }

  if (options.kpis && options.kpis.length > 0) {
    const kpis = options.kpis;
    const gap = 10;
    const usable = pageW - margin * 2;
    const boxW = (usable - gap * (kpis.length - 1)) / kpis.length;
    const boxH = 48;
    kpis.forEach((kpi, i) => {
      const x = margin + i * (boxW + gap);
      doc.setFillColor(246, 245, 250);
      doc.setDrawColor(230, 228, 238);
      doc.roundedRect(x, y, boxW, boxH, 6, 6, "FD");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(kpi.label.toUpperCase(), x + 10, y + 17);
      const [r, g, b] = KPI_TONE[kpi.tone ?? "neutral"];
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(r, g, b);
      doc.text(kpi.value, x + 10, y + 36);
    });
    doc.setTextColor(0);
    y += boxH + 18;
  }

  for (const section of options.sections) {
    if (section.heading) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(section.heading, margin, y + 8);
      y += 16;
    }
    const columnStyles = section.align
      ? Object.fromEntries(section.align.map((halign, i) => [i, { halign }]))
      : undefined;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, bottom: 48 },
      head: [section.head as string[]],
      body: section.body.map((r) => [...r]),
      ...(section.foot ? { foot: [section.foot as string[]] } : {}),
      ...(columnStyles ? { columnStyles } : {}),
      headStyles: { fillColor: [124, 92, 255], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [37, 31, 51], textColor: 255, fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 5 },
      theme: "striped",
    });
    const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    y = (after ? after.finalY : y) + 22;
  }

  // Footer on every page (total page count isn't known inside didDrawPage).
  const generatedOn = options.generatedOn ?? new Date().toISOString().slice(0, 10);
  const genLabel = `Gerado em ${brDate(generatedOn)}`;
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(genLabel, margin, pageH - 18);
    doc.text(`Pagina ${p} de ${pageCount}`, pageW - margin, pageH - 18, { align: "right" });
  }
  doc.setTextColor(0);

  doc.save(options.filename);
}

/** Convenience re-export so callers format PDF money in one place. */
export const pdfMoney = (cents: number): string => formatBRL(cents, { withSign: false });

/** Like `pdfMoney` but keeps a leading "- " for negatives — for results/nets/balances. */
export const pdfMoneySigned = (cents: number): string =>
  formatBRL(cents, { withSign: true }).replace("R$ ", "");
