import type { Account } from "@/domain/entities/account";
import type { Category } from "@/domain/entities/category";
import type { CreditCard } from "@/domain/entities/credit-card";
import type { Person } from "@/domain/entities/person";
import { Money } from "@/domain/money/money";
import { computeAccountBalances } from "@/domain/services/balance.calculator";
import { cardUtilization, computeCardBills } from "@/domain/services/card-bill.calculator";
import { computePersonBalances } from "@/domain/services/person-ledger.calculator";
import { todayInBrazil } from "@/shared/formatting/now";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

export type AccountView = Account & { readonly balanceCents: number };
export type CardView = CreditCard & { readonly billCents: number; readonly utilization: number };
export type PersonView = Person & { readonly balanceCents: number };

export interface WorkspaceView {
  readonly accounts: AccountView[];
  readonly cards: CardView[];
  readonly people: PersonView[];
  readonly categories: Category[];
}

/** A user's entities enriched with derived balances/bills/ledger — serializable for RSC. */
export async function getWorkspaceView(repo: FinanceRepository, userId: string): Promise<WorkspaceView> {
  const ws = await loadWorkspaceCached(repo, userId);
  // Live balances exclude future-dated entries (e.g. a salary booked for next month).
  const balances = computeAccountBalances(ws.accounts, ws.transactions, todayInBrazil());
  const bills = computeCardBills(ws.creditCards, ws.transactions);
  const ledger = computePersonBalances(ws.people, ws.transactions, ws.settlements);

  return {
    accounts: ws.accounts.map((account) => ({
      ...account,
      balanceCents: (balances.get(account.id) ?? Money.zero()).cents,
    })),
    cards: ws.creditCards.map((card) => {
      const bill = bills.get(card.id) ?? Money.zero();
      return { ...card, billCents: bill.cents, utilization: cardUtilization(bill, card) };
    }),
    people: ws.people.map((person) => ({
      ...person,
      balanceCents: (ledger.get(person.id) ?? Money.zero()).cents,
    })),
    categories: ws.categories,
  };
}
