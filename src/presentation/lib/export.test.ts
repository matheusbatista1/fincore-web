import { describe, expect, it } from "vitest";
import { buildCsv, csvMoney, type PdfDocument, renderPdf, toAutoTableCell } from "./export";

describe("buildCsv", () => {
  it("joins headers and rows with ';' and CRLF", () => {
    expect(
      buildCsv(
        ["A", "B"],
        [
          ["1", "2"],
          ["3", "4"],
        ],
      ),
    ).toBe("A;B\r\n1;2\r\n3;4");
  });

  it("quotes fields containing the delimiter, quotes or newlines (RFC-4180)", () => {
    expect(buildCsv(["X"], [["a;b"]])).toBe('X\r\n"a;b"');
    expect(buildCsv(["X"], [['a "b" c']])).toBe('X\r\n"a ""b"" c"');
    expect(buildCsv(["X"], [["line1\nline2"]])).toBe('X\r\n"line1\nline2"');
  });

  it("does not quote plain fields and accepts numbers", () => {
    expect(buildCsv(["N"], [[42]])).toBe("N\r\n42");
  });
});

describe("csvMoney", () => {
  it("formats integer cents as pt-BR decimals without a currency symbol", () => {
    expect(csvMoney(123456)).toBe("1234,56");
    expect(csvMoney(-5000)).toBe("-50,00");
    expect(csvMoney(0)).toBe("0,00");
    expect(csvMoney(5)).toBe("0,05");
  });
});

describe("toAutoTableCell", () => {
  it("passes a plain string through", () => {
    expect(toAutoTableCell("R$ 1,00")).toBe("R$ 1,00");
  });

  it("maps tone and weight to autoTable cell styles and joins multi-line content with line breaks", () => {
    expect(toAutoTableCell({ content: ["Mercado", "Cartão Nubank"], tone: "muted", bold: true })).toEqual({
      content: "Mercado\nCartão Nubank",
      styles: { textColor: [111, 105, 133], fontStyle: "bold" },
    });
    expect(toAutoTableCell({ content: "crédito R$ 3,60", tone: "pos" })).toEqual({
      content: "crédito R$ 3,60",
      styles: { textColor: [15, 122, 86] },
    });
  });
});

describe("renderPdf", () => {
  it("renders a summary card, prose and a long table with the totals on the last page only", async () => {
    const spec: PdfDocument = {
      title: "Extrato — Pessoa",
      subtitle: "Amiga · Junho 2026 · lançamentos de 01/06 a 30/06",
      summary: {
        headline: { label: "Falta pagar", value: "R$ 2.360,63", tone: "neg" },
        lines: [
          { label: "Crédito que você já tinha", value: "– R$ 1.088,03", tone: "pos" },
          { label: "Suas compras no período (sua parte)", value: "+ R$ 3.448,66" },
          { label: "Falta pagar", value: "R$ 2.360,63", bold: true, ruleAbove: true, tone: "neg" },
        ],
        notes: ["Último pagamento antes do período: R$ 1.100,00 em 20/09/2026.", "80 lançamentos."],
      },
      sections: [
        {
          heading: "Lançamentos",
          head: ["Data", "Descrição", "Categoria", "Compra (sua parte)", "Pagamento", "Falta pagar"],
          align: ["left", "left", "left", "right", "right", "right"],
          columnWidths: [46, 213, 70, 64, 62, 60],
          showFoot: "lastPage",
          fontSize: 8.5,
          body: Array.from({ length: 80 }, (_, i) => [
            "04/10",
            { content: [`Compra ${i + 1}`, "Cartão Nubank · parcela 3 de 10 · faltam 7"] },
            "Mercado",
            "R$ 10,00",
            "",
            i % 2 ? "R$ 10,00" : { content: "crédito R$ 10,00", tone: "pos" },
          ]),
          foot: ["", "Totais do período", "", "R$ 800,00", "R$ 0,00", "Falta pagar R$ 800,00"],
        },
        {
          heading: "Como ler este extrato",
          paragraphs: ["Compra (sua parte): só a sua parte em cada gasto."],
        },
      ],
      generatedOn: "2026-11-03",
    };
    const doc = await renderPdf(spec);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(1000);
  });
});
