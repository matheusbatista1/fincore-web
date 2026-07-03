import {
  incomeEffectiveDate,
  isExpense,
  isPaid,
  isPayableObligation,
  isReceivableIncome,
  isReceived,
  isRolled,
  settledIncomeCents,
} from "@/domain/entities/transaction";
import { Money } from "@/domain/money/money";
import { billingCompetence } from "@/domain/services/card-bill.calculator";
import { computePersonBalances } from "@/domain/services/person-ledger.calculator";
import { transactionsForMonth } from "@/domain/services/recurring.projection";
import { type CompetenceMonth, monthOf } from "@/domain/value-objects/competence-month";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";
import { byDateDesc, createTransactionMapper, type TransactionListItem } from "./get-transactions";

/** A month-view row: a display transaction plus whether it is a (non-persisted) projection. */
export type MonthlyItem = TransactionListItem & {
  readonly projected: boolean;
  /**
   * For a projected ("previsto") row, the real anchor transaction the projection
   * derives from — so clicking it can open/edit/delete the recurring rule. Null
   * on real rows.
   */
  readonly anchor: TransactionListItem | null;
  /**
   * True for a synthetic "Acerto" row (a settlement — a person paying you back, or you
   * paying them). These are reimbursements of others' shares, so the personal lens drops
   * them (mirrors balance.calculator's personal lens, which ignores settlements).
   */
  readonly settlement?: boolean;
};

export interface MonthlyTotals {
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly netCents: number;
}

/** A paid deferred obligation's cash movement, in the month it was PAID (may differ from its due
 * month). Used by the Carteiras per-account in/out flow, which buckets by cash-movement month —
 * a paid boleto's accountId is null (its bank is in paidAccountId), so it needs its own channel. */
export interface PaidObligationFlow {
  readonly accountId: string;
  readonly outCents: number;
}

/** A received income's cash movement, in the month it was RECEIVED (may differ from its booked
 * month). Mirrors {@link PaidObligationFlow} on the income side: a received income's row lives in its
 * booked competence month, but the cash lands in the receiving account on the receipt month — so the
 * Carteiras per-account in-flow needs its own channel keyed by receivedAccountId. */
export interface ReceivedIncomeFlow {
  readonly accountId: string;
  readonly inCents: number;
}

/** Serializable monthly statement: realized totals, projected totals and the rows. */
export interface MonthlyData {
  readonly month: CompetenceMonth;
  /** Totals over real (booked) transactions only. */
  readonly realized: MonthlyTotals;
  /** Totals including projected recurring occurrences ("previsto"). */
  readonly projectedTotals: MonthlyTotals;
  readonly items: MonthlyItem[];
  /** Paid obligations whose payment landed in this month (for the Carteiras per-account flow). */
  readonly paidObligationFlows: PaidObligationFlow[];
  /** Incomes whose receipt landed in this month (for the Carteiras per-account in-flow). */
  readonly receivedIncomeFlows: ReceivedIncomeFlow[];
}

function sumTotals(items: readonly MonthlyItem[]): MonthlyTotals {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const item of items) {
    // A card credit (estorno, income with a cardId) only reduces a card bill — it
    // is shown on the Cards screen, not counted as monthly income. A received income counts at what
    // actually landed (a person paying you back a different value); a pending receivable at its face.
    if (item.kind === "income" && item.cardId === null)
      incomeCents +=
        item.isReceived && item.receivedAmountCents != null ? item.receivedAmountCents : item.amountCents;
    // A paid obligation counts at what actually left the account (settled amount) — a loan paid
    // with a discount lowers the month's "gasto", matching settledExpenseCents/computeViewTotals.
    else if (item.kind === "expense")
      expenseCents +=
        item.isPaid && item.paidAmountCents != null ? item.paidAmountCents : Math.abs(item.amountCents);
  }
  return { incomeCents, expenseCents, netCents: incomeCents - expenseCents };
}

/** Build a month's statement: real transactions + projected fixed occurrences, with totals. */
export async function getMonthly(
  repo: FinanceRepository,
  userId: string,
  month: CompetenceMonth,
): Promise<MonthlyData> {
  const ws = await loadWorkspaceCached(repo, userId);
  const map = createTransactionMapper(ws);
  // Card charges count in their bill's due month; everything else by its date's month.
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const { real, projected } = transactionsForMonth(ws.transactions, month, competenceOf);

  // A rolled (abated) debt is kept only for history — it must not count in the statement's
  // totals, groups or rows (it's already excluded from every other section).
  const realItems: MonthlyItem[] = real
    .filter((tx) => !isRolled(tx))
    .map((tx) => ({ ...map(tx), projected: false, anchor: null }));

  // Settlements ("Acerto" — a person paying you back, or you paying them) are real cash
  // movements but NOT transactions, so they'd otherwise be invisible in the statement. Add
  // each account-backed settlement dated this month as a synthetic row: an ENTRADA when the
  // person owed you, a SAÍDA when you owed them. Direction + amount mirror the account
  // credit/debit in computeAccountBalances (gross, transaction-derived person balance), so
  // the statement matches the account. A "sem conta" (perdão) settlement moves no cash → skip.
  const accountLabel = new Map(ws.accounts.map((a) => [a.id, `${a.bank} · ${a.name}`]));
  const personFirstName = new Map(ws.people.map((p) => [p.id, p.name.split(" ")[0] ?? p.name] as const));
  const grossPersonBalances = computePersonBalances([], ws.transactions, []);
  const settlementItems: MonthlyItem[] = ws.settlements
    .filter((s) => s.accountId !== null && monthOf(s.date) === month)
    .map((s): MonthlyItem => {
      const owedToYou = !(grossPersonBalances.get(s.personId) ?? Money.zero()).isNegative();
      const first = personFirstName.get(s.personId) ?? "Pessoa";
      const label = (s.accountId && accountLabel.get(s.accountId)) || "Acerto";
      return {
        id: `settle:${s.id}`,
        kind: owedToYou ? "income" : "expense",
        description: `Acerto — ${first}`,
        date: s.date,
        amountCents: owedToYou ? s.amountCents : -s.amountCents,
        note: s.note ?? null,
        category: null,
        categoryId: null,
        sourceLabel: label,
        source: owedToYou ? null : "account",
        cardId: null,
        accountId: s.accountId,
        linkedAccountId: null,
        parcela: null,
        installmentGroupId: null,
        billMonthOverride: null,
        isFixed: false,
        rolled: false,
        isPayable: false,
        isPaid: false,
        paidAt: null,
        paidAccountId: null,
        paidAccountLabel: null,
        paidAmountCents: null,
        isReceivable: false,
        isReceived: false,
        receivedAt: null,
        receivedAccountId: null,
        receivedAccountLabel: null,
        receivedAmountCents: null,
        shares: [],
        myShareCents: owedToYou ? null : s.amountCents,
        isReimbursement: false,
        fromPersonId: owedToYou ? s.personId : null,
        fromPersonName: owedToYou ? first : null,
        transferFromName: null,
        transferToName: null,
        transferFromAccountId: null,
        transferToAccountId: null,
        transferValueCents: null,
        projected: false,
        anchor: null,
        settlement: true,
      };
    });
  realItems.push(...settlementItems);
  const projectedItems: MonthlyItem[] = projected
    .filter((p) => !isRolled(p.source))
    .map((p) => {
      const anchor = map(p.source);
      return {
        ...anchor,
        id: `proj:${p.source.id}:${month}`,
        date: p.date,
        parcela: null,
        shares: [],
        // A projection is a not-yet-realized forecast: never inherit the anchor's received state, or
        // its total would count at the anchor's custom received amount instead of the rule's face.
        isReceived: false,
        receivedAt: null,
        receivedAccountId: null,
        receivedAccountLabel: null,
        receivedAmountCents: null,
        projected: true,
        // The real, persisted source row — opening this lets the user edit/delete the rule.
        anchor,
      };
    });

  const items = [...realItems, ...projectedItems].sort(byDateDesc);

  // Paid deferred obligations (boleto/loan/financing) move cash on their paid date — which may
  // fall in a different month than their due (competence) month, so they're NOT in `items` for the
  // paid month. Their accountId is null (the bank is in paidAccountId), so the Carteiras flow can't
  // derive them from the rows. Surface them here, bucketed by the month the payment landed.
  const paidObligationFlows: PaidObligationFlow[] = ws.transactions.flatMap((tx) => {
    if (!isExpense(tx) || !isPayableObligation(tx) || !isPaid(tx) || isRolled(tx)) return [];
    if (tx.paidAccountId == null || tx.paidAt == null || monthOf(tx.paidAt) !== month) return [];
    return [{ accountId: tx.paidAccountId, outCents: tx.paidAmountCents ?? Math.abs(tx.amountCents) }];
  });
  // A card fatura payment is cash out of its account in the month it was PAID. The individual card
  // charges already show in the statement in their competence month, so the payment is NOT a
  // statement row (that would double-count the spend) — it only feeds the Carteiras per-account flow.
  for (const p of ws.cardBillPayments) {
    if (monthOf(p.date) === month) {
      paidObligationFlows.push({ accountId: p.accountId, outCents: p.amountCents });
    }
  }

  // A received income credits its receiving account on the RECEIPT month — which may differ from the
  // booked (competence) month its row is filed under. Surface it here, bucketed by the receipt month,
  // so the Carteiras per-account in-flow reconciles with the account balance (mirrors paidObligationFlows).
  const receivedIncomeFlows: ReceivedIncomeFlow[] = ws.transactions.flatMap((tx) => {
    if (!isReceivableIncome(tx) || !isReceived(tx)) return [];
    const accountId = tx.receivedAccountId ?? tx.accountId;
    if (accountId == null || monthOf(incomeEffectiveDate(tx)) !== month) return [];
    return [{ accountId, inCents: settledIncomeCents(tx) }];
  });

  return {
    month,
    realized: sumTotals(realItems),
    projectedTotals: sumTotals(items),
    items,
    paidObligationFlows,
    receivedIncomeFlows,
  };
}
