"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Replays the route-enter cascade on each navigation by keying on the pathname. */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="route-enter">
      {children}
    </div>
  );
}
