/**
 * goal calculator — derives a savings goal's (meta) progress toward its target.
 * Pure arithmetic in integer cents; no IO, no imports outside src/domain.
 */

import { Money } from "../money/money";

export interface GoalProgress {
  readonly savedCents: number;
  readonly targetCents: number;
  /** `max(0, target − saved)` — what is still left to save. */
  readonly remainingCents: number;
  /** `saved / target` clamped to [0, 1] for display (0 when the target is non-positive). */
  readonly ratio: number;
  readonly reached: boolean;
}

/** Compute progress for a goal-shaped input (saved vs target). */
export function goalProgress(goal: { savedCents: number; targetCents: number }): GoalProgress {
  const saved = Money.fromCents(goal.savedCents);
  const target = Money.fromCents(goal.targetCents);
  const remaining = target.subtract(saved).max(Money.zero());
  const ratio = goal.targetCents > 0 ? Math.min(1, goal.savedCents / goal.targetCents) : 0;
  return {
    savedCents: goal.savedCents,
    targetCents: goal.targetCents,
    remainingCents: remaining.cents,
    ratio,
    reached: saved.greaterThanOrEqual(target),
  };
}
