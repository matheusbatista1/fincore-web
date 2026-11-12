import type { Workspace } from "@/application/ports/finance-repository";
import type { CardBillPayment } from "@/domain/entities/card-bill-payment";
import type {
  ExpenseTransaction,
  IncomeTransaction,
  ParcelaStatus,
  Transaction,
  TransferTransaction,
} from "@/domain/entities/transaction";
import { billingCompetence, computeCardBillForMonth } from "@/domain/services/card-bill.calculator";
import {
  addDays,
  addMonths,
  type CompetenceMonth,
  compareMonths,
  dateInMonth,
  type IsoDate,
  monthOf,
} from "@/domain/value-objects/competence-month";

/**
 * A made-up household's finances, for the demo area and the browser tests. Every name and figure
 * here is invented; nothing comes from a real account.
 *
 * It is built relative to `today`, so whenever it is opened there is a past (five months of
 * salary, rent, groceries, shared dinners, a parcelado), a present (this month, partly lived) and
 * a little of what is still to come — enough for every screen to have something to show.
 */

const MAIN = "demo-acc-main";
const RESERVE = "demo-acc-reserve";
const CASH = "demo-acc-cash";
const GOLD = "demo-card-gold";
const BLACK = "demo-card-black";
const ANA = "demo-person-ana";
const BRUNO = "demo-person-bruno";

const FOOD = "demo-cat-food";
const TRANSPORT = "demo-cat-transport";
const HOME = "demo-cat-home";
const LEISURE = "demo-cat-leisure";
const HEALTH = "demo-cat-health";
const BILLS = "demo-cat-bills";

/** How many months of history the demo has behind the current one. */
const MONTHS_BACK = 5;

/** Last month's tolls: one entry in the app, three lines at the bank (see `demo-statement`). */
export const DEMO_TOLLS = {
  description: "Pedágios do mês",
  totalCents: 4_440,
  /** Each toll the bank lists: the day of last month and its amount. */
  lines: [
    { day: 6, cents: 890 },
    { day: 13, cents: 1_240 },
    { day: 27, cents: 2_310 },
  ],
} as const;

/** A small deterministic spread around a base amount: the same month always gets the same value. */
const vary = (base: number, seed: number, spread: number): number =>
  base + (((seed * 9301 + 49297) % 233280) / 233280 - 0.5) * 2 * spread;
const cents = (value: number): number => Math.round(value);

export function demoWorkspace(today: IsoDate): Workspace {
  const current = monthOf(today);
  const months: CompetenceMonth[] = Array.from({ length: MONTHS_BACK + 1 }, (_, i) =>
    addMonths(current, i - MONTHS_BACK),
  );
  const transactions: Transaction[] = [];
  let seq = 0;
  const id = (prefix: string): string => `demo-${prefix}-${++seq}`;
  const happened = (date: IsoDate): boolean => date <= today;

  const expense = (
    date: IsoDate,
    description: string,
    amount: number,
    over: Partial<ExpenseTransaction>,
  ): ExpenseTransaction => ({
    id: id("tx"),
    kind: "expense",
    description,
    date,
    amountCents: -cents(amount),
    categoryId: null,
    source: "account",
    cardId: null,
    accountId: MAIN,
    linkedAccountId: null,
    splits: [],
    myShareCents: cents(amount),
    installment: null,
    recurrence: null,
    billMonthOverride: null,
    ...over,
  });
  const onCard = (
    cardId: string,
    date: IsoDate,
    description: string,
    amount: number,
    over: Partial<ExpenseTransaction> = {},
  ): ExpenseTransaction =>
    expense(date, description, amount, { source: "card", cardId, accountId: null, ...over });
  const income = (
    date: IsoDate,
    description: string,
    amount: number,
    over: Partial<IncomeTransaction> = {},
  ): IncomeTransaction => ({
    id: id("tx"),
    kind: "income",
    description,
    date,
    amountCents: cents(amount),
    accountId: MAIN,
    cardId: null,
    fromPersonId: null,
    isReimbursement: false,
    recurrence: null,
    ...over,
  });
  const transfer = (date: IsoDate, description: string, amount: number): TransferTransaction => ({
    id: id("tx"),
    kind: "transfer",
    description,
    date,
    fromAccountId: MAIN,
    toAccountId: RESERVE,
    valueCents: cents(amount),
  });

  months.forEach((month, i) => {
    const day = (d: number): IsoDate => dateInMonth(month, d);
    const fixed = (d: number) => ({ recurrence: { dayOfMonth: d } });

    // What comes in: the salary on the 5th.
    if (happened(day(5))) transactions.push(income(day(5), "Salário", 620_000, fixed(5)));

    // The fixed costs: rent by boleto on the 10th (paid on the day), internet debited on the 15th,
    // a streaming plan on the Gold card on the 8th.
    if (happened(day(10))) {
      transactions.push(
        expense(day(10), "Aluguel", 185_000, {
          source: "boleto",
          accountId: null,
          linkedAccountId: MAIN,
          categoryId: HOME,
          paidAt: day(10),
          paidAccountId: MAIN,
          paidAmountCents: 185_000,
          ...fixed(10),
        }),
      );
    }
    if (happened(day(15))) {
      transactions.push(expense(day(15), "Internet", 10_990, { categoryId: BILLS, ...fixed(15) }));
    }
    if (happened(day(8))) {
      transactions.push(onCard(GOLD, day(8), "Streaming", 3_990, { categoryId: LEISURE, ...fixed(8) }));
    }

    // The month's shopping, on the Gold card; fuel, debited from the account.
    for (const [n, d] of [3, 11, 19, 27].entries()) {
      if (!happened(day(d))) continue;
      transactions.push(
        onCard(GOLD, day(d), "Supermercado", vary(34_000, i * 7 + n, 9_000), { categoryId: FOOD }),
      );
    }
    for (const [n, d] of [7, 22].entries()) {
      if (!happened(day(d))) continue;
      transactions.push(
        expense(day(d), "Combustível", vary(21_000, i * 5 + n, 4_000), { categoryId: TRANSPORT }),
      );
    }
    if (happened(day(17))) {
      transactions.push(
        expense(day(17), "Farmácia", vary(8_500, i * 3, 3_000), { categoryId: HEALTH, accountId: CASH }),
      );
    }

    // A dinner out with Ana, on the Black card, split in two.
    if (happened(day(14))) {
      const total = cents(vary(18_000, i * 11, 4_000));
      const hers = Math.floor(total / 2);
      transactions.push(
        onCard(BLACK, day(14), "Jantar com a Ana", total, {
          categoryId: LEISURE,
          splits: [{ personId: ANA, shareCents: hers }],
          myShareCents: total - hers,
        }),
      );
    }

    // Something put aside every month.
    if (happened(day(6))) transactions.push(transfer(day(6), "Para a reserva", 40_000));
  });

  // A notebook in six parcelas on the Black card, bought three months ago.
  const firstParcela = addMonths(current, -3);
  for (let n = 1; n <= 6; n++) {
    const month = addMonths(firstParcela, n - 1);
    const relation = compareMonths(month, current);
    const status: ParcelaStatus = relation < 0 ? "paga" : relation === 0 ? "atual" : "futura";
    transactions.push(
      onCard(BLACK, dateInMonth(month, 12), "Notebook", 54_990, {
        categoryId: BILLS,
        installment: { groupId: "demo-group-notebook", number: n, total: 6, status },
      }),
    );
  }

  // Last month's tolls, booked as one entry at the end of the month (the bank lists each one).
  const lastMonth = addMonths(current, -1);
  transactions.push(
    expense(dateInMonth(lastMonth, 28), DEMO_TOLLS.description, DEMO_TOLLS.totalCents, {
      categoryId: TRANSPORT,
    }),
  );

  // Bruno's half of last month's gas bill, still to be paid back.
  transactions.push(
    expense(dateInMonth(lastMonth, 20), "Conta de gás", 13_000, {
      categoryId: HOME,
      splits: [{ personId: BRUNO, shareCents: 6_500 }],
      myShareCents: 6_500,
    }),
  );

  // Still to come: a freela to be received and a present already booked.
  transactions.push(income(addDays(today, 6), "Freela", 90_000, { receivedAt: null }));
  transactions.push(expense(addDays(today, 9), "Presente de aniversário", 15_000, { categoryId: LEISURE }));

  // Ana paid back two months of dinners at once, two months ago.
  const settlements = [
    {
      id: "demo-settlement-ana",
      personId: ANA,
      amountCents: 16_000,
      date: dateInMonth(addMonths(current, -2), 16),
      accountId: MAIN,
    },
  ];

  const creditCards: Workspace["creditCards"] = [
    {
      id: GOLD,
      bank: "Banco Azul",
      product: "Gold",
      flag: "mastercard",
      themeKey: "oceano",
      maskedNumber: "•••• 4821",
      limitCents: 800_000,
      closingDay: 24,
      dueDay: 2,
    },
    {
      id: BLACK,
      bank: "Banco Roxo",
      product: "Black",
      flag: "visa",
      themeKey: "roxo",
      maskedNumber: "•••• 7730",
      limitCents: 1_500_000,
      closingDay: 5,
      dueDay: 12,
    },
  ];

  // Every fatura whose due date has passed was paid on it, from the main account.
  const competenceOf = billingCompetence(creditCards, []);
  const cardBillPayments: CardBillPayment[] = [];
  for (const card of creditCards) {
    for (const month of months) {
      const due = dateInMonth(month, card.dueDay);
      if (!happened(due)) continue;
      const bill = computeCardBillForMonth(card.id, transactions, month, competenceOf);
      if (bill.cents <= 0) continue;
      cardBillPayments.push({
        id: `demo-payment-${card.id}-${month}`,
        cardId: card.id,
        competence: month,
        amountCents: bill.cents,
        accountId: MAIN,
        date: due,
      });
    }
  }

  return {
    accounts: [
      {
        id: MAIN,
        bank: "Banco Azul",
        name: "Conta corrente",
        type: "PF",
        themeKey: "oceano",
        openingBalanceCents: 240_000,
        maskedNumber: "•• 1042",
      },
      {
        id: RESERVE,
        bank: "Banco Verde",
        name: "Reserva",
        type: "PF",
        themeKey: "esmeralda",
        openingBalanceCents: 650_000,
        maskedNumber: "•• 5518",
      },
      {
        id: CASH,
        bank: "Carteira",
        name: "Dinheiro",
        type: "PF",
        themeKey: "grafite",
        openingBalanceCents: 60_000,
        maskedNumber: "",
      },
    ],
    creditCards,
    people: [
      { id: ANA, name: "Ana Demo", relationship: "Amiga", color: "#7c5cff" },
      { id: BRUNO, name: "Bruno Demo", relationship: "Irmão", color: "#34e1a8" },
    ],
    categories: [
      { id: FOOD, name: "Alimentação", color: "#f5b53f", icon: "utensils-crossed" },
      { id: TRANSPORT, name: "Transporte", color: "#56b6f2", icon: "car-front" },
      { id: HOME, name: "Moradia", color: "#7c5cff", icon: "building-2" },
      { id: LEISURE, name: "Lazer", color: "#fb6e83", icon: "party-popper" },
      { id: HEALTH, name: "Saúde", color: "#34e1a8", icon: "heart-pulse" },
      { id: BILLS, name: "Contas e compras", color: "#b79eff", icon: "plug-zap" },
    ],
    transactions,
    settlements,
    budgets: [],
    goals: [],
    cardBillDates: [],
    cardBillPayments,
  };
}

/** The demo's own identifiers, for whatever needs to point at one of its accounts or cards. */
export const DEMO_IDS = { MAIN, RESERVE, CASH, GOLD, BLACK, ANA, BRUNO } as const;
