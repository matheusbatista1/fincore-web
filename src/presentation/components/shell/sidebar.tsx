"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/_actions/auth";
import { NAV } from "@/presentation/components/shell/nav-items";
import { cn } from "@/presentation/lib/cn";

export function Sidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 flex-col gap-1 border-r border-line bg-bg-0/60 p-4 lg:flex">
      <div className="flex items-center gap-2 px-2 py-3">
        <span className="grid size-8 place-items-center rounded-md bg-gradient-to-br from-purple-400 to-purple-700 font-display text-sm font-bold text-on-purple">
          F
        </span>
        <span className="font-display text-lg font-semibold text-text-hi">
          Fin<span className="text-purple-400">Core</span>
        </span>
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-0.5">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition",
                active
                  ? "bg-purple-soft text-text-hi"
                  : "text-text-mid hover:bg-surface-2 hover:text-text-hi",
              )}
            >
              <item.icon size={18} strokeWidth={1.9} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line pt-3">
        <div className="truncate px-3 pb-2 text-xs text-text-lo" title={userEmail}>
          {userEmail}
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium text-text-mid transition hover:bg-surface-2 hover:text-rose-500"
          >
            <LogOut size={18} strokeWidth={1.9} />
            Sair
          </button>
        </form>
      </div>
    </aside>
  );
}
