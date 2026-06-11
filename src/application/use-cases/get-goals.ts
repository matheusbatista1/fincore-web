import { goalProgress } from "@/domain/services/goal.calculator";
import type { FinanceRepository } from "../ports/finance-repository";

/** A goal enriched with its progress — serializable for RSC. */
export interface GoalView {
  readonly id: string;
  readonly name: string;
  readonly targetCents: number;
  readonly savedCents: number;
  readonly remainingCents: number;
  readonly ratio: number;
  readonly reached: boolean;
}

export interface GoalsData {
  readonly totalTargetCents: number;
  readonly totalSavedCents: number;
  readonly goals: GoalView[];
}

/** Load the user's savings goals with computed progress. */
export async function getGoals(repo: FinanceRepository, userId: string): Promise<GoalsData> {
  const ws = await repo.loadWorkspace(userId);

  const goals: GoalView[] = ws.goals
    .map((goal) => {
      const progress = goalProgress(goal);
      return {
        id: goal.id,
        name: goal.name,
        targetCents: goal.targetCents,
        savedCents: goal.savedCents,
        remainingCents: progress.remainingCents,
        ratio: progress.ratio,
        reached: progress.reached,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);

  return {
    totalTargetCents: goals.reduce((sum, g) => sum + g.targetCents, 0),
    totalSavedCents: goals.reduce((sum, g) => sum + g.savedCents, 0),
    goals,
  };
}
