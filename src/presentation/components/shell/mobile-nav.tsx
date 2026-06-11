"use client";

import { LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOutAction } from "@/app/_actions/auth";
import { MOBILE_PRIMARY, NAV } from "@/presentation/components/shell/nav-items";
import { Dialog, DialogContent, DialogTrigger } from "@/presentation/components/ui/dialog";
import { cn } from "@/presentation/lib/cn";

const isActive = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);

export function MobileNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = MOBILE_PRIMARY.map((href) => NAV.find((item) => item.href === href)).filter(
    (item): item is (typeof NAV)[number] => item !== undefined,
  );
  const moreActive = NAV.some((item) => !MOBILE_PRIMARY.includes(item.href) && isActive(pathname, item.href));

  const tabClass = (active: boolean) =>
    cn(
      "flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium transition",
      active ? "text-purple-300" : "text-text-lo",
    );

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-bg-0/90 backdrop-blur-lg lg:hidden">
      {primary.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link key={item.href} href={item.href} className={tabClass(active)}>
            <item.icon size={20} strokeWidth={active ? 2.2 : 1.9} />
            {item.label}
          </Link>
        );
      })}

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogTrigger asChild>
          <button type="button" className={tabClass(moreActive)}>
            <Menu size={20} strokeWidth={moreActive ? 2.2 : 1.9} />
            Mais
          </button>
        </DialogTrigger>
        <DialogContent
          title="Menu"
          className="top-auto bottom-0 left-1/2 max-h-[80dvh] -translate-y-0 rounded-b-none"
        >
          <div className="grid grid-cols-2 gap-2">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-md border p-3 text-sm font-medium transition",
                    active
                      ? "border-purple-400 bg-purple-soft text-text-hi"
                      : "border-line bg-surface-2 text-text-mid hover:text-text-hi",
                  )}
                >
                  <item.icon size={18} strokeWidth={1.9} />
                  {item.label}
                </Link>
              );
            })}
          </div>
          <form action={signOutAction} className="mt-3">
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-md border border-line bg-surface-2 p-3 text-sm font-medium text-text-mid transition hover:text-rose-500"
            >
              <LogOut size={18} strokeWidth={1.9} />
              Sair
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
