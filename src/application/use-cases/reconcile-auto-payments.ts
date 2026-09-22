import { isExpense, isPaid, isPayableObligation, isRolled } from "@/domain/entities/transaction";
import {
  billingCompetence,
  cardBillOverridesByCard,
  computeCardBillForMonth,
} from "@/domain/services/card-bill.calculator";
import { type CompetenceMonth, dateInMonth } from "@/domain/value-objects/competence-month";
import { todayInBrazil } from "@/shared/formatting/now";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

export interface ReconcileResult {
  readonly paidObligations: number;
  readonly paidFaturas: number;
}

const NOOP: ReconcileResult = { paidObligations: 0, paidFaturas: 0 };

/**
 * Auto-payments: when enabled, books every DUE unpaid deferred obligation (boleto/loan/financing)
 * and card fatura as PAID from the user's single default account, dated on the item's due date —
 * so it behaves as if the money left on the day it was due. Idempotent: already-paid items are
 * skipped, so it's safe to run on every app load and from the daily cron. Off, or with no default
 * account, it does nothing.
 */
export async function reconcileAutoPayments(
  repo: FinanceRepository,
  userId: string,
): Promise<ReconcileResult> {
  const profile = await repo.getProfile(userId);
  const account = profile.defaultPayAccountId;
  if (!profile.autoPaymentsEnabled || account === null) return NOOP;

  const ws = await loadWorkspaceCached(repo, userId);
  // The default account must still exist; otherwise auto-pay can't debit anything.
  if (!ws.accounts.some((a) => a.id === account)) return NOOP;
  const today = todayInBrazil();
  // Only book items coming DUE on/after auto-pay was turned on — never retroactively book arbitrary
  // past-due history (which would dump a surprise back-dated debit and may double-count bills the
  // user really paid elsewhere). Falls back to today if the "since" date is somehow unset.
  const since = profile.autoPaymentsSince ?? today;

  // 1) Deferred obligations due within [since, today] → book paid on their due date.
  let paidObligations = 0;
  for (const tx of ws.transactions) {
    if (isPayableObligation(tx) && !isPaid(tx) && !isRolled(tx) && tx.date >= since && tx.date <= today) {
      await repo.payTransaction(userId, tx.id, {
        paidAt: tx.date,
        paidAccountId: account,
        paidAmountCents: Math.abs(tx.amountCents),
      });
      paidObligations++;
    }
  }

  // 2) Card faturas whose due date has passed and aren't paid yet → book the whole bill.
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const overridesByCard = cardBillOverridesByCard(ws.cardBillDates);
  const paidBills = new Set(ws.cardBillPayments.map((p) => `${p.cardId}|${p.competence}`));
  let paidFaturas = 0;
  for (const card of ws.creditCards) {
    const competences = new Set<CompetenceMonth>();
    for (const tx of ws.transactions) {
      if (isExpense(tx) && tx.source === "card" && tx.cardId === card.id && !isRolled(tx)) {
        competences.add(competenceOf(tx));
      }
    }
    for (const competence of competences) {
      if (paidBills.has(`${card.id}|${competence}`)) continue;
      const dueDay = overridesByCard.get(card.id)?.get(competence)?.dueDay ?? card.dueDay;
      const dueDate = dateInMonth(competence, dueDay);
      if (dueDate < since || dueDate > today) continue; // outside [since, today]
      const bill = computeCardBillForMonth(card.id, ws.transactions, competence, competenceOf);
      if (bill.cents <= 0) continue; // nothing owed (or a credit balance)
      await repo.payCardBill(userId, {
        cardId: card.id,
        competenceMonth: competence,
        amountCents: bill.cents,
        accountId: account,
        paidOn: dueDate,
      });
      paidFaturas++;
    }
  }

  return { paidObligations, paidFaturas };
}
