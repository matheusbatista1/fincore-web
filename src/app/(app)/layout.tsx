import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { MobileNav } from "@/presentation/components/shell/mobile-nav";
import { Sidebar } from "@/presentation/components/shell/sidebar";

/** Authenticated app shell: sidebar (desktop) + bottom nav (mobile) + main content. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="relative z-10 flex min-h-dvh">
      <Sidebar userEmail={user.email ?? ""} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pt-8 pb-24 sm:px-8 lg:pb-8">{children}</main>
      <MobileNav />
    </div>
  );
}
