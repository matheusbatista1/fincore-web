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

/** Authenticated app shell: sidebar (desktop) + topbar + bottom nav (mobile) + main content. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Cached (React.cache) — shares the single workspace load with the page below.
  const workspace = await getWorkspaceView(financeRepository, user.id);
  const formData = {
    accounts: workspace.accounts.map((a) => ({ id: a.id, bank: a.bank, name: a.name })),
    cards: workspace.cards.map((c) => ({ id: c.id, bank: c.bank })),
    people: workspace.people.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    categories: workspace.categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
  };

  return (
    <div className="relative z-10 flex min-h-dvh">
      <Sidebar userEmail={user.email ?? ""} />
      <div className="flex min-h-dvh flex-1 flex-col">
        <AppHeader {...formData} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 pt-6 pb-24 sm:px-8 lg:pb-10">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      <MobileNav />
      <Toaster />
    </div>
  );
}
