import { spendingAccounts } from "@/domain/entities/account";
import { Money } from "@/domain/money/money";
import { computeAccountBalances } from "@/domain/services/balance.calculator";
import {
  computeBalanceTimeline,
  dailyTotalBalances,
  totalBalanceAt,
} from "@/domain/services/balance-timeline";
import {
  billingCompetence,
  cardUtilization,
  computeCardBillForecast,
  computeCardBillsForMonth,
  computeCardOpenBills,
  computeCardOutstandings,
} from "@/domain/services/card-bill.calculator";
import { type ForecastEvent, forecastCash } from "@/domain/services/cash-forecast";
import { projectMonthEnd } from "@/domain/services/month-end-projection";
import { computePersonMonthNetsAndSettledCash } from "@/domain/services/person-ledger.calculator";
import { computeViewTotals } from "@/domain/services/personal-vs-general";
import { freshOccurrence, transactionsForMonth } from "@/domain/services/recurring.projection";
import {
  addMonths,
  type CompetenceMonth,
  compareMonths,
  dateInMonth,
  type IsoDate,
  monthOf,
} from "@/domain/value-objects/competence-month";
import { todayInBrazil } from "@/shared/formatting/now";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";

export interface AccountSummary {
  readonly id: string;
  readonly bank: string;
  readonly name: string;
  readonly themeKey: string;
  readonly balanceCents: number;
  /** Set aside (reserva / investimento): in the net worth, not in the available balance. */
  readonly isReserve: boolean;
}

export interface CardSummary {
  readonly id: string;
  readonly bank: string;
  readonly product: string;
  readonly themeKey: string;
  readonly limitCents: number;
  /** Fatura shown for the view: on the current month the bill you owe NEXT (the one that just
   * closed while unpaid, else the cycle still accumulating); on another month, that month's own. */
  readonly billCents: number;
  /** The competence `billCents` refers to, so the UI can say which fatura it is showing. */
  readonly billCompetence: CompetenceMonth;
  /**
   * The projected ("previsto") portion still expected to charge into that same fatura — recurring
   * occurrences whose day hasn't come. Screens show `billCents + billProjectedCents` as the bill's
   * expected total, calling this slice out; it NEVER enters a payable amount.
   */
  readonly billProjectedCents: number;
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

/**
 * The total across accounts at the end of each day — the hero's net-worth timeline. Real cash
 * (general lens) in EVERY account, the reserve ones included: its last entry is the available
 * balance plus what is set aside.
 */
export interface NetWorthDaily {
  /** The day `valuesCents[0]` is the total of; each next entry is the following calendar day. */
  readonly startDate: IsoDate;
  /** One end-of-day total per day, through today. */
  readonly valuesCents: number[];
}

/**
 * The total across accounts expected at the end of each day after today — the dashed continuation
 * of the net-worth timeline. General lens (real cash); it passes through the hero's "fim do mês",
 * plus where the reserve accounts land (the timeline is the net worth, the hero what is available).
 */
export interface NetWorthForecast {
  /** Tomorrow: the day `valuesCents[0]` is the expected total of. */
  readonly startDate: IsoDate;
  /** One expected end-of-day total per day, through the last day of next month. */
  readonly valuesCents: number[];
  /** What is expected to move the total, oldest first — for the reader of a forecast day. */
  readonly events: readonly ForecastEvent[];
}

/**
 * How far the daily forecast looks: the current month and the next. Beyond that only the fixed
 * entries are known, so a daily line would promise a precision the data does not have — and each
 * month costs one replay of the person ledger.
 */
const NET_WORTH_FORECAST_MONTHS = 2;

/** The timeline never starts later than this many months back (the current month included)… */
const NET_WORTH_MIN_MONTHS = 6;
/** …nor earlier than this many: one stray old date must not stretch the chart for ever. */
const NET_WORTH_MAX_MONTHS = 60;

/** Serializable dashboard snapshot (plain cents — safe to pass to client components). */
export interface DashboardData {
  readonly month: CompetenceMonth;
  /**
   * The live balance available to spend: every account EXCEPT the ones set aside as a reserve. With
   * no reserve account it is simply the total across accounts. The figures derived from it below
   * (personal lens, "fim do mês", month-over-month change, held for others) follow the same rule.
   */
  readonly totalBalanceCents: number;
  /** Live total balance through the personal lens (only the user's own share of shared debits). */
  readonly totalBalancePersonalCents: number;
  /** What is set aside: the live balance of the reserve / investment accounts. */
  readonly investedCents: number;
  /**
   * Projected total balance at the END of the browsed month (general lens): real
   * movements up to month-end, plus the recurring ('previsto') occurrences, minus
   * the card bills due, PLUS what people still owe you through month-end (− what
   * you owe them) — every pending month, not just the browsed one.
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
   * Account-backed settlement cash attributed to the browsed month by the COMPETENCE of the debts
   * it covered (a person paying you back is +, you paying them is −) — not by the settlement's own
   * date, so a pre-payment credits the month its fatura counts as expense, not the month the money
   * arrived. The GENERAL "economia" counts other people's shares as expense, so it must also count
   * the cash that settled them; the personal lens drops it (a reimbursement, not your money).
   */
  readonly settlementNetCents: number;
  /**
   * Cash sitting in the accounts that belongs to OTHER people: advances received (acertos and
   * reimbursement income) minus their shares the user already fronted via paid faturas/expenses.
   * Derived as max(0, general − personal live totals) — the lens difference IS that float.
   */
  readonly heldForOthersCents: number;
  readonly general: ViewTotalsDto;
  readonly personal: ViewTotalsDto;
  /**
   * The browsed CURRENT month's projected ("previsto") occurrences still to come, as view totals —
   * zero for past months (nothing left) and future months (already inside `general`/`personal`).
   * Feeds the chips' reconciliation line against the Visão mensal, which counts forecasts.
   */
  readonly projectedIncomeCents: number;
  readonly projectedExpenseCents: number;
  /** The same still-to-come slice through the personal lens (only the user's own shares). */
  readonly projectedIncomePersonalCents: number;
  readonly projectedExpensePersonalCents: number;
  /** The total balance day by day, from the month of the first movement through today. */
  readonly netWorthDaily: NetWorthDaily;
  /** Its expected continuation, from tomorrow to the end of next month. */
  readonly netWorthForecast: NetWorthForecast;
  /**
   * The available balance at the end of the browsed month and of the month before it, each with
   * every movement dated up to that day (so the current month counts what is already booked for
   * later in it) — the two figures the hero's month-over-month change compares. Money moved into a
   * reserve account leaves it, like it leaves the figure this change sits under.
   */
  readonly monthEndTotals: { readonly previousCents: number; readonly currentCents: number };
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

  // What is available to spend leaves the reserve accounts out; the net worth counts every account.
  const spending = spendingAccounts(ws.accounts);
  const hasReserve = spending.length < ws.accounts.length;

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
  const bills: Map<string, { amount: Money; competence: CompetenceMonth }> = isCurrentView
    ? computeCardOpenBills(
        ws.creditCards,
        ws.transactions,
        today,
        competenceOf,
        ws.cardBillDates,
        ws.cardBillPayments,
      )
    : new Map(
        [...computeCardBillsForMonth(ws.creditCards, ws.transactions, month, competenceOf)].map(
          ([id, amount]) => [id, { amount, competence: month }],
        ),
      );
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
  // The same walk also yields the settlement CASH per covered-debt month (see below).
  const { nets: monthNets, settledCashByMonth } = computePersonMonthNetsAndSettledCash(
    ws.people,
    ws.transactions,
    ws.settlements,
    month,
    competenceOf,
  );
  const personNetFor = (personId: string, m: CompetenceMonth): number => monthNets.get(personId)?.get(m) ?? 0;
  // The month's set: real movements always, plus the projected ("previsto") recurring
  // occurrences for FUTURE months — so browsing months ahead shows expected income and
  // spending. Past/current stay real-only (history/actuals unchanged).
  const { real, projected } = transactionsForMonth(ws.transactions, month, competenceOf);
  // Each projection counts as a fresh instance at its occurrence date: taking the anchor row
  // instead would total it at the anchor's settled amount and on the anchor's own date.
  const monthSet =
    compareMonths(month, currentMonth) <= 0
      ? real
      : [...real, ...projected.map((p) => freshOccurrence(p.source, p.date))];
  const general = computeViewTotals(monthSet, "general");
  const personal = computeViewTotals(monthSet, "personal");
  // The month's still-to-come slice, for the chips' reconciliation line: what the Visão mensal
  // (which counts forecasts) shows on top of the realized figures. Zero when browsing the future
  // (the projections are already inside monthSet there) or the past (nothing left to come).
  const stillToCome =
    compareMonths(month, currentMonth) === 0 ? projected.map((p) => freshOccurrence(p.source, p.date)) : [];
  const projectedTotals = computeViewTotals(stillToCome, "general");
  // The same slice through the personal lens (only the user's own share of shared forecasts) —
  // the "Sobra real · com previstos" chip must not mix other people's shares into a personal figure.
  const projectedTotalsPersonal = computeViewTotals(stillToCome, "personal");

  const accounts = ws.accounts.map((account) => ({
    id: account.id,
    bank: account.bank,
    name: account.name,
    themeKey: account.themeKey,
    balanceCents: (balances.get(account.id) ?? Money.zero()).cents,
    isReserve: account.isReserve,
  }));

  const cards = ws.creditCards.map((card) => {
    const bill = bills.get(card.id);
    const outstanding = outstandings.get(card.id) ?? Money.zero();
    return {
      id: card.id,
      bank: card.bank,
      product: card.product,
      themeKey: card.themeKey,
      limitCents: card.limitCents,
      billCents: (bill?.amount ?? Money.zero()).cents,
      /** Which fatura `billCents` is — the one closed and due now, or the cycle still open. */
      billCompetence: bill?.competence ?? month,
      billProjectedCents: computeCardBillForecast(
        card.id,
        ws.transactions,
        bill?.competence ?? month,
        competenceOf,
      ).cents,
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

  // Account-backed settlement cash, attributed to the browsed month by the COMPETENCE of the
  // debts it covered (not the settlement's own date) — the general "economia" then credits a
  // reimbursement in the same month the covered expense counts. A person pre-paying next month's
  // fatura no longer books phantom surplus in the month the money arrived, and the fatura month
  // gets its matching credit. + = they paid you (entrada), − = you paid them (saída).
  const settlementNetCents = settledCashByMonth.get(month) ?? 0;

  let totalBalanceCents = 0;
  let investedCents = 0;
  for (const account of accounts) {
    if (account.isReserve) investedCents += account.balanceCents;
    else totalBalanceCents += account.balanceCents;
  }
  // Personal-lens total: only the user's own share of shared account/overdraft expenses.
  let totalBalancePersonalCents = 0;
  for (const account of spending) {
    totalBalancePersonalCents += (balancesPersonal.get(account.id) ?? Money.zero()).cents;
  }
  // Cash in the accounts that belongs to other people: advances received (acertos/reembolsos)
  // minus their shares the user already fronted — exactly the general−personal lens difference.
  const heldForOthersCents = Math.max(0, totalBalanceCents - totalBalancePersonalCents);

  // The "fim do mês" of the browsed month through both lenses — one formula, shared with the gap
  // explainer and the daily forecast (see month-end-projection): where the accounts land, minus
  // what falls due along the way and what is already overdue, plus (general lens) what people owe.
  // Only the accounts available to spend: a transfer into a reserve account leaves this figure.
  const projection = {
    accounts: spending,
    people: ws.people,
    transactions: ws.transactions,
    settlements: ws.settlements,
    cardBillPayments: ws.cardBillPayments,
    month,
    currentMonth,
    competenceOf,
    personNets: monthNets,
  };
  const projectedBalanceCents = projectMonthEnd(projection, "general").totalCents;
  const projectedBalancePersonalCents = projectMonthEnd(projection, "personal").totalCents;

  // The total balance as it moved, read off the balance timeline: one pass over the history, and
  // each reading is what the account balances add up to with that day as their cutoff.
  const timeline = computeBalanceTimeline(ws.accounts, ws.transactions, ws.settlements, ws.cardBillPayments);
  // The month-over-month change is about the available balance, like the figure it sits under.
  const spendingTimeline = hasReserve
    ? computeBalanceTimeline(spending, ws.transactions, ws.settlements, ws.cardBillPayments)
    : timeline;
  const monthEndTotals = {
    previousCents: totalBalanceAt(spendingTimeline, dateInMonth(addMonths(month, -1), 31)),
    currentCents: totalBalanceAt(spendingTimeline, dateInMonth(month, 31)),
  };
  // Day by day through today, from the first day of the month anything first moved — flat at the
  // opening balances before that, so a new workspace still shows its six trailing months.
  const shortestStart = dateInMonth(addMonths(currentMonth, 1 - NET_WORTH_MIN_MONTHS), 1);
  const longestStart = dateInMonth(addMonths(currentMonth, 1 - NET_WORTH_MAX_MONTHS), 1);
  const firstMovement = timeline.changes[0]?.date;
  let netWorthStart = firstMovement === undefined ? shortestStart : dateInMonth(monthOf(firstMovement), 1);
  if (netWorthStart > shortestStart) netWorthStart = shortestStart;
  if (netWorthStart < longestStart) netWorthStart = longestStart;
  const netWorthDaily: NetWorthDaily = {
    startDate: netWorthStart,
    valuesCents: dailyTotalBalances(timeline, netWorthStart, today),
  };
  // …and where it is expected to go: the same "fim do mês" as above, spread over the days its
  // parts fall on. Pinned on the browsed month's figure, and reusing its person nets, when that
  // month is inside the forecast. The timeline is the net worth, so the figure it is pinned on is
  // the month-end of EVERY account: the available "fim do mês" plus where the reserves land.
  const netWorthMonthEndCents = hasReserve
    ? projectMonthEnd({ ...projection, accounts: ws.accounts }, "general").totalCents
    : projectedBalanceCents;
  const forecastThrough = addMonths(currentMonth, NET_WORTH_FORECAST_MONTHS - 1);
  const browsedIsForecast =
    compareMonths(month, currentMonth) >= 0 && compareMonths(month, forecastThrough) <= 0;
  const forecast = forecastCash({
    accounts: ws.accounts,
    creditCards: ws.creditCards,
    cardBillDates: ws.cardBillDates,
    people: ws.people,
    transactions: ws.transactions,
    settlements: ws.settlements,
    cardBillPayments: ws.cardBillPayments,
    today,
    throughMonth: forecastThrough,
    competenceOf,
    ...(browsedIsForecast
      ? { anchors: new Map([[month, netWorthMonthEndCents]]), personNets: new Map([[month, monthNets]]) }
      : {}),
  });
  const netWorthForecast: NetWorthForecast = {
    startDate: forecast.startDate,
    valuesCents: forecast.dailyCents,
    events: forecast.events,
  };

  return {
    month,
    totalBalanceCents,
    totalBalancePersonalCents,
    investedCents,
    projectedBalanceCents,
    projectedBalancePersonalCents,
    accounts,
    cards,
    people,
    aReceberCents,
    aPagarCents,
    settlementNetCents,
    heldForOthersCents,
    projectedIncomeCents: projectedTotals.income.cents,
    projectedExpenseCents: projectedTotals.expense.cents,
    projectedIncomePersonalCents: projectedTotalsPersonal.income.cents,
    projectedExpensePersonalCents: projectedTotalsPersonal.expense.cents,
    netWorthDaily,
    netWorthForecast,
    monthEndTotals,
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
