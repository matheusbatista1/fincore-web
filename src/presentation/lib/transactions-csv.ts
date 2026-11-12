import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { monthLabel } from "@/shared/formatting/dates";
import { type CsvCell, csvMoney } from "./export";

/**
 * The spreadsheet of "Baixar meus dados": one row per transaction, with everything a person would
 * want to filter or add up by — not only what the transactions screen shows.
 */
export const TRANSACTIONS_EXPORT_HEADERS = [
  "Data",
  "Descrição",
  "Tipo",
  "Categoria",
  "Origem",
  "Pessoas",
  "Minha parte (R$)",
  "Parcela",
  "Fatura",
  "Fixo",
  "Situação",
  "Observação",
  "Valor (R$)",
] as const;

const KIND_LABEL: Record<TransactionListItem["kind"], string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
};

/** `2026-07-02` → `02/07/2026`. */
const brDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Where a row stands, in words: paid, still to pay, received, still to receive… or nothing to say. */
function situation(t: TransactionListItem): string {
  if (t.rolled) return "Rolada para outra dívida";
  if (t.ledgerOnly) return "Dívida sem movimentação";
  if (t.isPayable) return t.isPaid && t.paidAt ? `Pago em ${brDate(t.paidAt)}` : "A pagar";
  if (t.isReceivable)
    return t.isReceived && t.receivedAt ? `Recebido em ${brDate(t.receivedAt)}` : "A receber";
  return "";
}

/** One transaction as a row of {@link TRANSACTIONS_EXPORT_HEADERS}. */
export function transactionExportRow(t: TransactionListItem): CsvCell[] {
  const shared = t.shares.length > 0;
  return [
    brDate(t.date),
    t.description || KIND_LABEL[t.kind],
    KIND_LABEL[t.kind],
    t.category?.name ?? "",
    t.kind === "transfer"
      ? `${t.transferFromName ?? ""} -> ${t.transferToName ?? ""}`
      : (t.sourceLabel ?? ""),
    t.kind === "income" ? (t.fromPersonName ?? "") : t.shares.map((s) => s.name).join(", "),
    // Only where it differs from the amount: an expense someone else shares.
    shared && t.myShareCents !== null ? csvMoney(-Math.abs(t.myShareCents)) : "",
    t.parcela ? `${t.parcela.number}/${t.parcela.total}` : "",
    // A card charge is filed under the month its fatura is due.
    t.kind === "expense" && t.source === "card" && t.billMonth ? monthLabel(t.billMonth) : "",
    t.isFixed ? "Sim" : "",
    situation(t),
    t.note ?? "",
    csvMoney(t.kind === "transfer" ? (t.transferValueCents ?? 0) : t.amountCents),
  ];
}
