import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { AppHeader } from "@/presentation/components/shell/app-header";
import { MobileNav } from "@/presentation/components/shell/mobile-nav";
import { PageHead } from "@/presentation/components/shell/page-head";
import { PageTransition } from "@/presentation/components/shell/page-transition";
import { Sidebar } from "@/presentation/components/shell/sidebar";
import { TxModalsHost } from "@/presentation/components/transactions/tx-modals-host";
import { LONG_MONTHS, monthLabel } from "@/shared/formatting/dates";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";

/** Derive a display name from the account email when no profile name is set. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(" ") || email;
}

/** Authenticated app shell — 1:1 with the prototype: .shell grid (sidebar + main) + mobile nav. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Cached (React.cache) — shares the single workspace load with the page below.
  const [workspace, transactions, profile] = await Promise.all([
    getWorkspaceView(financeRepository, user.id),
    getTransactions(financeRepository, user.id),
    financeRepository.getProfile(user.id),
  ]);
  const formData = {
    accounts: workspace.accounts.map((a) => ({
      id: a.id,
      bank: a.bank,
      name: a.name,
      themeKey: a.themeKey,
      balanceCents: a.balanceCents,
    })),
    cards: workspace.cards.map((c) => ({ id: c.id, bank: c.bank })),
    people: workspace.people.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    categories: workspace.categories.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      icon: c.icon,
    })),
  };
  const pendingCount = workspace.people.filter((p) => p.balanceCents !== 0).length;

  const today = todayInBrazil();
  const displayName = profile.displayName ?? nameFromEmail(user.email ?? "");
  const firstName = displayName.split(" ")[0] ?? displayName;
  const dayOfMonth = Number(today.split("-")[2] ?? "1");
  const monthIndex = Number(today.split("-")[1] ?? "1") - 1;
  const todayLabel = `${String(dayOfMonth).padStart(2, "0")} de ${(LONG_MONTHS[monthIndex] ?? "").toLowerCase()}`;
  const monthChip = monthLabel(currentMonthInBrazil(), { long: true });

  const notif = {
    cards: workspace.cards.map((c) => ({
      id: c.id,
      bank: c.bank,
      dueDay: c.dueDay,
      billCents: c.billCents,
      utilization: c.utilization,
    })),
    debtors: workspace.people
      .filter((p) => p.balanceCents > 0)
      .map((p) => ({
        id: p.id,
        name: p.name,
        relationship: p.relationship,
        balanceCents: p.balanceCents,
      })),
    today,
  };
  const searchPeople = workspace.people.map((p) => ({
    id: p.id,
    name: p.name,
    relationship: p.relationship,
    color: p.color,
    balanceCents: p.balanceCents,
  }));
  const searchCards = workspace.cards.map((c) => ({
    id: c.id,
    bank: c.bank,
    product: c.product,
    maskedNumber: c.maskedNumber,
  }));
  // Cap the search payload so the RSC response stays lean.
  const searchTransactions = transactions.slice(0, 300);

  return (
    <div className="shell">
      <Sidebar userEmail={user.email ?? ""} pendingCount={pendingCount} displayName={displayName} />
      <main className="main">
        <AppHeader
          {...formData}
          searchPeople={searchPeople}
          searchCards={searchCards}
          transactions={searchTransactions}
          notif={notif}
        />
        <div className="page">
          <PageHead firstName={firstName} todayLabel={todayLabel} monthChip={monthChip} />
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
      <MobileNav {...formData} pendingCount={pendingCount} />
      <TxModalsHost {...formData} today={today} />
    </div>
  );
}
