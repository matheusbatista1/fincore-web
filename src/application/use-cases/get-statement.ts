import { isExpense, isIncome, isPaid, isRolled, isTransfer } from "@/domain/entities/transaction";
import { Money } from "@/domain/money/money";
import { billingCompetence } from "@/domain/services/card-bill.calculator";
import { computePersonBalances } from "@/domain/services/person-ledger.calculator";
import { transactionsForMonth } from "@/domain/services/recurring.projection";
import { addMonths, type CompetenceMonth, compareMonths } from "@/domain/value-objects/competence-month";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository } from "../ports/finance-repository";
import { byDateDesc, createTransactionMapper, type TransactionListItem } from "./get-transactions";

/**
 * The transactions statement, split into two lenses:
 *  - `executed`: cash that has ALREADY moved (an extrato), newest → oldest. Money the user received
 *    or paid: income received, account/overdraft expenses, transfers made, PAID obligations (dated
 *    by their pay date and valued at the amount paid), settlements (a person paying you back / you
 *    paying them) and card-fatura payments. Individual card charges are NOT here — a card only moves
 *    cash when its fatura is paid, which shows as a "Pagamento de fatura" row.
 *  - `future`: what is still to come, oldest → newest: future-dated real movements, unpaid deferred
 *    obligations (by due date), future-dated card charges, and projected ("previsto") recurring
 *    occurrences over the next few months.
 *
 * Rolled (abated) expenses and card credits (estornos) are excluded from both.
 */
export interface StatementData {
  readonly executed: TransactionListItem[];
  readonly future: TransactionListItem[];
}

/** How many months ahead to fold in projected ("previsto") recurring occurrences for the future view. */
const FUTURE_HORIZON_MONTHS = 6;

const byDateAsc = (a: TransactionListItem, b: TransactionListItem): number => -byDateDesc(a, b);

/** Build a fully-populated display row from a partial — every TransactionListItem field defaults to null/empty. */
function syntheticRow(
  over: Partial<TransactionListItem> &
    Pick<TransactionListItem, "id" | "kind" | "description" | "date" | "amountCents">,
): TransactionListItem {
  return {
    note: null,
    category: null,
    categoryId: null,
    sourceLabel: null,
    source: null,
    cardId: null,
    accountId: null,
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
    shares: [],
    myShareCents: null,
    isReimbursement: false,
    fromPersonId: null,
    fromPersonName: null,
    transferFromName: null,
    transferToName: null,
    transferFromAccountId: null,
    transferToAccountId: null,
    transferValueCents: null,
    ...over,
  };
}

/** Assemble the executed extrato + the future/pending list from the workspace. */
export async function getStatement(repo: FinanceRepository, userId: string): Promise<StatementData> {
  const ws = await loadWorkspaceCached(repo, userId);
  const today = todayInBrazil();
  const currentMonth = currentMonthInBrazil();
  const map = createTransactionMapper(ws);
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);

  const executed: TransactionListItem[] = [];
  const future: TransactionListItem[] = [];
  // Faturas already settled (card + competence) — their charges show only as the "Pagamento de
  // fatura" row in executed, never again as individual upcoming charges.
  const paidFaturas = new Set(ws.cardBillPayments.map((p) => `${p.cardId}|${p.competence}`));

  for (const tx of ws.transactions) {
    if (isExpense(tx) && isRolled(tx)) continue; // abated — history only, never a movement

    if (isIncome(tx)) {
      if (tx.cardId !== null) continue; // card credit (estorno) — only reduces a bill, not cash
      (tx.date <= today ? executed : future).push(map(tx));
      continue;
    }

    if (isTransfer(tx)) {
      (tx.date <= today ? executed : future).push(map(tx));
      continue;
    }

    // Expense.
    if (tx.source === "card") {
      // A card charge is not cash — it settles through the whole fatura. Surface it in the future
      // view while its fatura is still open (competence in the current month or later AND not yet
      // paid); once the fatura is paid the spend shows only as the "Pagamento de fatura" row in
      // executed. A charge on an already-paid or past fatura is not repeated here (no double-count).
      const comp = competenceOf(tx);
      if (!paidFaturas.has(`${tx.cardId}|${comp}`) && compareMonths(comp, currentMonth) >= 0) {
        future.push(map(tx));
      }
      continue;
    }
    if (tx.source === "account" || tx.source === "overdraft") {
      (tx.date <= today ? executed : future).push(map(tx)); // debits the balance when booked
      continue;
    }
    // Deferred obligation (boleto/loan/financing).
    if (isPaid(tx) && tx.paidAt != null) {
      // Cash left on the pay date, for the amount actually paid (may be a discount).
      const paidRow: TransactionListItem = {
        ...map(tx),
        date: tx.paidAt,
        amountCents: -(tx.paidAmountCents ?? Math.abs(tx.amountCents)),
      };
      (tx.paidAt <= today ? executed : future).push(paidRow);
    } else {
      future.push(map(tx)); // pending — appears in the future view by its due date
    }
  }

  // Settlements that name an account move real cash (a person paying you back = entrada; you paying
  // them = saída). Direction follows the person's transaction-derived (gross) balance sign.
  const accountLabel = new Map(ws.accounts.map((a) => [a.id, `${a.bank} · ${a.name}`]));
  const personFirstName = new Map(ws.people.map((p) => [p.id, (p.name.split(" ")[0] ?? p.name) as string]));
  const grossPersonBalances = computePersonBalances([], ws.transactions, []);
  for (const s of ws.settlements) {
    if (s.accountId === null) continue; // "sem conta" (perdão) — no cash moved
    const owedToYou = !(grossPersonBalances.get(s.personId) ?? Money.zero()).isNegative();
    const first = personFirstName.get(s.personId) ?? "Pessoa";
    const row = syntheticRow({
      id: `settle:${s.id}`,
      kind: owedToYou ? "income" : "expense",
      description: `Acerto — ${first}`,
      date: s.date,
      amountCents: owedToYou ? s.amountCents : -s.amountCents,
      note: s.note ?? null,
      sourceLabel: (s.accountId && accountLabel.get(s.accountId)) || "Acerto",
      source: owedToYou ? null : "account",
      accountId: s.accountId,
      myShareCents: owedToYou ? null : s.amountCents,
      fromPersonId: owedToYou ? s.personId : null,
      fromPersonName: owedToYou ? first : null,
    });
    (s.date <= today ? executed : future).push(row);
  }

  // Card-fatura payments are cash out of the paying account on the pay date. (The individual charges
  // are excluded above, so this is where card spending enters the extrato — no double-count.)
  const cardName = new Map(ws.creditCards.map((c) => [c.id, `${c.bank} · ${c.product}`]));
  for (const p of ws.cardBillPayments) {
    const row = syntheticRow({
      id: `fatpay:${p.id}`,
      kind: "expense",
      description: `Pagamento de fatura — ${cardName.get(p.cardId) ?? "Cartão"}`,
      date: p.date,
      amountCents: -p.amountCents,
      note: p.note ?? null,
      sourceLabel: accountLabel.get(p.accountId) ?? "Conta",
      source: "account",
      accountId: p.accountId,
    });
    (p.date <= today ? executed : future).push(row);
  }

  // Projected ("previsto") recurring occurrences over the next few months → future only.
  for (let i = 1; i <= FUTURE_HORIZON_MONTHS; i++) {
    const month = addMonths(currentMonth, i) as CompetenceMonth;
    const { projected } = transactionsForMonth(ws.transactions, month, competenceOf);
    for (const occ of projected) {
      if (isExpense(occ.source) && isRolled(occ.source)) continue;
      if (isIncome(occ.source) && occ.source.cardId !== null) continue;
      if (occ.date <= today) continue;
      const anchor = map(occ.source);
      future.push({ ...anchor, id: `proj:${occ.source.id}:${month}`, date: occ.date, projected: true });
    }
  }

  executed.sort(byDateDesc);
  future.sort(byDateAsc);
  return { executed, future };
}
