import { Money } from "@/domain/money/money";
import { generateInstallments } from "@/domain/services/installment.generator";
import { dayOf } from "@/domain/value-objects/competence-month";
import type { ImportStatementInput } from "@/shared/schemas/import";
import type {
  CreateTransactionCommand,
  FinanceRepository,
  NewTransactionEntry,
} from "../ports/finance-repository";

type ImportEntry = ImportStatementInput["entries"][number];
type InstallmentEntry = ImportEntry & { installment: NonNullable<ImportEntry["installment"]> };

/**
 * Import reviewed lines as transactions.
 *
 * - **Wallet (statement):** a negative amount becomes an account expense, a
 *   positive one income landing in it.
 * - **Card (bill):** every line is a charge, stored as a negative card expense
 *   by magnitude (the wizard already excluded credits by dominant sign).
 *
 * Per line the user may also mark it **fixed** (recurring) or, on a card,
 * **installment** (split into N parcelas). Installment lines each persist as
 * their own group via `createTransaction`; the rest go in one atomic batch.
 */
export async function importStatement(
  repo: FinanceRepository,
  userId: string,
  input: ImportStatementInput,
): Promise<{ imported: number }> {
  return input.target.type === "card"
    ? importCard(repo, userId, input.entries, input.target.cardId)
    : importAccount(repo, userId, input.entries, input.target.accountId);
}

/** Bank-statement lines → account expenses (negative) and incomes (positive). */
async function importAccount(
  repo: FinanceRepository,
  userId: string,
  rows: ImportEntry[],
  accountId: string,
): Promise<{ imported: number }> {
  const entries: NewTransactionEntry[] = rows.map((entry) => {
    const recurrenceDayOfMonth = entry.fixed ? dayOf(entry.date) : null;
    if (entry.amountCents < 0) {
      return {
        kind: "expense",
        description: entry.description || "Despesa",
        date: entry.date,
        amountCents: entry.amountCents,
        source: "account",
        accountId,
        categoryId: entry.categoryId,
        myShareCents: Math.abs(entry.amountCents),
        recurrenceDayOfMonth,
        splits: [],
      };
    }
    return {
      kind: "income",
      description: entry.description || "Receita",
      date: entry.date,
      amountCents: entry.amountCents,
      accountId,
      isReimbursement: false,
      myShareCents: entry.amountCents,
      recurrenceDayOfMonth,
    };
  });
  if (entries.length === 0) return { imported: 0 };
  await repo.createTransaction(userId, { entries });
  return { imported: entries.length };
}

/** Card-bill lines → card charges; installment lines expand into their own group. */
async function importCard(
  repo: FinanceRepository,
  userId: string,
  rows: ImportEntry[],
  cardId: string,
): Promise<{ imported: number }> {
  const plain = rows.filter((row) => row.installment === null);
  const installments = rows.filter((row): row is InstallmentEntry => row.installment !== null);

  let imported = 0;
  if (plain.length > 0) {
    const entries: NewTransactionEntry[] = plain.map((entry) => {
      const cents = Math.abs(entry.amountCents);
      return {
        kind: "expense",
        description: entry.description || "Despesa",
        date: entry.date,
        amountCents: -cents,
        source: "card",
        cardId,
        categoryId: entry.categoryId,
        myShareCents: cents,
        recurrenceDayOfMonth: entry.fixed ? dayOf(entry.date) : null,
        splits: [],
      };
    });
    await repo.createTransaction(userId, { entries });
    imported += entries.length;
  }

  // Each installment line is its own group (the command carries one group at a time).
  for (const entry of installments) {
    await repo.createTransaction(userId, cardInstallmentCommand(entry, cardId));
    imported += 1;
  }
  return { imported };
}

/** Expand one installment card line into an installment group + N parcela entries. */
function cardInstallmentCommand(entry: InstallmentEntry, cardId: string): CreateTransactionCommand {
  const principal = Money.fromCents(-Math.abs(entry.amountCents));
  const schedule = generateInstallments({
    total: principal,
    count: entry.installment.total,
    current: entry.installment.current,
    includePrevious: entry.installment.includePrevious,
    includeNext: entry.installment.includeNext,
    baseDate: entry.date,
  });
  const entries: NewTransactionEntry[] = schedule.map((parcela) => ({
    kind: "expense",
    description: entry.description || "Despesa",
    date: parcela.date,
    amountCents: parcela.amount.cents,
    source: "card",
    cardId,
    categoryId: entry.categoryId,
    myShareCents: parcela.amount.abs().cents,
    parcelaNo: parcela.number,
    parcelaTotal: parcela.total,
    parcelaStatus: parcela.status,
    splits: [],
  }));
  return {
    installmentGroup: { totalCount: entry.installment.total, totalCents: principal.cents },
    entries,
  };
}
