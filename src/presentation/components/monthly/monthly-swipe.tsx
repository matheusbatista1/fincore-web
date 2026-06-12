"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useSwipeX } from "@/presentation/lib/use-swipe-x";

/** Swiping left/right on the monthly statement navigates months (prototype useSwipeX). */
export function MonthlySwipe({
  prevHref,
  nextHref,
  children,
}: {
  prevHref: string;
  nextHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const swipe = useSwipeX(
    () => router.push(nextHref),
    () => router.push(prevHref),
  );
  return <div {...swipe}>{children}</div>;
}
