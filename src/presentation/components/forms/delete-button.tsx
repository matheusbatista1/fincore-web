"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import type { ActionState } from "@/app/_actions/finance";

/** Inline delete with a confirm prompt; calls the bound action with the entity id. */
export function DeleteButton({
  id,
  action,
  confirmMessage,
}: {
  id: string;
  action: (id: string) => Promise<ActionState>;
  confirmMessage: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(confirmMessage)) return;
        startTransition(async () => {
          await action(id);
        });
      }}
      className="grid size-9 place-items-center rounded-sm text-text-lo transition hover:bg-rose-soft hover:text-rose-500 disabled:opacity-50"
      aria-label="Excluir"
    >
      <Trash2 size={17} />
    </button>
  );
}
