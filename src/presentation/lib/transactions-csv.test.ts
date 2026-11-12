import { describe, expect, it } from "vitest";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { TRANSACTIONS_EXPORT_HEADERS, transactionExportRow } from "./transactions-csv";

/** A plain account expense; each test changes only what it is about. */
const row = (over: Partial<TransactionListItem> = {}): TransactionListItem => ({
  id: "t",
  kind: "expense",
  description: "Mercado",
  date: "2026-11-05",
  amountCents: -15_090,
  note: null,
  category: { name: "Alimentação", color: "#000000", icon: "utensils" },
  categoryId: "c",
  sourceLabel: "Itaú · Conta principal",
  source: "account",
  cardId: null,
  accountId: "a",
  linkedAccountId: null,
  parcela: null,
  installmentGroupId: null,
  billMonthOverride: null,
  billMonth: "2026-11",
  isFixed: false,
  rolled: false,
  isPayable: false,
  isPaid: false,
  paidAt: null,
  paidAccountId: null,
  paidAccountLabel: null,
  paidAmountCents: null,
  usualPayAccountId: null,
  isReceivable: false,
  isReceived: false,
  receivedAt: null,
  receivedAccountId: null,
  receivedAccountLabel: null,
  receivedAmountCents: null,
  shares: [],
  myShareCents: 15_090,
  isReimbursement: false,
  fromPersonId: null,
  fromPersonName: null,
  transferFromName: null,
  transferToName: null,
  transferFromAccountId: null,
  transferToAccountId: null,
  transferValueCents: null,
  ...over,
});

/** A row as an object keyed by the header, so an expectation names the column it is about. */
const cells = (item: TransactionListItem): Record<string, string | number> =>
  Object.fromEntries(
    TRANSACTIONS_EXPORT_HEADERS.map((header, i) => [header, transactionExportRow(item)[i] ?? ""]),
  );

describe("transactionExportRow", () => {
  it("has one cell per header", () => {
    expect(transactionExportRow(row())).toHaveLength(TRANSACTIONS_EXPORT_HEADERS.length);
  });

  it("writes a plain expense", () => {
    expect(cells(row())).toEqual({
      Data: "05/11/2026",
      Descrição: "Mercado",
      Tipo: "Despesa",
      Categoria: "Alimentação",
      Origem: "Itaú · Conta principal",
      Pessoas: "",
      "Minha parte (R$)": "",
      Parcela: "",
      Fatura: "",
      Fixo: "",
      Situação: "",
      Observação: "",
      "Valor (R$)": "-150,90",
    });
  });

  it("names who shares an expense, and the user's part of it", () => {
    const shared = cells(
      row({
        shares: [
          { personId: "p1", name: "Ana", color: "#000000", shareCents: 5_030 },
          { personId: "p2", name: "Bia", color: "#000000", shareCents: 5_030 },
        ],
        myShareCents: 5_030,
      }),
    );
    expect(shared.Pessoas).toBe("Ana, Bia");
    expect(shared["Minha parte (R$)"]).toBe("-50,30");
    expect(shared["Valor (R$)"]).toBe("-150,90");
  });

  it("files a card charge under its fatura, and tells its parcela and whether it is fixed", () => {
    const charge = cells(
      row({
        source: "card",
        cardId: "k",
        accountId: null,
        sourceLabel: "Cartão Nubank",
        billMonth: "2026-12",
        parcela: { number: 3, total: 10, status: "open" as never },
        isFixed: true,
      }),
    );
    expect(charge.Origem).toBe("Cartão Nubank");
    expect(charge.Fatura).toBe("Dez 2026");
    expect(charge.Parcela).toBe("3/10");
    expect(charge.Fixo).toBe("Sim");
  });

  it("says where a bill or an income stands", () => {
    const bill = row({ source: "boleto", accountId: null, sourceLabel: "Boleto", isPayable: true });
    expect(cells(bill).Situação).toBe("A pagar");
    expect(cells({ ...bill, isPaid: true, paidAt: "2026-11-10" }).Situação).toBe("Pago em 10/11/2026");
    const salary = row({ kind: "income", amountCents: 500_000, isReceivable: true, category: null });
    expect(cells(salary).Situação).toBe("A receber");
    expect(cells({ ...salary, isReceived: true, receivedAt: "2026-11-06" }).Situação).toBe(
      "Recebido em 06/11/2026",
    );
    expect(cells(row({ rolled: true })).Situação).toBe("Rolada para outra dívida");
    expect(cells(row({ ledgerOnly: true })).Situação).toBe("Dívida sem movimentação");
  });

  it("writes an income from a person and a transfer between accounts", () => {
    const fromAna = cells(
      row({ kind: "income", description: "", amountCents: 6_000, category: null, fromPersonName: "Ana" }),
    );
    expect(fromAna.Descrição).toBe("Receita");
    expect(fromAna.Pessoas).toBe("Ana");
    expect(fromAna["Valor (R$)"]).toBe("60,00");
    const transfer = cells(
      row({
        kind: "transfer",
        description: "Reserva",
        amountCents: 0,
        category: null,
        sourceLabel: null,
        source: null,
        transferFromName: "Itaú · Conta",
        transferToName: "Nubank · Caixinha",
        transferValueCents: 20_000,
      }),
    );
    expect(transfer.Tipo).toBe("Transferência");
    expect(transfer.Origem).toBe("Itaú · Conta -> Nubank · Caixinha");
    expect(transfer["Valor (R$)"]).toBe("200,00");
  });

  it("keeps the note", () => {
    expect(cells(row({ note: "Assumido de Ana" })).Observação).toBe("Assumido de Ana");
  });
});
