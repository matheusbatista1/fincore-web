import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getProfileCached } from "@/application/loaders";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { PullToRefresh } from "@/presentation/components/gestures/pull-to-refresh";
import { OnboardingHost } from "@/presentation/components/onboarding/onboarding-host";
import { AppHeader } from "@/presentation/components/shell/app-header";
import { MobileNav } from "@/presentation/components/shell/mobile-nav";
import { PageHead } from "@/presentation/components/shell/page-head";
import { PageTransition } from "@/presentation/components/shell/page-transition";
import { Sidebar } from "@/presentation/components/shell/sidebar";
import { TxModalsHost } from "@/presentation/components/transactions/tx-modals-host";
import { ModulesProvider } from "@/presentation/providers/modules-provider";
import { LONG_MONTHS } from "@/shared/formatting/dates";
import { todayInBrazil } from "@/shared/formatting/now";
import { isModuleEnabled } from "@/shared/modules";

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
    getProfileCached(financeRepository, user.id),
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
  const enabledModules = profile.enabledModules;
  const peopleOn = isModuleEnabled(enabledModules, "people");
  // Month-scoped, matching the People page (which lists the month's pendências).
  const pendingCount = peopleOn ? workspace.people.filter((p) => p.monthBalanceCents !== 0).length : 0;

  const today = todayInBrazil();
  const displayName = profile.displayName ?? nameFromEmail(user.email ?? "");
  const firstName = displayName.split(" ")[0] ?? displayName;
  const dayOfMonth = Number(today.split("-")[2] ?? "1");
  const monthIndex = Number(today.split("-")[1] ?? "1") - 1;
  const todayLabel = `${String(dayOfMonth).padStart(2, "0")} de ${(LONG_MONTHS[monthIndex] ?? "").toLowerCase()}`;

  const notif = {
    cards: workspace.cards.map((c) => ({
      id: c.id,
      bank: c.bank,
      dueDay: c.dueDay,
      dueBillCents: c.dueBillCents,
      utilization: c.utilization,
    })),
    debtors: peopleOn
      ? workspace.people
          .filter((p) => p.monthBalanceCents > 0)
          .map((p) => ({
            id: p.id,
            name: p.name,
            relationship: p.relationship,
            balanceCents: p.monthBalanceCents,
          }))
      : [],
    today,
  };
  const searchPeople = peopleOn
    ? workspace.people.map((p) => ({
        id: p.id,
        name: p.name,
        relationship: p.relationship,
        color: p.color,
        balanceCents: p.balanceCents,
      }))
    : [];
  const searchCards = workspace.cards.map((c) => ({
    id: c.id,
    bank: c.bank,
    product: c.product,
    maskedNumber: c.maskedNumber,
  }));
  // Cap the search payload so the RSC response stays lean.
  const searchTransactions = transactions.slice(0, 300);

  return (
    <ModulesProvider value={enabledModules}>
      <div className="shell">
        <Sidebar
          userEmail={user.email ?? ""}
          pendingCount={pendingCount}
          displayName={displayName}
          avatarUrl={profile.avatarUrl}
        />
        <main className="main">
          <AppHeader
            {...formData}
            searchPeople={searchPeople}
            searchCards={searchCards}
            transactions={searchTransactions}
            notif={notif}
          />
          <div className="page">
            <PageHead firstName={firstName} todayLabel={todayLabel} />
            <PullToRefresh>
              <PageTransition>{children}</PageTransition>
            </PullToRefresh>
          </div>
        </main>
        <MobileNav {...formData} pendingCount={pendingCount} />
        <TxModalsHost {...formData} transactions={transactions} today={today} />
        <OnboardingHost onboarded={profile.onboardedAt !== null} enabledModules={enabledModules} />
      </div>
    </ModulesProvider>
  );
}
