import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { Sidebar } from "@/presentation/components/shell/sidebar";

/** Authenticated app shell: sidebar + main content. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="relative z-10 flex min-h-dvh">
      <Sidebar userEmail={user.email ?? ""} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">{children}</main>
    </div>
  );
}
