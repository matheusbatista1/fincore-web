import { describe, expect, it } from "vitest";
import { buildCsv, csvMoney } from "./export";

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
