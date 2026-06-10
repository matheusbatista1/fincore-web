/**
 * pt-BR date formatting for display. Ported from the prototype's date helpers.
 * `today` is always passed in explicitly so these stay pure and testable (no
 * hidden `Date.now()`).
 */
import type { CompetenceMonth, IsoDate } from "@/domain/value-objects/competence-month";

export const SHORT_MONTHS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

export const LONG_MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

const MS_PER_DAY = 86_400_000;

/** Whole days between two ISO dates (b − a), using a UTC-safe midnight parse. */
function dayDelta(a: IsoDate, b: IsoDate): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / MS_PER_DAY);
}

/** "Hoje" / "Ontem" / "DD/MM" relative to `today` (mirrors the prototype's dateLabel). */
export function relativeDateLabel(date: IsoDate, today: IsoDate): string {
  if (date === today) return "Hoje";
  if (dayDelta(date, today) === 1) return "Ontem";
  const [, month, day] = date.split("-");
  return `${day}/${month}`;
}

/** "10/06" — day/month only. */
export function shortDate(date: IsoDate): string {
  const [, month, day] = date.split("-");
  return `${day}/${month}`;
}

/** "Junho 2026" (long) or "Jun 2026" (short) for a competence month. */
export function monthLabel(month: CompetenceMonth, options: { long?: boolean } = {}): string {
  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  const names = options.long ? LONG_MONTHS : SHORT_MONTHS;
  return `${names[monthIndex - 1]} ${year}`;
}
