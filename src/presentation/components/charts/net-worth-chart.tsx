"use client";

import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { InfoHint } from "@/presentation/components/ui/info-hint";
import { useReducedMotion } from "@/presentation/lib/use-reduced-motion";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRL } from "@/shared/formatting/currency";
import { monthLabel } from "@/shared/formatting/dates";
import {
  AXIS_WIDTH,
  areaPath,
  assumedWindow,
  axisIsCompact,
  axisTicks,
  CHART_HEIGHT,
  dateAt,
  dayAtX,
  dayLabel,
  dayMonth,
  dayX,
  drawnDays,
  EDGE_FADE,
  extremes,
  type ForecastNote,
  fitRange,
  formatAxisTick,
  linePath,
  MONTH_BAND,
  monthEndIndex,
  monthNameFits,
  monthRangeLabel,
  monthSlots,
  monthSpans,
  notesByDay,
  offsetEndingAt,
  PLOT_HEIGHT,
  placeTip,
  type RangeSpring,
  readableDays,
  restingAt,
  springSettled,
  stepSpring,
  trackFor,
  trackWidth,
  type ValueRange,
  valueY,
} from "./net-worth-timeline";

export interface NetWorthChartProps {
  /** The day the first value is the total of. */
  readonly startDate: string;
  /** One end-of-day total per day; the last one is today's (the live balance). */
  readonly valuesCents: readonly number[];
  /** The total expected at the end of each day after today — drawn dashed. Optional. */
  readonly forecastCents?: readonly number[];
  /** What is expected to move the total on the forecast days, for the tooltip. */
  readonly forecastEvents?: readonly ForecastNote[];
  readonly today: string;
  /** The month the page is browsing: the chart scrolls to it and marks its name. */
  readonly month: string;
}

/** The part of the track the browser is showing. */
interface Viewport {
  readonly offset: number;
  readonly width: number;
}

/** Half the widest the tooltip gets: nearer than this to a side of the plot, it stops centring. */
const TIP_HALF_WIDTH = 82;
/** How far past its day a tooltip that is not centred starts (or ends). */
const TIP_OVERHANG = 14;
/** The tooltip's height with its two fixed lines, and what each further line adds. */
const TIP_HEIGHT = 52;
const TIP_LINE = 17;
/** A tooltip that names what moves a forecast day has a set width, so it can be placed whole. */
const TIP_LISTING_WIDTH = 224;
/** How many of a forecast day's movements the tooltip names before "+ n". */
const TIP_EVENTS = 3;
/** A label nearer than this to a side of the plot hangs towards the middle instead of centring. */
const LABEL_EDGE = 76;
/** How long a released drag keeps gliding: the time constant of its decay, in ms. */
const GLIDE_MS = 325;
/** How long the track takes to glide to the page's month: the shortest and the longest trip. */
const GLIDE_TO_MONTH_MS = { min: 320, max: 720 };

/**
 * Tweens a numeric series from its previous values to `target`, re-rendering each frame, so the
 * line glides when a movement is added or edited. Snaps when motion is off or the number of days
 * changed (a new day would shift every point sideways). The effect keys on a value-signature so
 * an incidental re-render does not restart the tween.
 */
function useTweenedSeries(target: readonly number[], animate: boolean, dur = 900): readonly number[] {
  const signature = useMemo(() => target.join("|"), [target]);
  const targetRef = useRef(target);
  targetRef.current = target;
  /** What the line shows right now — where the next tween starts from. */
  const shown = useRef(target);
  const [values, setValues] = useState(target);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` is the value-signature trigger; the latest array is read via `targetRef` so the tween doesn't restart on incidental re-renders.
  useEffect(() => {
    const from = shown.current;
    const to = targetRef.current;
    const show = (next: readonly number[]) => {
      shown.current = next;
      setValues(next);
    };
    if (!animate || from.length !== to.length) {
      show(to);
      return;
    }
    // Nothing to travel (the same values, e.g. when motion is switched on): no frames at all.
    if (from.every((value, i) => value === to[i])) {
      shown.current = to;
      return;
    }
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / dur);
      // ease-in-out-cubic — the curve flows rather than snaps.
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
      if (progress < 1) {
        show(to.map((value, i) => (from[i] ?? value) + (value - (from[i] ?? value)) * eased));
        frame = requestAnimationFrame(tick);
      } else {
        show(to);
      }
    };
    frame = requestAnimationFrame(tick);
    // Interrupted mid-way (new data): the next tween starts from what is on screen.
    return () => cancelAnimationFrame(frame);
  }, [signature, animate, dur]);

  return values;
}

/**
 * The axis range on a spring: follows `target` (the fit of what is in view) so the scale glides
 * while the chart scrolls instead of jumping. With `animate` off it is `target` at once.
 */
function useSpringRange(targetLo: number, targetHi: number, animate: boolean): ValueRange {
  const [range, setRange] = useState<ValueRange>({ lo: targetLo, hi: targetHi });
  const spring = useRef<RangeSpring>(restingAt({ lo: targetLo, hi: targetHi }));
  const target = useRef<ValueRange>({ lo: targetLo, hi: targetHi });
  const frame = useRef(0);

  useEffect(() => {
    const goal = { lo: targetLo, hi: targetHi };
    target.current = goal;
    if (!animate) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      spring.current = restingAt(goal);
      setRange(goal);
      return;
    }
    // Already moving: the running loop reads the new target on its next frame.
    if (frame.current !== 0) return;
    let last = performance.now();
    const tick = (now: number) => {
      const next = stepSpring(spring.current, target.current, (now - last) / 1000);
      last = now;
      if (springSettled(next, target.current)) {
        spring.current = restingAt(target.current);
        setRange(target.current);
        frame.current = 0;
        return;
      }
      spring.current = next;
      setRange({ lo: next.lo, hi: next.hi });
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [targetLo, targetHi, animate]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );

  return range;
}

/**
 * The hero's net-worth timeline: the total balance day by day on one long track, scrolled
 * sideways under a fixed value axis.
 *
 * - The track scrolls natively (touch momentum, trackpad, shift+wheel) and by dragging with a mouse.
 * - The axis fits the days in view and follows the scroll on a spring; the highest and lowest day
 *   in view carry their value.
 * - Hovering (mouse), tapping (touch) or the arrow keys (the range input) read one day.
 * - Changing the page's month glides the track to that month.
 */
export function NetWorthChart({
  startDate,
  valuesCents,
  forecastCents,
  forecastEvents,
  today,
  month,
}: NetWorthChartProps) {
  // One series on the track: the days up to today, then the days expected.
  const series = useMemo(
    () => (forecastCents && forecastCents.length > 0 ? [...valuesCents, ...forecastCents] : valuesCents),
    [valuesCents, forecastCents],
  );
  const days = series.length;
  /** Today's place on the track: where the real line ends and the forecast begins. */
  const todayIndex = valuesCents.length - 1;
  const reduced = useReducedMotion();
  const privacy = useUIStore((s) => s.privacy);
  const gradientId = useId();

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Viewport | null>(null);
  /** Positioned and measured: the track may show (before that it would flash its oldest days). */
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [pin, setPin] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const animate = ready && !reduced;
  const values = useTweenedSeries(series, animate);
  // The horizontal scale: a few pixels per day, more when the whole history would not fill the plot.
  const { dayPx } = trackFor(days, view?.width);
  const track = useMemo(() => ({ days, dayPx }), [days, dayPx]);
  const months = useMemo(() => monthSpans(startDate, days), [startDate, days]);
  const slots = useMemo(() => monthSlots(months, track), [months, track]);
  const width = trackWidth(track);

  const win =
    view === null
      ? assumedWindow(days, monthEndIndex(startDate, days, month))
      : readableDays(view.offset, view.width, track);
  /** The part of the view that is read: all of it but the fade at the right. */
  const readable = useMemo(
    () => (view === null ? null : { offset: view.offset, width: Math.max(0, view.width - EDGE_FADE) }),
    [view],
  );
  const inView = extremes(values, win);
  const target = fitRange(inView.min, inView.max);
  const range = useSpringRange(target.lo, target.hi, animate);

  // Only the days around the plot are drawn; the stretch moves in steps, so it is stable while
  // the track scrolls and the path is rebuilt only when the scale (or the data) changes.
  const drawnWindow = drawnDays(win, days);
  const drawn = useMemo(
    () => ({ first: drawnWindow.first, last: drawnWindow.last }),
    [drawnWindow.first, drawnWindow.last],
  );
  // The real days up to today, solid; from today on, the forecast, dashed.
  const real = useMemo(
    () => ({ first: drawn.first, last: Math.min(drawn.last, todayIndex) }),
    [drawn, todayIndex],
  );
  const expected = useMemo(
    () => ({ first: Math.max(drawn.first, todayIndex), last: drawn.last }),
    [drawn, todayIndex],
  );
  const line = useMemo(() => linePath(values, range, track, real), [values, range, track, real]);
  const area = useMemo(() => areaPath(line, track, real), [line, track, real]);
  const forecastLine = useMemo(
    () => (expected.first < expected.last ? linePath(values, range, track, expected) : ""),
    [values, range, track, expected],
  );
  const forecastArea = useMemo(
    () => areaPath(forecastLine, track, expected),
    [forecastLine, track, expected],
  );

  // ---- measuring ---------------------------------------------------------------------------

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (el === null) return;
    const next = { offset: el.scrollLeft, width: el.clientWidth };
    setView((prev) =>
      prev !== null && prev.offset === next.offset && prev.width === next.width ? prev : next,
    );
  }, []);

  // The first measurement: the plot's width decides the track's scale, so placing waits for it.
  useEffect(() => {
    measure();
  }, [measure]);

  /** The track's own motion in flight: the glide to a month, or the coast after a mouse drag. */
  const glide = useRef(0);
  useEffect(() => () => cancelAnimationFrame(glide.current), []);

  // Follow the page's month: jump there once measured, glide there afterwards. The glide is the
  // chart's own animation rather than the browser's smooth scrolling: the same pace and easing in
  // every browser, and a touch, a drag or the wheel takes over from it at once.
  const measured = view !== null;
  const placed = useRef(false);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  /** The scroll offset that puts the page's month at the end of a view `width` wide. */
  const monthOffset = useRef<(width: number) => number>(() => 0);
  monthOffset.current = (width) => offsetEndingAt(monthEndIndex(startDate, track.days, month), width, track);
  /** Resting where the page's month put it, rather than where the reader has scrolled to. */
  const onMonth = useRef(true);
  /** Put the page's month at the end of the view: gliding there, or at once. */
  const showMonth = useRef<(gliding: boolean) => void>(() => {});
  showMonth.current = (gliding) => {
    const el = scrollerRef.current;
    if (el === null || track.days < 2) return;
    const left = monthOffset.current(el.clientWidth);
    onMonth.current = true;
    cancelAnimationFrame(glide.current);
    const from = el.scrollLeft;
    if (!gliding || reducedRef.current || Math.abs(left - from) < 1) {
      el.scrollLeft = left;
    } else {
      // Ease-out: leaves at once, lands softly. Longer trips take a little longer, up to a cap.
      const duration = Math.min(GLIDE_TO_MONTH_MS.max, GLIDE_TO_MONTH_MS.min + Math.abs(left - from) * 0.6);
      const started = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - started) / duration);
        el.scrollLeft = from + (left - from) * (1 - (1 - progress) ** 3);
        if (progress < 1) glide.current = requestAnimationFrame(step);
      };
      glide.current = requestAnimationFrame(step);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: month, startDate and track are the triggers — `showMonth` reads them from the latest render.
  useEffect(() => {
    if (!measured) return;
    showMonth.current(placed.current);
    placed.current = true;
    measure();
  }, [measured, month, startDate, track, measure]);

  // One frame after it is placed, so the axis starts on the real window instead of gliding to it.
  useEffect(() => {
    if (view === null || ready || !placed.current) return;
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [view, ready]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // A new width shows other days. Resting on the page's month, the track goes back to it;
      // scrolled elsewhere, it stays where the reader left it.
      if (onMonth.current) showMonth.current(false);
      measure();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const onScroll = (): void => {
    const el = scrollerRef.current;
    if (el !== null) onMonth.current = Math.abs(el.scrollLeft - monthOffset.current(el.clientWidth)) < 2;
    measure();
  };

  // ---- reading one day ---------------------------------------------------------------------

  /** The day under a pointer. */
  const dayUnder = (clientX: number, el: HTMLElement): number =>
    dayAtX(clientX - el.getBoundingClientRect().left + el.scrollLeft, track);

  /** Bring a day into view (the keyboard moves the reading past the edge of the plot). */
  const reveal = (index: number): void => {
    const el = scrollerRef.current;
    if (el === null) return;
    const x = dayX(index, track);
    const margin = 28;
    if (x < el.scrollLeft + margin) el.scrollLeft = Math.max(0, x - margin);
    else if (x > el.scrollLeft + el.clientWidth - margin) el.scrollLeft = x - el.clientWidth + margin;
  };

  // ---- dragging with a mouse (touch and trackpads scroll natively) ---------------------------

  const drag = useRef<{
    readonly id: number;
    readonly startX: number;
    readonly startLeft: number;
    moved: boolean;
    lastX: number;
    lastTime: number;
    velocity: number;
  } | null>(null);
  const swallowClick = useRef(false);
  const lastPointer = useRef("mouse");
  /**
   * Where the mouse last was, and whether the keyboard is doing the reading. A browser reports a
   * "move" of a mouse that is standing still whenever the track scrolls under it; those keep the
   * hover on the day under the cursor — unless a key was the last thing pressed, in which case the
   * reading stays with the keyboard until the mouse really moves.
   */
  const mouseAt = useRef<{ x: number; y: number } | null>(null);
  const keyboardReads = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    lastPointer.current = e.pointerType;
    cancelAnimationFrame(glide.current);
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag.current = {
      id: e.pointerId,
      startX: e.clientX,
      startLeft: e.currentTarget.scrollLeft,
      moved: false,
      lastX: e.clientX,
      lastTime: e.timeStamp,
      velocity: 0,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const held = drag.current;
    if (held !== null && held.id === e.pointerId) {
      const dx = e.clientX - held.startX;
      if (!held.moved && Math.abs(dx) > 4) {
        held.moved = true;
        el.setPointerCapture(e.pointerId);
        setDragging(true);
        setHover(null);
      }
      if (held.moved) {
        el.scrollLeft = held.startLeft - dx;
        const elapsed = e.timeStamp - held.lastTime;
        if (elapsed > 0) {
          held.velocity = 0.75 * ((e.clientX - held.lastX) / elapsed) + 0.25 * held.velocity;
          held.lastX = e.clientX;
          held.lastTime = e.timeStamp;
        }
        return;
      }
    }
    // Only a change of position is a real move; the first report after a key press just says
    // where the mouse is.
    const at = mouseAt.current;
    if (at !== null && (at.x !== e.clientX || at.y !== e.clientY)) keyboardReads.current = false;
    mouseAt.current = { x: e.clientX, y: e.clientY };
    if (!keyboardReads.current) setHover(dayUnder(e.clientX, el));
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const held = drag.current;
    if (held === null || held.id !== e.pointerId) return;
    drag.current = null;
    if (!held.moved) return;
    const el = e.currentTarget;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    setDragging(false);
    // The click that follows a drag is not a click.
    swallowClick.current = true;
    setTimeout(() => {
      swallowClick.current = false;
    }, 0);
    // Let go while moving: keep going, decaying. A pointer that had stopped stays put.
    if (reducedRef.current || e.timeStamp - held.lastTime > 60 || Math.abs(held.velocity) < 0.05) return;
    let velocity = held.velocity;
    let position = el.scrollLeft;
    let last = performance.now();
    const step = (now: number) => {
      const elapsed = now - last;
      last = now;
      velocity *= Math.exp(-elapsed / GLIDE_MS);
      position -= velocity * elapsed;
      el.scrollLeft = position;
      if (Math.abs(velocity) > 0.02 && position > 0 && position < el.scrollWidth - el.clientWidth) {
        glide.current = requestAnimationFrame(step);
      }
    };
    glide.current = requestAnimationFrame(step);
  };

  const onClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    // A mouse reads by hovering; a tap pins the day it lands on, and unpins it when tapped again.
    if (swallowClick.current || lastPointer.current === "mouse") return;
    const index = dayUnder(e.clientX, e.currentTarget);
    setPin((current) => (current !== null && Math.abs(current - index) <= 2 ? null : index));
  };

  // ---- what to draw ------------------------------------------------------------------------

  const monthTable = useMemo(
    () =>
      months.map((span) => {
        const { min, max } = extremes(series, span);
        // A month that ends after today closes on a forecast.
        return {
          month: span.month,
          closing: series[span.last] ?? 0,
          min,
          max,
          expected: span.last > todayIndex,
        };
      }),
    [months, series, todayIndex],
  );
  /** What is expected to move each forecast day. */
  const notes = useMemo(() => notesByDay(forecastEvents ?? []), [forecastEvents]);

  if (days < 2) {
    return (
      <div className="nw-chart">
        <div className="nw-head">
          <span className="kicker">Evolução do patrimônio</span>
        </div>
        <div className="nw-body nw-empty">Sem histórico ainda.</div>
      </div>
    );
  }

  const y = (value: number): number => valueY(value, range);
  const valueAt = (index: number): number => values[index] ?? 0;
  const ticks = axisTicks(target);
  const compact = axisIsCompact(ticks);

  // A pinned day that scrolled out of the plot is not read until it comes back.
  const pinned = pin !== null && pin >= win.first && pin <= win.last ? pin : null;
  const focus = hover ?? pinned;
  const last = days - 1;
  // The highest and the lowest day in view carry their value — unless one day is being read (its
  // tooltip takes the room), the values are hidden, or the line is flat (nothing to tell apart).
  const peaks =
    focus === null && !privacy && view !== null && inView.maxIndex !== inView.minIndex
      ? [
          { key: "max", index: inView.maxIndex, value: inView.max, dy: -9 },
          { key: "min", index: inView.minIndex, value: inView.min, dy: 16 },
        ]
      : [];

  /**
   * Which way something `reach` wide on each side of a day hangs, so a side of the plot never cuts
   * it: centred on the day, or towards the middle when the day is too near an edge.
   */
  const sideAt = (index: number, reach: number): "start" | "middle" | "end" => {
    if (readable === null) return "middle";
    const x = dayX(index, track) - readable.offset;
    if (x < reach) return "start";
    if (x > readable.width - reach) return "end";
    return "middle";
  };

  const focusDate = focus === null ? null : dateAt(startDate, focus);
  const focusValue = focus === null ? 0 : (series[focus] ?? 0);
  const focusChange = focus === null || focus === 0 ? 0 : focusValue - (series[focus - 1] ?? focusValue);
  const focusY = focus === null ? 0 : y(valueAt(focus));
  // A day after today is a forecast: it names what is expected to move it instead of what did.
  const focusExpected = focus !== null && focus > todayIndex;
  const focusNotes = focusExpected && focusDate !== null && !privacy ? notes.get(focusDate) : undefined;
  const named = focusNotes?.notes.slice(0, TIP_EVENTS) ?? [];
  const unnamed = (focusNotes?.notes.length ?? 0) - named.length;
  const lateCount = focusNotes?.lateCount ?? 0;
  const tipFootnote = [
    unnamed > 0 ? `+ ${unnamed} no mesmo dia` : "",
    lateCount > 0 ? `${lateCount} em atraso` : "",
  ]
    .filter((part) => part !== "")
    .join(" · ");
  const tipLines = focusExpected
    ? named.length + (tipFootnote === "" ? 0 : 1)
    : !privacy && focusChange !== 0
      ? 1
      : 0;
  const tipHeight = TIP_HEIGHT + tipLines * TIP_LINE;
  // A tooltip that names what moves the day is placed whole, by its set width; the plain one hangs
  // from its day.
  const listingWidth = Math.min(TIP_LISTING_WIDTH, (readable?.width ?? TIP_LISTING_WIDTH) - 8);
  const listing =
    named.length > 0 && focus !== null && readable !== null
      ? placeTip({ x: dayX(focus, track), y: focusY }, { width: listingWidth, height: tipHeight }, readable)
      : null;
  const tipAbove = focusY - 12 - tipHeight >= 0;
  const tipSide = focus === null ? "middle" : sideAt(focus, TIP_HALF_WIDTH);
  // Next to its day: centred on it, or starting / ending just past it when an edge is near.
  const tipX =
    focus === null || readable === null
      ? 0
      : tipSide === "start"
        ? Math.max(dayX(focus, track) - TIP_OVERHANG, readable.offset + 4)
        : tipSide === "end"
          ? Math.min(dayX(focus, track) + TIP_OVERHANG, readable.offset + readable.width - 4)
          : dayX(focus, track);
  const tipShift = tipSide === "start" ? "0" : tipSide === "end" ? "-100%" : "-50%";

  const sliderDay = pin ?? todayIndex;
  const sliderValue = series[sliderDay] ?? 0;
  const sliderNotes =
    sliderDay > todayIndex && !privacy ? (notes.get(dateAt(startDate, sliderDay))?.notes ?? []) : [];
  // The same reading in words: the day, its total, and — on a forecast day — what moves it.
  const sliderText = [
    `${dayLabel(dateAt(startDate, sliderDay), today)}: ${privacy ? "valor oculto" : formatBRL(sliderValue)}${
      sliderDay > todayIndex ? " (previsto)" : ""
    }`,
    ...sliderNotes
      .slice(0, TIP_EVENTS)
      .map((note) => `${note.label}${note.late ? ", em atraso" : ""}: ${formatBRL(note.deltaCents)}`),
  ].join(". ");

  return (
    <div className="nw-chart">
      <div className="nw-head">
        <span className="kicker">
          Evolução do{" "}
          <span className="nw-head-last">
            patrimônio
            <InfoHint label="Como ler este gráfico">
              Linha cheia: o saldo real das suas contas em cada dia, até hoje.
              {todayIndex < last
                ? " Tracejado: a previsão. Cada lançamento futuro ou fixo entra no dia dele, cada fatura no vencimento, o que está em atraso conta para amanhã e o que as pessoas te devem entra no último dia do mês — por isso o último dia de cada mês é o “fim do mês” da visão Geral."
                : ""}
            </InfoHint>
          </span>
        </span>
        <span className="pill purple">
          {monthRangeLabel(dateAt(startDate, win.first), dateAt(startDate, win.last), today)}
        </span>
      </div>
      <div className="nw-body">
        <figure className="nw" data-ready={ready} style={{ height: CHART_HEIGHT }}>
          <figcaption className="sr-only">
            Evolução do patrimônio dia a dia, de {dayLabel(startDate, "")} até hoje
            {todayIndex < last ? `, com a previsão até ${dayLabel(dateAt(startDate, last), "")}` : ""}. Use as
            setas para ler um dia.
          </figcaption>
          {/* The keyboard and screen-reader way to read one day; arrows, Page Up/Down, Home and End. */}
          <input
            className="nw-range"
            type="range"
            min={0}
            max={last}
            step={1}
            value={sliderDay}
            aria-label="Dia lido no gráfico de evolução do patrimônio"
            aria-valuetext={sliderText}
            onChange={(e) => {
              const index = Number(e.target.value);
              keyboardReads.current = true;
              setHover(null);
              setPin(index);
              reveal(index);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPin(null);
            }}
          />
          <div className="nw-plot" style={{ right: AXIS_WIDTH }}>
            <div className="nw-grid" style={{ height: PLOT_HEIGHT }} aria-hidden="true">
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className={tick === 0 ? "nw-gridline is-zero" : "nw-gridline"}
                  style={{ transform: `translateY(${y(tick).toFixed(1)}px)` }}
                />
              ))}
            </div>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only shortcuts (drag to pan, hover/tap to read a day); the range input above is the semantic control for the same reading. */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard reads a day through the range input above. */}
            <div
              ref={scrollerRef}
              className={dragging ? "nw-scroll is-dragging" : "nw-scroll"}
              tabIndex={-1}
              onScroll={onScroll}
              onWheel={() => cancelAnimationFrame(glide.current)}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onPointerLeave={(e) => {
                if (e.pointerType !== "mouse") return;
                mouseAt.current = null;
                setHover(null);
              }}
              onClick={onClick}
            >
              <div className="nw-track" style={{ width, height: CHART_HEIGHT }}>
                <svg className="nw-svg" width={width} height={CHART_HEIGHT} aria-hidden="true">
                  <defs>
                    <linearGradient
                      id={gradientId}
                      gradientUnits="userSpaceOnUse"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2={PLOT_HEIGHT}
                    >
                      <stop offset="0" className="nw-wash-top" />
                      <stop offset="1" className="nw-wash-bottom" />
                    </linearGradient>
                  </defs>
                  {months.map((span) => {
                    const x = dayX(span.first, track) - track.dayPx / 2;
                    return span.first === 0 ? null : (
                      <line
                        key={span.month}
                        className="nw-month-rule"
                        x1={x}
                        x2={x}
                        y1={0}
                        y2={PLOT_HEIGHT}
                      />
                    );
                  })}
                  <path d={area} fill={`url(#${gradientId})`} />
                  <path className="nw-wash-expected" d={forecastArea} fill={`url(#${gradientId})`} />
                  <path className="nw-line" d={line} />
                  <path className="nw-line is-expected" d={forecastLine} />
                  {peaks.map(({ key, index, value, dy }) => (
                    <g key={key} className="nw-peak">
                      {index !== todayIndex && (
                        <circle className="nw-peak-dot" cx={dayX(index, track)} cy={y(value)} r={3} />
                      )}
                      <text x={dayX(index, track)} y={y(value) + dy} textAnchor={sideAt(index, LABEL_EDGE)}>
                        {formatBRL(series[index] ?? 0)}
                        <tspan className="nw-peak-date"> · {dayMonth(dateAt(startDate, index))}</tspan>
                      </text>
                    </g>
                  ))}
                  {focus !== null && (
                    <>
                      <line
                        className="nw-cross"
                        x1={dayX(focus, track)}
                        x2={dayX(focus, track)}
                        y1={0}
                        y2={PLOT_HEIGHT}
                      />
                      <circle className="nw-cross-dot" cx={dayX(focus, track)} cy={focusY} r={4} />
                    </>
                  )}
                  {/* Today: the line's live end. */}
                  <circle
                    className="nw-live-ring"
                    cx={dayX(todayIndex, track)}
                    cy={y(valueAt(todayIndex))}
                    r={4.5}
                  />
                  <circle
                    className="nw-live-dot"
                    cx={dayX(todayIndex, track)}
                    cy={y(valueAt(todayIndex))}
                    r={4.5}
                  />
                </svg>
                {/* Each name stays inside its own month and sticks to the plot's edge while that
                    month is only partly in view, so it is never cut. */}
                <div
                  className="nw-months"
                  style={{ top: PLOT_HEIGHT, height: MONTH_BAND }}
                  aria-hidden="true"
                >
                  {months.map((span, i) => {
                    const slot = slots[i];
                    const cut = view !== null && slot !== undefined && !monthNameFits(slot, span.label, view);
                    return (
                      <span key={span.month} className="nw-month-slot" style={slot}>
                        <span
                          className={`nw-month${span.month === month ? " is-browsed" : ""}${cut ? " is-cut" : ""}`}
                        >
                          {span.label}
                        </span>
                      </span>
                    );
                  })}
                </div>
                {focus !== null && focusDate !== null && (
                  <div
                    className={listing ? "nw-tip is-listing" : "nw-tip"}
                    style={
                      listing === null
                        ? {
                            left: tipX,
                            top: tipAbove ? focusY - 12 : focusY + 14,
                            transform: `translate(${tipShift}, ${tipAbove ? "-100%" : "0"})`,
                          }
                        : listing.edge === "bottom"
                          ? { left: listing.left, bottom: listing.offset, width: listingWidth }
                          : { left: listing.left, top: listing.offset, width: listingWidth }
                    }
                  >
                    <span className="nw-tip-value tnum">{privacy ? "R$ ••••" : formatBRL(focusValue)}</span>
                    <span className="nw-tip-date">
                      {dayLabel(focusDate, today)}
                      {focusExpected ? " · previsto" : ""}
                    </span>
                    {!privacy && !focusExpected && focusChange !== 0 && (
                      <span className={focusChange > 0 ? "nw-tip-change up tnum" : "nw-tip-change down tnum"}>
                        {focusChange > 0 ? "+ " : ""}
                        {formatBRL(focusChange)} no dia
                      </span>
                    )}
                    {named.map((note) => (
                      <span
                        key={`${note.late ? "late" : "due"}|${note.label}`}
                        className={note.late ? "nw-tip-note is-late" : "nw-tip-note"}
                      >
                        <span className="nw-tip-note-label">{note.label}</span>
                        <span
                          className={
                            note.deltaCents > 0 ? "nw-tip-change up tnum" : "nw-tip-change down tnum"
                          }
                        >
                          {note.deltaCents > 0 ? "+ " : ""}
                          {formatBRL(note.deltaCents)}
                        </span>
                      </span>
                    ))}
                    {tipFootnote !== "" && <span className="nw-tip-date">{tipFootnote}</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="nw-axis" style={{ width: AXIS_WIDTH, height: CHART_HEIGHT }} aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="nw-tick tnum"
                style={{ transform: `translateY(${y(tick).toFixed(1)}px)` }}
              >
                {privacy ? "•••" : formatAxisTick(tick, compact)}
              </span>
            ))}
          </div>
          {!privacy && (
            <table className="sr-only">
              <caption>Patrimônio por mês</caption>
              <thead>
                <tr>
                  <th scope="col">Mês</th>
                  <th scope="col">No fim do mês</th>
                  <th scope="col">Máximo</th>
                  <th scope="col">Mínimo</th>
                </tr>
              </thead>
              <tbody>
                {monthTable.map((row) => (
                  <tr key={row.month}>
                    <th scope="row">
                      {monthLabel(row.month, { long: true })}
                      {row.expected ? " (previsto)" : ""}
                    </th>
                    <td>{formatBRL(row.closing)}</td>
                    <td>{formatBRL(row.max)}</td>
                    <td>{formatBRL(row.min)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </figure>
      </div>
    </div>
  );
}
