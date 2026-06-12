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

export interface PdfSection {
  readonly heading?: string;
  readonly head: readonly string[];
  readonly body: ReadonlyArray<readonly string[]>;
  readonly foot?: readonly string[];
}

/**
 * Render an A4 PDF with a title, optional subtitle and stacked autoTable
 * sections, then download it. jsPDF's built-in font is WinAnsi — use ASCII like
 * "->" instead of "→" in cell text. Money cells should be `formatBRL`-formatted.
 */
export async function exportPDF(options: {
  readonly filename: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly sections: readonly PdfSection[];
}): Promise<void> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
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

  for (const section of options.sections) {
    if (section.heading) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(section.heading, margin, y + 8);
      y += 16;
    }
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [section.head as string[]],
      body: section.body.map((r) => [...r]),
      ...(section.foot ? { foot: [section.foot as string[]] } : {}),
      headStyles: { fillColor: [124, 92, 255], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [37, 31, 51], textColor: 255, fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 5 },
      theme: "striped",
    });
    const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    y = (after ? after.finalY : y) + 22;
  }

  doc.save(options.filename);
}

/** Convenience re-export so callers format PDF money in one place. */
export const pdfMoney = (cents: number): string => formatBRL(cents, { withSign: false });
