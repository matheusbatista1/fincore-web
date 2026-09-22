import { isReceivableIncome, isReceived } from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import { todayInBrazil } from "@/shared/formatting/now";
import { err, ok, type Result } from "@/shared/result";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

export interface ReceiveIncomeParams {
  readonly id: string;
  readonly receivedAccountId: string;
  /** Defaults to today (America/São_Paulo) when omitted. */
  readonly receivedAt?: IsoDate;
  /** Defaults to the income's full amount; a custom value records a partial/different receipt. */
  readonly receivedAmountCents?: number;
}

export interface ReceiveIncomeError {
  readonly code:
    | "not_found"
    | "not_receivable"
    | "already_received"
    | "invalid_account"
    | "invalid_amount"
    | "invalid_date";
  readonly message: string;
}

/**
 * Mark a normal income as RECEIVED (the mirror of {@link payTransaction} on the income side): record
 * the receiving account, receipt date and amount so it credits the balance on the receipt date, while
 * its original booked date and amount stay intact for history. When the income is a payment from a
 * person, receiving abates that person's debt by the amount received. Card credits (estornos) are
 * excluded — they only reduce a card bill, never received into an account.
 */
export async function receiveIncome(
  repo: FinanceRepository,
  userId: string,
  params: ReceiveIncomeParams,
): Promise<Result<void, ReceiveIncomeError>> {
  const ws = await loadWorkspaceCached(repo, userId);
  const tx = ws.transactions.find((t) => t.id === params.id);
  if (!tx) return err({ code: "not_found", message: "Lançamento não encontrado." });
  if (!isReceivableIncome(tx)) {
    return err({ code: "not_receivable", message: "Só receitas em conta podem ser recebidas." });
  }
  if (isReceived(tx)) return err({ code: "already_received", message: "Esta receita já foi recebida." });

  if (!ws.accounts.some((a) => a.id === params.receivedAccountId)) {
    return err({ code: "invalid_account", message: "Conta de recebimento inválida." });
  }

  const receivedAmountCents = params.receivedAmountCents ?? tx.amountCents;
  if (!Number.isInteger(receivedAmountCents) || receivedAmountCents <= 0) {
    return err({ code: "invalid_amount", message: "Valor recebido inválido." });
  }

  const today = todayInBrazil();
  const receivedAt = params.receivedAt ?? today;
  // A receipt can't be in the future: a future `received_at` would mark the income "received" (no
  // longer a pending receivable) yet the cash would not credit the balance until that future date —
  // a contradictory state. The client caps the picker at today; re-enforce it server-side.
  if (receivedAt > today) {
    return err({ code: "invalid_date", message: "A data do recebimento não pode ser futura." });
  }
  await repo.receiveIncome(userId, tx.id, {
    receivedAt,
    receivedAccountId: params.receivedAccountId,
    receivedAmountCents,
  });
  return ok(undefined);
}
