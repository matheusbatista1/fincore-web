import type { TransactionHistoryEntry } from "@/application/use-cases/transaction-history";
import type { ExpenseSource } from "@/domain/entities/transaction";
import type { HistoryValue, TransactionField } from "@/domain/services/transaction-history";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { monthLabel } from "@/shared/formatting/dates";

/**
 * The words of a transaction's history ("Histórico de alterações"): what each entry is called, what
 * each field is called and how each value reads. Pure, so the screen only lays them out.
 */

/** The names behind the ids a history entry carries: what the screen already knows. */
export interface HistoryNames {
  readonly accounts: ReadonlyMap<string, string>;
  readonly cards: ReadonlyMap<string, string>;
  readonly categories: ReadonlyMap<string, string>;
  readonly people: ReadonlyMap<string, string>;
}

// The action is free text read back from the database: looked up in maps, never as a property.

/** How a creation is called, by what was being done; anything else is simply "Criado". */
const CREATED: ReadonlyMap<string, string> = new Map([
  ["import", "Criado pela importação"],
  ["recurring", "Lançado pelo fixo do mês"],
  ["roll", "Criado ao rolar a dívida"],
  ["settle", "Criado junto com o acerto"],
]);

/** How a change is called, by what was being done; anything else is simply "Alterado". */
const UPDATED: ReadonlyMap<string, string> = new Map([
  ["edit", "Editado"],
  ["pay", "Pago"],
  ["auto-pay", "Pago automaticamente"],
  ["undo-pay", "Pagamento desfeito"],
  ["receive", "Recebido"],
  ["undo-receive", "Recebimento desfeito"],
  ["bill-month", "Mudou de fatura"],
  ["stop-recurrence", "Deixou de ser fixo"],
  ["roll", "Dívida rolada"],
  ["assume", "Você assumiu a parte de alguém"],
]);

/** What an entry is called: "Criado", "Editado", "Pago", "Excluído"… */
export function historyTitle(entry: Pick<TransactionHistoryEntry, "kind" | "action">): string {
  if (entry.kind === "created") return CREATED.get(entry.action) ?? "Criado";
  if (entry.kind === "deleted") return "Excluído";
  return UPDATED.get(entry.action) ?? "Alterado";
}

const FIELD_LABELS: Readonly<Record<TransactionField, string>> = {
  description: "Descrição",
  amount: "Valor",
  date: "Data",
  category: "Categoria",
  source: "Forma de pagamento",
  card: "Cartão",
  account: "Conta",
  linkedAccount: "Conta vinculada",
  transferFrom: "De",
  transferTo: "Para",
  fromPerson: "Recebido de",
  reimbursement: "Reembolso",
  splits: "Rateio",
  recurrence: "Fixo todo mês",
  billMonth: "Fatura",
  payment: "Pagamento",
  receipt: "Recebimento",
  rolled: "Dívida rolada em",
  note: "Observação",
};

/** What a field is called on the screen. */
export const historyFieldLabel = (field: TransactionField): string => FIELD_LABELS[field];

/** What "nothing there" reads as, field by field: a bare dash would say too little. */
const EMPTY: Readonly<Partial<Record<TransactionField, string>>> = {
  category: "sem categoria",
  card: "nenhum",
  account: "nenhuma",
  linkedAccount: "nenhuma",
  fromPerson: "ninguém",
  splits: "só você",
  recurrence: "não",
  billMonth: "automática",
  payment: "em aberto",
  receipt: "a receber",
  rolled: "não",
  note: "vazia",
};

/** The same words the form uses for each way of paying. */
const SOURCES: Readonly<Record<ExpenseSource, string>> = {
  card: "Cartão de crédito",
  account: "Conta / Pix / débito",
  boleto: "Boleto",
  loan: "Empréstimo",
  financing: "Financiamento",
  overdraft: "Cheque especial",
};

/** What a record that is no longer there reads as. */
const GONE = "(removido)";

/** "10/11/2026". */
const fullDate = (date: IsoDate): string => {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
};

const nameOf = (
  names: HistoryNames,
  entity: "account" | "card" | "category" | "person",
  id: string,
): string => {
  const known =
    entity === "account"
      ? names.accounts
      : entity === "card"
        ? names.cards
        : entity === "category"
          ? names.categories
          : names.people;
  return known.get(id) ?? GONE;
};

/** How a field's value reads: money as R$, dates as dd/mm/aaaa, ids as the names behind them. */
export function historyValueText(field: TransactionField, value: HistoryValue, names: HistoryNames): string {
  switch (value.type) {
    case "none":
      return EMPTY[field] ?? "—";
    case "text":
      return value.text;
    case "money":
      return formatBRLAbsolute(value.cents);
    case "date":
      return fullDate(value.date);
    case "month":
      return monthLabel(value.month);
    case "day":
      return `dia ${value.day}`;
    case "flag":
      return value.on ? "sim" : "não";
    case "source":
      return SOURCES[value.source];
    case "ref":
      return nameOf(names, value.entity, value.id);
    case "splits":
      return value.splits
        .map((split) => `${nameOf(names, "person", split.personId)} ${formatBRLAbsolute(split.shareCents)}`)
        .join(" · ");
    case "settled": {
      const parts = [fullDate(value.date)];
      if (value.cents !== null) parts.push(formatBRLAbsolute(value.cents));
      if (value.accountId !== null) parts.push(nameOf(names, "account", value.accountId));
      return parts.join(" · ");
    }
  }
}

const WHEN = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** When an entry was recorded, on São Paulo's clock: "12/11/2026 às 18:40". */
export function historyWhen(at: string): string {
  const parts = WHEN.formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} às ${part("hour")}:${part("minute")}`;
}
