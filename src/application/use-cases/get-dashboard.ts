import { Money } from "@/domain/money/money";
import { computeAccountBalances } from "@/domain/services/balance.calculator";
import { billingCompetence, cardUtilization, computeCardBills } from "@/domain/services/card-bill.calculator";
import { computePersonBalances } from "@/domain/services/person-ledger.calculator";
import { computeViewTotals } from "@/domain/services/personal-vs-general";
import { cardBillsDueThrough, projectedMonthEndBalances } from "@/domain/services/projected-balance";
import { addMonths, type CompetenceMonth, dateInMonth } from "@/domain/value-objects/competence-month";
import { monthLabel } from "@/shared/formatting/dates";
import { todayInBrazil } from "@/shared/formatting/now";
import { loadWorkspaceCached } from "../loaders";
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

/** One point of the net-worth trend sparkline (cumulative balance at month-end). */
export interface TrendPoint {
  readonly label: string;
  readonly valueCents: number;
}

/** Serializable dashboard snapshot (plain cents — safe to pass to client components). */
export interface DashboardData {
  readonly month: CompetenceMonth;
  readonly totalBalanceCents: number;
  /**
   * Projected total balance at the END of the browsed month: real movements up to
   * month-end plus the recurring occurrences ('previsto') not yet booked.
   */
  readonly projectedBalanceCents: number;
  readonly accounts: AccountSummary[];
  readonly cards: CardSummary[];
  readonly people: PersonSummary[];
  readonly general: ViewTotalsDto;
  readonly personal: ViewTotalsDto;
  /** Trailing 6-month cumulative balance for the hero sparkline. */
  readonly trend: TrendPoint[];
}

/** Load the user's workspace and derive the dashboard via the domain calculators. */
export async function getDashboard(
  repo: FinanceRepository,
  userId: string,
  month: CompetenceMonth,
): Promise<DashboardData> {
  const ws = await loadWorkspaceCached(repo, userId);
  const today = todayInBrazil();

  // Headline balances are "live" (as of today), independent of the browsed month.
  const balances = computeAccountBalances(ws.accounts, ws.transactions, today);
  const bills = computeCardBills(ws.creditCards, ws.transactions);
  const ledger = computePersonBalances(ws.people, ws.transactions, ws.settlements);
  // Card charges count in their bill's due month; everything else by its date's month.
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const general = computeViewTotals(ws.transactions, "general", month, competenceOf);
  const personal = computeViewTotals(ws.transactions, "personal", month, competenceOf);

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

  // Projected balance at the end of the browsed month: real movements up to month-end
  // plus the recurring occurrences (accumulated from the current month onward), MINUS
  // the credit-card bills that fall due along the way (assumed paid from an account).
  const currentMonth = today.slice(0, 7);
  const eomBalances = projectedMonthEndBalances(
    ws.accounts,
    ws.transactions,
    month,
    competenceOf,
    currentMonth,
  );
  let projectedBalanceCents = 0;
  for (const value of eomBalances.values()) projectedBalanceCents += value.cents;
  projectedBalanceCents -= cardBillsDueThrough(ws.transactions, currentMonth, month, competenceOf).cents;

  // Trailing 6-month cumulative balance: re-run the balance calculator with the
  // cutoff at each month-end (small in-memory volumes).
  const trend: TrendPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    const m = addMonths(month, -i);
    const monthBalances = computeAccountBalances(ws.accounts, ws.transactions, dateInMonth(m, 31));
    let total = 0;
    for (const value of monthBalances.values()) total += value.cents;
    trend.push({ label: monthLabel(m), valueCents: total });
  }

  return {
    month,
    totalBalanceCents,
    projectedBalanceCents,
    accounts,
    cards,
    people,
    trend,
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
