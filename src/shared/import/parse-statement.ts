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

/**
 * Parse `YYYY-MM-DD`, `DD/MM/YYYY`, `DD.MM.YYYY`, `DD-MM-YY`, or OFX `YYYYMMDD…`
 * to an IsoDate. Day/month may be 1–2 digits; a 2-digit year is read as `20YY`.
 */
export function parseDate(raw: string): IsoDate | null {
  const text = raw.trim();
  if (isValidIsoDate(text)) return text;

  // `isValidIsoDate` narrows `text` to `never` past the guard (IsoDate is `string`),
  // so operate on a fresh binding for the remaining formats.
  const value: string = raw.trim();

  // DD/MM/YYYY with `/`, `.` or `-` separators; year may be 2 or 4 digits.
  const dmy = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (dmy) {
    const day = (dmy[1] ?? "").padStart(2, "0");
    const month = (dmy[2] ?? "").padStart(2, "0");
    const rawYear = dmy[3] ?? "";
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    const candidate = `${year}-${month}-${day}`;
    return isValidIsoDate(candidate) ? candidate : null;
  }

  const ofx = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (ofx) {
    const candidate = `${ofx[1]}-${ofx[2]}-${ofx[3]}`;
    return isValidIsoDate(candidate) ? candidate : null;
  }
  return null;
}

// Header keywords are matched against diacritic-stripped, lower-cased cells (see
// normalizeKey), so list them ASCII-only.
const DATE_KEYS = ["data", "date", "dt", "compet"];
const DESC_KEYS = [
  "descri",
  "histor",
  "memo",
  "lancamento",
  "name",
  "title",
  "titulo",
  "estabelec",
  "transa",
  "detalhe",
];
const AMOUNT_KEYS = ["valor", "amount", "value", "montante", "quantia"];
// Some banks split money into separate debit/credit columns instead of one signed value.
const DEBIT_KEYS = ["debito", "saida", "despesa", "debit"];
const CREDIT_KEYS = ["credito", "entrada", "recebi", "credit"];

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

/**
 * The amount column, preferring the BRL one. Some statements export more than one
 * "valor" column — notably C6's international invoice has both "Valor (em US$)"
 * (zero for domestic buys) and "Valor (em R$)" (the actual charge). Picking the
 * first match grabs the US$ column and every row parses as 0, so prefer a column
 * whose header looks like Reais and skip foreign-currency ones.
 */
function indexOfAmountColumn(header: string[]): number {
  const matches = header.flatMap((cell, i) => (indexOfKey([cell], AMOUNT_KEYS) === 0 ? [i] : []));
  if (matches.length <= 1) return matches[0] ?? -1;
  const foreign = /us\$|usd|dolar|dollar|eur|gbp|€|£/;
  const reais = /r\$|reais|brl|real/;
  const brl = matches.find((i) => reais.test(normalizeKey(header[i] ?? "")));
  if (brl !== undefined) return brl;
  const domestic = matches.find((i) => !foreign.test(normalizeKey(header[i] ?? "")));
  return domestic ?? matches[matches.length - 1] ?? -1;
}

/** Guess the delimiter from the header line: prefer `;`/TAB (BR exports use comma decimals). */
function detectDelimiter(headerLine: string): string {
  const semi = (headerLine.match(/;/g) ?? []).length;
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  if (semi > 0 || tabs > 0) return tabs > semi ? "\t" : ";";
  return ",";
}

/** A row's signed amount: a single "valor" column, or a debit/credit pair (debit = expense). */
function resolveAmount(
  cells: string[],
  amountIdx: number,
  debitIdx: number,
  creditIdx: number,
): number | null {
  if (amountIdx >= 0) return parseAmountToCents(cells[amountIdx] ?? "");
  const credit = creditIdx >= 0 ? parseAmountToCents(cells[creditIdx] ?? "") : null;
  if (credit !== null && credit !== 0) return Math.abs(credit);
  const debit = debitIdx >= 0 ? parseAmountToCents(cells[debitIdx] ?? "") : null;
  if (debit !== null && debit !== 0) return -Math.abs(debit);
  return null;
}

function parseCsv(content: string): ParsedEntry[] {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const first = lines[0] ?? "";
  const delimiter = detectDelimiter(first);

  const firstCells = splitCsvLine(first, delimiter);
  const looksLikeHeader =
    indexOfKey(firstCells, [...DATE_KEYS, ...AMOUNT_KEYS, ...DESC_KEYS, ...DEBIT_KEYS, ...CREDIT_KEYS]) !==
    -1;

  let dateIdx = 0;
  let descIdx = 1;
  let amountIdx = 2;
  let debitIdx = -1;
  let creditIdx = -1;
  let startRow = 0;
  if (looksLikeHeader) {
    dateIdx = indexOfKey(firstCells, DATE_KEYS);
    descIdx = indexOfKey(firstCells, DESC_KEYS);
    amountIdx = indexOfAmountColumn(firstCells);
    debitIdx = indexOfKey(firstCells, DEBIT_KEYS);
    creditIdx = indexOfKey(firstCells, CREDIT_KEYS);
    startRow = 1;
  }
  // Need a date column and at least one amount source (single value or debit/credit).
  if (dateIdx === -1 || (amountIdx === -1 && debitIdx === -1 && creditIdx === -1)) return [];

  const entries: ParsedEntry[] = [];
  for (let i = startRow; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i] ?? "", delimiter);
    const date = parseDate(cells[dateIdx] ?? "");
    const amountCents = resolveAmount(cells, amountIdx, debitIdx, creditIdx);
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
  // Strip a leading UTF-8 BOM (common in Excel/online-banking exports) so it
  // doesn't poison the first header cell.
  const clean = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  return format === "ofx" ? parseOfx(clean) : parseCsv(clean);
}
