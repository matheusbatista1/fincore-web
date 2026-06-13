import { isHrefEnabled, type ModuleKey } from "@/shared/modules";

export interface NavItem {
  readonly href: string;
  readonly label: string;
  /** Icon name string for the <Icon> registry. */
  readonly icon: string;
  /** Show the pending-count badge/dot. */
  readonly badge?: boolean;
}

export interface NavGroup {
  readonly label: string;
  readonly items: NavItem[];
}

/** Sidebar nav groups — prototype's "Principal" + "Pessoas & Relatórios", plus the v1 extras. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Principal",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "layout-dashboard" },
      { href: "/wallets", label: "Carteiras", icon: "wallet" },
      { href: "/cards", label: "Cartões", icon: "credit-card" },
      { href: "/transactions", label: "Transações", icon: "arrow-left-right" },
      { href: "/categories", label: "Categorias", icon: "tag" },
      { href: "/monthly", label: "Visão mensal", icon: "calendar-range" },
    ],
  },
  {
    label: "Planejamento",
    items: [
      { href: "/budgets", label: "Orçamentos", icon: "target" },
      { href: "/goals", label: "Metas", icon: "piggy-bank" },
    ],
  },
  {
    label: "Pessoas & Relatórios",
    items: [
      { href: "/people", label: "Pessoas", icon: "users", badge: true },
      { href: "/reports", label: "Relatórios", icon: "chart-pie" },
    ],
  },
];

/** Pushed to the sidebar footer. */
export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Configurações", icon: "settings" };

/** Discreet entry just below Settings (import a bank statement or a card bill). */
export const IMPORT_ITEM: NavItem = { href: "/import", label: "Importar", icon: "file-up" };

/** Mobile bottom-nav: 4 primary tabs (+ a "Mais" sheet for the rest). */
export const MOBILE_TABS: NavItem[] = [
  { href: "/dashboard", label: "Início", icon: "house" },
  { href: "/monthly", label: "Mensal", icon: "calendar-range" },
  { href: "/cards", label: "Cartões", icon: "credit-card" },
  { href: "/people", label: "Pessoas", icon: "users", badge: true },
];

export const MOBILE_MORE: NavItem[] = [
  { href: "/wallets", label: "Carteiras", icon: "wallet" },
  { href: "/transactions", label: "Transações", icon: "arrow-left-right" },
  { href: "/categories", label: "Categorias", icon: "tag" },
  { href: "/budgets", label: "Orçamentos", icon: "target" },
  { href: "/goals", label: "Metas", icon: "piggy-bank" },
  { href: "/reports", label: "Relatórios", icon: "chart-pie" },
  { href: "/settings", label: "Configurações", icon: "settings" },
  { href: "/import", label: "Importar", icon: "file-up" },
];

/** All routes flattened, for resolving the topbar title from the pathname. */
const ALL: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM, IMPORT_ITEM];

export function titleForPath(pathname: string): string {
  const item = ALL.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  return item?.label ?? "FinCore";
}

/** Sidebar groups with module-gated items removed (and empty groups dropped). */
export function visibleNavGroups(enabled: readonly ModuleKey[]): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => isHrefEnabled(enabled, i.href)),
  })).filter((g) => g.items.length > 0);
}

/** Mobile "Mais" sheet items with module-gated routes removed. */
export function visibleMobileMore(enabled: readonly ModuleKey[]): NavItem[] {
  return MOBILE_MORE.filter((i) => isHrefEnabled(enabled, i.href));
}

/** Mobile bottom tabs — People is pinned, so when off it falls back to a core route. */
export function visibleMobileTabs(enabled: readonly ModuleKey[]): NavItem[] {
  const fallback: NavItem = { href: "/transactions", label: "Transações", icon: "arrow-left-right" };
  return MOBILE_TABS.map((t) => (isHrefEnabled(enabled, t.href) ? t : fallback));
}
