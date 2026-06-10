/** Expense category (categoria). */
export interface Category {
  readonly id: string;
  readonly name: string;
  /** Display color (hex). */
  readonly color: string;
  /** Lucide icon name, e.g. "utensils-crossed". */
  readonly icon: string;
}
