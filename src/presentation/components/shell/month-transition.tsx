"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useRef, useTransition } from "react";
import { Icon } from "@/presentation/components/ui/icon";
import { useSwipeX } from "@/presentation/lib/use-swipe-x";

type Direction = "prev" | "next";

interface MonthNav {
  /** Navigate to `href`; `dir` drives the slide direction of the incoming month. */
  readonly go: (href: string, dir: Direction) => void;
  /** True while the next month is being fetched (server round-trip in flight). */
  readonly isPending: boolean;
  /** Last requested direction, for the entrance animation. */
  readonly dir: Direction;
}

const MonthNavContext = createContext<MonthNav | null>(null);

/** Access the month-navigation controls. Must be used inside <MonthTransition>. */
export function useMonthNav(): MonthNav {
  const ctx = useContext(MonthNavContext);
  if (!ctx) throw new Error("useMonthNav must be used within <MonthTransition>");
  return ctx;
}

/**
 * Wraps a month-navigable screen (dashboard / monthly / wallets). Month changes
 * go through `useTransition` + `router.push` so we get an `isPending` flag for
 * instant feedback during the ~1s server round-trip, and swiping left/right
 * navigates too. Render the nav chevrons with <MonthNavButton> and wrap the
 * month-dependent content in <MonthFade> so it dims while pending and slides in
 * when the new month arrives.
 */
export function MonthTransition({
  prevHref,
  nextHref,
  children,
}: {
  prevHref: string;
  nextHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const dirRef = useRef<Direction>("next");

  const go = (href: string, dir: Direction): void => {
    dirRef.current = dir;
    startTransition(() => router.push(href));
  };

  const swipe = useSwipeX(
    () => go(nextHref, "next"),
    () => go(prevHref, "prev"),
  );

  return (
    <MonthNavContext.Provider value={{ go, isPending, dir: dirRef.current }}>
      <div {...swipe}>{children}</div>
    </MonthNavContext.Provider>
  );
}

/** The month-dependent content: dims while navigating, slides in on the new month. */
export function MonthFade({ month, children }: { month: string; children: ReactNode }) {
  const { isPending, dir } = useMonthNav();
  return (
    <div className={isPending ? "month-fade is-pending" : "month-fade"} key={month} data-dir={dir}>
      {children}
    </div>
  );
}

/** A chevron nav button that triggers the pending transition (replaces a plain Link). */
export function MonthNavButton({
  href,
  dir,
  title,
  children,
}: {
  href: string;
  dir: Direction;
  title: string;
  children: ReactNode;
}) {
  const { go } = useMonthNav();
  return (
    <button type="button" className="icon-btn" title={title} aria-label={title} onClick={() => go(href, dir)}>
      {children}
    </button>
  );
}

/** A small inline spinner shown on the month label while a transition is pending. */
export function MonthNavPending() {
  const { isPending } = useMonthNav();
  if (!isPending) return null;
  return <Icon name="loader-circle" size={15} className="spin" />;
}
