/**
 * Client-side CSV/PDF export helpers. CSV is pure + tiny; the PDF path
 * dynamically imports jsPDF + autotable on first use so the ~350 KB never lands
 * in the route bundles. All money is formatted via the shared formatter so
 * exports always show real values (privacy mode is for the screen, not the file).
 */
import type { jsPDF } from "jspdf";
import type { CellDef, CellHookData } from "jspdf-autotable";
import { formatBRL } from "@/shared/formatting/currency";
import { todayInBrazil } from "@/shared/formatting/now";

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

/** Text colour of a figure or cell: positive (green), negative (red), neutral (ink) or muted (grey). */
export type PdfTone = "pos" | "neg" | "neutral" | "muted";

/** A styled table cell: one or more lines, optionally toned and/or bold. */
export interface PdfCellDef {
  readonly content: string | readonly string[];
  readonly tone?: PdfTone;
  readonly bold?: boolean;
}
export type PdfCell = string | PdfCellDef;

export interface PdfTableSection {
  readonly heading?: string;
  readonly head: readonly string[];
  readonly body: ReadonlyArray<readonly PdfCell[]>;
  readonly foot?: readonly PdfCell[];
  /** Per-column horizontal alignment (index-matched). Omitted columns stay "left". */
  readonly align?: readonly PdfAlign[];
  /** Fixed column widths in pt (index-matched); omitted columns share the remaining width. */
  readonly columnWidths?: ReadonlyArray<number | undefined>;
  /** Where the foot row prints; autoTable's default repeats it on every page. */
  readonly showFoot?: "everyPage" | "lastPage";
  readonly fontSize?: number;
}

/** A block of prose (a legend, "how to read this") — wrapped to the page width. */
export interface PdfTextSection {
  readonly heading?: string;
  readonly paragraphs: readonly string[];
}

export type PdfSection = PdfTableSection | PdfTextSection;

/** A headline figure rendered as a boxed card in the KPI band above the tables. */
export interface PdfKpi {
  readonly label: string;
  readonly value: string;
  readonly tone?: PdfTone;
}

export interface PdfSummaryLine {
  readonly label: string;
  readonly value: string;
  readonly tone?: PdfTone;
  readonly bold?: boolean;
  /** Draw a hairline above this line (the "= total" row of an arithmetic). */
  readonly ruleAbove?: boolean;
}

/**
 * A full-width summary card: a headline figure, the arithmetic behind it as label/value lines
 * and small notes under them — the "what happened" a lay reader wants before the table.
 */
export interface PdfSummary {
  readonly headline: { readonly label: string; readonly value: string; readonly tone?: PdfTone };
  readonly lines: readonly PdfSummaryLine[];
  readonly notes?: readonly string[];
}

export interface PdfDocument {
  readonly title: string;
  readonly subtitle?: string;
  readonly summary?: PdfSummary;
  /** Headline figures drawn as a band of cards above the first section. */
  readonly kpis?: readonly PdfKpi[];
  readonly sections: readonly PdfSection[];
  /** ISO date stamped in the per-page footer; defaults to today in São Paulo. */
  readonly generatedOn?: string;
  /** Page orientation — use "landscape" for wide, many-column statements. */
  readonly orientation?: "portrait" | "landscape";
  /** PDF metadata title (viewer tab); defaults to `title`. */
  readonly documentTitle?: string;
}

type Rgb = readonly [number, number, number];

/** Tones chosen for text on white paper (the app's mint/rose read well only on dark). */
const TONE: Record<PdfTone, Rgb> = {
  pos: [15, 122, 86],
  neg: [201, 48, 74],
  neutral: [37, 31, 51],
  muted: [111, 105, 133],
};
const INK: Rgb = [37, 31, 51];
const CARD_FILL: Rgb = [246, 245, 250];
const CARD_LINE: Rgb = [230, 228, 238];
const HEAD_FILL: Rgb = [124, 92, 255];
const FOOT_FILL: Rgb = [37, 31, 51];

/** ISO "YYYY-MM-DD" -> "DD/MM/YYYY" for the footer stamp. */
function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/**
 * Map a cell to autoTable's shape: a plain string stays a string; a styled one gets its styles.
 * Multi-line content becomes one string with line breaks (autoTable splits on them; an array would
 * be stringified with commas).
 */
export function toAutoTableCell(cell: PdfCell): string | CellDef {
  if (typeof cell === "string") return cell;
  const content = Array.isArray(cell.content) ? cell.content.join("\n") : (cell.content as string);
  const styles: NonNullable<CellDef["styles"]> = {};
  if (cell.tone) styles.textColor = [...TONE[cell.tone]];
  if (cell.bold) styles.fontStyle = "bold";
  return { content, styles };
}

const isTable = (s: PdfSection): s is PdfTableSection => "head" in s;

/**
 * Render an A4 PDF: title, optional subtitle, an optional summary card, an optional KPI band,
 * stacked sections (autoTable tables or wrapped prose), and a per-page footer (generation date +
 * page numbers). jsPDF's built-in font is WinAnsi (CP-1252) — pt-BR accents, "—", "–", "·" and
 * "…" are fine, but avoid glyphs outside it ("→", the U+2212 minus). Money cells should be
 * `pdfMoney`-formatted and right-aligned via `align`.
 */
export async function renderPdf(spec: PdfDocument): Promise<jsPDF> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;

  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: spec.orientation ?? "portrait" });
  doc.setProperties({ title: spec.documentTitle ?? spec.title });
  const margin = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usable = pageW - margin * 2;
  const bottomLimit = pageH - 48;

  const ink = () => doc.setTextColor(INK[0], INK[1], INK[2]);
  const tone = (t: PdfTone) => {
    const [r, g, b] = TONE[t];
    doc.setTextColor(r, g, b);
  };
  const ensureRoom = (needed: number, y: number): number => {
    if (y + needed <= bottomLimit) return y;
    doc.addPage();
    return 48;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  ink();
  const titleLines = doc.splitTextToSize(spec.title, usable) as string[];
  doc.text(titleLines, margin, 48);
  let y = 48 + (titleLines.length - 1) * 19 + 16;
  if (spec.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    tone("muted");
    const subLines = doc.splitTextToSize(spec.subtitle, usable) as string[];
    doc.text(subLines, margin, y);
    ink();
    y += subLines.length * 13 + 2;
  }
  y += 6;

  if (spec.summary) {
    const { headline, lines, notes = [] } = spec.summary;
    const padX = 14;
    doc.setFontSize(8.5);
    const noteLines = notes.flatMap((n) => doc.splitTextToSize(n, usable - padX * 2) as string[]);
    const linesH = lines.reduce((h, l) => h + 15 + (l.ruleAbove ? 6 : 0), 0);
    const notesH = noteLines.length > 0 ? 8 + noteLines.length * 11 : 0;
    const boxH = 58 + linesH + notesH + 12;
    y = ensureRoom(boxH, y);
    doc.setFillColor(CARD_FILL[0], CARD_FILL[1], CARD_FILL[2]);
    doc.setDrawColor(CARD_LINE[0], CARD_LINE[1], CARD_LINE[2]);
    doc.roundedRect(margin, y, usable, boxH, 8, 8, "FD");
    const x = margin + padX;
    const right = margin + usable - padX;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    tone("muted");
    doc.text(headline.label.toUpperCase(), x, y + 19);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(19);
    tone(headline.tone ?? "neutral");
    doc.text(headline.value, x, y + 42);
    let ly = y + 58;
    for (const line of lines) {
      if (line.ruleAbove) {
        doc.setDrawColor(CARD_LINE[0], CARD_LINE[1], CARD_LINE[2]);
        doc.line(x, ly - 4, right, ly - 4);
        ly += 6;
      }
      doc.setFontSize(9.5);
      doc.setFont("helvetica", line.bold ? "bold" : "normal");
      tone(line.bold ? "neutral" : "muted");
      doc.text(line.label, x, ly + 7);
      doc.setFont("helvetica", "bold");
      tone(line.tone ?? "neutral");
      doc.text(line.value, right, ly + 7, { align: "right" });
      ly += 15;
    }
    if (noteLines.length > 0) {
      ly += 8;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      tone("muted");
      doc.text(noteLines, x, ly + 6);
    }
    ink();
    y += boxH + 16;
  }

  if (spec.kpis && spec.kpis.length > 0) {
    const kpis = spec.kpis;
    const gap = 10;
    const boxW = (usable - gap * (kpis.length - 1)) / kpis.length;
    const boxH = 48;
    y = ensureRoom(boxH, y);
    kpis.forEach((kpi, i) => {
      const x = margin + i * (boxW + gap);
      doc.setFillColor(CARD_FILL[0], CARD_FILL[1], CARD_FILL[2]);
      doc.setDrawColor(CARD_LINE[0], CARD_LINE[1], CARD_LINE[2]);
      doc.roundedRect(x, y, boxW, boxH, 6, 6, "FD");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      tone("muted");
      doc.text(kpi.label.toUpperCase(), x + 10, y + 17);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      tone(kpi.tone ?? "neutral");
      doc.text(kpi.value, x + 10, y + 36);
    });
    ink();
    y += boxH + 18;
  }

  for (const section of spec.sections) {
    if (!isTable(section)) {
      doc.setFontSize(8.5);
      const paragraphs = section.paragraphs.map((p) => doc.splitTextToSize(p, usable) as string[]);
      const bodyH = paragraphs.reduce((h, lines) => h + lines.length * 11 + 5, 0);
      // Keep a short block (a legend) whole: move it to the next page rather than orphan a paragraph.
      const blockH = (section.heading ? 18 : 0) + bodyH;
      y = ensureRoom(blockH <= pageH / 2 ? blockH : (section.heading ? 18 : 0) + 40, y);
      if (section.heading) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        ink();
        doc.text(section.heading, margin, y + 8);
        y += 18;
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      tone("muted");
      for (const lines of paragraphs) {
        y = ensureRoom(lines.length * 11, y);
        doc.text(lines, margin, y + 7);
        y += lines.length * 11 + 5;
      }
      ink();
      y += 10;
      continue;
    }
    y = ensureRoom(70, y);
    if (section.heading) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      ink();
      doc.text(section.heading, margin, y + 8);
      y += 16;
    }
    const align = section.align;
    const widths = section.columnWidths;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, bottom: 48 },
      head: [[...section.head]],
      body: section.body.map((r) => r.map(toAutoTableCell)),
      ...(section.foot ? { foot: [section.foot.map(toAutoTableCell)] } : {}),
      ...(section.showFoot ? { showFoot: section.showFoot } : {}),
      ...(widths
        ? {
            columnStyles: Object.fromEntries(
              widths.flatMap((w, i) => (w === undefined ? [] : [[i, { cellWidth: w }]])),
            ),
          }
        : {}),
      // autoTable's `columnStyles` only aligns BODY cells; a didParseCell hook aligns
      // head and foot too, so column headers and total rows line up with the figures.
      ...(align
        ? {
            didParseCell: (d: CellHookData) => {
              const a = align[d.column.index];
              if (a) d.cell.styles.halign = a;
            },
          }
        : {}),
      headStyles: { fillColor: [...HEAD_FILL], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [...FOOT_FILL], textColor: 255, fontStyle: "bold" },
      styles: { fontSize: section.fontSize ?? 9, cellPadding: 5, textColor: [...INK] },
      rowPageBreak: "avoid",
      theme: "striped",
    });
    const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    y = (after ? after.finalY : y) + 22;
  }

  // Footer on every page (total page count isn't known inside didDrawPage).
  const genLabel = `Gerado em ${brDate(spec.generatedOn ?? todayInBrazil())}`;
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    tone("muted");
    doc.text(genLabel, margin, pageH - 18);
    doc.text(`Página ${p} de ${pageCount}`, pageW - margin, pageH - 18, { align: "right" });
  }
  ink();
  return doc;
}

/** Render the document and download it. */
export async function exportPDF(options: PdfDocument & { readonly filename: string }): Promise<void> {
  const doc = await renderPdf(options);
  doc.save(options.filename);
}

/** Convenience re-export so callers format PDF money in one place. */
export const pdfMoney = (cents: number): string => formatBRL(cents, { withSign: false });

/** Like `pdfMoney` but keeps a leading "- " for negatives — for results/nets/balances. */
export const pdfMoneySigned = (cents: number): string =>
  formatBRL(cents, { withSign: true }).replace("R$ ", "");
