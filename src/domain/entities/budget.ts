/** Monthly spending limit for a category (orçamento). */
export interface Budget {
  readonly id: string;
  /** The category this budget caps. One budget per category. */
  readonly categoryId: string;
  /** The monthly limit in cents (> 0). */
  readonly limitCents: number;
}
