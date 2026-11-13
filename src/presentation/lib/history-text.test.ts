import { describe, expect, it } from "vitest";
import { TRANSACTION_FIELDS } from "@/domain/services/transaction-history";
import {
  type HistoryNames,
  historyFieldLabel,
  historyTitle,
  historyValueText,
  historyWhen,
} from "./history-text";

const names: HistoryNames = {
  accounts: new Map([["acc-1", "Banco Azul · Conta corrente"]]),
  cards: new Map([["card-1", "Cartão Gold"]]),
  categories: new Map([["cat-1", "Mercado"]]),
  people: new Map([
    ["ana", "Ana"],
    ["bia", "Bia"],
  ]),
};

/** `Intl` separates "R$" from the figure with a no-break space; the tests read plain ones. */
const plain = (text: string): string => text.replace(/ /g, " ");

describe("historyTitle", () => {
  it("names a creation by how it came to be", () => {
    expect(historyTitle({ kind: "created", action: "create" })).toBe("Criado");
    expect(historyTitle({ kind: "created", action: "import" })).toBe("Criado pela importação");
    expect(historyTitle({ kind: "created", action: "recurring" })).toBe("Lançado pelo fixo do mês");
    expect(historyTitle({ kind: "created", action: "roll" })).toBe("Criado ao rolar a dívida");
    expect(historyTitle({ kind: "created", action: "settle" })).toBe("Criado junto com o acerto");
  });

  it("names a change by what was being done", () => {
    expect(historyTitle({ kind: "updated", action: "edit" })).toBe("Editado");
    expect(historyTitle({ kind: "updated", action: "pay" })).toBe("Pago");
    expect(historyTitle({ kind: "updated", action: "auto-pay" })).toBe("Pago automaticamente");
    expect(historyTitle({ kind: "updated", action: "undo-pay" })).toBe("Pagamento desfeito");
    expect(historyTitle({ kind: "updated", action: "receive" })).toBe("Recebido");
    expect(historyTitle({ kind: "updated", action: "undo-receive" })).toBe("Recebimento desfeito");
    expect(historyTitle({ kind: "updated", action: "bill-month" })).toBe("Mudou de fatura");
    expect(historyTitle({ kind: "updated", action: "stop-recurrence" })).toBe("Deixou de ser fixo");
    expect(historyTitle({ kind: "updated", action: "roll" })).toBe("Dívida rolada");
    expect(historyTitle({ kind: "updated", action: "assume" })).toBe("Você assumiu a parte de alguém");
  });

  it("falls back to the kind for an action it does not know, and calls a removal by its name", () => {
    expect(historyTitle({ kind: "created", action: "something-new" })).toBe("Criado");
    expect(historyTitle({ kind: "updated", action: "" })).toBe("Alterado");
    expect(historyTitle({ kind: "deleted", action: "delete" })).toBe("Excluído");
    // A word every object answers to is still just an unknown action.
    expect(historyTitle({ kind: "updated", action: "toString" })).toBe("Alterado");
    expect(historyTitle({ kind: "created", action: "constructor" })).toBe("Criado");
  });
});

describe("historyFieldLabel", () => {
  it("has words for every field", () => {
    for (const field of TRANSACTION_FIELDS) expect(historyFieldLabel(field).length).toBeGreaterThan(1);
    expect(historyFieldLabel("amount")).toBe("Valor");
    expect(historyFieldLabel("splits")).toBe("Rateio");
  });
});

describe("historyValueText", () => {
  it("reads money, dates, months and plain text", () => {
    expect(plain(historyValueText("amount", { type: "money", cents: 123456 }, names))).toBe("R$ 1.234,56");
    expect(historyValueText("date", { type: "date", date: "2026-11-05" }, names)).toBe("05/11/2026");
    expect(historyValueText("billMonth", { type: "month", month: "2026-12" }, names)).toBe("Dez 2026");
    expect(historyValueText("description", { type: "text", text: "Mercado" }, names)).toBe("Mercado");
    expect(historyValueText("recurrence", { type: "day", day: 10 }, names)).toBe("dia 10");
    expect(historyValueText("reimbursement", { type: "flag", on: true }, names)).toBe("sim");
    expect(historyValueText("reimbursement", { type: "flag", on: false }, names)).toBe("não");
    expect(historyValueText("source", { type: "source", source: "overdraft" }, names)).toBe(
      "Cheque especial",
    );
  });

  it("names the records behind the ids, and says when one is gone", () => {
    const ref = (entity: "account" | "card" | "category" | "person", id: string) =>
      ({ type: "ref", entity, id }) as const;
    expect(historyValueText("account", ref("account", "acc-1"), names)).toBe("Banco Azul · Conta corrente");
    expect(historyValueText("card", ref("card", "card-1"), names)).toBe("Cartão Gold");
    expect(historyValueText("category", ref("category", "cat-1"), names)).toBe("Mercado");
    expect(historyValueText("fromPerson", ref("person", "ana"), names)).toBe("Ana");
    expect(historyValueText("account", ref("account", "closed"), names)).toBe("(removido)");
  });

  it("lists who shares an expense, and a payment as day, amount and account", () => {
    const splits = {
      type: "splits",
      splits: [
        { personId: "ana", shareCents: 2000 },
        { personId: "bia", shareCents: 1050 },
      ],
    } as const;
    expect(plain(historyValueText("splits", splits, names))).toBe("Ana R$ 20,00 · Bia R$ 10,50");
    expect(
      plain(
        historyValueText(
          "payment",
          { type: "settled", date: "2026-11-12", accountId: "acc-1", cents: 4800 },
          names,
        ),
      ),
    ).toBe("12/11/2026 · R$ 48,00 · Banco Azul · Conta corrente");
    expect(
      historyValueText(
        "receipt",
        { type: "settled", date: "2026-11-12", accountId: null, cents: null },
        names,
      ),
    ).toBe("12/11/2026");
  });

  it("says what 'nothing there' means for each field", () => {
    const none = { type: "none" } as const;
    expect(historyValueText("category", none, names)).toBe("sem categoria");
    expect(historyValueText("splits", none, names)).toBe("só você");
    expect(historyValueText("payment", none, names)).toBe("em aberto");
    expect(historyValueText("receipt", none, names)).toBe("a receber");
    expect(historyValueText("billMonth", none, names)).toBe("automática");
    expect(historyValueText("recurrence", none, names)).toBe("não");
    expect(historyValueText("note", none, names)).toBe("vazia");
    // A field with no special wording keeps the dash.
    expect(historyValueText("description", none, names)).toBe("—");
  });
});

describe("historyWhen", () => {
  it("reads the instant on São Paulo's clock", () => {
    expect(historyWhen("2026-11-12T21:40:00.000Z")).toBe("12/11/2026 às 18:40");
    // Past midnight in UTC is still the evening before in São Paulo.
    expect(historyWhen("2026-11-13T01:05:00.000Z")).toBe("12/11/2026 às 22:05");
  });
});
