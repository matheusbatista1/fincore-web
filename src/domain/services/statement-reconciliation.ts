/**
 * statement-reconciliation — compares the lines of a bank statement (or a card fatura) with what
 * is booked in the app, by AMOUNT and DATE only.
 *
 * Names never pair a bank line with an entry: the user writes their own descriptions, and often
 * books several bank lines as one entry (the month's tolls) — or one bank line as several.
 *
 * Four passes, each working on what the ones before left:
 *
 * 1. **exact** — one bank line ↔ one entry of the same amount, at most `maxDayGap` days apart.
 *    Per amount: as many pairs as possible, then the nearest dates.
 * 2. **bank-group** — several bank lines ↔ one entry: a run of consecutive lines the BANK calls by
 *    the same name (comparing bank lines with each other is fair game), or a few lines near the
 *    entry's date, adding up to it.
 * 3. **book-group** — one bank line ↔ a few entries near its date adding up to it.
 * 4. **bank-cancel** — two bank lines that undo each other (a charge and its refund) and were
 *    never booked: there is nothing to book.
 *
 * A group of otherwise unrelated lines is only accepted when it is the ONLY combination of amounts
 * that works: a coincidence must not hide a missing entry.
 */

import { daysBetween, type IsoDate } from "../value-objects/competence-month";

export interface ReconLine {
  readonly id: string;
  readonly date: IsoDate;
  /** Signed cents: money leaving is negative. Never zero. */
  readonly amountCents: number;
  /** The bank's description, or the entry's. Only ever compared among bank lines. */
  readonly label: string;
}

export type ReconMatchKind = "exact" | "bank-group" | "book-group" | "bank-cancel";

export interface ReconMatch {
  readonly kind: ReconMatchKind;
  readonly bank: readonly ReconLine[];
  readonly book: readonly ReconLine[];
}

export interface ReconOptions {
  /**
   * The most days a bank line and its entry may be apart. `null` when dates only break ties: a
   * fatura, whose lines all belong to it whatever their date.
   */
  readonly maxDayGap: number | null;
  /**
   * The most days the lines of a group may be from what they add up to; `maxDayGap` when omitted.
   * A fatura pairs one to one on any date (a parcela carries the date of the purchase), but lines
   * booked together were bought together: without this, any sum that happens to work would do.
   */
  readonly groupDayGap?: number | null;
}

export interface Reconciliation {
  /** Oldest first. */
  readonly matches: readonly ReconMatch[];
  /** In the statement, not booked. */
  readonly bankOnly: readonly ReconLine[];
  /** Booked, not in the statement. */
  readonly bookOnly: readonly ReconLine[];
}

/** The most lines an unnamed group may have: beyond a handful, sums stop being telling. */
const GROUP_MAX_SIZE = 4;
/** How many lines, the nearest in date, a group is looked for among. */
const GROUP_POOL = 24;
/** Above this many cells the pairing of one amount falls back to a single ordered pass. */
const PAIRING_CELLS = 250_000;
/** A pair outweighs any sum of day gaps. */
const PAIR = 1e9;

const byDate = (a: ReconLine, b: ReconLine): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * A date as a day count. Dates are compared millions of times on a long statement and there are
 * only a few dozen distinct ones, so each is worked out once.
 */
const dayNumbers = new Map<IsoDate, number>();
const dayNumber = (date: IsoDate): number => {
  let day = dayNumbers.get(date);
  if (day === undefined) {
    if (dayNumbers.size >= 4_096) dayNumbers.clear();
    day = daysBetween("1970-01-01", date);
    dayNumbers.set(date, day);
  }
  return day;
};

const dayGap = (a: IsoDate, b: IsoDate): number => Math.abs(dayNumber(a) - dayNumber(b));

const near = (a: IsoDate, b: IsoDate, maxDayGap: number | null): boolean =>
  maxDayGap === null || dayGap(a, b) <= maxDayGap;

/** The first index of a sorted list whose value is not below `value`. */
function lowerBound(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] as number) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** What a bank calls a line, without the numbers and marks that change from one to the next. */
const nameKey = (label: string): string =>
  label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();

/**
 * Pairs two date-ordered lists of lines that are worth the same: as many pairs as the day gap
 * allows, and among those the pairing with the smallest total gap. Pairs never cross (the n-th
 * line of one list never takes a partner older than the one before it took) — for dates on a line
 * that loses nothing.
 */
function pairUp(
  left: readonly ReconLine[],
  right: readonly ReconLine[],
  maxDayGap: number | null,
): [ReconLine, ReconLine][] {
  const n = left.length;
  const m = right.length;
  const pairs: [ReconLine, ReconLine][] = [];
  if (n === 0 || m === 0) return pairs;

  if (n * m > PAIRING_CELLS) {
    // Too many lines of one amount to weigh every pairing: one ordered pass still pairs the most.
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      const a = left[i] as ReconLine;
      const b = right[j] as ReconLine;
      if (near(a.date, b.date, maxDayGap)) {
        pairs.push([a, b]);
        i += 1;
        j += 1;
      } else if (a.date < b.date) i += 1;
      else j += 1;
    }
    return pairs;
  }

  // best[i][j]: the best of left[i..] with right[j..].
  const width = m + 1;
  const best = new Float64Array((n + 1) * width);
  const paired = (i: number, j: number): number => {
    const a = left[i] as ReconLine;
    const b = right[j] as ReconLine;
    return near(a.date, b.date, maxDayGap)
      ? PAIR - dayGap(a.date, b.date) + (best[(i + 1) * width + j + 1] ?? 0)
      : Number.NEGATIVE_INFINITY;
  };
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      best[i * width + j] = Math.max(
        paired(i, j),
        best[(i + 1) * width + j] ?? 0,
        best[i * width + j + 1] ?? 0,
      );
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const here = best[i * width + j] ?? 0;
    if (paired(i, j) === here) {
      pairs.push([left[i] as ReconLine, right[j] as ReconLine]);
      i += 1;
      j += 1;
    } else if ((best[(i + 1) * width + j] ?? 0) === here) i += 1;
    else j += 1;
  }
  return pairs;
}

/**
 * The lines of `pool` that add up to `target`, when exactly one combination of AMOUNTS does it
 * with two to {@link GROUP_MAX_SIZE} lines. Lines worth the same stand for one another, so the
 * first ones of the pool (the nearest in date) are the ones taken.
 */
function onlyGroup(pool: readonly ReconLine[], target: number): ReconLine[] | null {
  if (pool.length < 2) return null;
  const state = { found: null as ReconLine[] | null, amounts: "", ambiguous: false };
  const chosen: ReconLine[] = [];
  // No line left can be worth more than this: a sum that even the largest ones cannot reach in the
  // lines still allowed is not worth looking for.
  const largest = pool.reduce((most, line) => Math.max(most, Math.abs(line.amountCents)), 0);
  const visit = (from: number, missing: number): void => {
    if (missing > largest * (GROUP_MAX_SIZE - chosen.length)) return;
    if (missing === 0) {
      const amounts = chosen
        .map((line) => Math.abs(line.amountCents))
        .sort((a, b) => a - b)
        .join("+");
      if (state.found === null) {
        state.found = [...chosen];
        state.amounts = amounts;
      } else if (amounts !== state.amounts) state.ambiguous = true;
      return;
    }
    if (chosen.length === GROUP_MAX_SIZE) return;
    for (let i = from; i < pool.length && !state.ambiguous; i++) {
      const line = pool[i] as ReconLine;
      const amount = Math.abs(line.amountCents);
      if (amount > missing) continue;
      chosen.push(line);
      visit(i + 1, missing - amount);
      chosen.pop();
    }
  };
  visit(0, Math.abs(target));
  return state.ambiguous ? null : state.found;
}

/** Compare a statement's lines with the booked entries. See the file header for the rules. */
export function reconcileStatement(
  bank: readonly ReconLine[],
  book: readonly ReconLine[],
  options: ReconOptions,
): Reconciliation {
  const { maxDayGap } = options;
  const groupDayGap = options.groupDayGap === undefined ? maxDayGap : options.groupDayGap;
  const bankLines = [...bank].sort(byDate);
  const bookLines = [...book].sort(byDate);
  const freeBank = new Set(bankLines);
  const freeBook = new Set(bookLines);
  const matches: ReconMatch[] = [];
  const take = (
    kind: ReconMatchKind,
    bankSide: readonly ReconLine[],
    bookSide: readonly ReconLine[],
  ): void => {
    for (const line of bankSide) freeBank.delete(line);
    for (const line of bookSide) freeBook.delete(line);
    matches.push({ kind, bank: [...bankSide].sort(byDate), book: [...bookSide].sort(byDate) });
  };
  const byAmount = (lines: Iterable<ReconLine>): Map<number, ReconLine[]> => {
    const groups = new Map<number, ReconLine[]>();
    for (const line of lines) {
      const group = groups.get(line.amountCents);
      if (group) group.push(line);
      else groups.set(line.amountCents, [line]);
    }
    return groups;
  };

  // ---- 1. one bank line ↔ one entry of the same amount.
  const bookByAmount = byAmount(bookLines);
  for (const [amount, lines] of byAmount(bankLines)) {
    for (const [bankLine, entry] of pairUp(lines, bookByAmount.get(amount) ?? [], maxDayGap)) {
      take("exact", [bankLine], [entry]);
    }
  }

  // ---- 2a. a run of bank lines of one name ↔ one entry. The longest runs first, so an entry that
  // is the whole month's tolls takes them all before a shorter run can take a few. EVERY line of a
  // name adding up to an entry, to the cent, is no coincidence, whenever the entry was booked; a
  // part of them could be one (a bank calls every Pix the same), so the entry must also sit within
  // the run's dates, give or take the day gap.
  const named = new Map<string, ReconLine[]>();
  for (const line of bankLines) {
    if (!freeBank.has(line)) continue;
    const name = nameKey(line.label);
    if (name === "") continue;
    const key = `${line.amountCents < 0 ? "-" : "+"}${name}`;
    const group = named.get(key);
    if (group) group.push(line);
    else named.set(key, [line]);
  }
  // Running totals and the free entries by amount: a run costs one lookup, so a statement with
  // thousands of lines of one name is still checked in no time.
  const freeBookByAmount = byAmount(freeBook);
  for (const lines of named.values()) {
    const upTo = [0];
    for (const line of lines) upTo.push((upTo[upTo.length - 1] ?? 0) + line.amountCents);
    for (let size = lines.length; size >= 2; size--) {
      for (let start = 0; start + size <= lines.length; start++) {
        const candidates = freeBookByAmount.get((upTo[start + size] ?? 0) - (upTo[start] ?? 0));
        if (candidates === undefined) continue;
        const run = lines.slice(start, start + size);
        if (run.some((line) => !freeBank.has(line))) continue;
        const first = (run[0] as ReconLine).date;
        const last = (run[run.length - 1] as ReconLine).date;
        const whole = size === lines.length;
        let entry: ReconLine | null = null;
        for (const candidate of candidates) {
          if (!freeBook.has(candidate)) continue;
          const day = dayNumber(candidate.date);
          const within =
            whole ||
            groupDayGap === null ||
            (day - dayNumber(first) >= -groupDayGap && dayNumber(last) - day >= -groupDayGap);
          if (!within) continue;
          if (entry === null || dayGap(candidate.date, last) < dayGap(entry.date, last)) entry = candidate;
        }
        if (entry !== null) take("bank-group", run, [entry]);
      }
    }
  }

  /**
   * The free lines of one side (date-ordered, with their day counts) a group for `anchor` may be
   * made of: on the same side of zero, smaller than it, within the day gap — the nearest first.
   */
  const poolFor = (
    anchor: ReconLine,
    lines: readonly ReconLine[],
    days: readonly number[],
    free: ReadonlySet<ReconLine>,
  ): ReconLine[] => {
    const day = dayNumber(anchor.date);
    const from = groupDayGap === null ? 0 : lowerBound(days, day - groupDayGap);
    const to = groupDayGap === null ? lines.length : lowerBound(days, day + groupDayGap + 1);
    const pool: ReconLine[] = [];
    for (let i = from; i < to; i++) {
      const line = lines[i] as ReconLine;
      if (
        free.has(line) &&
        line.amountCents < 0 === anchor.amountCents < 0 &&
        Math.abs(line.amountCents) < Math.abs(anchor.amountCents)
      ) {
        pool.push(line);
      }
    }
    return pool
      .sort((a, b) => dayGap(a.date, anchor.date) - dayGap(b.date, anchor.date) || byDate(a, b))
      .slice(0, GROUP_POOL);
  };
  const bankDays = bankLines.map((line) => dayNumber(line.date));
  const bookDays = bookLines.map((line) => dayNumber(line.date));

  // ---- 2b. a few bank lines near an entry ↔ that entry.
  for (const entry of bookLines) {
    if (!freeBook.has(entry)) continue;
    const group = onlyGroup(poolFor(entry, bankLines, bankDays, freeBank), entry.amountCents);
    if (group !== null) take("bank-group", group, [entry]);
  }

  // ---- 3. one bank line ↔ a few entries near it.
  for (const line of bankLines) {
    if (!freeBank.has(line)) continue;
    const group = onlyGroup(poolFor(line, bookLines, bookDays, freeBook), line.amountCents);
    if (group !== null) take("book-group", [line], group);
  }

  // ---- 4. two bank lines that undo each other.
  const coming = new Map<number, ReconLine[]>();
  const going = new Map<number, ReconLine[]>();
  for (const line of bankLines) {
    if (!freeBank.has(line)) continue;
    const side = line.amountCents > 0 ? coming : going;
    const value = Math.abs(line.amountCents);
    const group = side.get(value);
    if (group) group.push(line);
    else side.set(value, [line]);
  }
  for (const [value, lines] of coming) {
    for (const pair of pairUp(lines, going.get(value) ?? [], maxDayGap)) take("bank-cancel", pair, []);
  }

  const first = (match: ReconMatch): ReconLine => (match.bank[0] ?? match.book[0]) as ReconLine;
  return {
    matches: matches.sort((a, b) => byDate(first(a), first(b))),
    bankOnly: bankLines.filter((line) => freeBank.has(line)),
    bookOnly: bookLines.filter((line) => freeBook.has(line)),
  };
}
