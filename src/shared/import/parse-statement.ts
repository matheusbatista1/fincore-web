/**
 * Bank statement parser — turns a CSV or OFX export into normalized entries.
 *
 * Pure and dependency-light (no IO): the UI reads the file text and hands it
 * here; the result is reviewed and confirmed before any transaction is created.
 * Amounts are normalized to integer **cents**; the sign is preserved (negative =
 * expense, positive = income), mirroring the app's money convention.
 */

import type { IsoDate } from "@/domain/value-objects/competence-month";
import { isValidIsoDate } from "@/domain/value-objects/competence-month";

export type StatementFormat = "csv" | "ofx";

/** A normalized statement line, before the user maps account/category. */
export interface ParsedEntry {
  readonly date: IsoDate;
  readonly description: string;
  /** Signed amount in cents (negative = expense, positive = income). */
  readonly amountCents: number;
}

/** Guess the format from the file name and/or content. */
export function detectFormat(fileName: string, content: string): StatementFormat {
  if (/\.ofx$/i.test(fileName) || /<OFX>/i.test(content) || /<STMTTRN>/i.test(content)) return "ofx";
  return "csv";
}

/** Parse a `R$ 1.234,56` / `1234.56` / `(1.234,56)` amount to signed cents. */
export function parseAmountToCents(raw: string): number | null {
  let text = raw.trim().replace(/r\$/i, "").trim();
  if (text === "") return null;

  // Accounting negatives: (123,45)
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  if (hasComma && hasDot) {
    // The right-most separator is the decimal one; the other groups thousands.
    text =
      text.lastIndexOf(",") > text.lastIndexOf(".")
        ? text.replace(/\./g, "").replace(",", ".")
        : text.replace(/,/g, "");
  } else if (hasComma) {
    text = text.replace(",", ".");
  }

  text = text.replace(/\s/g, "");
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

/** Parse `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY` or OFX `YYYYMMDD…` to an IsoDate. */
export function parseDate(raw: string): IsoDate | null {
  const text = raw.trim();
  if (isValidIsoDate(text)) return text;

  // `isValidIsoDate` narrows `text` to `never` past the guard (IsoDate is `string`),
  // so operate on a fresh binding for the remaining formats.
  const value: string = raw.trim();

  const slash = value.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (slash) {
    const candidate = `${slash[3]}-${slash[2]}-${slash[1]}`;
    return isValidIsoDate(candidate) ? candidate : null;
  }

  const ofx = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (ofx) {
    const candidate = `${ofx[1]}-${ofx[2]}-${ofx[3]}`;
    return isValidIsoDate(candidate) ? candidate : null;
  }
  return null;
}

const DATE_KEYS = ["data", "date", "dt"];
const DESC_KEYS = ["descri", "histor", "memo", "lançamento", "lancamento", "name", "title"];
const AMOUNT_KEYS = ["valor", "amount", "value", "montante"];

function splitCsvLine(line: string, delimiter: string): string[] {
  // Minimal CSV: handles quoted fields containing the delimiter.
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

/** Lower-case and strip diacritics so "Histórico" matches the key "histor". */
function normalizeKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function indexOfKey(header: string[], keys: string[]): number {
  return header.findIndex((cell) => {
    const normalized = normalizeKey(cell);
    return keys.some((key) => normalized.includes(key));
  });
}

function parseCsv(content: string): ParsedEntry[] {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const first = lines[0] ?? "";
  const delimiter = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";

  const firstCells = splitCsvLine(first, delimiter);
  const looksLikeHeader = indexOfKey(firstCells, [...DATE_KEYS, ...AMOUNT_KEYS, ...DESC_KEYS]) !== -1;

  let dateIdx = 0;
  let descIdx = 1;
  let amountIdx = 2;
  let startRow = 0;
  if (looksLikeHeader) {
    dateIdx = indexOfKey(firstCells, DATE_KEYS);
    descIdx = indexOfKey(firstCells, DESC_KEYS);
    amountIdx = indexOfKey(firstCells, AMOUNT_KEYS);
    startRow = 1;
  }
  if (dateIdx === -1 || amountIdx === -1) return [];

  const entries: ParsedEntry[] = [];
  for (let i = startRow; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i] ?? "", delimiter);
    const date = parseDate(cells[dateIdx] ?? "");
    const amountCents = parseAmountToCents(cells[amountIdx] ?? "");
    if (date === null || amountCents === null || amountCents === 0) continue;
    const description = (descIdx >= 0 ? cells[descIdx] : undefined)?.trim() || "Lançamento importado";
    entries.push({ date, description, amountCents });
  }
  return entries;
}

function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}>([^<\r\n]*)`, "i"));
  return match?.[1]?.trim() ?? null;
}

function parseOfx(content: string): ParsedEntry[] {
  const blocks = content.split(/<STMTTRN>/i).slice(1);
  const entries: ParsedEntry[] = [];
  for (const block of blocks) {
    const date = parseDate(tag(block, "DTPOSTED") ?? "");
    const amountCents = parseAmountToCents(tag(block, "TRNAMT") ?? "");
    if (date === null || amountCents === null || amountCents === 0) continue;
    const description = (tag(block, "MEMO") ?? tag(block, "NAME"))?.trim() || "Lançamento importado";
    entries.push({ date, description, amountCents });
  }
  return entries;
}

/** Parse a statement file's text into normalized, signed-cents entries. */
export function parseStatement(content: string, format: StatementFormat): ParsedEntry[] {
  return format === "ofx" ? parseOfx(content) : parseCsv(content);
}
