"use client";

import type { ReactNode } from "react";
import { cn } from "@/presentation/lib/cn";

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
}

/** Pill segmented control (the prototype's `.seg` / view toggle). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex gap-1 rounded-pill bg-surface-2 p-1", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm font-semibold transition",
            value === option.value ? "bg-surface-3 text-text-hi shadow-1" : "text-text-lo hover:text-text-hi",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
