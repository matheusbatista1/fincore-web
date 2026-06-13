import type { ImportStatementInput } from "@/shared/schemas/import";
import type { FinanceRepository, NewTransactionEntry } from "../ports/finance-repository";

/**
 * Import reviewed lines as transactions.
 *
 * - **Wallet (bank statement):** a negative amount becomes an expense paid from
 *   the account; a positive one becomes income landing in it.
 * - **Card (bill):** every positive line becomes a charge on the card (stored as
 *   a negative card expense). Negative lines are credits/refunds, which the
 *   domain can't represent as a card transaction, so they are skipped.
 *
 * All rows are inserted atomically via the repository.
 */
export async function importStatement(
  repo: FinanceRepository,
  userId: string,
  input: ImportStatementInput,
): Promise<{ imported: number }> {
  const entries: NewTransactionEntry[] =
    input.target.type === "card"
      ? toCardCharges(input.entries, input.target.cardId)
      : toAccountEntries(input.entries, input.target.accountId);

  if (entries.length === 0) return { imported: 0 };
  await repo.createTransaction(userId, { entries });
  return { imported: entries.length };
}

/** Bank-statement lines → account expenses (negative) and incomes (positive). */
function toAccountEntries(rows: ImportStatementInput["entries"], accountId: string): NewTransactionEntry[] {
  return rows.map((entry) => {
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
    };
  });
}

/** Card-bill lines → card charges. Positive = purchase; negative = credit (skipped). */
function toCardCharges(rows: ImportStatementInput["entries"], cardId: string): NewTransactionEntry[] {
  return rows.flatMap((entry) => {
    if (entry.amountCents <= 0) return [];
    return [
      {
        kind: "expense",
        description: entry.description || "Despesa",
        date: entry.date,
        amountCents: -entry.amountCents,
        source: "card",
        cardId,
        categoryId: entry.categoryId,
        myShareCents: entry.amountCents,
        splits: [],
      },
    ];
  });
}
