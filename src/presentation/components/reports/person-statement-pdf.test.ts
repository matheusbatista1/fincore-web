import { describe, expect, it } from "vitest";
import type { PersonStatement, PersonStatementRow } from "@/application/use-cases/get-person-statements";
import type { PdfCell, PdfDocument, PdfSection } from "@/presentation/lib/export";
import {
  balanceWords,
  buildPersonStatementPdf,
  personStatementFilename,
  rowLines,
  runningWords,
} from "./person-statement-pdf";

const row = (over: Partial<PersonStatementRow> = {}): PersonStatementRow => ({
  date: "2026-10-04",
  competence: "2026-11",
  kind: "purchase",
  description: "Kalunga",
  note: null,
  originLabel: "Cartão Nubank",
  categoryName: "Papelaria",
  categoryColor: "#111111",
  parcela: null,
  purchaseTotalCents: 8890,
  groupTotalCents: null,
  groupShareCents: null,
  groupCount: null,
  cashCents: 8890,
  runningCents: -99913,
  projected: false,
  ...over,
});

const statement = (over: Partial<PersonStatement> = {}): PersonStatement => ({
  id: "p1",
  name: "Ana Souza",
  relationship: "Mãe",
  color: "#000000",
  from: "2026-11",
  to: "2026-11",
  openingCents: -108_803,
  rows: [row()],
  purchasesCents: 8890,
  paymentsCents: 0,
  refundsCents: 0,
  writeoffsCents: 0,
  closingCents: -99_913,
  ledgerClosingCents: 0,
  projectedCount: 0,
  projectedCents: 0,
  lastPaymentBefore: { date: "2026-09-20", amountCents: 110_000 },
  rowsDateSpan: { first: "2026-10-04", last: "2026-10-04" },
  byCategory: [{ name: "Papelaria", color: "#111111", count: 1, totalCents: 8890 }],
  asOf: null,
  ...over,
});

const ctx = { rangeLabel: "Novembro 2026", today: "2026-11-03", issuerFirstName: "Matheus" };

/** jsPDF's built-in font is WinAnsi: Latin-1 plus a handful of CP-1252 extras — nothing else. */
const WINANSI = /^[\x20-\x7E -ÿ–—‘’“”•…€]*$/;

function everyString(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(everyString);
  if (value && typeof value === "object") return Object.values(value).flatMap(everyString);
  return [];
}

const tableOf = (doc: PdfDocument, heading: string) =>
  doc.sections.find(
    (s): s is Extract<PdfSection, { head: readonly string[] }> => "head" in s && s.heading === heading,
  );

const text = (cell: PdfCell | undefined): string =>
  cell === undefined ? "" : typeof cell === "string" ? cell : [cell.content].flat().join(" | ");

describe("balanceWords / runningWords", () => {
  it("says what the figure means instead of showing a sign", () => {
    expect(balanceWords(236_063)).toEqual({ label: "Falta pagar", value: "R$ 2.360,63", tone: "neg" });
    expect(balanceWords(-360)).toEqual({ label: "Crédito a seu favor", value: "R$ 3,60", tone: "pos" });
    expect(balanceWords(0)).toEqual({ label: "Tudo pago", value: "R$ 0,00", tone: "pos" });
    expect(runningWords(9306)).toBe("R$ 93,06");
    expect(runningWords(-107_704)).toEqual({ content: ["R$ 1.077,04", "crédito"], tone: "pos" });
  });
});

describe("rowLines", () => {
  it("explains a shared card purchase: origin, the whole purchase and the fatura it belongs to", () => {
    expect(rowLines(row({ purchaseTotalCents: 17_780 }))).toEqual([
      "Kalunga",
      "Cartão Nubank · compra de R$ 177,80 · fatura de Nov 2026",
    ]);
  });

  it("says which parcela this is, how many are left and the whole purchase", () => {
    const parcela = row({
      description: "Geladeira",
      parcela: { number: 3, total: 10, remaining: 7 },
      groupTotalCents: 100_000,
      groupShareCents: 50_000,
      groupCount: 10,
      cashCents: 5000,
    });
    expect(rowLines(parcela)[1]).toBe(
      "Cartão Nubank · parcela 3 de 10 · faltam 7 · compra de R$ 1.000,00 em 10x · fatura de Nov 2026",
    );
    expect(rowLines(row({ parcela: { number: 9, total: 10, remaining: 1 } }))[1]).toContain(
      "parcela 9 de 10 · falta 1",
    );
    expect(rowLines(row({ parcela: { number: 10, total: 10, remaining: 0 } }))[1]).toContain(
      "última parcela (10 de 10)",
    );
  });

  it("omits the whole purchase when the person's part is all of it, and flags previsto and notes", () => {
    const own = row({
      date: "2026-11-04",
      purchaseTotalCents: 8890,
      projected: true,
      note: "Assumido de Ana em 01/11",
    });
    expect(rowLines(own)[1]).toBe("Cartão Nubank · previsto: ainda não cobrado · Assumido de Ana em 01/11");
  });

  it("describes a payment by its account and the note the app wrote", () => {
    const payment = row({
      kind: "payment",
      description: "Pagamento",
      originLabel: "Itaú · Conta",
      categoryName: null,
      purchaseTotalCents: null,
      date: "2026-11-20",
      cashCents: -60_000,
      note: "Acerto · R$ 3,60 de crédito",
    });
    expect(rowLines(payment)).toEqual(["Pagamento", "Itaú · Conta · Acerto · R$ 3,60 de crédito"]);
  });
});

describe("buildPersonStatementPdf", () => {
  it("leads with the headline in words and spells the arithmetic out", () => {
    const doc = buildPersonStatementPdf(statement(), ctx);
    expect(doc.title).toBe("Extrato — Ana Souza");
    expect(doc.subtitle).toBe("Mãe · Novembro 2026 · lançamentos de 04/10 a 04/10");
    expect(doc.summary?.headline).toEqual({ label: "Crédito a seu favor", value: "R$ 999,13", tone: "pos" });
    expect(doc.summary?.lines.map((l) => [l.label, l.value])).toEqual([
      ["Crédito que você já tinha", "– R$ 1.088,03"],
      ["Suas compras no período (sua parte)", "+ R$ 88,90"],
      ["Pagamentos que você fez para Matheus", "– R$ 0,00"],
      ["Crédito a seu favor", "R$ 999,13"],
    ]);
    expect(doc.summary?.lines.at(-1)).toMatchObject({ bold: true, ruleAbove: true, tone: "pos" });
    expect(doc.summary?.notes).toEqual([
      "Último pagamento antes do período: R$ 1.100,00 em 20/09/2026.",
      "1 lançamento.",
    ]);
    expect(doc.generatedOn).toBe("2026-11-03");
    expect(doc.documentTitle).toBe("Extrato — Ana Souza · Novembro 2026");
  });

  it("reads 'falta pagar' when they still owe, lists what they already owed, and skips zero lines", () => {
    const doc = buildPersonStatementPdf(
      statement({
        openingCents: 5000,
        rows: [row({ runningCents: 13_890 })],
        closingCents: 13_890,
        refundsCents: 0,
        writeoffsCents: -1000,
        lastPaymentBefore: null,
        projectedCount: 1,
        projectedCents: 8890,
      }),
      { ...ctx, issuerFirstName: null },
    );
    expect(doc.summary?.headline).toEqual({ label: "Falta pagar", value: "R$ 138,90", tone: "neg" });
    expect(doc.summary?.lines.map((l) => l.label)).toEqual([
      "Você já devia de antes",
      "Suas compras no período (sua parte)",
      "Pagamentos que você fez",
      "Descontos",
      "Falta pagar",
    ]);
    expect(doc.summary?.notes).toEqual(["1 lançamento · 1 previsto (R$ 88,90 ainda não cobrados)."]);
  });

  it("adds the 'hoje' line for a past window", () => {
    const paid = buildPersonStatementPdf(
      statement({ to: "2026-10", from: "2026-10", asOf: { month: "2026-11", closingCents: 0 } }),
      ctx,
    );
    expect(paid.summary?.notes?.at(-1)).toBe(
      "Hoje (03/11/2026): tudo pago — considera o que entrou depois de Out 2026.",
    );
    const owing = buildPersonStatementPdf(
      statement({ to: "2026-10", from: "2026-10", asOf: { month: "2026-11", closingCents: 1234 } }),
      ctx,
    );
    expect(owing.summary?.notes?.at(-1)).toBe(
      "Hoje (03/11/2026): falta pagar R$ 12,34 — considera o que entrou depois de Out 2026.",
    );
  });

  it("places a row by the direction of the money and prints totals on the last page only", () => {
    const doc = buildPersonStatementPdf(
      statement({
        rows: [
          row({ runningCents: -99_913 }),
          row({
            kind: "payment",
            description: "Pagamento",
            originLabel: "Itaú · Conta",
            categoryName: null,
            date: "2026-11-20",
            cashCents: -50_000,
            runningCents: -149_913,
          }),
          row({ kind: "refund", description: "Devolução", cashCents: 20_000, runningCents: -129_913 }),
        ],
        paymentsCents: 50_000,
        refundsCents: 20_000,
        closingCents: -129_913,
      }),
      ctx,
    );
    const table = tableOf(doc, "Lançamentos");
    expect(table?.head).toEqual([
      "Data",
      "Descrição",
      "Categoria",
      "Compra (sua parte)",
      "Pagamento",
      "Falta pagar",
    ]);
    expect(table?.showFoot).toBe("lastPage");
    const rows = table?.body ?? [];
    expect(text(rows[0]?.[3])).toBe("R$ 88,90");
    expect(text(rows[0]?.[4])).toBe("");
    expect(text(rows[0]?.[5])).toBe("R$ 999,13 | crédito");
    expect(text(rows[1]?.[3])).toBe("");
    expect(text(rows[1]?.[4])).toBe("R$ 500,00");
    expect(text(rows[1]?.[2])).toBe("—");
    expect(text(rows[2]?.[3])).toBe("R$ 200,00"); // a refund adds to what is open: Compra column
    expect(table?.foot?.map(text)).toEqual([
      "",
      "Totais do período — crédito a seu favor",
      "",
      "R$ 288,90",
      "R$ 500,00",
      "R$ 1.299,13",
    ]);
  });

  it("mutes a projected row and keeps the description on two lines", () => {
    const doc = buildPersonStatementPdf(statement({ rows: [row({ projected: true })] }), ctx);
    const cell = tableOf(doc, "Lançamentos")?.body[0]?.[1];
    expect(cell).toEqual({
      content: ["Kalunga", "Cartão Nubank · fatura de Nov 2026 · previsto: ainda não cobrado"],
      tone: "muted",
    });
  });

  it("adds the category summary only with two or more buckets, and always the legend", () => {
    const one = buildPersonStatementPdf(statement(), ctx);
    expect(one.sections.map((s) => s.heading)).toEqual(["Lançamentos", "Como ler este extrato"]);
    const two = buildPersonStatementPdf(
      statement({
        purchasesCents: 10_000,
        byCategory: [
          { name: "Mercado", color: "#1", count: 2, totalCents: 7500 },
          { name: "Sem categoria", color: "#2", count: 1, totalCents: 2500 },
        ],
      }),
      ctx,
    );
    expect(two.sections.map((s) => s.heading)).toEqual([
      "Lançamentos",
      "Por categoria",
      "Como ler este extrato",
    ]);
    expect(tableOf(two, "Por categoria")?.body).toEqual([
      ["Mercado", "2", "R$ 75,00", "75%"],
      ["Sem categoria", "1", "R$ 25,00", "25%"],
    ]);
  });

  it("shows an empty window honestly", () => {
    const doc = buildPersonStatementPdf(
      statement({
        rows: [],
        purchasesCents: 0,
        closingCents: 0,
        rowsDateSpan: null,
        byCategory: [],
        lastPaymentBefore: null,
      }),
      ctx,
    );
    expect(doc.subtitle).toBe("Mãe · Novembro 2026");
    expect(doc.summary?.headline.label).toBe("Tudo pago");
    expect(text(tableOf(doc, "Lançamentos")?.body[0]?.[1])).toBe("Sem lançamentos no período.");
  });

  it("names the file after the person and the period, accent-free", () => {
    expect(personStatementFilename(statement({ name: "João Pé" }))).toBe("extrato-joao-2026-11.pdf");
    expect(personStatementFilename(statement({ from: "2026-11", to: "2027-04" }))).toBe(
      "extrato-ana-2026-11-2027-04.pdf",
    );
  });

  it("only uses glyphs the PDF font can print", () => {
    const doc = buildPersonStatementPdf(
      statement({
        rows: [
          row({ parcela: { number: 3, total: 10, remaining: 7 }, groupTotalCents: 88_900, groupCount: 10 }),
        ],
        asOf: { month: "2026-12", closingCents: 0 },
        writeoffsCents: 500,
      }),
      ctx,
    );
    for (const s of everyString(doc)) expect(s, s).toMatch(WINANSI);
  });
});
