import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ASSUMED_VISIBLE_DAYS,
  areaPath,
  assumedWindow,
  axisIsCompact,
  axisTicks,
  DAY_PX,
  dateAt,
  dayAtX,
  dayLabel,
  dayMonth,
  dayX,
  drawnDays,
  extremes,
  fitRange,
  formatAxisTick,
  LEAD_IN,
  LEAD_OUT,
  linePath,
  MONTH_NAME_ROOM,
  monthEndIndex,
  monthRangeLabel,
  monthSlots,
  monthSpans,
  niceStep,
  offsetEndingAt,
  PEAK_ROOM,
  PLOT_HEIGHT,
  restingAt,
  springSettled,
  stepSpring,
  trackFor,
  trackWidth,
  VALLEY_ROOM,
  valueY,
  visibleDays,
} from "./net-worth-timeline";

/** A track at the plain scale: DAY_PX per day. */
const plain = (days: number) => trackFor(days);

describe("the track's scale", () => {
  it("is DAY_PX per day while the history is longer than the plot", () => {
    expect(trackFor(365)).toEqual({ days: 365, dayPx: DAY_PX });
    // 365 days at 3px are far wider than 270px: it scrolls.
    expect(trackFor(365, 270)).toEqual({ days: 365, dayPx: DAY_PX });
  });

  it("widens the days of a history that would not fill the plot", () => {
    // 165 days at 3px are 520px; in a 706px plot they would end three quarters of the way across.
    const track = trackFor(165, 706);
    expect(track.dayPx).toBeGreaterThan(DAY_PX);
    expect(trackWidth(track)).toBeCloseTo(706, 6);
    // Nothing left to scroll, and every day is in view.
    expect(offsetEndingAt(164, 706, track)).toBe(0);
    expect(visibleDays(0, 706, track)).toEqual({ first: 0, last: 164 });
  });

  it("never narrows a day, and always fills the plot or overflows it", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 2200 }),
        fc.integer({ min: 120, max: 1600 }),
        (days, viewport) => {
          const track = trackFor(days, viewport);
          expect(track.dayPx).toBeGreaterThanOrEqual(DAY_PX);
          expect(trackWidth(track)).toBeGreaterThanOrEqual(viewport - 1e-6);
          // Wherever it is scrolled to its end, the last day is in view.
          const end = Math.max(0, trackWidth(track) - viewport);
          expect(visibleDays(end, viewport, track).last).toBe(days - 1);
        },
      ),
    );
  });

  it("with too few days to draw, or no measurement yet, stays plain", () => {
    expect(trackFor(1, 500)).toEqual({ days: 1, dayPx: DAY_PX });
    expect(trackFor(0, 500)).toEqual({ days: 0, dayPx: DAY_PX });
    expect(trackFor(30, undefined)).toEqual({ days: 30, dayPx: DAY_PX });
  });
});

describe("days and pixels", () => {
  it("places one point every day width, after the lead-in", () => {
    const track = plain(31);
    expect(dayX(0, track)).toBe(LEAD_IN);
    expect(dayX(10, track)).toBe(LEAD_IN + 10 * DAY_PX);
    expect(trackWidth(track)).toBe(LEAD_IN + 30 * DAY_PX + LEAD_OUT);
    expect(trackWidth(plain(1))).toBe(LEAD_IN + LEAD_OUT);
    expect(trackWidth(plain(0))).toBe(LEAD_IN + LEAD_OUT);
    expect(dayX(10, { days: 31, dayPx: 4.5 })).toBe(LEAD_IN + 45);
  });

  it("finds the day nearest to an x, inside the track", () => {
    const track = plain(30);
    expect(dayAtX(dayX(7, track), track)).toBe(7);
    expect(dayAtX(dayX(7, track) + 1, track)).toBe(7);
    expect(dayAtX(dayX(7, track) + 2, track)).toBe(8);
    expect(dayAtX(-50, track)).toBe(0);
    expect(dayAtX(99_999, track)).toBe(29);
  });

  it("reads the days whose points are in view", () => {
    const year = plain(365);
    expect(visibleDays(0, 100, year)).toEqual({ first: 0, last: 29 });
    expect(visibleDays(300, 270, year)).toEqual({ first: 96, last: 186 });
    // Scrolled to the very end: the last day is the last one in view.
    expect(visibleDays(trackWidth(year) - 270, 270, year).last).toBe(364);
    // A viewport that falls between two points still reads a day.
    expect(visibleDays(dayX(5, year) + 1, 1, year)).toEqual({ first: 5, last: 5 });
    expect(visibleDays(0, 100, plain(1))).toEqual({ first: 0, last: 0 });
  });

  it("keeps every day it reports inside the viewport, and their neighbours outside", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 2000 }),
        fc.integer({ min: 0, max: 6000 }),
        fc.integer({ min: DAY_PX, max: 900 }),
        (days, offset, width) => {
          const track = plain(days);
          const { first, last } = visibleDays(offset, width, track);
          expect(first).toBeLessThanOrEqual(last);
          expect(first).toBeGreaterThanOrEqual(0);
          expect(last).toBeLessThanOrEqual(days - 1);
          // Only meaningful while the viewport is over the points themselves.
          if (offset + width < dayX(0, track) || offset > dayX(days - 1, track)) return;
          expect(dayX(first, track)).toBeGreaterThanOrEqual(offset);
          expect(dayX(last, track)).toBeLessThanOrEqual(offset + width);
          if (first > 0) expect(dayX(first - 1, track)).toBeLessThan(offset);
          if (last < days - 1) expect(dayX(last + 1, track)).toBeGreaterThan(offset + width);
        },
      ),
    );
  });

  it("assumes the most recent days before anything is measured", () => {
    expect(assumedWindow(400)).toEqual({ first: 400 - ASSUMED_VISIBLE_DAYS, last: 399 });
    expect(assumedWindow(30)).toEqual({ first: 0, last: 29 });
  });

  it("ends the viewport on a day, without leaving the track", () => {
    const year = plain(365);
    // The last day ends the track: the offset is the furthest the track scrolls.
    expect(offsetEndingAt(364, 270, year)).toBe(trackWidth(year) - 270);
    // Any other day: the viewport ends right after it, the next day out of view.
    const offset = offsetEndingAt(200, 270, year);
    expect(offset).toBe(dayX(200, year) + DAY_PX / 2 - 270);
    expect(visibleDays(offset, 270, year).last).toBe(200);
    expect(offsetEndingAt(10, 270, year)).toBe(0);
    // A track shorter than the viewport does not scroll.
    expect(offsetEndingAt(29, 600, plain(30))).toBe(0);
  });
});

describe("extremes", () => {
  const values = [500, 900, 200, 900, 200, 400];

  it("finds the lowest and the highest day of a window", () => {
    expect(extremes(values, { first: 0, last: 2 })).toEqual({ min: 200, max: 900, minIndex: 2, maxIndex: 1 });
  });

  it("on a tie, takes the most recent day", () => {
    expect(extremes(values, { first: 0, last: 5 })).toEqual({ min: 200, max: 900, minIndex: 4, maxIndex: 3 });
  });

  it("reads a one-day window", () => {
    expect(extremes(values, { first: 5, last: 5 })).toEqual({ min: 400, max: 400, minIndex: 5, maxIndex: 5 });
  });
});

describe("fitRange / valueY", () => {
  it("keeps the label rooms: the highest day under the top, the lowest above the bottom", () => {
    const range = fitRange(100_000, 400_000);
    expect(valueY(400_000, range)).toBeCloseTo(PEAK_ROOM, 6);
    expect(valueY(100_000, range)).toBeCloseTo(PLOT_HEIGHT - VALLEY_ROOM, 6);
    expect(valueY(range.hi, range)).toBe(0);
    expect(valueY(range.lo, range)).toBeCloseTo(PLOT_HEIGHT, 6);
  });

  it("gives a flat line a scale around it instead of a zero-height one", () => {
    const range = fitRange(150_000, 150_000);
    expect(range.hi - range.lo).toBeGreaterThan(20_000);
    // The line sits between the two rooms, not glued to an edge.
    const y = valueY(150_000, range);
    expect(y).toBeGreaterThan(PEAK_ROOM);
    expect(y).toBeLessThan(PLOT_HEIGHT - VALLEY_ROOM);
  });

  it("works below zero", () => {
    const range = fitRange(-65_609, 341_290);
    expect(range.lo).toBeLessThan(-65_609);
    expect(range.hi).toBeGreaterThan(341_290);
    expect(valueY(0, range)).toBeGreaterThan(valueY(341_290, range));
    expect(valueY(0, range)).toBeLessThan(valueY(-65_609, range));
  });

  it("always contains the data, top to bottom, in order", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50_000_000, max: 50_000_000 }),
        fc.integer({ min: 0, max: 80_000_000 }),
        (min, span) => {
          const max = min + span;
          const range = fitRange(min, max);
          expect(range.hi).toBeGreaterThan(range.lo);
          expect(valueY(max, range)).toBeGreaterThanOrEqual(PEAK_ROOM - 1e-6);
          expect(valueY(min, range)).toBeLessThanOrEqual(PLOT_HEIGHT - VALLEY_ROOM + 1e-6);
          expect(valueY(max, range)).toBeLessThanOrEqual(valueY(min, range));
        },
      ),
    );
  });
});

describe("the value axis", () => {
  it("steps on 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceStep(80_571)).toBe(100_000);
    expect(niceStep(100_000)).toBe(100_000);
    expect(niceStep(100_001)).toBe(200_000);
    expect(niceStep(21_000)).toBe(25_000);
    expect(niceStep(26_000)).toBe(50_000);
    expect(niceStep(6_000)).toBe(10_000);
    expect(niceStep(1_000)).toBe(1_000);
  });

  it("marks round values, zero included when it is in view", () => {
    // R$ −656,09 … R$ 3.412,90 in view; the rooms for the labels stretch the axis a little past both.
    const ticks = axisTicks(fitRange(-65_609, 341_290));
    expect(ticks).toEqual([-100_000, 0, 100_000, 200_000, 300_000]);
    expect(ticks.some((tick) => Object.is(tick, -0))).toBe(false);
    // All positive, starting right at zero: the mark is a plain 0, not −0.
    expect(axisTicks({ lo: -40_000, hi: 500_000 })[0]).toBe(0);
  });

  it("leaves out a mark that would be cut at the top or bottom edge", () => {
    // The range starts and ends exactly on a step: both ends are on an edge and unlabelled.
    expect(axisTicks({ lo: 0, hi: 500_000 })).toEqual([100_000, 200_000, 300_000, 400_000]);
  });

  it("never crowds the axis, whatever the range", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50_000_000, max: 50_000_000 }),
        fc.integer({ min: 0, max: 80_000_000 }),
        (min, span) => {
          const range = fitRange(min, min + span);
          const ticks = axisTicks(range);
          expect(ticks.length).toBeGreaterThanOrEqual(1);
          expect(ticks.length).toBeLessThanOrEqual(6);
          for (const [i, tick] of ticks.entries()) {
            // Whole reais (the step never goes under R$ 50), inside the plot, ascending.
            expect(Math.abs(tick % 100)).toBe(0);
            expect(valueY(tick, range)).toBeGreaterThanOrEqual(9);
            expect(valueY(tick, range)).toBeLessThanOrEqual(PLOT_HEIGHT - 3);
            const previous = ticks[i - 1];
            if (previous !== undefined) {
              // At least a label's height apart.
              expect(valueY(previous, range) - valueY(tick, range)).toBeGreaterThan(30);
            }
          }
        },
      ),
    );
  });

  it("reads in full under R$ 10.000 and in thousands once the axis reaches it", () => {
    expect(axisIsCompact([0, 100_000, 200_000])).toBe(false);
    expect(axisIsCompact([0, 500_000, 1_000_000])).toBe(true);
    expect(axisIsCompact([-1_500_000, 0])).toBe(true);

    expect(formatAxisTick(0, false)).toBe("0");
    expect(formatAxisTick(250_000, false)).toBe("2.500");
    expect(formatAxisTick(-150_000, false)).toBe("−1.500");

    expect(formatAxisTick(0, true)).toBe("0");
    expect(formatAxisTick(500_000, true)).toBe("5 mil");
    expect(formatAxisTick(1_250_000, true)).toBe("12,5 mil");
    expect(formatAxisTick(-2_000_000, true)).toBe("−20 mil");
    expect(formatAxisTick(125_000_000, true)).toBe("1,25 mi");
  });
});

describe("the line", () => {
  const range = { lo: 0, hi: 100 };

  const all = (count: number) => ({ first: 0, last: count - 1 });

  it("goes through every day asked for, in track pixels", () => {
    expect(linePath([0, 100, 50], range, plain(3), all(3))).toBe(
      `M${LEAD_IN} ${PLOT_HEIGHT}L${LEAD_IN + DAY_PX} 0L${LEAD_IN + 2 * DAY_PX} ${PLOT_HEIGHT / 2}`,
    );
    expect(linePath([], range, plain(0), all(0))).toBe("");
    // Wider days spread the same points further apart.
    expect(linePath([0, 100], range, { days: 2, dayPx: 10 }, all(2))).toBe(
      `M${LEAD_IN} ${PLOT_HEIGHT}L${LEAD_IN + 10} 0`,
    );
  });

  it("draws only a stretch of the days, each still at its own place", () => {
    const values = [0, 100, 50, 100, 0];
    expect(linePath(values, range, plain(5), { first: 2, last: 3 })).toBe(
      `M${LEAD_IN + 2 * DAY_PX} ${PLOT_HEIGHT / 2}L${LEAD_IN + 3 * DAY_PX} 0`,
    );
    // A stretch that runs past the data stops with it.
    expect(linePath(values, range, plain(5), { first: 4, last: 9 })).toBe(
      `M${LEAD_IN + 4 * DAY_PX} ${PLOT_HEIGHT}`,
    );
  });

  it("closes down to the bottom of the plot for the wash under it", () => {
    const line = linePath([0, 100], range, plain(2), all(2));
    expect(areaPath(line, plain(2), all(2))).toBe(
      `${line}L${LEAD_IN + DAY_PX} ${PLOT_HEIGHT}L${LEAD_IN} ${PLOT_HEIGHT}Z`,
    );
    const part = linePath([0, 100, 50, 100, 0], range, plain(5), { first: 2, last: 3 });
    expect(areaPath(part, plain(5), { first: 2, last: 3 })).toBe(
      `${part}L${LEAD_IN + 3 * DAY_PX} ${PLOT_HEIGHT}L${LEAD_IN + 2 * DAY_PX} ${PLOT_HEIGHT}Z`,
    );
    expect(areaPath("", plain(0), all(0))).toBe("");
  });

  it("draws the days in view and a margin around them, moving in steps", () => {
    // A short history is drawn whole.
    expect(drawnDays({ first: 72, last: 164 }, 165)).toEqual({ first: 0, last: 164 });
    // A long one: the window, at least 128 days on each side, on 32-day steps.
    expect(drawnDays({ first: 1000, last: 1092 }, 1808)).toEqual({ first: 864, last: 1248 });
    // Scrolling a little does not move it…
    expect(drawnDays({ first: 1010, last: 1102 }, 1808)).toEqual({ first: 864, last: 1248 });
    // …and at the ends it stops with the track.
    expect(drawnDays({ first: 1715, last: 1807 }, 1808)).toEqual({ first: 1568, last: 1807 });
    expect(drawnDays({ first: 0, last: 92 }, 1808)).toEqual({ first: 0, last: 224 });
  });

  it("always draws what is in view, with its margin", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2500 }), fc.nat(2500), fc.nat(600), (days, start, length) => {
        const first = Math.min(start, days - 1);
        const last = Math.min(first + length, days - 1);
        const drawn = drawnDays({ first, last }, days);
        expect(drawn.first).toBeLessThanOrEqual(Math.max(0, first - 128));
        expect(drawn.last).toBeGreaterThanOrEqual(Math.min(days - 1, last + 128));
        expect(drawn.first).toBeGreaterThanOrEqual(0);
        expect(drawn.last).toBeLessThanOrEqual(days - 1);
      }),
    );
  });
});

describe("the calendar under the line", () => {
  it("splits the track into months, the year shown where it is news", () => {
    expect(monthSpans("2026-06-01", 165)).toEqual([
      { month: "2026-06", first: 0, last: 29, label: "Jun 2026" },
      { month: "2026-07", first: 30, last: 60, label: "Jul" },
      { month: "2026-08", first: 61, last: 91, label: "Ago" },
      { month: "2026-09", first: 92, last: 121, label: "Set" },
      { month: "2026-10", first: 122, last: 152, label: "Out" },
      { month: "2026-11", first: 153, last: 164, label: "Nov" },
    ]);
  });

  it("handles a partial first month and the turn of the year", () => {
    expect(monthSpans("2026-11-20", 60)).toEqual([
      { month: "2026-11", first: 0, last: 10, label: "Nov 2026" },
      { month: "2026-12", first: 11, last: 41, label: "Dez" },
      { month: "2027-01", first: 42, last: 59, label: "Jan 2027" },
    ]);
    expect(monthSpans("2026-06-01", 0)).toEqual([]);
  });

  it("covers every day exactly once", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1500 }), fc.integer({ min: 1, max: 2200 }), (shift, days) => {
        const start = dateAt("2024-01-01", shift);
        const spans = monthSpans(start, days);
        expect(spans[0]?.first).toBe(0);
        expect(spans.at(-1)?.last).toBe(days - 1);
        for (const [i, span] of spans.entries()) {
          expect(dateAt(start, span.first).slice(0, 7)).toBe(span.month);
          expect(dateAt(start, span.last).slice(0, 7)).toBe(span.month);
          const next = spans[i + 1];
          if (next !== undefined) expect(next.first).toBe(span.last + 1);
        }
      }),
    );
  });

  it("gives each month's name the stretch over its own days", () => {
    const track = plain(181); // 1 Jun … 28 Nov
    const slots = monthSlots(monthSpans("2026-06-01", 181), track);
    // June starts with the track; July runs from one month boundary to the next.
    expect(slots[0]).toEqual({ left: 0, width: dayX(29, track) + DAY_PX / 2 });
    expect(slots[1]).toEqual({ left: dayX(30, track) - DAY_PX / 2, width: 31 * DAY_PX });
    // November ends with the track, room after today included.
    expect(slots[5]).toEqual({
      left: dayX(153, track) - DAY_PX / 2,
      width: trackWidth(track) - dayX(153, track) + DAY_PX / 2,
    });
  });

  it("lets a month that has only just begun borrow room for its name", () => {
    // 1 Jun … 2 Nov: two days of November are not wide enough for "Nov".
    const track = plain(155);
    const november = monthSlots(monthSpans("2026-06-01", 155), track)[5];
    expect(november?.width).toBe(MONTH_NAME_ROOM);
    expect((november?.left ?? 0) + (november?.width ?? 0)).toBe(trackWidth(track));
  });

  it("tiles the track with the slots, end to end", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1500 }), fc.integer({ min: 2, max: 2200 }), (shift, days) => {
        const track = plain(days);
        const spans = monthSpans(dateAt("2024-01-01", shift), days);
        const slots = monthSlots(spans, track);
        expect(slots).toHaveLength(spans.length);
        expect(slots[0]?.left).toBe(0);
        const lastSlot = slots.at(-1);
        expect((lastSlot?.left ?? 0) + (lastSlot?.width ?? 0)).toBe(trackWidth(track));
        for (const [i, slot] of slots.entries()) {
          expect(slot.width).toBeGreaterThan(0);
          const next = slots[i + 1];
          // Each slot ends where the next month begins (the last one may reach back into it).
          if (next !== undefined && i + 2 < slots.length) expect(slot.left + slot.width).toBe(next.left);
        }
      }),
    );
  });

  it("finds where the track should end to show a month", () => {
    expect(monthEndIndex("2026-06-01", 165, "2026-08")).toBe(91); // 31 Aug
    expect(monthEndIndex("2026-06-01", 165, "2026-11")).toBe(164); // not over yet: today
    expect(monthEndIndex("2026-06-01", 165, "2027-02")).toBe(164); // a month still to come
    expect(monthEndIndex("2026-06-01", 165, "2026-03")).toBe(0); // before the track starts
  });

  it("names the months in view", () => {
    // This year goes without saying.
    expect(monthRangeLabel("2026-11-01", "2026-11-12", "2026-11-12")).toBe("Nov");
    expect(monthRangeLabel("2026-09-03", "2026-11-12", "2026-11-12")).toBe("Set – Nov");
    // Another year is named, once, after the last month.
    expect(monthRangeLabel("2025-09-03", "2025-11-12", "2026-11-12")).toBe("Set – Nov/25");
    expect(monthRangeLabel("2025-12-01", "2025-12-31", "2026-11-12")).toBe("Dez/25");
    // Across the new year: it ends in the year named (or in this one), and began the year before.
    expect(monthRangeLabel("2024-11-20", "2025-01-15", "2026-11-12")).toBe("Nov – Jan/25");
    expect(monthRangeLabel("2025-11-20", "2026-01-15", "2026-01-15")).toBe("Nov – Jan");
  });

  it("names a day", () => {
    expect(dayLabel("2026-10-05", "2026-11-12")).toBe("5 out 2026");
    expect(dayLabel("2026-11-12", "2026-11-12")).toBe("Hoje, 12 nov");
    expect(dayMonth("2026-10-05")).toBe("05/10");
    expect(dateAt("2026-06-01", 164)).toBe("2026-11-12");
  });
});

describe("the axis spring", () => {
  const from = restingAt({ lo: 0, hi: 100_000 });
  const target = { lo: 50_000, hi: 400_000 };

  it("settles on the target in well under a second, frame after frame", () => {
    let spring = from;
    let frames = 0;
    while (!springSettled(spring, target) && frames < 240) {
      spring = stepSpring(spring, target, 1 / 60);
      frames += 1;
    }
    expect(frames).toBeGreaterThan(5); // it travels, it does not jump
    expect(frames).toBeLessThan(45); // ~0.75 s at 60 fps
    expect(Math.abs(spring.lo - target.lo)).toBeLessThan(1_000);
    expect(Math.abs(spring.hi - target.hi)).toBeLessThan(1_000);
  });

  it("barely overshoots", () => {
    let spring = from;
    let highest = spring.hi;
    for (let i = 0; i < 240; i++) {
      spring = stepSpring(spring, target, 1 / 60);
      highest = Math.max(highest, spring.hi);
    }
    // Under 1% past the target on a 300.000 trip.
    expect(highest - target.hi).toBeLessThan(3_000);
  });

  it("stays stable through a long frame (a tab coming back to the foreground)", () => {
    const spring = stepSpring(from, target, 2);
    expect(Number.isFinite(spring.lo) && Number.isFinite(spring.hi)).toBe(true);
    expect(springSettled(spring, target)).toBe(true);
  });

  it("does not move with no time, and is at rest where it was placed", () => {
    expect(stepSpring(from, target, 0)).toEqual(from);
    expect(springSettled(restingAt(target), target)).toBe(true);
    expect(springSettled(from, target)).toBe(false);
  });
});
