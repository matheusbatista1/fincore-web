import { describe, expect, it } from "vitest";
import { detectFormat, parseAmountToCents, parseDate, parseStatement } from "./parse-statement";

describe("parseAmountToCents", () => {
  it("parses pt-BR thousands/decimal", () => {
    expect(parseAmountToCents("1.234,56")).toBe(123456);
    expect(parseAmountToCents("R$ 1.234,56")).toBe(123456);
  });
  it("parses en decimal", () => {
    expect(parseAmountToCents("1234.56")).toBe(123456);
  });
  it("handles negatives and parentheses", () => {
    expect(parseAmountToCents("-12,00")).toBe(-1200);
    expect(parseAmountToCents("(12,00)")).toBe(-1200);
  });
  it("returns null for non-numeric", () => {
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("")).toBeNull();
  });
});

describe("parseDate", () => {
  it("accepts ISO, BR slash and OFX dates", () => {
    expect(parseDate("2026-06-10")).toBe("2026-06-10");
    expect(parseDate("10/06/2026")).toBe("2026-06-10");
    expect(parseDate("20260610120000[-3:GMT]")).toBe("2026-06-10");
  });
  it("accepts dot separators and 2-digit years", () => {
    expect(parseDate("10.06.2026")).toBe("2026-06-10");
    expect(parseDate("10/06/26")).toBe("2026-06-10");
    expect(parseDate("1.6.2026")).toBe("2026-06-01");
  });
  it("rejects invalid dates", () => {
    expect(parseDate("2026-13-40")).toBeNull();
    expect(parseDate("nope")).toBeNull();
  });
});

describe("parseStatement CSV", () => {
  it("parses a headered, semicolon, pt-BR statement", () => {
    const csv = ["Data;Histórico;Valor", "10/06/2026;Mercado;-150,90", "12/06/2026;Salário;3.000,00"].join(
      "\n",
    );
    const entries = parseStatement(csv, "csv");
    expect(entries).toEqual([
      { date: "2026-06-10", description: "Mercado", amountCents: -15090 },
      { date: "2026-06-12", description: "Salário", amountCents: 300000 },
    ]);
  });

  it("parses a headerless comma statement in date,description,amount order", () => {
    const csv = "2026-06-01,Uber,-25.50";
    expect(parseStatement(csv, "csv")).toEqual([
      { date: "2026-06-01", description: "Uber", amountCents: -2550 },
    ]);
  });

  it("skips rows with invalid date or zero amount", () => {
    const csv = ["Data;Descrição;Valor", "bad;x;-1,00", "10/06/2026;ok;0,00"].join("\n");
    expect(parseStatement(csv, "csv")).toEqual([]);
  });

  it("strips a leading UTF-8 BOM before reading the header", () => {
    const csv = `﻿${["Data;Descrição;Valor", "10/06/2026;Mercado;-150,90"].join("\n")}`;
    expect(parseStatement(csv, "csv")).toEqual([
      { date: "2026-06-10", description: "Mercado", amountCents: -15090 },
    ]);
  });

  it("detects a TAB delimiter", () => {
    const csv = ["Data\tDescrição\tValor", "10/06/2026\tMercado\t-150,90"].join("\n");
    expect(parseStatement(csv, "csv")).toEqual([
      { date: "2026-06-10", description: "Mercado", amountCents: -15090 },
    ]);
  });

  it("recognizes extra header names (Competência/Estabelecimento)", () => {
    const csv = ["Competência;Estabelecimento;Valor", "10.06.2026;Padaria;-9,90"].join("\n");
    expect(parseStatement(csv, "csv")).toEqual([
      { date: "2026-06-10", description: "Padaria", amountCents: -990 },
    ]);
  });

  it("builds the signed amount from separate Débito/Crédito columns", () => {
    const csv = [
      "Data;Histórico;Débito;Crédito",
      "10/06/2026;Compra;150,90;",
      "12/06/2026;Salário;;3.000,00",
    ].join("\n");
    expect(parseStatement(csv, "csv")).toEqual([
      { date: "2026-06-10", description: "Compra", amountCents: -15090 },
      { date: "2026-06-12", description: "Salário", amountCents: 300000 },
    ]);
  });

  it("picks the BRL column over US$ on a C6 invoice (dot decimals, quoted desc)", () => {
    const csv = [
      "Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)",
      "17/04/2026;MATHEUS S BATISTA;0469;Especialidade varejo;COBASI;2/2;0;0;83.40",
      '11/05/2026;MATHEUS S BATISTA;3641;-;"Inclusao de Pagamento    ";Única;0;0;-3387.39',
    ].join("\n");
    expect(parseStatement(csv, "csv")).toEqual([
      { date: "2026-04-17", description: "COBASI", amountCents: 8340 },
      { date: "2026-05-11", description: "Inclusao de Pagamento", amountCents: -338739 },
    ]);
  });
});

describe("parseStatement OFX", () => {
  it("extracts STMTTRN blocks", () => {
    const ofx = `
      <OFX><BANKTRANLIST>
        <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260610<TRNAMT>-150.90<MEMO>Mercado</STMTTRN>
        <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260612<TRNAMT>3000.00<NAME>Salario</STMTTRN>
      </BANKTRANLIST></OFX>`;
    expect(parseStatement(ofx, "ofx")).toEqual([
      { date: "2026-06-10", description: "Mercado", amountCents: -15090 },
      { date: "2026-06-12", description: "Salario", amountCents: 300000 },
    ]);
  });
});

describe("detectFormat", () => {
  it("detects ofx by extension or content", () => {
    expect(detectFormat("extrato.ofx", "")).toBe("ofx");
    expect(detectFormat("x.txt", "<OFX>...")).toBe("ofx");
    expect(detectFormat("extrato.csv", "a,b,c")).toBe("csv");
  });
});
