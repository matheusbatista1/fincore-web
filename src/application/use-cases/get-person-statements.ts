import { isExpense, isLedgerOnly } from "@/domain/entities/transaction";
import { billingCompetence } from "@/domain/services/card-bill.calculator";
import {
  type CashMovement,
  computePersonLedger,
  withCashDeltas,
} from "@/domain/services/person-ledger.calculator";
import { type CompetenceMonth, compareMonths, type IsoDate } from "@/domain/value-objects/competence-month";
import { DEFAULT_CATEGORY_COLOR } from "@/shared/theme/category-colors";
import { loadWorkspaceCached } from "../loaders";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import { createTransactionMapper } from "./get-transactions";
import { isRolloverNote, ROLLOVER_NOTE_PREFIX } from "./roll-person-month-debt";

/**
 * What a statement row is, from the person's point of view:
 *  - `purchase`: their part of a shared expense (adds to what they owe);
 *  - `carried`: a remainder of an earlier period, back on its new date — the other half of a
 *    rollover covered with the user's own money. It adds to what they owe but is no new purchase;
 *  - `payment`: money they paid you (a received income from them, or an account-backed acerto);
 *  - `refund`: money you paid them back (an account-backed acerto against a balance in their favour);
 *  - `writeoff`: a "sem conta" acerto — a baixa/perdão (usually reduces what they owe; a positive
 *    one abates credit they had);
 *  - `rollover`: the acerto "Rolar dívida" writes. Nothing was paid and nothing forgiven: that
 *    amount left this period and is owed again as a new debt, on a later date. With or without an
 *    account behind it — where the user got the money to cover it is not the person's business.
 */
export type PersonStatementRowKind = "purchase" | "carried" | "payment" | "refund" | "writeoff" | "rollover";

/** One line of a person's statement, with the running figure after it. */
export interface PersonStatementRow {
  readonly date: IsoDate;
  /** The month the row is filed under: a card charge's fatura month, otherwise its calendar month. */
  readonly competence: CompetenceMonth;
  readonly kind: PersonStatementRowKind;
  readonly description: string;
  /** The acerto's note (the app writes "Acerto · R$ X de crédito", "Rolagem — …") or the expense note. */
  readonly note: string | null;
  /** "Cartão Nubank", "Itaú · Conta", "Boleto", … "sem conta" for a baixa/perdão, "Rolagem" for a rollover. */
  readonly originLabel: string;
  readonly categoryName: string | null;
  readonly categoryColor: string | null;
  /** Which parcela this row is and how many still come after it (`total − number`). */
  readonly parcela: { readonly number: number; readonly total: number; readonly remaining: number } | null;
  /** The whole expense (this parcela) the person's part came from; null for non-purchase rows. */
  readonly purchaseTotalCents: number | null;
  /** For an installment: the whole purchase (Σ parcelas), the person's part of it and the parcela count. */
  readonly groupTotalCents: number | null;
  readonly groupShareCents: number | null;
  readonly groupCount: number | null;
  /** The money the row really moved: `> 0` adds to what they owe, `< 0` reduces it. */
  readonly cashCents: number;
  /** Running reader balance after the row (`> 0` they still owe, `< 0` credit in their favour). */
  readonly runningCents: number;
  /** Projected ("previsto") — a recurring occurrence or a not-yet-charged parcela. */
  readonly projected: boolean;
}

/**
 * A person's statement over `[from, to]`, in the money view a lay reader expects: every row moves
 * the cash it really moved (an acerto above the debt is NOT clamped away), so
 * `opening + purchases + carried + refunds − payments + writeoffs + rollovers === closing`, and
 * `closing` is the profile's "no total" minus its "crédito" line (`ledgerClosingCents − advance`).
 */
export interface PersonStatement {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  readonly color: string;
  readonly from: CompetenceMonth;
  readonly to: CompetenceMonth;
  /** Carried in from before the window: `> 0` they already owed, `< 0` credit they already had. */
  readonly openingCents: number;
  readonly rows: PersonStatementRow[];
  /** Σ of purchase rows (their part of shared expenses in the window). */
  readonly purchasesCents: number;
  /** Σ of carried rows: remainders of earlier periods that fall due in the window. */
  readonly carriedCents: number;
  /** Σ of what they paid in the window (positive magnitude). */
  readonly paymentsCents: number;
  /** Σ of what you paid them back in the window (positive magnitude). */
  readonly refundsCents: number;
  /** Σ of baixa/perdão rows, signed (usually ≤ 0: a discount on what they owed). */
  readonly writeoffsCents: number;
  /** Σ of rollover rows, signed (≤ 0 when they owed): what was moved to a later date, not paid. */
  readonly rolloversCents: number;
  /** `> 0` they still owe, `< 0` credit in their favour, 0 all settled. */
  readonly closingCents: number;
  /** The clamped ledger figure (`computePersonBalancesThrough(to)`), kept for reconciliation. */
  readonly ledgerClosingCents: number;
  readonly projectedCount: number;
  readonly projectedCents: number;
  /** The latest payment they made before the window (the "you already paid R$ X on dd/mm" line). */
  readonly lastPaymentBefore: { readonly date: IsoDate; readonly amountCents: number } | null;
  /** First and last row dates, to say "lançamentos de dd/mm a dd/mm" next to the competence label. */
  readonly rowsDateSpan: { readonly first: IsoDate; readonly last: IsoDate } | null;
  /** Purchases grouped by category, largest first, "Sem categoria" last. */
  readonly byCategory: ReadonlyArray<{
    readonly name: string;
    readonly color: string;
    readonly count: number;
    readonly totalCents: number;
  }>;
  /**
   * The same closing figure read through a later month (`asOf`), when the window is in the past:
   * a payment made after `to` shows up here, so a past statement can still say "hoje: tudo pago".
   * Null when `asOf` is absent or not after `to`.
   */
  readonly asOf: { readonly month: CompetenceMonth; readonly closingCents: number } | null;
}

export interface GetPersonStatementsRange {
  readonly from: CompetenceMonth;
  readonly to: CompetenceMonth;
  /**
   * The current month. Two uses: the "situação hoje" figure for a past window, and telling a
   * parcela already billed from one still ahead (a parcela's stored status is a snapshot taken at
   * creation — "futura" never flips to "atual" when the month turns — so the calendar decides).
   */
  readonly asOf?: CompetenceMonth;
}

export const NO_CATEGORY_LABEL = "Sem categoria";

interface InstallmentGroupTotals {
  totalCents: number;
  count: number;
  readonly shareByPerson: Map<string, number>;
}

/** Σ |amount| over every parcela of each installment group, and each person's part of it. */
function installmentGroupTotals(ws: Workspace): Map<string, InstallmentGroupTotals> {
  const groups = new Map<string, InstallmentGroupTotals>();
  for (const tx of ws.transactions) {
    if (!isExpense(tx) || !tx.installment) continue;
    const group = groups.get(tx.installment.groupId) ?? { totalCents: 0, count: 0, shareByPerson: new Map() };
    group.totalCents += Math.abs(tx.amountCents);
    group.count += 1;
    for (const split of tx.splits) {
      group.shareByPerson.set(
        split.personId,
        (group.shareByPerson.get(split.personId) ?? 0) + split.shareCents,
      );
    }
    groups.set(tx.installment.groupId, group);
  }
  return groups;
}

const EMPTY_PURCHASE = {
  categoryName: null,
  categoryColor: null,
  parcela: null,
  purchaseTotalCents: null,
  groupTotalCents: null,
  groupShareCents: null,
  groupCount: null,
} as const;

/**
 * Build a person's statement for the window `[from, to]` in plain-reader terms: what was carried
 * in, each purchase (their part), each payment, and what is still open after every line.
 *
 * One {@link computePersonLedger} replay through `to` (so the figures agree with the People page's
 * ledger), annotated with {@link withCashDeltas}: the clamp that keeps the LEDGER at zero never
 * hides a payment here — a pre-payment reads as credit carried in, and an acerto above the debt
 * shows the full amount paid. Rows are windowed by COMPETENCE (a card charge belongs to its fatura
 * month) and listed by date, so an October purchase appears in November's statement with its
 * October date and `competence` says why.
 *
 * Caveat kept from the ledger: a "sem conta" acerto and an acerto landing on a zero balance read the
 * horizon, so `opening(from)` need not equal `closing(from − 1)`; within one statement the arithmetic
 * is always exact.
 */
export async function getPersonStatements(
  repo: FinanceRepository,
  userId: string,
  range: GetPersonStatementsRange,
): Promise<PersonStatement[]> {
  const ws = await loadWorkspaceCached(repo, userId);
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const [from, to] =
    compareMonths(range.from, range.to) <= 0 ? [range.from, range.to] : [range.to, range.from];
  const current = range.asOf ?? null;
  const asOfMonth = current !== null && compareMonths(current, to) > 0 ? current : null;
  // A real parcela is a forecast only while its fatura month is still ahead of today; the ledger
  // flags every stored-"futura" parcela, which goes stale once that month arrives.
  const stillAhead = (competence: CompetenceMonth): boolean =>
    current === null || compareMonths(competence, current) > 0;

  const ledger = computePersonLedger(ws.people, ws.transactions, ws.settlements, to, competenceOf);
  const movements = withCashDeltas(ledger.movements);
  // "Situação hoje": the same reader figure read through a later month (payments after `to` count).
  const asOfMovements = asOfMonth
    ? withCashDeltas(
        computePersonLedger(ws.people, ws.transactions, ws.settlements, asOfMonth, competenceOf).movements,
      )
    : null;

  const mapTx = createTransactionMapper(ws);
  const accountName = new Map(ws.accounts.map((a) => [a.id, `${a.bank} · ${a.name}`]));
  const groups = installmentGroupTotals(ws);

  const byPerson = new Map<string, CashMovement[]>();
  for (const mv of movements) {
    const list = byPerson.get(mv.personId);
    if (list) list.push(mv);
    else byPerson.set(mv.personId, [mv]);
  }
  const asOfCashByPerson = new Map<string, number>();
  for (const mv of asOfMovements ?? []) {
    asOfCashByPerson.set(mv.personId, (asOfCashByPerson.get(mv.personId) ?? 0) + mv.cashDeltaCents);
  }

  // A rollover is never a payment of theirs, even when the user's borrowed money landed in an account.
  const isPayment = (mv: CashMovement): boolean =>
    mv.cashDeltaCents < 0 &&
    (mv.source.type === "payment" ||
      (mv.source.type === "settlement" &&
        mv.source.settlement.accountId !== null &&
        !isRolloverNote(mv.source.settlement.note)));

  const toRow = (personId: string, mv: CashMovement, runningCents: number): PersonStatementRow => {
    const base = { date: mv.date, competence: mv.competence, cashCents: mv.cashDeltaCents, runningCents };
    if (mv.source.type === "settlement") {
      const s = mv.source.settlement;
      if (isRolloverNote(s.note)) {
        // What the app wrote after the prefix ("Dívida de Ana · nova data 20/12/2026") is the detail.
        const detail = (s.note ?? "").slice(ROLLOVER_NOTE_PREFIX.length).trim();
        return {
          ...base,
          ...EMPTY_PURCHASE,
          kind: "rollover",
          description: "Saldo adiado",
          note: detail || null,
          originLabel: "Rolagem",
          projected: false,
        };
      }
      const kind: PersonStatementRowKind =
        s.accountId === null ? "writeoff" : mv.cashDeltaCents < 0 ? "payment" : "refund";
      const description =
        kind === "payment"
          ? "Pagamento"
          : kind === "refund"
            ? "Devolução"
            : mv.cashDeltaCents < 0
              ? "Desconto"
              : "Crédito abatido";
      return {
        ...base,
        ...EMPTY_PURCHASE,
        kind,
        description,
        note: s.note ?? null,
        originLabel: (s.accountId ? accountName.get(s.accountId) : undefined) ?? "sem conta",
        projected: false,
      };
    }
    const item = mapTx(mv.source.tx);
    if (mv.source.type === "payment") {
      return {
        ...base,
        ...EMPTY_PURCHASE,
        kind: "payment",
        description: item.description,
        note: item.note,
        originLabel: item.sourceLabel ?? "Outros",
        projected: mv.projected,
      };
    }
    const tx = mv.source.tx;
    const expenseTx = isExpense(tx) ? tx : null; // a share always comes from an expense
    const installment = expenseTx?.installment ?? null;
    const group = installment ? groups.get(installment.groupId) : undefined;
    return {
      ...base,
      // A ledger-only debt is what a rollover left to be paid later: owed, but not a purchase.
      kind: isLedgerOnly(tx) ? "carried" : "purchase",
      description: item.description,
      note: item.note,
      originLabel: item.sourceLabel ?? "Outros",
      categoryName: item.category?.name ?? null,
      categoryColor: item.category?.color ?? null,
      parcela: installment
        ? {
            number: installment.number,
            total: installment.total,
            remaining: Math.max(0, installment.total - installment.number),
          }
        : null,
      purchaseTotalCents: expenseTx ? Math.abs(expenseTx.amountCents) : null,
      groupTotalCents: group?.totalCents ?? null,
      groupShareCents: group ? (group.shareByPerson.get(personId) ?? 0) : null,
      groupCount: group?.count ?? null,
      projected: installment ? mv.projected && stillAhead(mv.competence) : mv.projected,
    };
  };

  return ws.people.map((p) => {
    const mvs = byPerson.get(p.id) ?? [];
    let openingCents = 0;
    let lastPaymentBefore: PersonStatement["lastPaymentBefore"] = null;
    const period: CashMovement[] = [];
    for (const mv of mvs) {
      if (compareMonths(mv.competence, from) < 0) {
        openingCents += mv.cashDeltaCents;
        if (isPayment(mv) && (lastPaymentBefore === null || mv.date >= lastPaymentBefore.date)) {
          lastPaymentBefore = { date: mv.date, amountCents: -mv.cashDeltaCents };
        }
      } else if (compareMonths(mv.competence, to) <= 0) {
        period.push(mv);
      }
    }
    // Chronological display order (stable: shares and payments stay ahead of same-day acertos). A
    // rollover is listed at the end of its month: it settles what the month left open, including
    // rows dated after the day it was made — in date order the running figure would dip into a
    // "credit" nobody has until those rows came.
    const displayOrder = (mv: CashMovement): string =>
      mv.source.type === "settlement" && isRolloverNote(mv.source.settlement.note)
        ? `${mv.competence}-99`
        : mv.date;
    period.sort((a, b) => {
      const [ka, kb] = [displayOrder(a), displayOrder(b)];
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    let running = openingCents;
    let purchasesCents = 0;
    let carriedCents = 0;
    let paymentsCents = 0;
    let refundsCents = 0;
    let writeoffsCents = 0;
    let rolloversCents = 0;
    let projectedCount = 0;
    let projectedCents = 0;
    const rows: PersonStatementRow[] = [];
    const categories = new Map<string, { color: string; count: number; totalCents: number }>();
    for (const mv of period) {
      // A movement that moved no money (a baixa against nothing) has no line to show.
      if (mv.cashDeltaCents === 0) continue;
      running += mv.cashDeltaCents;
      const row = toRow(p.id, mv, running);
      rows.push(row);
      if (row.kind === "purchase") purchasesCents += row.cashCents;
      else if (row.kind === "carried") carriedCents += row.cashCents;
      else if (row.kind === "payment") paymentsCents -= row.cashCents;
      else if (row.kind === "refund") refundsCents += row.cashCents;
      else if (row.kind === "rollover") rolloversCents += row.cashCents;
      else writeoffsCents += row.cashCents;
      if (row.projected) {
        projectedCount += 1;
        projectedCents += row.cashCents;
      }
      if (row.kind === "purchase") {
        const name = row.categoryName ?? NO_CATEGORY_LABEL;
        const bucket = categories.get(name) ?? {
          color: row.categoryColor ?? DEFAULT_CATEGORY_COLOR,
          count: 0,
          totalCents: 0,
        };
        bucket.count += 1;
        bucket.totalCents += row.cashCents;
        categories.set(name, bucket);
      }
    }
    const byCategory = [...categories.entries()]
      .map(([name, c]) => ({ name, ...c }))
      .sort((a, b) =>
        a.name === NO_CATEGORY_LABEL ? 1 : b.name === NO_CATEGORY_LABEL ? -1 : b.totalCents - a.totalCents,
      );
    // Earliest and latest dates, not the first and last rows: a rollover is listed out of date order.
    let first: IsoDate | null = null;
    let last: IsoDate | null = null;
    for (const row of rows) {
      if (first === null || row.date < first) first = row.date;
      if (last === null || row.date > last) last = row.date;
    }

    return {
      id: p.id,
      name: p.name,
      relationship: p.relationship,
      color: p.color,
      from,
      to,
      openingCents,
      rows,
      purchasesCents,
      carriedCents,
      paymentsCents,
      refundsCents,
      writeoffsCents,
      rolloversCents,
      closingCents: running,
      ledgerClosingCents: ledger.balances.get(p.id)?.cents ?? 0,
      projectedCount,
      projectedCents,
      lastPaymentBefore,
      rowsDateSpan: first !== null && last !== null ? { first, last } : null,
      byCategory,
      asOf: asOfMonth ? { month: asOfMonth, closingCents: asOfCashByPerson.get(p.id) ?? 0 } : null,
    };
  });
}
