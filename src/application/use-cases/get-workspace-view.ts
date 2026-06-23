import type { Account } from "@/domain/entities/account";
import type { CardBillDate } from "@/domain/entities/card-bill-date";
import type { Category } from "@/domain/entities/category";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { Person } from "@/domain/entities/person";
import { Money } from "@/domain/money/money";
import { computeAccountBalances } from "@/domain/services/balance.calculator";
import {
  billingCompetence,
  cardUtilization,
  computeCardBills,
  computeCardOutstandings,
} from "@/domain/services/card-bill.calculator";
import { computePersonBalances } from "@/domain/services/person-ledger.calculator";
import { todayInBrazil } from "@/shared/formatting/now";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

export type AccountView = Account & { readonly balanceCents: number };
export type CardView = CreditCard & {
  /** Current open-cycle bill (fatura atual). */
  readonly billCents: number;
  /** Total committed against the limit ("limite utilizado"): open + future − estornos. */
  readonly outstandingCents: number;
  /** outstanding / limit ratio. */
  readonly utilization: number;
};
export type PersonView = Person & { readonly balanceCents: number };

export interface WorkspaceView {
  readonly accounts: AccountView[];
  readonly cards: CardView[];
  readonly people: PersonView[];
  readonly categories: Category[];
  readonly cardBillDates: CardBillDate[];
}

/** A user's entities enriched with derived balances/bills/ledger — serializable for RSC. */
export async function getWorkspaceView(repo: FinanceRepository, userId: string): Promise<WorkspaceView> {
  const ws = await loadWorkspaceCached(repo, userId);
  // Live balances exclude future-dated entries (e.g. a salary booked for next month).
  const today = todayInBrazil();
  const balances = computeAccountBalances(ws.accounts, ws.transactions, today, "general", ws.settlements);
  const bills = computeCardBills(ws.creditCards, ws.transactions);
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const outstandings = computeCardOutstandings(
    ws.creditCards,
    ws.transactions,
    today.slice(0, 7),
    competenceOf,
  );
  const ledger = computePersonBalances(ws.people, ws.transactions, ws.settlements);

  return {
    accounts: ws.accounts.map((account) => ({
      ...account,
      balanceCents: (balances.get(account.id) ?? Money.zero()).cents,
    })),
    cards: ws.creditCards.map((card) => {
      const bill = bills.get(card.id) ?? Money.zero();
      const outstanding = outstandings.get(card.id) ?? Money.zero();
      return {
        ...card,
        billCents: bill.cents,
        outstandingCents: outstanding.cents,
        utilization: cardUtilization(outstanding, card),
      };
    }),
    people: ws.people.map((person) => ({
      ...person,
      balanceCents: (ledger.get(person.id) ?? Money.zero()).cents,
    })),
    categories: ws.categories,
    cardBillDates: ws.cardBillDates,
  };
}
