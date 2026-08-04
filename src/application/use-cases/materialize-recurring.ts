import type { Transaction } from "@/domain/entities/transaction";
import { isExpense, isIncome } from "@/domain/entities/transaction";
import { recurringOccurrencesBetween } from "@/domain/services/recurring.projection";
import { addMonths, dateInMonth, type IsoDate, monthOf } from "@/domain/value-objects/competence-month";
import { todayInBrazil } from "@/shared/formatting/now";
import { createTransactionSchema } from "@/shared/schemas/transaction";
import { loadWorkspaceCached } from "../loaders";
import type { CreateTransactionCommand, FinanceRepository } from "../ports/finance-repository";
import { buildCommand } from "./create-transaction";

export interface MaterializeResult {
  /** How many occurrences were booked as real transactions. */
  readonly created: number;
}

const NOOP: MaterializeResult = { created: 0 };

/**
 * The floor for a user with no watermark yet: the last day of the PREVIOUS month. The watermark is
 * exclusive ("materialised through this date"), so this starts the very first pass on day 1 of the
 * current month — a salary anchored on the 1st is booked — while no earlier month is back-filled.
 */
const defaultWatermark = (date: IsoDate): IsoDate => dateInMonth(addMonths(monthOf(date), -1), 31);

/**
 * Turn the recurring rules ("lançamentos fixos") whose day has arrived into REAL transactions.
 *
 * A fixo used to be a pure projection, so the moment a month turned its occurrences vanished from
 * the current fatura and from the month's obligations — the salary was never received, the
 * subscriptions were never charged, and the user had to re-type them by hand. From here on every
 * occurrence dated in `(watermark, today]` is booked once, and the watermark moves to today.
 *
 * Idempotent by construction, so it is safe on every app load and from the daily cron:
 *  - the watermark short-circuits a pass that already ran today;
 *  - an occurrence whose identity is already booked in that calendar month is skipped (a manual
 *    re-entry or an earlier pass), so nothing is ever duplicated;
 *  - the watermark advance doubles as an optimistic lock inside the write transaction, so two
 *    concurrent passes cannot both insert.
 *
 * A materialised row is a plain transaction, NOT a new rule: the anchor stays the single source of
 * the recurrence, so editing or stopping the rule keeps working on one row. Expenses are born
 * pending (auto-payments, when enabled, settles them right after); an income dated today or earlier
 * is born RECEIVED into its account by the "pela data" rule, so the money actually lands.
 */
export async function materializeRecurring(
  repo: FinanceRepository,
  userId: string,
): Promise<MaterializeResult> {
  const profile = await repo.getProfile(userId);
  const today = todayInBrazil();
  // Never back-fill history: a user without a watermark starts at the current month's first day.
  const through = profile.recurringMaterializedThrough ?? defaultWatermark(today);
  if (through >= today) return NOOP;

  const ws = await loadWorkspaceCached(repo, userId);
  const occurrences = recurringOccurrencesBetween(ws.transactions, through as IsoDate, today);

  const commands: CreateTransactionCommand[] = [];
  for (const occurrence of occurrences) {
    const input = occurrenceInput(occurrence.source, occurrence.date);
    if (input === null) continue;
    const parsed = createTransactionSchema.safeParse(input);
    if (!parsed.success) continue;
    const command = buildCommand(parsed.data, today);
    if (!command.ok) continue;
    commands.push(command.value);
  }

  // Always advance the watermark — even with nothing to book — so the next pass short-circuits.
  const created = await repo.materializeRecurring(userId, today, commands);
  return { created };
}

/**
 * The create-transaction input that reproduces `source` on `date`. Returns null for a rule that
 * cannot be replayed (an income with no destination). Never carries `fixed`: the anchor remains the
 * one rule, so materialised rows never become extra anchors that would double-project.
 */
function occurrenceInput(tx: Transaction, date: IsoDate): unknown {
  if (isIncome(tx)) {
    if (tx.accountId === null && tx.cardId === null) return null;
    return {
      kind: "income",
      description: tx.description,
      date,
      amountCents: tx.amountCents,
      accountId: tx.accountId,
      cardId: tx.cardId,
      fromPersonId: tx.fromPersonId,
      fixed: false,
    };
  }
  if (!isExpense(tx)) return null;

  const total = Math.abs(tx.amountCents);
  const sharesTotal = tx.splits.reduce((sum, s) => sum + s.shareCents, 0);
  return {
    kind: "expense",
    description: tx.description,
    date,
    totalAmountCents: total,
    categoryId: tx.categoryId,
    source: tx.source,
    cardId: tx.cardId,
    accountId: tx.accountId,
    linkedAccountId: tx.linkedAccountId,
    fixed: false,
    // Replay the anchor's exact shares. "Me in" whenever the people do not cover the whole amount,
    // which is precisely how the anchor's own myShareCents was derived.
    split: {
      method: "custom" as const,
      meIn: sharesTotal < total,
      selected: tx.splits.map((s) => s.personId),
      custom: Object.fromEntries(tx.splits.map((s) => [s.personId, s.shareCents])),
    },
    installment: null,
  };
}
