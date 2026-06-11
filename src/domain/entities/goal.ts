/** A savings goal (meta de economia). */
export interface Goal {
  readonly id: string;
  readonly name: string;
  /** Target amount to reach, in cents (> 0). */
  readonly targetCents: number;
  /** Amount saved so far, in cents (>= 0). */
  readonly savedCents: number;
}
