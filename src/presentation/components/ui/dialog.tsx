"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/presentation/lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * Prototype-styled modal (`.overlay` > `.modal` with `.modal-head`), keeping
 * Radix for focus-trap, Escape and scroll-lock. The full-screen Close button is
 * the dim-area scrim (click-outside to close); `children` provides the
 * `.modal-body` and `.modal-foot`. Focus is left to the body's own autoFocus.
 */
export function DialogModal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Content
        className="overlay"
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogPrimitive.Close
          aria-label="Fechar"
          tabIndex={-1}
          style={{ position: "absolute", inset: 0, background: "transparent", border: 0, cursor: "default" }}
        />
        <div className="modal" style={{ position: "relative" }}>
          <div className="modal-head">
            <DialogPrimitive.Title asChild>
              <h3>{title}</h3>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="icon-btn btn-sm"
              style={{ width: 36, height: 36 }}
              aria-label="Fechar"
            >
              <X size={18} />
            </DialogPrimitive.Close>
          </div>
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogContent({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-surface-1 p-6 shadow-3",
          className,
        )}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="font-display text-xl font-semibold text-text-hi">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-1 text-sm text-text-mid">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="grid size-9 shrink-0 place-items-center rounded-sm text-text-lo transition hover:bg-surface-2 hover:text-text-hi"
            aria-label="Fechar"
          >
            <X size={18} />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
