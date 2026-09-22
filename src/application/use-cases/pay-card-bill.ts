import { billingCompetence, computeCardBillForMonth } from "@/domain/services/card-bill.calculator";
import type { CompetenceMonth, IsoDate } from "@/domain/value-objects/competence-month";
import { todayInBrazil } from "@/shared/formatting/now";
import { err, ok, type Result } from "@/shared/result";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

export interface PayCardBillParams {
  readonly cardId: string;
  /** The bill's competence (due) month `YYYY-MM`. */
  readonly competenceMonth: CompetenceMonth;
  readonly paidAccountId: string;
  /** Defaults to today (America/São_Paulo) when omitted. */
  readonly paidAt?: IsoDate;
}

export interface PayCardBillError {
  readonly code: "card_not_found" | "invalid_account" | "nothing_to_pay" | "already_paid";
  readonly message: string;
}

/**
 * Pay a whole credit-card fatura: snapshots the computed bill total for (card, competence) and
 * records a payment that debits the chosen account on the pay date. The bill total is computed
 * server-side (never trusted from the client). Rejects an empty bill or one already paid.
 */
export async function payCardBill(
  repo: FinanceRepository,
  userId: string,
  params: PayCardBillParams,
): Promise<Result<void, PayCardBillError>> {
  const ws = await loadWorkspaceCached(repo, userId);
  if (!ws.creditCards.some((c) => c.id === params.cardId)) {
    return err({ code: "card_not_found", message: "Cartão não encontrado." });
  }
  if (!ws.accounts.some((a) => a.id === params.paidAccountId)) {
    return err({ code: "invalid_account", message: "Conta de pagamento inválida." });
  }
  if (
    ws.cardBillPayments.some((p) => p.cardId === params.cardId && p.competence === params.competenceMonth)
  ) {
    return err({ code: "already_paid", message: "Esta fatura já está paga." });
  }

  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const bill = computeCardBillForMonth(params.cardId, ws.transactions, params.competenceMonth, competenceOf);
  if (bill.cents <= 0) {
    return err({ code: "nothing_to_pay", message: "Não há valor a pagar nesta fatura." });
  }

  await repo.payCardBill(userId, {
    cardId: params.cardId,
    competenceMonth: params.competenceMonth,
    amountCents: bill.cents,
    accountId: params.paidAccountId,
    paidOn: params.paidAt ?? todayInBrazil(),
  });
  return ok(undefined);
}
