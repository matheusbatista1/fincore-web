import type {
  ExpenseSource,
  ParcelaStatus,
  Transaction,
  TransactionKind,
} from "@/domain/entities/transaction";
import { isExpense, isIncome, isTransfer } from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import { monthOf } from "@/domain/value-objects/competence-month";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";

/** pt-BR labels for the non-card/account expense sources. */
const SOURCE_LABELS: Record<ExpenseSource, string> = {
  card: "Cartão",
  account: "Conta",
  boleto: "Boleto",
  loan: "Empréstimo",
  financing: "Financiamento",
  overdraft: "Cheque especial",
};

/** One person's share of a shared expense, enriched with display data. */
export interface TxShareView {
  readonly personId: string;
  readonly name: string;
  readonly color: string;
  readonly shareCents: number;
}

/** A serializable transaction row enriched with resolved names — safe for RSC/client. */
export interface TransactionListItem {
  readonly id: string;
  readonly kind: TransactionKind;
  readonly description: string;
  readonly date: IsoDate;
  /** Signed amount for display (expense < 0, income > 0; transfers carry `transferValueCents`). */
  readonly amountCents: number;
  readonly note: string | null;
  readonly category: { readonly name: string; readonly color: string; readonly icon: string } | null;
  /** Raw category id (edit-form prefill). */
  readonly categoryId: string | null;
  /** "Cartão Nubank", "Itaú · Conta principal", "Boleto", … */
  readonly sourceLabel: string | null;
  /** Expense payment source (edit-form prefill); null for income/transfer. */
  readonly source: ExpenseSource | null;
  /** Card this expense was charged to (for per-card bill filtering). */
  readonly cardId: string | null;
  /** Account that moved (expense debit / income credit) — null for card-source and transfers. */
  readonly accountId: string | null;
  /** Organizational bank link for boleto/loan/financing/overdraft. */
  readonly linkedAccountId: string | null;
  readonly parcela: {
    readonly number: number;
    readonly total: number;
    readonly status: ParcelaStatus;
  } | null;
  /** Groups installments of the same purchase (for the active-installments panel). */
  readonly installmentGroupId: string | null;
  /** Manual bill (competence month) override for a card charge; null = automatic. */
  readonly billMonthOverride: string | null;
  readonly isFixed: boolean;
  /** True when this expense was rolled into a new debt ("Rolar dívida") — abated, kept for history. */
  readonly rolled: boolean;
  /** People sharing the expense (empty when not shared). */
  readonly shares: TxShareView[];
  readonly myShareCents: number | null;
  /** True for a reimbursement income (a refund) — excluded from the personal lens. */
  readonly isReimbursement: boolean;
  /** When an income is a payment from a person, their id + first name. */
  readonly fromPersonId: string | null;
  readonly fromPersonName: string | null;
  readonly transferFromName: string | null;
  readonly transferToName: string | null;
  readonly transferFromAccountId: string | null;
  readonly transferToAccountId: string | null;
  readonly transferValueCents: number | null;
}

export interface GetTransactionsOptions {
  /** Restrict to a single competence month (`YYYY-MM`); omit for the full history. */
  readonly month?: string;
}

/** Newest-first comparator for display rows (ties broken by id for stability). */
export function byDateDesc(a: TransactionListItem, b: TransactionListItem): number {
  return a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1;
}

/**
 * Build a pure mapper from a loaded workspace: `(transaction) => TransactionListItem`.
 * Resolves account/card/category/person names once, so callers (history, monthly
 * view, projections) share the exact same display logic.
 */
export function createTransactionMapper(ws: Workspace): (tx: Transaction) => TransactionListItem {
  const accountName = new Map(ws.accounts.map((a) => [a.id, `${a.bank} · ${a.name}`]));
  const cardName = new Map(ws.creditCards.map((c) => [c.id, `Cartão ${c.bank}`]));
  const categoryById = new Map(ws.categories.map((c) => [c.id, c]));
  const personById = new Map(ws.people.map((p) => [p.id, p]));
  const firstName = (full: string): string => full.split(" ")[0] ?? full;

  return (tx: Transaction): TransactionListItem => {
    const base = {
      id: tx.id,
      description: tx.description,
      date: tx.date,
      note: tx.note ?? null,
      category: null,
      categoryId: null,
      sourceLabel: null,
      source: null,
      cardId: null,
      accountId: null,
      linkedAccountId: null,
      parcela: null,
      installmentGroupId: null,
      billMonthOverride: null,
      isFixed: false,
      rolled: false,
      fromPersonId: null,
      shares: [] as TxShareView[],
      myShareCents: null,
      isReimbursement: false,
      fromPersonName: null,
      transferFromName: null,
      transferToName: null,
      transferFromAccountId: null,
      transferToAccountId: null,
      transferValueCents: null,
    };

    if (isExpense(tx)) {
      const category = tx.categoryId ? (categoryById.get(tx.categoryId) ?? null) : null;
      const sourceLabel =
        tx.source === "card"
          ? tx.cardId
            ? (cardName.get(tx.cardId) ?? "Cartão")
            : "Cartão"
          : tx.source === "account"
            ? tx.accountId
              ? (accountName.get(tx.accountId) ?? "Conta")
              : "Conta"
            : SOURCE_LABELS[tx.source];
      const shares: TxShareView[] = tx.splits.flatMap((split) => {
        const person = personById.get(split.personId);
        return person
          ? [{ personId: person.id, name: person.name, color: person.color, shareCents: split.shareCents }]
          : [];
      });
      return {
        ...base,
        kind: "expense" as const,
        amountCents: tx.amountCents,
        category: category ? { name: category.name, color: category.color, icon: category.icon } : null,
        categoryId: tx.categoryId,
        sourceLabel,
        source: tx.source,
        cardId: tx.cardId,
        accountId: tx.accountId,
        linkedAccountId: tx.linkedAccountId,
        parcela: tx.installment
          ? { number: tx.installment.number, total: tx.installment.total, status: tx.installment.status }
          : null,
        installmentGroupId: tx.installment?.groupId ?? null,
        billMonthOverride: tx.billMonthOverride,
        isFixed: tx.recurrence !== null,
        rolled: tx.rolledAt != null,
        shares,
        myShareCents: tx.myShareCents,
      };
    }

    if (isIncome(tx)) {
      const person = tx.fromPersonId ? personById.get(tx.fromPersonId) : undefined;
      // A card credit (estorno) is bound to a card; a normal income to an account.
      const sourceLabel =
        tx.cardId !== null
          ? (cardName.get(tx.cardId) ?? "Cartão")
          : tx.accountId !== null
            ? (accountName.get(tx.accountId) ?? null)
            : null;
      return {
        ...base,
        kind: "income" as const,
        amountCents: tx.amountCents,
        sourceLabel,
        accountId: tx.accountId,
        cardId: tx.cardId,
        isFixed: tx.recurrence !== null,
        isReimbursement: tx.isReimbursement,
        fromPersonId: tx.fromPersonId,
        fromPersonName: person ? firstName(person.name) : null,
      };
    }

    if (isTransfer(tx)) {
      return {
        ...base,
        kind: "transfer" as const,
        amountCents: 0,
        transferFromName: accountName.get(tx.fromAccountId) ?? null,
        transferToName: accountName.get(tx.toAccountId) ?? null,
        transferFromAccountId: tx.fromAccountId,
        transferToAccountId: tx.toAccountId,
        transferValueCents: tx.valueCents,
      };
    }

    throw new Error("Unknown transaction kind");
  };
}

/** Load a user's transactions as a display-ready, newest-first list. */
export async function getTransactions(
  repo: FinanceRepository,
  userId: string,
  options: GetTransactionsOptions = {},
): Promise<TransactionListItem[]> {
  const ws = await loadWorkspaceCached(repo, userId);
  const map = createTransactionMapper(ws);
  const source = options.month
    ? ws.transactions.filter((tx) => monthOf(tx.date) === options.month)
    : ws.transactions;
  return source.map(map).sort(byDateDesc);
}
