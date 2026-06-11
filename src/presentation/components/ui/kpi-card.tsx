import type { ReactNode } from "react";
import { cn } from "@/presentation/lib/cn";

export type KpiTone = "purple" | "mint" | "rose" | "sky" | "amber" | "neutral";

const TONE: Record<KpiTone, string> = {
  purple: "bg-purple-soft text-purple-300",
  mint: "bg-mint-soft text-mint-500",
  rose: "bg-rose-soft text-rose-500",
  sky: "bg-sky-soft text-sky-500",
  amber: "bg-amber-soft text-amber-500",
  neutral: "bg-surface-3 text-text-lo",
};

/** A labelled metric tile with a toned icon (the prototype's KpiCard). */
export function KpiCard({
  icon,
  label,
  tone = "neutral",
  sub,
  children,
}: {
  icon?: ReactNode;
  label: string;
  tone?: KpiTone;
  sub?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-5 shadow-2">
      <div className="flex items-center gap-3">
        {icon && (
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-md", TONE[tone])}>{icon}</span>
        )}
        <span className="text-xs font-semibold uppercase tracking-widest text-text-faint">{label}</span>
      </div>
      <div className="tnum mt-3 font-display text-2xl font-semibold text-text-hi">{children}</div>
      {sub && <p className="mt-1 text-sm text-text-lo">{sub}</p>}
    </div>
  );
}
