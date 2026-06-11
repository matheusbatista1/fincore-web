import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { AppHeader } from "@/presentation/components/shell/app-header";
import { MobileNav } from "@/presentation/components/shell/mobile-nav";
import { PageTransition } from "@/presentation/components/shell/page-transition";
import { Sidebar } from "@/presentation/components/shell/sidebar";
import { Toaster } from "@/presentation/components/ui/toaster";

/** Authenticated app shell — 1:1 with the prototype: .shell grid (sidebar + main) + mobile nav. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Cached (React.cache) — shares the single workspace load with the page below.
  const workspace = await getWorkspaceView(financeRepository, user.id);
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

  return (
    <div className="shell">
      <Sidebar userEmail={user.email ?? ""} pendingCount={pendingCount} />
      <main className="main">
        <AppHeader {...formData} />
        <div className="page">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
      <MobileNav {...formData} pendingCount={pendingCount} />
      <Toaster />
    </div>
  );
}
