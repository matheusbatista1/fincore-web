"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import type { TransactionKind } from "@/domain/entities/transaction";
import { useTxUIStore } from "@/presentation/stores/tx-ui-store";

/** `?novo=<value>` → the kind of transaction the form opens on. */
const KIND_BY_PARAM: Readonly<Record<string, TransactionKind>> = {
  despesa: "expense",
  receita: "income",
  transferencia: "transfer",
};

/** The query parameter that opens the form. */
export const CREATE_PARAM = "novo";

/**
 * Opens "Novo lançamento" when the page is reached with `?novo=despesa|receita|transferencia` —
 * the target of the installed app's shortcuts and of any bookmark. The parameter is consumed: it
 * leaves the URL as soon as it is read, so a reload or the back button does not reopen the form.
 */
export function CreateFromLink() {
  const params = useSearchParams();
  const pathname = usePathname();
  const requested = params.get(CREATE_PARAM);

  useEffect(() => {
    if (requested === null) return;
    const kind = KIND_BY_PARAM[requested];
    if (kind !== undefined) useTxUIStore.getState().openCreate(kind);
    const rest = new URLSearchParams(params);
    rest.delete(CREATE_PARAM);
    const query = rest.toString();
    // The History API, not the router: dropping a parameter must not refetch the page from the
    // server. The router still follows it (useSearchParams updates).
    window.history.replaceState(null, "", query === "" ? pathname : `${pathname}?${query}`);
  }, [requested, params, pathname]);

  return null;
}
