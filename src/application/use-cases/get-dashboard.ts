import { Money } from "@/domain/money/money";
import { computeAccountBalances } from "@/domain/services/balance.calculator";
import { cardUtilization, computeCardBills } from "@/domain/services/card-bill.calculator";
import { computePersonBalances } from "@/domain/services/person-ledger.calculator";
import { computeViewTotals } from "@/domain/services/personal-vs-general";
import type { CompetenceMonth } from "@/domain/value-objects/competence-month";
import type { FinanceRepository } from "../ports/finance-repository";

export interface AccountSummary {
  readonly id: string;
  readonly bank: string;
  readonly name: string;
  readonly themeKey: string;
  readonly balanceCents: number;
}

export interface CardSummary {
  readonly id: string;
  readonly bank: string;
  readonly product: string;
  readonly themeKey: string;
  readonly limitCents: number;
  readonly billCents: number;
  /** bill / limit in [0, ∞); 0 when the limit is non-positive. */
  readonly utilization: number;
}

export interface PersonSummary {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly balanceCents: number;
}

export interface ViewTotalsDto {
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly netCents: number;
}

/** Serializable dashboard snapshot (plain cents — safe to pass to client components). */
export interface DashboardData {
  readonly month: CompetenceMonth;
  readonly totalBalanceCents: number;
  readonly accounts: AccountSummary[];
  readonly cards: CardSummary[];
  readonly people: PersonSummary[];
  readonly general: ViewTotalsDto;
  readonly personal: ViewTotalsDto;
}

/** Load the user's workspace and derive the dashboard via the domain calculators. */
export async function getDashboard(
  repo: FinanceRepository,
  userId: string,
  month: CompetenceMonth,
): Promise<DashboardData> {
  const ws = await repo.loadWorkspace(userId);

  const balances = computeAccountBalances(ws.accounts, ws.transactions);
  const bills = computeCardBills(ws.creditCards, ws.transactions);
  const ledger = computePersonBalances(ws.people, ws.transactions, ws.settlements);
  const general = computeViewTotals(ws.transactions, "general", month);
  const personal = computeViewTotals(ws.transactions, "personal", month);

  const accounts = ws.accounts.map((account) => ({
    id: account.id,
    bank: account.bank,
    name: account.name,
    themeKey: account.themeKey,
    balanceCents: (balances.get(account.id) ?? Money.zero()).cents,
  }));

  const cards = ws.creditCards.map((card) => {
    const bill = bills.get(card.id) ?? Money.zero();
    return {
      id: card.id,
      bank: card.bank,
      product: card.product,
      themeKey: card.themeKey,
      limitCents: card.limitCents,
      billCents: bill.cents,
      utilization: cardUtilization(bill, card),
    };
  });

  const people = ws.people
    .map((person) => ({
      id: person.id,
      name: person.name,
      color: person.color,
      balanceCents: (ledger.get(person.id) ?? Money.zero()).cents,
    }))
    .filter((person) => person.balanceCents !== 0);

  const totalBalanceCents = accounts.reduce((sum, account) => sum + account.balanceCents, 0);

  return {
    month,
    totalBalanceCents,
    accounts,
    cards,
    people,
    general: {
      incomeCents: general.income.cents,
      expenseCents: general.expense.cents,
      netCents: general.net.cents,
    },
    personal: {
      incomeCents: personal.income.cents,
      expenseCents: personal.expense.cents,
      netCents: personal.net.cents,
    },
  };
}
