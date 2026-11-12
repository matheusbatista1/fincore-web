import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { daysBetween } from "../value-objects/competence-month";
import { type Reconciliation, type ReconLine, reconcileStatement } from "./statement-reconciliation";

// ---------------------------------------------------------------------------
// Builders: a line is a day of November 2026, an amount and (for the bank) a name.
// ---------------------------------------------------------------------------

const on = (day: number): string => `2026-11-${String(day).padStart(2, "0")}`;

let seq = 0;
const bankLine = (day: number, amountCents: number, label = "BANCO"): ReconLine => ({
  id: `b${++seq}`,
  date: on(day),
  amountCents,
  label,
});
const entry = (day: number, amountCents: number, label = "meu lançamento"): ReconLine => ({
  id: `e${++seq}`,
  date: on(day),
  amountCents,
  label,
});

const ACCOUNT = { maxDayGap: 4 };
const FATURA = { maxDayGap: null, groupDayGap: 4 };

/** A match as `kind: bank amounts = book amounts`, for compact expectations. */
const brief = (result: Reconciliation): string[] =>
  result.matches.map(
    (m) =>
      `${m.kind}: ${m.bank.map((l) => `${l.date.slice(8)}/${l.amountCents}`).join(" ")} = ${m.book
        .map((l) => `${l.date.slice(8)}/${l.amountCents}`)
        .join(" ")}`,
  );
const days = (lines: readonly ReconLine[]): string[] =>
  lines.map((l) => `${l.date.slice(8)}/${l.amountCents}`);

describe("reconcileStatement — one bank line, one entry", () => {
  it("pairs by amount and date, whatever each side calls it", () => {
    const result = reconcileStatement(
      [bankLine(3, -4_590, "PGTO*IFOOD 8842"), bankLine(5, 250_000, "TED RECEBIDA")],
      [entry(5, 250_000, "Salário"), entry(2, -4_590, "Jantar")],
      ACCOUNT,
    );
    expect(brief(result)).toEqual(["exact: 03/-4590 = 02/-4590", "exact: 05/250000 = 05/250000"]);
    expect(result.bankOnly).toEqual([]);
    expect(result.bookOnly).toEqual([]);
  });

  it("leaves both sides out when the dates are too far apart", () => {
    const result = reconcileStatement([bankLine(3, -4_590)], [entry(20, -4_590)], ACCOUNT);
    expect(result.matches).toEqual([]);
    expect(days(result.bankOnly)).toEqual(["03/-4590"]);
    expect(days(result.bookOnly)).toEqual(["20/-4590"]);
  });

  it("never pairs an amount with its opposite", () => {
    const result = reconcileStatement([bankLine(3, -4_590)], [entry(3, 4_590)], ACCOUNT);
    expect(result.matches).toEqual([]);
  });

  it("pairs each of two equal amounts once, and names the one that has no partner", () => {
    // Two lunches of the same price at the bank, three booked: the one from the 20th is extra.
    const result = reconcileStatement(
      [bankLine(10, -2_000), bankLine(12, -2_000)],
      [entry(10, -2_000), entry(11, -2_000), entry(20, -2_000)],
      ACCOUNT,
    );
    expect(brief(result)).toEqual(["exact: 10/-2000 = 10/-2000", "exact: 12/-2000 = 11/-2000"]);
    expect(days(result.bookOnly)).toEqual(["20/-2000"]);
  });

  it("prefers more pairs to nearer dates, and then the nearest dates", () => {
    // Bank on the 5th and the 8th, booked on the 2nd and the 5th: pairing the two 5ths would
    // leave the 8th and the 2nd six days apart, with no partner.
    const crossed = reconcileStatement(
      [bankLine(5, -1_000), bankLine(8, -1_000)],
      [entry(2, -1_000), entry(5, -1_000)],
      { maxDayGap: 3 },
    );
    expect(brief(crossed)).toEqual(["exact: 05/-1000 = 02/-1000", "exact: 08/-1000 = 05/-1000"]);
    // With one bank line only, it takes the entry of its own day.
    const nearest = reconcileStatement([bankLine(5, -1_000)], [entry(3, -1_000), entry(5, -1_000)], {
      maxDayGap: 3,
    });
    expect(brief(nearest)).toEqual(["exact: 05/-1000 = 05/-1000"]);
    expect(days(nearest.bookOnly)).toEqual(["03/-1000"]);
  });

  it("on a fatura, pairs equal amounts however far apart their dates are", () => {
    // A parcela shows on the fatura with the date of the purchase, months before.
    const result = reconcileStatement(
      [{ id: "b", date: "2026-08-14", amountCents: -19_990, label: "LOJA 03/10" }],
      [{ id: "e", date: "2026-11-14", amountCents: -19_990, label: "Tênis" }],
      FATURA,
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.kind).toBe("exact");
  });
});

describe("reconcileStatement — one amount, hundreds of times", () => {
  it("still pairs every line it can, in one ordered pass", () => {
    // 520 fares of 4,40 on each side — too many to weigh every pairing — booked a day late, plus
    // five on each side with nothing near them.
    const fares = (prefix: string, dayShift: number): ReconLine[] =>
      Array.from({ length: 520 }, (_, i) => ({
        id: prefix + String(i).padStart(3, "0"),
        date: on(1 + ((i + dayShift) % 28)),
        amountCents: -440,
        label: "TARIFA",
      }));
    const stray = (prefix: string, date: string): ReconLine[] =>
      Array.from({ length: 5 }, (_, i) => ({ id: prefix + i, date, amountCents: -440, label: "TARIFA" }));
    const result = reconcileStatement(
      [...stray("b-old", "2026-09-01"), ...fares("b", 0)],
      [...stray("e-older", "2026-08-01"), ...fares("e", 1)],
      ACCOUNT,
    );
    expect(result.matches).toHaveLength(520);
    expect(result.matches.every((m) => m.kind === "exact")).toBe(true);
    for (const match of result.matches) {
      const gap = Math.abs(daysBetween(match.bank[0]?.date ?? "", match.book[0]?.date ?? ""));
      expect(gap).toBeLessThanOrEqual(4);
    }
    expect(result.bankOnly.map((l) => l.date)).toEqual(Array(5).fill("2026-09-01"));
    expect(result.bookOnly.map((l) => l.date)).toEqual(Array(5).fill("2026-08-01"));
  });
});

describe("reconcileStatement — the largest statement accepted", () => {
  it("checks 2000 lines of one name against 2000 entries without grinding", () => {
    // Every line is "PIX ENVIADO", none has a partner: the worst case for the runs of one name.
    const bank: ReconLine[] = Array.from({ length: 2000 }, (_, i) => ({
      id: `b${String(i).padStart(4, "0")}`,
      date: on(1 + (i % 28)),
      amountCents: -(1_000 + i * 7),
      label: "PIX ENVIADO",
    }));
    const book: ReconLine[] = Array.from({ length: 2000 }, (_, i) => ({
      id: `e${String(i).padStart(4, "0")}`,
      date: on(1 + (i % 28)),
      amountCents: -(500_000_000 + i * 11),
      label: "outro",
    }));
    const started = performance.now();
    const result = reconcileStatement(bank, book, ACCOUNT);
    // A second is generous: the point is that it is not minutes.
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(result.matches).toEqual([]);
    expect(result.bankOnly).toHaveLength(2000);
    expect(result.bookOnly).toHaveLength(2000);
  });
});

describe("reconcileStatement — a fatura's groups", () => {
  it("pairs one to one on any date, but only groups lines near what they add up to", () => {
    // 5000 + 2000 happens to make the 7000 booked a month before: that is not a group.
    const far = reconcileStatement(
      [bankLine(1, -5_000, "MERCADO"), bankLine(3, -2_000, "FARMACIA")],
      [{ id: "e", date: "2026-10-01", amountCents: -7_000, label: "Outra compra" }],
      FATURA,
    );
    expect(far.matches).toEqual([]);
    // Booked the day after, it is.
    const close = reconcileStatement(
      [bankLine(1, -5_000, "MERCADO"), bankLine(3, -2_000, "FARMACIA")],
      [entry(4, -7_000, "Compras da semana")],
      FATURA,
    );
    expect(brief(close)).toEqual(["bank-group: 01/-5000 03/-2000 = 04/-7000"]);
  });
});

describe("reconcileStatement — several bank lines booked as one entry", () => {
  it("takes every line of one name for the entry that adds them up, whenever it was booked", () => {
    // The month's tolls, booked as one entry on the 30th.
    const result = reconcileStatement(
      [
        bankLine(2, -890, "PEDAGIO SEM PARAR 0012"),
        bankLine(9, -1_240, "PEDAGIO SEM PARAR 0458"),
        bankLine(9, -890, "PEDAGIO SEM PARAR 0459"),
        bankLine(17, -2_310, "PEDAGIO SEM PARAR 1002"),
        bankLine(5, -6_000, "MERCADO"),
      ],
      [entry(30, -5_330, "Pedágios"), entry(5, -6_000, "Mercado")],
      ACCOUNT,
    );
    expect(brief(result)).toEqual([
      "bank-group: 02/-890 09/-1240 09/-890 17/-2310 = 30/-5330",
      "exact: 05/-6000 = 05/-6000",
    ]);
    expect(result.bankOnly).toEqual([]);
    expect(result.bookOnly).toEqual([]);
  });

  it("splits the lines of one name between two entries, each near its own run", () => {
    const result = reconcileStatement(
      [
        bankLine(2, -500, "PEDAGIO"),
        bankLine(3, -700, "PEDAGIO"),
        bankLine(16, -900, "PEDAGIO"),
        bankLine(18, -1_100, "PEDAGIO"),
      ],
      [entry(4, -1_200, "Pedágios da 1ª semana"), entry(19, -2_000, "Pedágios da 3ª semana")],
      ACCOUNT,
    );
    expect(brief(result)).toEqual([
      "bank-group: 02/-500 03/-700 = 04/-1200",
      "bank-group: 16/-900 18/-1100 = 19/-2000",
    ]);
  });

  it("does not take a part of the lines of one name for an entry far from them", () => {
    // A bank calls every Pix the same: two of them adding up to an entry of weeks later says
    // nothing. (All three of them adding up to it would.)
    const result = reconcileStatement(
      [
        bankLine(3, -3_000, "PIX ENVIADO"),
        bankLine(5, -2_000, "PIX ENVIADO"),
        bankLine(25, -1_500, "PIX ENVIADO"),
      ],
      [entry(20, -5_000, "Presente")],
      ACCOUNT,
    );
    expect(result.matches).toEqual([]);
    expect(result.bankOnly).toHaveLength(3);
    expect(result.bookOnly).toHaveLength(1);
  });

  it("joins a few lines of different names next to the entry, when only one sum works", () => {
    const result = reconcileStatement(
      [bankLine(10, -1_500, "ESTACIONAMENTO"), bankLine(10, -3_250, "CINEMA"), bankLine(11, -980, "PADARIA")],
      [entry(10, -4_750, "Passeio de sábado")],
      ACCOUNT,
    );
    expect(brief(result)).toEqual(["bank-group: 10/-1500 10/-3250 = 10/-4750"]);
    expect(days(result.bankOnly)).toEqual(["11/-980"]);
  });

  it("gives up when more than one sum works: a coincidence must not hide a missing entry", () => {
    // 1000 + 4000 and 2000 + 3000 both make 5000.
    const result = reconcileStatement(
      [
        bankLine(10, -1_000, "A"),
        bankLine(10, -4_000, "B"),
        bankLine(11, -2_000, "C"),
        bankLine(11, -3_000, "D"),
      ],
      [entry(10, -5_000)],
      ACCOUNT,
    );
    expect(result.matches).toEqual([]);
    expect(result.bankOnly).toHaveLength(4);
  });

  it("treats lines worth the same as one another: the nearest ones are taken", () => {
    // Three coffees of 600; two of them were booked together.
    const result = reconcileStatement(
      [bankLine(8, -600, "CAFE A"), bankLine(10, -600, "CAFE B"), bankLine(13, -600, "CAFE C")],
      [entry(10, -1_200, "Cafés")],
      ACCOUNT,
    );
    expect(brief(result)).toEqual(["bank-group: 08/-600 10/-600 = 10/-1200"]);
    expect(days(result.bankOnly)).toEqual(["13/-600"]);
  });
});

describe("reconcileStatement — one bank line booked as several entries, and refunds", () => {
  it("joins the entries next to a bank line that add up to it", () => {
    const result = reconcileStatement(
      [bankLine(15, -12_000, "SUPERMERCADO")],
      [entry(15, -9_000, "Mercado"), entry(15, -3_000, "Presente da mãe"), entry(15, -700, "Pão")],
      ACCOUNT,
    );
    expect(brief(result)).toEqual(["book-group: 15/-12000 = 15/-9000 15/-3000"]);
    expect(days(result.bookOnly)).toEqual(["15/-700"]);
  });

  it("sets aside two bank lines that undo each other and were never booked", () => {
    const result = reconcileStatement(
      [bankLine(6, -8_990, "LOJA X"), bankLine(8, 8_990, "ESTORNO LOJA X"), bankLine(9, -500, "TARIFA")],
      [],
      ACCOUNT,
    );
    expect(brief(result)).toEqual(["bank-cancel: 06/-8990 08/8990 = "]);
    expect(days(result.bankOnly)).toEqual(["09/-500"]);
  });

  it("does not set a refund aside when the charge it undoes was booked", () => {
    const result = reconcileStatement(
      [bankLine(6, -8_990, "LOJA X"), bankLine(8, 8_990, "ESTORNO LOJA X")],
      [entry(6, -8_990, "Compra")],
      ACCOUNT,
    );
    expect(brief(result)).toEqual(["exact: 06/-8990 = 06/-8990"]);
    // The refund is still to be booked.
    expect(days(result.bankOnly)).toEqual(["08/8990"]);
  });

  it("with nothing on either side, has nothing to say", () => {
    expect(reconcileStatement([], [], ACCOUNT)).toEqual({ matches: [], bankOnly: [], bookOnly: [] });
    const lonely = reconcileStatement([], [entry(1, -100)], ACCOUNT);
    expect(lonely.bookOnly).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const lineArb = (prefix: string): fc.Arbitrary<ReconLine> =>
  fc
    .record({
      day: fc.integer({ min: 1, max: 28 }),
      // Few distinct amounts, so that pairs, groups and collisions all happen.
      units: fc.integer({ min: 1, max: 12 }),
      out: fc.boolean(),
      label: fc.constantFrom("PEDAGIO 01", "PEDAGIO 02", "PIX ENVIADO", "MERCADO", ""),
    })
    .map((r) => ({
      id: prefix,
      date: on(r.day),
      amountCents: (r.out ? -1 : 1) * r.units * 500,
      label: r.label,
    }));

/** Lines with unique ids. */
const linesArb = (prefix: string): fc.Arbitrary<ReconLine[]> =>
  fc
    .array(lineArb(prefix), { maxLength: 14 })
    .map((lines) => lines.map((line, i) => ({ ...line, id: `${prefix}${i}` })));

const total = (lines: readonly ReconLine[]): number => lines.reduce((sum, line) => sum + line.amountCents, 0);

describe("reconcileStatement (property-based)", () => {
  const gapArb = fc.constantFrom<number | null>(0, 2, 4, null);

  it("puts every line in exactly one place", () => {
    fc.assert(
      fc.property(linesArb("b"), linesArb("e"), gapArb, (bank, book, maxDayGap) => {
        const result = reconcileStatement(bank, book, { maxDayGap });
        const bankSeen = [...result.matches.flatMap((m) => m.bank), ...result.bankOnly]
          .map((l) => l.id)
          .sort();
        const bookSeen = [...result.matches.flatMap((m) => m.book), ...result.bookOnly]
          .map((l) => l.id)
          .sort();
        expect(bankSeen).toEqual(bank.map((l) => l.id).sort());
        expect(bookSeen).toEqual(book.map((l) => l.id).sort());
      }),
      { numRuns: 300 },
    );
  });

  it("only ever matches what is worth the same, so the difference is what is left out", () => {
    fc.assert(
      fc.property(linesArb("b"), linesArb("e"), gapArb, (bank, book, maxDayGap) => {
        const result = reconcileStatement(bank, book, { maxDayGap });
        for (const match of result.matches) {
          if (match.kind === "bank-cancel") {
            expect(match.book).toEqual([]);
            expect(match.bank).toHaveLength(2);
            expect(total(match.bank)).toBe(0);
          } else {
            expect(total(match.bank)).toBe(total(match.book));
            expect(match.bank.length).toBeGreaterThan(0);
            expect(match.book.length).toBeGreaterThan(0);
          }
          if (match.kind === "exact") {
            expect(match.bank).toHaveLength(1);
            expect(match.book).toHaveLength(1);
            const gap = Math.abs(daysBetween(match.bank[0]?.date ?? "", match.book[0]?.date ?? ""));
            if (maxDayGap !== null) expect(gap).toBeLessThanOrEqual(maxDayGap);
          }
          if (match.kind === "bank-group") expect(match.book).toHaveLength(1);
          if (match.kind === "book-group") expect(match.bank).toHaveLength(1);
        }
        expect(total(bank) - total(book)).toBe(total(result.bankOnly) - total(result.bookOnly));
      }),
      { numRuns: 300 },
    );
  });

  it("finds a statement equal to the books fully matched, line by line", () => {
    fc.assert(
      fc.property(linesArb("b"), gapArb, (bank, maxDayGap) => {
        const book = bank.map((line) => ({ ...line, id: `e-${line.id}`, label: "outro nome" }));
        const result = reconcileStatement(bank, book, { maxDayGap });
        expect(result.bankOnly).toEqual([]);
        expect(result.bookOnly).toEqual([]);
        expect(result.matches.every((m) => m.kind === "exact")).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("does not depend on the order the lines come in", () => {
    fc.assert(
      fc.property(linesArb("b"), linesArb("e"), gapArb, (bank, book, maxDayGap) => {
        const straight = reconcileStatement(bank, book, { maxDayGap });
        const reversed = reconcileStatement([...bank].reverse(), [...book].reverse(), { maxDayGap });
        expect(reversed).toEqual(straight);
      }),
      { numRuns: 200 },
    );
  });

  it("leaves no pair of the same amount within the day gap unmatched on both sides", () => {
    fc.assert(
      fc.property(linesArb("b"), linesArb("e"), gapArb, (bank, book, maxDayGap) => {
        const result = reconcileStatement(bank, book, { maxDayGap });
        for (const line of result.bankOnly) {
          for (const other of result.bookOnly) {
            const pairable =
              line.amountCents === other.amountCents &&
              (maxDayGap === null || Math.abs(daysBetween(line.date, other.date)) <= maxDayGap);
            expect(pairable).toBe(false);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
