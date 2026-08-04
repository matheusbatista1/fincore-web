import type { Account } from "@/domain/entities/account";
import type { CardBillDate } from "@/domain/entities/card-bill-date";
import type { CardBillPayment } from "@/domain/entities/card-bill-payment";
import type { Category } from "@/domain/entities/category";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { Person } from "@/domain/entities/person";
import { Money } from "@/domain/money/money";
import { computeAccountBalances } from "@/domain/services/balance.calculator";
import {
  billingCompetence,
  cardUtilization,
  computeCardBillForMonth,
  computeCardOpenBills,
  computeCardOutstandings,
} from "@/domain/services/card-bill.calculator";
import {
  computePersonBalances,
  computePersonBalancesForMonth,
} from "@/domain/services/person-ledger.calculator";
import { addMonths, type CompetenceMonth } from "@/domain/value-objects/competence-month";
import { todayInBrazil } from "@/shared/formatting/now";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

export type AccountView = Account & { readonly balanceCents: number };
export type CardView = CreditCard & {
  /** The OPEN bill (fatura atual): the cycle accumulating now, due next — not the all-cycles sum. */
  readonly billCents: number;
  /** Bill that comes DUE on the next due date (competence of the upcoming dueDay) — for the
   * "fatura vence" notification, which must show what you'll actually pay, not the open cycle. */
  readonly dueBillCents: number;
  /** Total committed against the limit ("limite utilizado"): open + future − estornos. */
  readonly outstandingCents: number;
  /** outstanding / limit ratio. */
  readonly utilization: number;
};
export type PersonView = Person & {
  /** All-time outstanding balance (cumulative). */
  readonly balanceCents: number;
  /** Net for the current month — matches the dashboard/People "a receber" figure. */
  readonly monthBalanceCents: number;
};

export interface WorkspaceView {
  readonly accounts: AccountView[];
  readonly cards: CardView[];
  readonly people: PersonView[];
  readonly categories: Category[];
  readonly cardBillDates: CardBillDate[];
  /** Paid faturas (one active per card+competence) — lets the Cards view mark a bill paid. */
  readonly cardBillPayments: CardBillPayment[];
}

/** A user's entities enriched with derived balances/bills/ledger — serializable for RSC. */
export async function getWorkspaceView(repo: FinanceRepository, userId: string): Promise<WorkspaceView> {
  const ws = await loadWorkspaceCached(repo, userId);
  // Live balances exclude future-dated entries (e.g. a salary booked for next month).
  const today = todayInBrazil();
  const balances = computeAccountBalances(
    ws.accounts,
    ws.transactions,
    today,
    "general",
    ws.settlements,
    ws.cardBillPayments,
  );
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  // "Fatura atual" = the OPEN bill (the one accumulating now, due next cycle) — not the whole
  // open-cycle sum across past/future charges.
  const bills = computeCardOpenBills(
    ws.creditCards,
    ws.transactions,
    today,
    competenceOf,
    ws.cardBillDates,
    ws.cardBillPayments,
  );
  const currentMonth = today.slice(0, 7) as CompetenceMonth;
  const dayToday = Number(today.slice(8, 10));
  const outstandings = computeCardOutstandings(
    ws.creditCards,
    ws.transactions,
    currentMonth,
    competenceOf,
    ws.cardBillPayments,
  );
  const ledger = computePersonBalances(ws.people, ws.transactions, ws.settlements);
  // Month-scoped person nets (same figure the dashboard/People show) — used by the
  // "te deve" notification and the pending badge.
  const monthLedger = computePersonBalancesForMonth(
    ws.people,
    ws.transactions,
    ws.settlements,
    currentMonth,
    competenceOf,
    currentMonth,
  );

  return {
    accounts: ws.accounts.map((account) => ({
      ...account,
      balanceCents: (balances.get(account.id) ?? Money.zero()).cents,
    })),
    cards: ws.creditCards.map((card) => {
      const bill = bills.get(card.id)?.amount ?? Money.zero();
      const outstanding = outstandings.get(card.id) ?? Money.zero();
      // The bill due on the NEXT due date lives in the competence of that due month
      // (next month if the dueDay already passed this month, else this month).
      const dueMonth = card.dueDay < dayToday ? addMonths(currentMonth, 1) : currentMonth;
      const dueBill = computeCardBillForMonth(card.id, ws.transactions, dueMonth, competenceOf);
      return {
        ...card,
        billCents: bill.cents,
        dueBillCents: dueBill.cents,
        outstandingCents: outstanding.cents,
        utilization: cardUtilization(outstanding, card),
      };
    }),
    people: ws.people.map((person) => ({
      ...person,
      balanceCents: (ledger.get(person.id) ?? Money.zero()).cents,
      monthBalanceCents: (monthLedger.get(person.id) ?? Money.zero()).cents,
    })),
    categories: ws.categories,
    cardBillDates: ws.cardBillDates,
    cardBillPayments: ws.cardBillPayments,
  };
}
