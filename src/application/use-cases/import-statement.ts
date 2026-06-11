import type { ImportStatementInput } from "@/shared/schemas/import";
import type { FinanceRepository, NewTransactionEntry } from "../ports/finance-repository";

/**
 * Import reviewed statement lines as transactions for one account. A negative
 * amount becomes an expense paid from the account; a positive one becomes income
 * landing in it. All rows are inserted atomically via the repository.
 */
export async function importStatement(
  repo: FinanceRepository,
  userId: string,
  input: ImportStatementInput,
): Promise<{ imported: number }> {
  const entries: NewTransactionEntry[] = input.entries.map((entry) => {
    if (entry.amountCents < 0) {
      return {
        kind: "expense",
        description: entry.description || "Despesa",
        date: entry.date,
        amountCents: entry.amountCents,
        source: "account",
        accountId: input.accountId,
        categoryId: entry.categoryId,
        myShareCents: Math.abs(entry.amountCents),
        splits: [],
      };
    }
    return {
      kind: "income",
      description: entry.description || "Receita",
      date: entry.date,
      amountCents: entry.amountCents,
      accountId: input.accountId,
      isReimbursement: false,
      myShareCents: entry.amountCents,
    };
  });

  if (entries.length === 0) return { imported: 0 };
  await repo.createTransaction(userId, { entries });
  return { imported: entries.length };
}
