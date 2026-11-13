import type { StatementCheck } from "@/domain/entities/statement-check";
import type { CompetenceMonth, IsoDate } from "@/domain/value-objects/competence-month";
import { err, ok, type Result } from "@/shared/result";
import type { ReconcileStatementInput } from "@/shared/schemas/reconcile";
import type { FinanceRepository } from "../ports/finance-repository";
import { type ReconcileStatementError, reconcileWithStatement } from "./reconcile-statement";

/** What the screens say about a check: when, what it covered and what was still open then. */
export interface StatementCheckSummary {
  readonly checkedOn: IsoDate;
  readonly periodFrom: IsoDate;
  readonly periodTo: IsoDate;
  /** The fatura checked (its due month), for a card; null for an account. */
  readonly competence: CompetenceMonth | null;
  /** Lines of the file with no entry, and entries with no line, when it was marked. */
  readonly bankOnly: number;
  readonly bookOnly: number;
}

const summarize = (check: StatementCheck): StatementCheckSummary => ({
  checkedOn: check.checkedOn,
  periodFrom: check.periodFrom,
  periodTo: check.periodTo,
  competence: check.competence,
  bankOnly: check.bankOnly,
  bookOnly: check.bookOnly,
});

/**
 * "Marcar como conferido": records that this statement was checked today. The comparison is run
 * again here, from the file's lines — what gets recorded is what the server finds, never a count
 * sent by the browser. It may be marked with differences still open; the record says how many.
 *
 * @param today The day being recorded (the clock stays with the caller).
 */
export async function markStatementChecked(
  repo: FinanceRepository,
  userId: string,
  input: ReconcileStatementInput,
  today: IsoDate,
): Promise<Result<StatementCheckSummary, ReconcileStatementError>> {
  const checked = await reconcileWithStatement(repo, userId, input);
  if (!checked.ok) return err(checked.error);
  const { target, period, bankCount, bankOnly, bookOnly } = checked.value;
  const record = {
    accountId: target.type === "account" ? target.id : null,
    cardId: target.type === "card" ? target.id : null,
    competence: target.type === "card" ? target.month : null,
    periodFrom: period.from,
    periodTo: period.to,
    bankLines: bankCount,
    bankOnly: bankOnly.length,
    bookOnly: bookOnly.length,
    checkedOn: today,
  };
  await repo.recordStatementCheck(userId, record);
  return ok({
    checkedOn: record.checkedOn,
    periodFrom: record.periodFrom,
    periodTo: record.periodTo,
    competence: record.competence,
    bankOnly: record.bankOnly,
    bookOnly: record.bookOnly,
  });
}

/**
 * The latest check of each account and of each card, by its id: what "conferido até…" shows.
 * An account or card never checked is simply not there.
 */
export async function getLastStatementChecks(
  repo: FinanceRepository,
  userId: string,
): Promise<Record<string, StatementCheckSummary>> {
  const latest: Record<string, StatementCheckSummary> = {};
  // Most recent first: the first one seen for a target is its latest.
  for (const check of await repo.listStatementChecks(userId)) {
    const target = check.accountId ?? check.cardId;
    if (target !== null && latest[target] === undefined) latest[target] = summarize(check);
  }
  return latest;
}
