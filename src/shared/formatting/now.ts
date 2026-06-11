/**
 * Current date/month in the user's timezone (America/São_Paulo), as the ISO
 * strings the domain expects. Used by RSC pages to pass a stable "today" into
 * pure components — kept out of `domain/` because it reads the wall clock.
 */
import type { CompetenceMonth, IsoDate } from "@/domain/value-objects/competence-month";

const SAO_PAULO = "America/Sao_Paulo";

/** Today as `YYYY-MM-DD` in São Paulo. */
export function todayInBrazil(): IsoDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SAO_PAULO }).format(new Date());
}

/** Current competence month as `YYYY-MM` in São Paulo. */
export function currentMonthInBrazil(): CompetenceMonth {
  return todayInBrazil().slice(0, 7);
}
