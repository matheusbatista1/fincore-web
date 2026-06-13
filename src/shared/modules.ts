/**
 * Optional feature modules. The core experience (dashboard, wallets, cards,
 * transactions, monthly, settings, import) is always on; these four can be
 * toggled per user. Disabling a module only hides every surface that relates to
 * it — no data is ever deleted, so re-enabling brings everything back.
 *
 * Pure data + helpers only (no framework imports) so it's safe to use from any
 * layer — the DB schema types `enabled_modules` against `ModuleKey`.
 */
export type ModuleKey = "people" | "budgets" | "goals" | "reports";

export const ALL_MODULE_KEYS: readonly ModuleKey[] = ["people", "budgets", "goals", "reports"];

export interface OptionalModule {
  readonly key: ModuleKey;
  /** Display name (pt-BR). */
  readonly label: string;
  /** Icon name for the <Icon> registry (matches the nav icon). */
  readonly icon: string;
  /** Full explanation shown in the onboarding picker and settings. */
  readonly description: string;
}

/** The four optional modules, with the copy used by onboarding + settings. */
export const OPTIONAL_MODULES: readonly OptionalModule[] = [
  {
    key: "people",
    label: "Pessoas",
    icon: "users",
    description:
      "Divida despesas e acompanhe quem te deve ou a quem você deve. Ideal para contas compartilhadas, rateios e empréstimos entre amigos. Ativa a divisão de despesas no lançamento.",
  },
  {
    key: "budgets",
    label: "Orçamentos",
    icon: "target",
    description:
      "Defina um limite de gasto por categoria e acompanhe, ao longo do mês, quanto você já comprometeu de cada um.",
  },
  {
    key: "goals",
    label: "Metas",
    icon: "piggy-bank",
    description:
      "Crie metas de economia (uma viagem, uma reserva de emergência) com um valor-alvo e acompanhe o progresso das suas contribuições.",
  },
  {
    key: "reports",
    label: "Relatórios",
    icon: "chart-pie",
    description:
      "Relatórios detalhados do seu fluxo de caixa, gastos por categoria e por cartão, com exportação em CSV e PDF.",
  },
];

/** True when `key` is in the user's enabled set. */
export function isModuleEnabled(enabled: readonly ModuleKey[], key: ModuleKey): boolean {
  return enabled.includes(key);
}

/**
 * The optional module a route belongs to, or `null` for core routes that are
 * always available. Used to gate routes, nav items and search results.
 */
export function moduleForHref(href: string): ModuleKey | null {
  const base = `/${href.split("/").filter(Boolean)[0] ?? ""}`;
  switch (base) {
    case "/people":
      return "people";
    case "/budgets":
      return "budgets";
    case "/goals":
      return "goals";
    case "/reports":
      return "reports";
    default:
      return null;
  }
}

/** True when the route is visible for the given enabled set (core routes always are). */
export function isHrefEnabled(enabled: readonly ModuleKey[], href: string): boolean {
  const mod = moduleForHref(href);
  return mod === null || isModuleEnabled(enabled, mod);
}

/** Keep only valid module keys from arbitrary input (defensive parse for stored/posted data). */
export function sanitizeModules(input: unknown): ModuleKey[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<ModuleKey>();
  for (const v of input) {
    if (typeof v === "string" && (ALL_MODULE_KEYS as readonly string[]).includes(v)) {
      seen.add(v as ModuleKey);
    }
  }
  return [...seen];
}
