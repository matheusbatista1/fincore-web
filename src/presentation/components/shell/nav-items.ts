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
  { href: "/budgets", label: "Orçamentos", icon: "target" },
  { href: "/goals", label: "Metas", icon: "piggy-bank" },
  { href: "/reports", label: "Relatórios", icon: "chart-pie" },
  { href: "/settings", label: "Configurações", icon: "settings" },
];

/** All routes flattened, for resolving the topbar title from the pathname. */
const ALL: NavItem[] = [
  ...NAV_GROUPS.flatMap((g) => g.items),
  SETTINGS_ITEM,
  { href: "/import", label: "Importar extrato", icon: "file-down" },
];

export function titleForPath(pathname: string): string {
  const item = ALL.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  return item?.label ?? "FinCore";
}
