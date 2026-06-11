import {
  ArrowLeftRight,
  CalendarRange,
  ChartPie,
  CreditCard,
  LayoutDashboard,
  type LucideIcon,
  Settings,
  Target,
  Users,
  Wallet,
} from "lucide-react";

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

/** The app's primary destinations, shared by the desktop sidebar and the mobile nav. */
export const NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
  { href: "/wallets", label: "Carteiras", icon: Wallet },
  { href: "/cards", label: "Cartões", icon: CreditCard },
  { href: "/transactions", label: "Lançamentos", icon: ArrowLeftRight },
  { href: "/monthly", label: "Visão mensal", icon: CalendarRange },
  { href: "/people", label: "Pessoas", icon: Users },
  { href: "/budgets", label: "Orçamentos", icon: Target },
  { href: "/reports", label: "Relatórios", icon: ChartPie },
  { href: "/settings", label: "Configurações", icon: Settings },
];

/** The four destinations pinned to the mobile bottom bar (the rest live under "Mais"). */
export const MOBILE_PRIMARY: readonly string[] = ["/dashboard", "/transactions", "/monthly", "/people"];
