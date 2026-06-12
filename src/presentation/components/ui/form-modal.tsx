"use client";

import type { ReactNode } from "react";
import { DialogClose, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";

/**
 * CRUD form modal — ported 1:1 from the prototype (forms.jsx FormShell).
 * Renders inside an open Radix Dialog: `.modal-body` with the fields and a
 * `.modal-foot` with Excluir (left, when editing) + Cancelar/submit (right).
 */
export function FormModal({
  title,
  submitLabel,
  canSubmit,
  submitting = false,
  onSubmit,
  onDelete,
  maxWidth,
  children,
}: {
  title: string;
  submitLabel: string;
  canSubmit: boolean;
  submitting?: boolean;
  onSubmit: () => void;
  /** Shown only when provided (editing) — deletes immediately, like the prototype. */
  onDelete?: () => void;
  maxWidth?: number;
  children: ReactNode;
}) {
  const enabled = canSubmit && !submitting;
  return (
    <DialogModal title={title} maxWidth={maxWidth}>
      <div className="modal-body">{children}</div>
      <div className="modal-foot" style={{ justifyContent: onDelete ? "space-between" : "flex-end" }}>
        {onDelete && (
          <button
            type="button"
            className="btn btn-quiet"
            style={{ color: "var(--rose-500)" }}
            onClick={onDelete}
          >
            <Icon name="trash-2" size={16} />
            Excluir
          </button>
        )}
        <div className="row gap-2">
          <DialogClose asChild>
            <button type="button" className="btn btn-ghost">
              Cancelar
            </button>
          </DialogClose>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!enabled}
            style={{ opacity: enabled ? 1 : 0.45, pointerEvents: enabled ? "auto" : "none" }}
            onClick={onSubmit}
          >
            <Icon name="check" size={17} />
            {submitting ? "Salvando…" : submitLabel}
          </button>
        </div>
      </div>
    </DialogModal>
  );
}
