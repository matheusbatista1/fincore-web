/**
 * Geometry and reading of the net-worth timeline — pure, so the maths the chart draws with is
 * tested without a browser. The component (`net-worth-chart.tsx`) only measures, animates and
 * renders what these functions answer.
 *
 * The chart is one long track, a few pixels per day, scrolled sideways under a fixed value axis.
 * The axis fits the days in view, so the scale follows the scroll.
 */

import {
  addDays,
  dateInMonth,
  dayOf,
  daysBetween,
  daysInMonth,
  type IsoDate,
  monthOf,
} from "@/domain/value-objects/competence-month";
import { SHORT_MONTHS } from "@/shared/formatting/dates";

/** Horizontal pixels per day: about three months across a phone. A short history gets wider days. */
export const DAY_PX = 3;
/** The whole figure: the plot and, under it, the band with the month names. */
export const CHART_HEIGHT = 212;
export const MONTH_BAND = 24;
export const PLOT_HEIGHT = CHART_HEIGHT - MONTH_BAND;
/** Room kept above the highest day in view, and under the lowest, for their labels. */
export const PEAK_ROOM = 26;
export const VALLEY_ROOM = 22;
/** Room before the first day and after the last (the live dot must not be cut). */
export const LEAD_IN = 12;
export const LEAD_OUT = 16;
/** Width of the value axis, at the right of the plot. */
export const AXIS_WIDTH = 52;
/** The track fades out over this much at the right of the plot (the mask of `.nw-scroll`). */
export const EDGE_FADE = 8;
/** Days taken as in view before the browser has been measured (server render, first paint). */
export const ASSUMED_VISIBLE_DAYS = 90;
/** The room a month's name needs, the widest being "Jan 2027". */
export const MONTH_NAME_ROOM = 58;

/** The least the axis spans: a flat line gets a readable scale around it, not a division by zero. */
const MIN_SPAN_CENTS = 20_000;

// ---------------------------------------------------------------------------
// Days ↔ pixels
// ---------------------------------------------------------------------------

/** The horizontal scale of the track: how many days it holds and how wide each one is. */
export interface Track {
  readonly days: number;
  readonly dayPx: number;
}

/**
 * The track for `days` in a viewport `viewportWidth` wide: {@link DAY_PX} per day, so it scrolls —
 * or wider days when the whole history would not fill the viewport, so the line never ends half-way
 * across the plot. With the viewport still unknown (server render), the plain {@link DAY_PX}.
 */
export function trackFor(days: number, viewportWidth?: number): Track {
  if (viewportWidth === undefined || days < 2) return { days, dayPx: DAY_PX };
  return { days, dayPx: Math.max(DAY_PX, (viewportWidth - LEAD_IN - LEAD_OUT) / (days - 1)) };
}

/** The x of a day's point on the track. */
export const dayX = (index: number, track: Track): number => LEAD_IN + index * track.dayPx;

/** The full width of the track. */
export const trackWidth = (track: Track): number =>
  LEAD_IN + Math.max(0, track.days - 1) * track.dayPx + LEAD_OUT;

/** The day whose point is nearest to a track x. */
export function dayAtX(x: number, track: Track): number {
  return clamp(Math.round((x - LEAD_IN) / track.dayPx), 0, Math.max(0, track.days - 1));
}

export interface DayWindow {
  readonly first: number;
  readonly last: number;
}

/** The days whose points are inside the viewport `[offset, offset + width]` of the track. */
export function visibleDays(offset: number, width: number, track: Track): DayWindow {
  const end = Math.max(0, track.days - 1);
  // A hair of tolerance: a stretched track ends exactly on the viewport's edge, give or take a float.
  const first = clamp(Math.ceil((offset - LEAD_IN) / track.dayPx - 1e-6), 0, end);
  const last = clamp(Math.floor((offset + width - LEAD_IN) / track.dayPx + 1e-6), 0, end);
  // A viewport narrower than a day still reads the day it sits on.
  return first <= last ? { first, last } : { first: last, last };
}

/**
 * The window assumed before any measurement: the days up to `end`, the day the track is about to
 * be placed to end on (its last one, unless told otherwise).
 */
export function assumedWindow(days: number, end = days - 1): DayWindow {
  const last = clamp(end, 0, Math.max(0, days - 1));
  return { first: Math.max(0, last + 1 - ASSUMED_VISIBLE_DAYS), last };
}

/**
 * The days being read: those in view, less the ones under the fade at the right of the plot. Those
 * hint at what comes next; they count for neither the scale nor the labels.
 */
export function readableDays(offset: number, width: number, track: Track): DayWindow {
  return visibleDays(offset, Math.max(0, width - EDGE_FADE), track);
}

/**
 * The scroll offset that ends the readable part of a `width`-wide viewport on day `index`: right
 * after it, so the day is whole and the next one (the next month) only hinted at, under the fade —
 * or, on the last day, at the very end of the track, with the room the live dot needs.
 */
export function offsetEndingAt(index: number, width: number, track: Track): number {
  const edge = index >= track.days - 1 ? trackWidth(track) : dayX(index, track) + track.dayPx / 2 + EDGE_FADE;
  return clamp(edge - width, 0, Math.max(0, trackWidth(track) - width));
}

// ---------------------------------------------------------------------------
// Values ↔ pixels
// ---------------------------------------------------------------------------

export interface Extremes {
  readonly min: number;
  readonly max: number;
  readonly minIndex: number;
  readonly maxIndex: number;
}

/** The lowest and highest day in a window. On a tie, the most recent day. */
export function extremes(values: readonly number[], window: DayWindow): Extremes {
  let minIndex = window.first;
  let maxIndex = window.first;
  let min = values[window.first] ?? 0;
  let max = min;
  for (let i = window.first + 1; i <= window.last; i++) {
    const value = values[i];
    if (value === undefined) break;
    if (value <= min) {
      min = value;
      minIndex = i;
    }
    if (value >= max) {
      max = value;
      maxIndex = i;
    }
  }
  return { min, max, minIndex, maxIndex };
}

/** The values at the bottom (`lo`) and at the top (`hi`) of the plot. */
export interface ValueRange {
  readonly lo: number;
  readonly hi: number;
}

/**
 * The range that fits `[min, max]` in the plot with the label rooms kept: the highest day lands
 * {@link PEAK_ROOM} below the top, the lowest {@link VALLEY_ROOM} above the bottom.
 */
export function fitRange(min: number, max: number): ValueRange {
  let low = min;
  let high = max;
  if (high - low < MIN_SPAN_CENTS) {
    const middle = (high + low) / 2;
    low = middle - MIN_SPAN_CENTS / 2;
    high = middle + MIN_SPAN_CENTS / 2;
  }
  const perPixel = (high - low) / (PLOT_HEIGHT - PEAK_ROOM - VALLEY_ROOM);
  return { lo: low - VALLEY_ROOM * perPixel, hi: high + PEAK_ROOM * perPixel };
}

/** The y of a value inside the plot (0 at the top). */
export const valueY = (value: number, range: ValueRange): number =>
  ((range.hi - value) / (range.hi - range.lo)) * PLOT_HEIGHT;

// ---------------------------------------------------------------------------
// The value axis
// ---------------------------------------------------------------------------

const NICE_MULTIPLES = [1, 2, 2.5, 5, 10] as const;

/** The smallest "clean" step (1, 2, 2.5 or 5 times a power of ten) that is at least `raw`. */
export function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const multiple of NICE_MULTIPLES) {
    if (multiple * magnitude >= raw) return multiple * magnitude;
  }
  return 10 * magnitude;
}

/**
 * Round values to mark on the axis for a range: at most `maxCount` of them (so never closer than a
 * sixth of the plot, about 31px), on clean steps, zero included whenever it is in view. Marks too
 * close to the top or bottom edge to be labelled without being cut are left out.
 */
export function axisTicks(range: ValueRange, maxCount = 6): number[] {
  const step = niceStep((range.hi - range.lo) / maxCount);
  const ticks: number[] = [];
  for (let tick = Math.ceil(range.lo / step) * step; tick <= range.hi; tick += step) {
    const y = valueY(tick, range);
    if (y < 9 || y > PLOT_HEIGHT - 3) continue;
    ticks.push(tick === 0 ? 0 : tick); // never −0
  }
  return ticks;
}

/** An axis that reaches R$ 10.000 reads in thousands; a smaller one reads in full. */
export const axisIsCompact = (ticks: readonly number[]): boolean =>
  ticks.some((tick) => Math.abs(tick) >= 1_000_000);

const WHOLE = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const TWO_DECIMALS = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

/** An axis mark's label: "1.500" in full, "12,5 mil" / "1,25 mi" compact. One style per axis. */
export function formatAxisTick(cents: number, compact: boolean): string {
  const reais = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "";
  if (!compact || reais === 0) return `${sign}${WHOLE.format(reais)}`;
  if (reais >= 1_000_000) return `${sign}${TWO_DECIMALS.format(reais / 1_000_000)} mi`;
  return `${sign}${ONE_DECIMAL.format(reais / 1_000)} mil`;
}

// ---------------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------------

const px = (value: number): string => (Math.round(value * 10) / 10).toString();

/** Days drawn on each side of the ones in view: more than a fast swipe covers before the next frame. */
const DRAW_MARGIN_DAYS = 128;
/** The drawn stretch moves in steps of this many days, so it changes rarely while scrolling. */
const DRAW_STEP_DAYS = 32;

/**
 * The stretch of days worth drawing for a window in view: the window and a margin on each side.
 * Drawing only that keeps the cost of a frame the same however long the history is.
 */
export function drawnDays(window: DayWindow, days: number): DayWindow {
  const end = Math.max(0, days - 1);
  const first = Math.floor((window.first - DRAW_MARGIN_DAYS) / DRAW_STEP_DAYS) * DRAW_STEP_DAYS;
  const last = Math.ceil((window.last + DRAW_MARGIN_DAYS) / DRAW_STEP_DAYS) * DRAW_STEP_DAYS;
  return { first: clamp(first, 0, end), last: clamp(last, 0, end) };
}

/** The line through the days of `drawn`, as an SVG path in track pixels. Empty with no days. */
export function linePath(
  values: readonly number[],
  range: ValueRange,
  track: Track,
  drawn: DayWindow,
): string {
  let path = "";
  for (let index = drawn.first; index <= drawn.last; index++) {
    const value = values[index];
    if (value === undefined) break;
    path += `${path === "" ? "M" : "L"}${px(dayX(index, track))} ${px(valueY(value, range))}`;
  }
  return path;
}

/** The line closed down to the bottom of the plot — the wash under it. */
export function areaPath(line: string, track: Track, drawn: DayWindow): string {
  if (line === "") return "";
  const right = px(dayX(drawn.last, track));
  const left = px(dayX(drawn.first, track));
  return `${line}L${right} ${PLOT_HEIGHT}L${left} ${PLOT_HEIGHT}Z`;
}

// ---------------------------------------------------------------------------
// The calendar under the line
// ---------------------------------------------------------------------------

export interface MonthSpan {
  /** `YYYY-MM`. */
  readonly month: string;
  /** Index of the month's first and last day on the track (the first/last month may be partial). */
  readonly first: number;
  readonly last: number;
  /** "Jul", or "Jan 2027" where the year is news: the first month shown and every January. */
  readonly label: string;
}

/** The months a track of `days` starting on `startDate` runs through, in order. */
export function monthSpans(startDate: IsoDate, days: number): MonthSpan[] {
  const spans: MonthSpan[] = [];
  let date = startDate;
  let index = 0;
  while (index < days) {
    const month = monthOf(date);
    const [year, monthNumber] = month.split("-").map(Number) as [number, number];
    const length = Math.min(daysInMonth(year, monthNumber) - dayOf(date) + 1, days - index);
    const name = SHORT_MONTHS[monthNumber - 1] ?? "";
    spans.push({
      month,
      first: index,
      last: index + length - 1,
      label: spans.length === 0 || monthNumber === 1 ? `${name} ${year}` : name,
    });
    index += length;
    date = addDays(date, length);
  }
  return spans;
}

/** The stretch of the track a month's name may sit in. */
export interface MonthSlot {
  readonly left: number;
  readonly width: number;
}

/**
 * Where each month's name may sit: over its own days, from the boundary with the month before to
 * the boundary with the next. The first and the last month take the track's ends too, and a last
 * month that has only just begun borrows from the one before, so its name always has room.
 */
export function monthSlots(spans: readonly MonthSpan[], track: Track): MonthSlot[] {
  const end = trackWidth(track);
  return spans.map((span, i) => {
    const isLast = i === spans.length - 1;
    const start = i === 0 ? 0 : dayX(span.first, track) - track.dayPx / 2;
    const stop = isLast ? end : dayX(span.last, track) + track.dayPx / 2;
    const left = isLast ? Math.max(0, Math.min(start, end - MONTH_NAME_ROOM)) : start;
    return { left, width: stop - left };
  });
}

/** How far from each side of the plot a month's name stays (the `left` / `right` of `.nw-month`). */
const MONTH_NAME_INSET = { left: 22, right: 10 } as const;
/** The room a plain three-letter name needs. */
const SHORT_MONTH_NAME_ROOM = 26;

/**
 * Whether a month's name fits, whole, in the part of its slot that is in view. A month that is
 * only just entering (or leaving) the plot goes unnamed rather than showing a cut name.
 */
export function monthNameFits(
  slot: MonthSlot,
  label: string,
  view: { readonly offset: number; readonly width: number },
): boolean {
  const from = Math.max(slot.left, view.offset + MONTH_NAME_INSET.left);
  const to = Math.min(slot.left + slot.width, view.offset + view.width - MONTH_NAME_INSET.right);
  return to - from >= (label.length > 3 ? MONTH_NAME_ROOM : SHORT_MONTH_NAME_ROOM);
}

/** The date of a day on the track. */
export const dateAt = (startDate: IsoDate, index: number): IsoDate => addDays(startDate, index);

/** The day the track should end at to show `month`: its last day, kept inside the track. */
export function monthEndIndex(startDate: IsoDate, days: number, month: string): number {
  return clamp(daysBetween(startDate, dateInMonth(month, 31)), 0, Math.max(0, days - 1));
}

const monthName = (date: IsoDate): string => SHORT_MONTHS[Number(date.slice(5, 7)) - 1] ?? "";

/**
 * The months between two days, for the header: "Set – Nov", or "Set – Nov/25" when the range ends
 * in a year that is not `today`'s. Only the last month carries a year (a range that crosses the
 * new year reads "Nov – Jan/26": it began the year before), and this year goes without saying —
 * the label stays short enough never to wrap the header on a phone.
 */
export function monthRangeLabel(first: IsoDate, last: IsoDate, today: IsoDate): string {
  const year = last.slice(0, 4) === today.slice(0, 4) ? "" : `/${last.slice(2, 4)}`;
  if (monthOf(first) === monthOf(last)) return `${monthName(last)}${year}`;
  return `${monthName(first)} – ${monthName(last)}${year}`;
}

/** A day in words: "12 nov 2026", or "Hoje, 12 nov". */
export function dayLabel(date: IsoDate, today: IsoDate): string {
  const text = `${dayOf(date)} ${monthName(date).toLowerCase()}`;
  return date === today ? `Hoje, ${text}` : `${text} ${date.slice(0, 4)}`;
}

/** A day as "30/10" — short enough to sit beside a value on the chart. */
export const dayMonth = (date: IsoDate): string => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

// ---------------------------------------------------------------------------
// Reading a forecast day
// ---------------------------------------------------------------------------

/** Something expected to move the total on a day after today. */
export interface ForecastNote {
  readonly date: IsoDate;
  /** Signed: money in is positive. */
  readonly deltaCents: number;
  readonly label: string;
  /** Still pending past its own date: the forecast counts it for tomorrow. */
  readonly late: boolean;
}

/** One line of a forecast day's reading. */
export interface DayNote {
  readonly label: string;
  readonly deltaCents: number;
  readonly late: boolean;
}

/** What is expected to move a forecast day. */
export interface DayNotes {
  /** One line per name, the largest amount first. */
  readonly notes: readonly DayNote[];
  /** How many of the day's movements are late. */
  readonly lateCount: number;
}

/**
 * The movements of each forecast day, ready to be read: those under one name on the same day are
 * one line (their sum) — what is late apart from what falls on its own day —, a line that sums to
 * nothing is left out, and the largest comes first.
 */
export function notesByDay(events: readonly ForecastNote[]): Map<IsoDate, DayNotes> {
  const days = new Map<IsoDate, Map<string, { note: DayNote; count: number }>>();
  for (const event of events) {
    let lines = days.get(event.date);
    if (lines === undefined) {
      lines = new Map();
      days.set(event.date, lines);
    }
    const key = `${event.late ? "late" : "due"}|${event.label}`;
    const line = lines.get(key);
    lines.set(key, {
      note: {
        label: event.label,
        deltaCents: (line?.note.deltaCents ?? 0) + event.deltaCents,
        late: event.late,
      },
      count: (line?.count ?? 0) + 1,
    });
  }
  const byDay = new Map<IsoDate, DayNotes>();
  for (const [date, lines] of days) {
    const kept = [...lines.values()].filter((line) => line.note.deltaCents !== 0);
    if (kept.length === 0) continue;
    byDay.set(date, {
      notes: kept.map((line) => line.note).sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents)),
      lateCount: kept.reduce((sum, line) => sum + (line.note.late ? line.count : 0), 0),
    });
  }
  return byDay;
}

/** Room between a tooltip and the point it reads: when it sits above the point, and below it. */
const TIP_ABOVE = 12;
const TIP_BELOW = 14;
/** Room kept between a tooltip and the sides of the plot. */
const TIP_SIDE = 4;

/** Where a tooltip sits on the track. */
export interface TipPlace {
  readonly left: number;
  /** The edge it is held by: its bottom when it sits above its point (so its height may vary), else its top. */
  readonly edge: "top" | "bottom";
  /** The distance from that edge to the same edge of the chart. */
  readonly offset: number;
}

/**
 * Where a tooltip of a known size goes for the point `(x, y)` of the track, so the plot never cuts
 * it: above the point; else below it; else — too tall for either — beside the point, level with it.
 */
export function placeTip(
  point: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  view: { readonly offset: number; readonly width: number },
): TipPlace {
  const leftmost = view.offset + TIP_SIDE;
  const rightmost = Math.max(leftmost, view.offset + view.width - TIP_SIDE - size.width);
  const centred = clamp(point.x - size.width / 2, leftmost, rightmost);
  if (point.y - TIP_ABOVE - size.height >= 0) {
    return { left: centred, edge: "bottom", offset: CHART_HEIGHT - (point.y - TIP_ABOVE) };
  }
  if (point.y + TIP_BELOW + size.height <= CHART_HEIGHT) {
    return { left: centred, edge: "top", offset: point.y + TIP_BELOW };
  }
  const offset = clamp(point.y - size.height / 2, 0, Math.max(0, CHART_HEIGHT - size.height));
  const before = point.x - TIP_ABOVE - size.width;
  const after = point.x + TIP_ABOVE;
  if (before >= leftmost) return { left: before, edge: "top", offset };
  if (after <= rightmost) return { left: after, edge: "top", offset };
  return { left: centred, edge: "top", offset };
}

// ---------------------------------------------------------------------------
// Motion: the axis follows the scroll on a spring
// ---------------------------------------------------------------------------

/** A range in motion: where it is and how fast each end is moving (value units per second). */
export interface RangeSpring extends ValueRange {
  readonly vLo: number;
  readonly vHi: number;
}

/** Stiffness 300, damping 30: settles in about a third of a second, with no visible overshoot. */
const STIFFNESS = 300;
const DAMPING = 30;
/** Largest slice integrated at once; a longer frame is cut into several, so the spring stays stable. */
const MAX_STEP_SECONDS = 1 / 120;

export const restingAt = (range: ValueRange): RangeSpring => ({ lo: range.lo, hi: range.hi, vLo: 0, vHi: 0 });

/** Advance the spring by `seconds` towards `target`. */
export function stepSpring(spring: RangeSpring, target: ValueRange, seconds: number): RangeSpring {
  let { lo, hi, vLo, vHi } = spring;
  let remaining = Math.max(0, seconds);
  while (remaining > 0) {
    const dt = Math.min(remaining, MAX_STEP_SECONDS);
    vLo += (STIFFNESS * (target.lo - lo) - DAMPING * vLo) * dt;
    vHi += (STIFFNESS * (target.hi - hi) - DAMPING * vHi) * dt;
    lo += vLo * dt;
    hi += vHi * dt;
    remaining -= dt;
  }
  return { lo, hi, vLo, vHi };
}

/** Whether the spring is close enough to `target`, and slow enough, to stop: under a third of a pixel. */
export function springSettled(spring: RangeSpring, target: ValueRange): boolean {
  const perPixel = (target.hi - target.lo) / PLOT_HEIGHT;
  const near = (a: number, b: number): boolean => Math.abs(a - b) < perPixel / 3;
  const slow = (v: number): boolean => Math.abs(v) < perPixel * 4;
  return near(spring.lo, target.lo) && near(spring.hi, target.hi) && slow(spring.vLo) && slow(spring.vHi);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
