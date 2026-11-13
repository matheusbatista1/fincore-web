import type { Transaction } from "./transaction";

/** What happened to a transaction: it appeared, something in it changed, or it was removed. */
export type TransactionEventKind = "created" | "updated" | "deleted";

/**
 * One entry of a transaction's history (histórico de alterações): the row as it was and as it
 * became, and when. Entries only add up — the history is never edited.
 */
export interface TransactionEvent {
  readonly id: string;
  readonly transactionId: string;
  readonly kind: TransactionEventKind;
  /**
   * What was being done when it happened: "edit", "pay", "import", "recurring"… Free text kept for
   * the reader; the screens fall back to the kind for a value they do not know.
   */
  readonly action: string;
  /** The row before; null when it did not exist yet. */
  readonly before: Transaction | null;
  /** The row after; null when it is gone. */
  readonly after: Transaction | null;
  /** When it was recorded. */
  readonly at: Date;
}
