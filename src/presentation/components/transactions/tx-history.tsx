"use client";

import { useState } from "react";
import { getTransactionHistoryAction, type TransactionHistoryState } from "@/app/_actions/finance";
import type { TransactionHistoryEntry } from "@/application/use-cases/transaction-history";
import { Icon } from "@/presentation/components/ui/icon";
import {
  type HistoryNames,
  historyFieldLabel,
  historyTitle,
  historyValueText,
  historyWhen,
} from "@/presentation/lib/history-text";

/** Reads one transaction's history from the server. */
export type LoadTransactionHistory = (input: { id: string }) => Promise<TransactionHistoryState>;

type State =
  | { readonly status: "closed" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly entries: readonly TransactionHistoryEntry[] }
  | { readonly status: "error"; readonly message: string };

/**
 * "Histórico de alterações" inside a transaction's detail: closed until asked for (most visits to a
 * detail never need it), then every time the row was created, changed or paid, the most recent
 * first, with each field's value before and after.
 */
export function TxHistory({
  transactionId,
  names,
  load = getTransactionHistoryAction,
}: {
  transactionId: string;
  names: HistoryNames;
  load?: LoadTransactionHistory;
}) {
  const [state, setState] = useState<State>({ status: "closed" });

  async function open() {
    setState({ status: "loading" });
    try {
      const result = await load({ id: transactionId });
      setState(
        result.ok ? { status: "ready", entries: result.entries } : { status: "error", message: result.error },
      );
    } catch {
      // The request itself failed (offline, the server away): say so instead of spinning for ever.
      setState({ status: "error", message: "Não foi possível carregar o histórico." });
    }
  }

  if (state.status === "closed") {
    return (
      <button type="button" className="btn btn-quiet btn-sm" style={{ marginTop: 4 }} onClick={open}>
        <Icon name="history" size={14} />
        Ver histórico de alterações
      </button>
    );
  }

  return (
    <section className="tx-hist" aria-label="Histórico de alterações" aria-busy={state.status === "loading"}>
      <div className="tx-hist-head">
        <span className="kicker">Histórico de alterações</span>
        <button type="button" className="tx-hist-close" onClick={() => setState({ status: "closed" })}>
          Ocultar
        </button>
      </div>
      {state.status === "loading" && <p className="tx-hist-note">Carregando…</p>}
      {state.status === "error" && (
        <p className="tx-hist-note" role="alert">
          {state.message}{" "}
          <button type="button" className="tx-hist-close" onClick={open}>
            Tentar de novo
          </button>
        </p>
      )}
      {state.status === "ready" && state.entries.length === 0 && (
        <p className="tx-hist-note">
          Nada registrado ainda. O histórico guarda o que acontecer com este lançamento daqui para frente.
        </p>
      )}
      {state.status === "ready" && state.entries.length > 0 && (
        <ol className="tx-hist-list">
          {state.entries.map((entry) => (
            <li key={entry.id} className="tx-hist-entry">
              <div className="tx-hist-top">
                <span className="tx-hist-title">{historyTitle(entry)}</span>
                <time className="tx-hist-when" dateTime={entry.at}>
                  {historyWhen(entry.at)}
                </time>
              </div>
              {entry.changes.length > 0 && (
                <dl className="tx-hist-changes">
                  {entry.changes.map((change) => (
                    <div key={change.field} className="tx-hist-change">
                      <dt>{historyFieldLabel(change.field)}</dt>
                      <dd>
                        <span className="was">{historyValueText(change.field, change.before, names)}</span>
                        <span className="arrow" aria-hidden="true">
                          <Icon name="arrow-right" size={12} />
                        </span>
                        <span className="sr-only"> passou a ser </span>
                        <span className="now">{historyValueText(change.field, change.after, names)}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
