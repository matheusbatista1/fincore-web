/**
 * Competence-month helpers (mês de competência) — pure, locale-free date logic
 * ported from the prototype's data.js. Dates are ISO `YYYY-MM-DD`; months are
 * `YYYY-MM`. Display/locale formatting lives in shared/formatting, not here.
 */

/** An ISO calendar date string, `YYYY-MM-DD`. */
export type IsoDate = string;

/** A competence month string, `YYYY-MM`. */
export type CompetenceMonth = string;

const pad2 = (n: number): string => String(n).padStart(2, "0");

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const isValidIsoDate = (value: string): value is IsoDate => DATE_RE.test(value);
export const isValidCompetenceMonth = (value: string): value is CompetenceMonth => MONTH_RE.test(value);

/** Days in a given 1-based month of a year (handles leap years). */
export function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/** The competence month a date belongs to (`2026-06-10` → `2026-06`). */
export function monthOf(date: IsoDate): CompetenceMonth {
  return date.slice(0, 7);
}

/** The day-of-month component of a date (`2026-06-10` → 10). */
export function dayOf(date: IsoDate): number {
  return Number.parseInt(date.slice(8, 10), 10);
}

/** Shift a competence month by `delta` months (can be negative). */
export function addMonths(month: CompetenceMonth, delta: number): CompetenceMonth {
  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  let m = monthIndex - 1 + delta;
  const y = year + Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return `${y}-${pad2(m + 1)}`;
}

/** A date in `month` on `day`, clamped to the last day of that month. */
export function dateInMonth(month: CompetenceMonth, day: number): IsoDate {
  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  const clamped = Math.min(Math.max(day, 1), daysInMonth(year, monthIndex));
  return `${year}-${pad2(monthIndex)}-${pad2(clamped)}`;
}

/** Signed number of whole months from `a` to `b` (`b - a`). */
export function monthsBetween(a: CompetenceMonth, b: CompetenceMonth): number {
  const [ay, am] = a.split("-").map(Number) as [number, number];
  const [by, bm] = b.split("-").map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am);
}

/** Chronological comparison of two competence months. */
export function compareMonths(a: CompetenceMonth, b: CompetenceMonth): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
