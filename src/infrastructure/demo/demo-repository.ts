import type { FinanceRepository, UserProfile } from "@/application/ports/finance-repository";
import type { IsoDate } from "@/domain/value-objects/competence-month";
import { ALL_MODULE_KEYS } from "@/shared/modules";
import { demoHistory } from "./demo-history";
import { demoWorkspace } from "./demo-workspace";

/** Whoever looks at the demo is this made-up user. */
export const DEMO_USER_ID = "demo-user";

const DEMO_PROFILE: UserProfile = {
  displayName: "Pessoa Demo",
  email: "demo@fincore.invalid",
  avatarUrl: null,
  enabledModules: [...ALL_MODULE_KEYS],
  onboardedAt: new Date(0),
  autoPaymentsEnabled: false,
  defaultPayAccountId: null,
  autoPaymentsSince: null,
  recurringMaterializedThrough: null,
};

/**
 * A repository over the made-up workspace: it answers what the screens read, and has nothing to
 * write with — a call to anything else fails, which is what a demo should do.
 */
export function demoRepository(today: IsoDate): FinanceRepository {
  const workspace = demoWorkspace(today);
  return {
    loadWorkspace: async () => workspace,
    getProfile: async () => DEMO_PROFILE,
    listStatementChecks: async () => [],
    listTransactionEvents: async (_userId: string, transactionId: string) =>
      demoHistory(workspace, transactionId, today),
  } as unknown as FinanceRepository;
}
