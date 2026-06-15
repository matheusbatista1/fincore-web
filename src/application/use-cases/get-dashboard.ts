import { Money } from "@/domain/money/money";
import { computeAccountBalances } from "@/domain/services/balance.calculator";
import { billingCompetence, cardUtilization, computeCardBills } from "@/domain/services/card-bill.calculator";
import { computePersonBalancesForMonth } from "@/domain/services/person-ledger.calculator";
import { computeViewTotals } from "@/domain/services/personal-vs-general";
import { cardBillsDueThrough, projectedMonthEndBalances } from "@/domain/services/projected-balance";
import { transactionsForMonth } from "@/domain/services/recurring.projection";
import {
  addMonths,
  type CompetenceMonth,
  compareMonths,
  dateInMonth,
} from "@/domain/value-objects/competence-month";
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
  readonly relationship: string;
  readonly color: string;
  /** The person's NET for the browsed month (> 0 they owe you, < 0 you owe them). */
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
   * Projected total balance at the END of the browsed month (general lens): real
   * movements up to month-end, plus the recurring ('previsto') occurrences, minus
   * the card bills due, PLUS what people owe you this month (− what you owe).
   */
  readonly projectedBalanceCents: number;
  /**
   * Same projection through the personal lens — accounts count only the user's own
   * share of shared expenses and exclude reimbursement income; people are not added
   * (the lens already internalises the split).
   */
  readonly projectedBalancePersonalCents: number;
  readonly accounts: AccountSummary[];
  readonly cards: CardSummary[];
  /** People with a non-zero NET in the browsed month (sorted, they-owe-you first). */
  readonly people: PersonSummary[];
  /** Sum of the month's positive person nets (others owe you this month). */
  readonly aReceberCents: number;
  /** Sum of the month's negative person nets, as a positive figure (you owe this month). */
  readonly aPagarCents: number;
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
  const currentMonth = today.slice(0, 7);

  // Headline balances are "live" (as of today), independent of the browsed month.
  const balances = computeAccountBalances(ws.accounts, ws.transactions, today);
  const bills = computeCardBills(ws.creditCards, ws.transactions);
  // Card charges count in their bill's due month; everything else by its date's month.
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  // Person nets scoped to the browsed month (drives "A receber" + "Pessoas com pendências").
  const ledgerMonth = computePersonBalancesForMonth(
    ws.people,
    ws.transactions,
    ws.settlements,
    month,
    competenceOf,
    currentMonth,
  );
  // The month's set: real movements always, plus the projected ("previsto") recurring
  // occurrences for FUTURE months — so browsing months ahead shows expected income and
  // spending. Past/current stay real-only (history/actuals unchanged).
  const { real, projected } = transactionsForMonth(ws.transactions, month, competenceOf);
  const monthSet =
    compareMonths(month, currentMonth) <= 0 ? real : [...real, ...projected.map((p) => p.source)];
  const general = computeViewTotals(monthSet, "general");
  const personal = computeViewTotals(monthSet, "personal");

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
      relationship: person.relationship,
      color: person.color,
      balanceCents: (ledgerMonth.get(person.id) ?? Money.zero()).cents,
    }))
    .filter((person) => person.balanceCents !== 0)
    .sort((a, b) => b.balanceCents - a.balanceCents);
  const aReceberCents = people.reduce((sum, p) => (p.balanceCents > 0 ? sum + p.balanceCents : sum), 0);
  const aPagarCents = people.reduce((sum, p) => (p.balanceCents < 0 ? sum - p.balanceCents : sum), 0);

  const totalBalanceCents = accounts.reduce((sum, account) => sum + account.balanceCents, 0);

  // Projected balance at the end of the browsed month: real movements up to month-end
  // plus the recurring occurrences (accumulated from the current month onward), MINUS
  // the credit-card bills that fall due along the way (assumed paid from an account).
  const eomBalances = projectedMonthEndBalances(
    ws.accounts,
    ws.transactions,
    month,
    competenceOf,
    currentMonth,
  );
  let projectedBalanceCents = 0;
  for (const value of eomBalances.values()) projectedBalanceCents += value.cents;
  projectedBalanceCents -= cardBillsDueThrough(
    ws.transactions,
    currentMonth,
    month,
    competenceOf,
    "general",
    currentMonth,
  ).cents;
  // General "fim do mês" also reflects this month's receivables/payables with people.
  projectedBalanceCents += aReceberCents - aPagarCents;

  // Personal projection: accounts count only the user's share + drop reimbursements;
  // people are NOT added (the personal lens already internalises shared splits).
  const eomPersonal = projectedMonthEndBalances(
    ws.accounts,
    ws.transactions,
    month,
    competenceOf,
    currentMonth,
    "personal",
  );
  let projectedBalancePersonalCents = 0;
  for (const value of eomPersonal.values()) projectedBalancePersonalCents += value.cents;
  projectedBalancePersonalCents -= cardBillsDueThrough(
    ws.transactions,
    currentMonth,
    month,
    competenceOf,
    "personal",
    currentMonth,
  ).cents;

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
    projectedBalancePersonalCents,
    accounts,
    cards,
    people,
    aReceberCents,
    aPagarCents,
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
