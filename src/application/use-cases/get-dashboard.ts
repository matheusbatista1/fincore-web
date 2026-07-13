import { isPaid, isPayableObligation, isRolled } from "@/domain/entities/transaction";
import { Money } from "@/domain/money/money";
import { computeAccountBalances } from "@/domain/services/balance.calculator";
import {
  billingCompetence,
  cardUtilization,
  computeCardBillsForMonth,
  computeCardOpenBills,
  computeCardOutstandings,
} from "@/domain/services/card-bill.calculator";
import { computePersonBalances, computePersonMonthNets } from "@/domain/services/person-ledger.calculator";
import { computeViewTotals } from "@/domain/services/personal-vs-general";
import { obligationsDueThrough, projectedMonthEndBalances } from "@/domain/services/projected-balance";
import { transactionsForMonth } from "@/domain/services/recurring.projection";
import {
  addMonths,
  type CompetenceMonth,
  compareMonths,
  dateInMonth,
  monthOf,
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
  /** Fatura shown for the view: the open bill on the current month, else the browsed month's. */
  readonly billCents: number;
  /** Total committed against the limit: open + future bills − estornos ("limite utilizado"). */
  readonly outstandingCents: number;
  readonly dueDay: number;
  /** outstanding / limit in [0, ∞); 0 when the limit is non-positive. */
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
  /** Live total balance through the personal lens (only the user's own share of shared debits). */
  readonly totalBalancePersonalCents: number;
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
  /**
   * Net cash from account-backed settlements dated in the browsed month (a person paying you back
   * is +, you paying them is −). The GENERAL "economia" counts other people's shares as expense, so
   * it must also count the cash that settled them; the personal lens drops it (a reimbursement, not
   * your money). Mirrors how the monthly view reflects settlements as entradas/saídas.
   */
  readonly settlementNetCents: number;
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
  // Card charges count in their bill's due month; everything else by its date's month.
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  // Settlements that name an account move real cash (a person paying you, or you paying
  // them); overdraft (cheque especial) debits its account — both reflected here.
  const balances = computeAccountBalances(
    ws.accounts,
    ws.transactions,
    today,
    "general",
    ws.settlements,
    ws.cardBillPayments,
    competenceOf,
  );
  // The personal lens NEEDS competenceOf: without it a paid card fatura debits its FULL amount
  // (fallback), charging the user with other people's shares of the bill — instead of only the
  // user's own slice via faturaPersonalDebit.
  const balancesPersonal = computeAccountBalances(
    ws.accounts,
    ws.transactions,
    today,
    "personal",
    ws.settlements,
    ws.cardBillPayments,
    competenceOf,
  );
  // "Fatura" follows the view: on the current month show each card's open bill (the next
  // one to pay); when browsing another month show that month's own fatura. The "limite
  // utilizado" is the all-open total (today onward), independent of the browsed month.
  const isCurrentView = compareMonths(month, currentMonth) === 0;
  const bills = isCurrentView
    ? computeCardOpenBills(ws.creditCards, ws.transactions, today, competenceOf, ws.cardBillDates)
    : computeCardBillsForMonth(ws.creditCards, ws.transactions, month, competenceOf);
  const outstandings = computeCardOutstandings(
    ws.creditCards,
    ws.transactions,
    currentMonth,
    competenceOf,
    ws.cardBillPayments,
  );
  // Per-person, per-month nets through the browsed month, in ONE pass — a pre-payment
  // (settlement before the debt's competence) re-buckets onto the debt's month, so the
  // month slices stay consistent when summed (a per-month re-call would lock each month at
  // its own horizon and miss a later settlement that retroactively clears an earlier debt).
  const monthNets = computePersonMonthNets(ws.people, ws.transactions, ws.settlements, month, competenceOf);
  const personNetFor = (personId: string, m: CompetenceMonth): number => monthNets.get(personId)?.get(m) ?? 0;
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
    const outstanding = outstandings.get(card.id) ?? Money.zero();
    return {
      id: card.id,
      bank: card.bank,
      product: card.product,
      themeKey: card.themeKey,
      limitCents: card.limitCents,
      billCents: bill.cents,
      outstandingCents: outstanding.cents,
      dueDay: card.dueDay,
      // Utilization is the committed total (open + future), not just this month's bill.
      utilization: cardUtilization(outstanding, card),
    };
  });

  const people = ws.people
    .map((person) => ({
      id: person.id,
      name: person.name,
      relationship: person.relationship,
      color: person.color,
      balanceCents: personNetFor(person.id, month),
    }))
    .filter((person) => person.balanceCents !== 0)
    .sort((a, b) => b.balanceCents - a.balanceCents);
  const aReceberCents = people.reduce((sum, p) => (p.balanceCents > 0 ? sum + p.balanceCents : sum), 0);
  const aPagarCents = people.reduce((sum, p) => (p.balanceCents < 0 ? sum - p.balanceCents : sum), 0);

  // Account-backed settlements dated in the browsed month move real cash. Their direction follows
  // the person's transaction-derived (gross) balance sign — a person who owed you paying back is an
  // entrada (+), you paying someone you owed is a saída (−). Summed here so the general "economia"
  // can credit the cash that reimbursed other people's shares (which it already counts as expense).
  const grossPersonBalances = computePersonBalances([], ws.transactions, []);
  let settlementNetCents = 0;
  for (const s of ws.settlements) {
    if (s.accountId === null || monthOf(s.date) !== month) continue;
    const owedToYou = !(grossPersonBalances.get(s.personId) ?? Money.zero()).isNegative();
    settlementNetCents += owedToYou ? s.amountCents : -s.amountCents;
  }

  const totalBalanceCents = accounts.reduce((sum, account) => sum + account.balanceCents, 0);
  // Personal-lens total: only the user's own share of shared account/overdraft expenses.
  let totalBalancePersonalCents = 0;
  for (const value of balancesPersonal.values()) totalBalancePersonalCents += value.cents;

  // Overdue payable obligations (boleto/empréstimo/financiamento) still UNPAID with competence BEFORE
  // the current month never debited a balance and fall outside the [currentMonth…] projection window,
  // silently inflating "fim do mês". Subtract them explicitly. Card faturas are NOT included: a fatura
  // before the current month is PRESUMED PAID (the same assumption computeCardOutstanding relies on —
  // paid faturas often have no CardBillPayment record), and only boleto/loan/financing carry an
  // explicit unpaid state (isPaid). Applied only when browsing the current month or later.
  let overdueGeneralCents = 0;
  let overduePersonalCents = 0;
  if (compareMonths(month, currentMonth) >= 0) {
    for (const tx of ws.transactions) {
      if (!isPayableObligation(tx) || isPaid(tx) || isRolled(tx)) continue;
      if (compareMonths(competenceOf(tx), currentMonth) >= 0) continue;
      overdueGeneralCents += Math.abs(tx.amountCents);
      overduePersonalCents += tx.myShareCents;
    }
  }

  // Projected balance at the end of the browsed month: real movements up to month-end
  // plus the recurring occurrences (accumulated from the current month onward), MINUS
  // the credit-card bills that fall due along the way (assumed paid from an account).
  const eomBalances = projectedMonthEndBalances(
    ws.accounts,
    ws.transactions,
    month,
    competenceOf,
    currentMonth,
    "general",
    ws.settlements,
    ws.cardBillPayments,
  );
  let projectedBalanceCents = 0;
  for (const value of eomBalances.values()) projectedBalanceCents += value.cents;
  projectedBalanceCents -= obligationsDueThrough(
    ws.transactions,
    currentMonth,
    month,
    competenceOf,
    "general",
    currentMonth,
    ws.cardBillPayments,
  ).cents;
  projectedBalanceCents -= overdueGeneralCents; // overdue boleto/loan/financing before this month
  // General "fim do mês" also reflects the receivables/payables with people. Obligations above are
  // summed cumulatively (currentMonth → browsed month), so the people net must be cumulative over the
  // same window too — otherwise a past month's obligation gets subtracted without crediting that
  // month's receivable.
  for (let m = currentMonth; compareMonths(m, month) <= 0; m = addMonths(m, 1)) {
    for (const person of ws.people) projectedBalanceCents += personNetFor(person.id, m);
  }

  // Personal projection: accounts count only the user's share + drop reimbursements;
  // people are NOT added (the personal lens already internalises shared splits).
  const eomPersonal = projectedMonthEndBalances(
    ws.accounts,
    ws.transactions,
    month,
    competenceOf,
    currentMonth,
    "personal",
    ws.settlements,
    ws.cardBillPayments,
  );
  let projectedBalancePersonalCents = 0;
  for (const value of eomPersonal.values()) projectedBalancePersonalCents += value.cents;
  projectedBalancePersonalCents -= obligationsDueThrough(
    ws.transactions,
    currentMonth,
    month,
    competenceOf,
    "personal",
    currentMonth,
    ws.cardBillPayments,
  ).cents;
  projectedBalancePersonalCents -= overduePersonalCents; // overdue obligations' own-share before this month

  // Trailing 6-month cumulative balance: re-run the balance calculator with the
  // cutoff at each month-end (small in-memory volumes).
  const trend: TrendPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    const m = addMonths(month, -i);
    const monthBalances = computeAccountBalances(
      ws.accounts,
      ws.transactions,
      dateInMonth(m, 31),
      "general",
      ws.settlements,
      ws.cardBillPayments,
    );
    let total = 0;
    for (const value of monthBalances.values()) total += value.cents;
    trend.push({ label: monthLabel(m), valueCents: total });
  }

  return {
    month,
    totalBalanceCents,
    totalBalancePersonalCents,
    projectedBalanceCents,
    projectedBalancePersonalCents,
    accounts,
    cards,
    people,
    aReceberCents,
    aPagarCents,
    settlementNetCents,
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
