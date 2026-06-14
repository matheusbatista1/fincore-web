/**
 * Map Drizzle rows to pure domain entities. Keeps infrastructure shapes
 * (user_id, audit columns) out of the domain.
 */
import type { Account } from "@/domain/entities/account";
import type { Budget } from "@/domain/entities/budget";
import type { CardBillDate } from "@/domain/entities/card-bill-date";
import type { Category } from "@/domain/entities/category";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { Goal } from "@/domain/entities/goal";
import type { Person } from "@/domain/entities/person";
import type { Settlement } from "@/domain/entities/settlement";
import type { Transaction, TransactionSplit } from "@/domain/entities/transaction";
import type {
  accounts,
  budgets,
  cardBillDates,
  categories,
  creditCards,
  goals,
  people,
  settlements,
  transactionSplits,
  transactions,
} from "./schema";

type AccountRow = typeof accounts.$inferSelect;
type CreditCardRow = typeof creditCards.$inferSelect;
type CardBillDateRow = typeof cardBillDates.$inferSelect;
type PersonRow = typeof people.$inferSelect;
type CategoryRow = typeof categories.$inferSelect;
type TransactionRow = typeof transactions.$inferSelect;
type SplitRow = typeof transactionSplits.$inferSelect;
type SettlementRow = typeof settlements.$inferSelect;
type BudgetRow = typeof budgets.$inferSelect;
type GoalRow = typeof goals.$inferSelect;

/** Throw on a NULL column that a transaction kind guarantees to be present. */
function required<T>(value: T | null | undefined, field: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Inconsistent transaction row: "${field}" must be present`);
  }
  return value;
}

export function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    bank: row.bank,
    name: row.name,
    type: row.type,
    themeKey: row.themeKey,
    openingBalanceCents: row.openingBalanceCents,
    maskedNumber: row.maskedNumber,
  };
}

export function toCreditCard(row: CreditCardRow): CreditCard {
  return {
    id: row.id,
    bank: row.bank,
    product: row.product,
    flag: row.flag,
    themeKey: row.themeKey,
    maskedNumber: row.maskedNumber,
    limitCents: row.limitCents,
    closingDay: row.closingDay,
    dueDay: row.dueDay,
  };
}

export function toCardBillDate(row: CardBillDateRow): CardBillDate {
  return {
    cardId: row.cardId,
    month: row.month,
    closingDay: row.closingDay,
    dueDay: row.dueDay,
  };
}

export function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    relationship: row.relationship,
    color: row.color,
  };
}

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
  };
}

export function toBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    categoryId: row.categoryId,
    limitCents: row.limitCents,
  };
}

export function toGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    name: row.name,
    targetCents: row.targetCents,
    savedCents: row.savedCents,
  };
}

export function toSplit(row: SplitRow): TransactionSplit {
  return { personId: row.personId, shareCents: row.shareCents };
}

export function toSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    personId: row.personId,
    amountCents: row.amountCents,
    date: row.settledOn,
    accountId: row.accountId,
    ...(row.note != null ? { note: row.note } : {}),
  };
}

/** Build the polymorphic Transaction from its row (+ its splits for expenses). */
export function toTransaction(row: TransactionRow, splits: readonly SplitRow[] = []): Transaction {
  const base = {
    id: row.id,
    description: row.description,
    date: row.occurredOn,
    ...(row.note != null ? { note: row.note } : {}),
  };

  const recurrence = row.recurrenceDayOfMonth != null ? { dayOfMonth: row.recurrenceDayOfMonth } : null;

  if (row.kind === "transfer") {
    return {
      ...base,
      kind: "transfer",
      fromAccountId: required(row.transferFromAccountId, "transferFromAccountId"),
      toAccountId: required(row.transferToAccountId, "transferToAccountId"),
      valueCents: required(row.transferValueCents, "transferValueCents"),
    };
  }

  if (row.kind === "income") {
    return {
      ...base,
      kind: "income",
      amountCents: row.amountCents,
      accountId: required(row.accountId, "accountId"),
      fromPersonId: row.fromPersonId,
      isReimbursement: row.isReimbursement,
      recurrence,
    };
  }

  return {
    ...base,
    kind: "expense",
    amountCents: row.amountCents,
    categoryId: row.categoryId,
    source: required(row.source, "source"),
    cardId: row.cardId,
    accountId: row.accountId,
    linkedAccountId: row.linkedAccountId,
    splits: splits.map(toSplit),
    myShareCents: row.myShareCents ?? Math.abs(row.amountCents),
    installment:
      row.installmentGroupId != null
        ? {
            groupId: row.installmentGroupId,
            number: required(row.parcelaNo, "parcelaNo"),
            total: required(row.parcelaTotal, "parcelaTotal"),
            status: required(row.parcelaStatus, "parcelaStatus"),
          }
        : null,
    recurrence,
  };
}
