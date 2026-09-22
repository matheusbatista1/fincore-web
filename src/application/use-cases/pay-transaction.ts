import { isPaid, isPayableObligation, isRolled } from "@/domain/entities/transaction";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import { todayInBrazil } from "@/shared/formatting/now";
import { err, ok, type Result } from "@/shared/result";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

export interface PayTransactionParams {
  readonly id: string;
  readonly paidAccountId: string;
  /** Defaults to today (America/São_Paulo) when omitted. */
  readonly paidAt?: IsoDate;
  /** Defaults to the obligation's full amount; a custom value settles early (e.g. a loan discount). */
  readonly paidAmountCents?: number;
}

export interface PayTransactionError {
  readonly code: "not_found" | "not_payable" | "already_paid" | "invalid_account" | "invalid_amount";
  readonly message: string;
}

/**
 * Pay a deferred obligation (boleto/loan/financing): record the paying account, paid date and
 * amount so it debits the balance on the paid date, while its original due date and amount stay
 * intact for history. Card charges are excluded (settled via the whole bill, not per-charge).
 */
export async function payTransaction(
  repo: FinanceRepository,
  userId: string,
  params: PayTransactionParams,
): Promise<Result<void, PayTransactionError>> {
  const ws = await loadWorkspaceCached(repo, userId);
  const tx = ws.transactions.find((t) => t.id === params.id);
  if (!tx) return err({ code: "not_found", message: "Lançamento não encontrado." });
  if (isRolled(tx)) return err({ code: "not_payable", message: "Uma dívida rolada não pode ser paga." });
  if (!isPayableObligation(tx)) {
    return err({
      code: "not_payable",
      message: "Só boletos, empréstimos e financiamentos podem ser pagos individualmente.",
    });
  }
  if (isPaid(tx)) return err({ code: "already_paid", message: "Este lançamento já está pago." });

  if (!ws.accounts.some((a) => a.id === params.paidAccountId)) {
    return err({ code: "invalid_account", message: "Conta de pagamento inválida." });
  }

  const paidAmountCents = params.paidAmountCents ?? Math.abs(tx.amountCents);
  if (!Number.isInteger(paidAmountCents) || paidAmountCents <= 0) {
    return err({ code: "invalid_amount", message: "Valor pago inválido." });
  }

  const paidAt = params.paidAt ?? todayInBrazil();
  await repo.payTransaction(userId, tx.id, { paidAt, paidAccountId: params.paidAccountId, paidAmountCents });
  return ok(undefined);
}
