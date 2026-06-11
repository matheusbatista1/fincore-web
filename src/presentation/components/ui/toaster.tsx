"use client";

import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/presentation/lib/cn";
import { type Toast, useUIStore } from "@/presentation/stores/ui-store";

const TONE = {
  success: { Icon: CheckCircle2, color: "text-mint-500" },
  error: { Icon: AlertTriangle, color: "text-rose-500" },
  info: { Icon: Info, color: "text-sky-500" },
} as const;

function ToastItem({ toast }: { toast: Toast }) {
  useEffect(() => {
    const timer = setTimeout(() => useUIStore.getState().dismissToast(toast.id), 3200);
    return () => clearTimeout(timer);
  }, [toast.id]);

  const { Icon, color } = TONE[toast.tone];
  return (
    <output className="rise pointer-events-auto flex items-center gap-2.5 rounded-pill border border-line-2 bg-surface-2 px-5 py-3 text-sm font-medium text-text-hi shadow-2">
      <Icon size={18} className={cn("shrink-0", color)} />
      {toast.message}
    </output>
  );
}

/** Fixed, bottom-centered toast stack. Mount once (in the app shell). */
export function Toaster() {
  const toasts = useUIStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
