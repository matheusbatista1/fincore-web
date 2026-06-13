"use client";

import { useState } from "react";
import { deleteTransactionAction, stopRecurringAction } from "@/app/_actions/finance";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { Dialog, DialogClose, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { useTxUIStore } from "@/presentation/stores/tx-ui-store";
import { toast } from "@/presentation/stores/ui-store";

type Scope = "one" | "forward" | "all";

/**
 * Scope dialog when deleting an installment (one/forward/all — extras.jsx) or a
 * fixed/recurring transaction (stop repeating vs delete). Non-scoped rows are
 * deleted directly from the detail modal and never open this.
 */
export function DeleteScopeModal({ transactions }: { transactions: TransactionListItem[] }) {
  const tx = useTxUIStore((s) => s.deleting);
  const closeDelete = useTxUIStore((s) => s.closeDelete);
  const closeDetail = useTxUIStore((s) => s.closeDetail);
  const [pending, setPending] = useState(false);

  if (tx && !tx.parcela && !tx.isFixed) return null;
  const parcela = tx?.parcela ?? null;
  const isFixed = Boolean(tx?.isFixed) && !parcela;

  // Live row counts for installments (the prototype counts the rows present, app.jsx:226).
  const groupRows =
    tx?.installmentGroupId != null
      ? transactions.filter((t) => t.installmentGroupId === tx.installmentGroupId)
      : [];
  const count = groupRows.length || (parcela?.total ?? 0);
  const forwardCount = parcela
    ? groupRows.filter((t) => (t.parcela?.number ?? 0) >= parcela.number).length ||
      parcela.total - parcela.number + 1
    : 0;

  function done() {
    closeDelete();
    closeDetail();
  }

  async function choose(scope: Scope) {
    if (!tx || pending) return;
    setPending(true);
    const result = await deleteTransactionAction({ id: tx.id, scope });
    setPending(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    const removed = result.count ?? 1;
    toast(removed === 1 ? "Parcela excluída" : `${removed} parcelas excluídas`);
    done();
  }

  async function stopRepeating() {
    if (!tx || pending) return;
    setPending(true);
    const result = await stopRecurringAction({ id: tx.id });
    setPending(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Esse lançamento não vai mais se repetir.");
    done();
  }

  async function deleteFixed() {
    if (!tx || pending) return;
    setPending(true);
    const result = await deleteTransactionAction({ id: tx.id, scope: "all" });
    setPending(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Lançamento excluído.");
    done();
  }

  return (
    <Dialog open={tx !== null} onOpenChange={(v) => !v && closeDelete()}>
      {tx && parcela && (
        <DialogModal title="Excluir parcela" maxWidth={460}>
          <div className="modal-body">
            <p style={{ margin: "0 0 18px", color: "var(--text-mid)", fontSize: 14, lineHeight: 1.5 }}>
              <b style={{ color: "var(--text-hi)" }}>{tx.description}</b> faz parte de um parcelamento de{" "}
              <b style={{ color: "var(--text-hi)" }}>{parcela.total}x</b> (você está na parcela{" "}
              {parcela.number}). O que deseja excluir?
            </p>
            <button type="button" className="scope-opt" disabled={pending} onClick={() => choose("one")}>
              <span className="so-ic">
                <Icon name="file-minus" size={18} />
              </span>
              <span>
                <b>Apenas esta parcela</b>
                <small>
                  Remove só a parcela {parcela.number}/{parcela.total}
                </small>
              </span>
            </button>
            <button type="button" className="scope-opt" disabled={pending} onClick={() => choose("forward")}>
              <span className="so-ic">
                <Icon name="list-x" size={18} />
              </span>
              <span>
                <b>Esta e as próximas</b>
                <small>
                  Remove da parcela {parcela.number} em diante ({forwardCount}{" "}
                  {forwardCount === 1 ? "lançamento" : "lançamentos"})
                </small>
              </span>
            </button>
            <button
              type="button"
              className="scope-opt danger"
              disabled={pending}
              onClick={() => choose("all")}
            >
              <span className="so-ic">
                <Icon name="trash-2" size={18} />
              </span>
              <span>
                <b>Todas as parcelas</b>
                <small>
                  Remove o parcelamento inteiro ({count} {count === 1 ? "lançamento" : "lançamentos"})
                </small>
              </span>
            </button>
          </div>
          <div className="modal-foot">
            <DialogClose asChild>
              <button type="button" className="btn btn-ghost">
                Cancelar
              </button>
            </DialogClose>
          </div>
        </DialogModal>
      )}

      {tx && isFixed && (
        <DialogModal title="Lançamento fixo" maxWidth={460}>
          <div className="modal-body">
            <p style={{ margin: "0 0 18px", color: "var(--text-mid)", fontSize: 14, lineHeight: 1.5 }}>
              <b style={{ color: "var(--text-hi)" }}>{tx.description}</b> se repete todo mês. O que deseja
              fazer?
            </p>
            <button type="button" className="scope-opt" disabled={pending} onClick={stopRepeating}>
              <span className="so-ic">
                <Icon name="calendar-x" size={18} />
              </span>
              <span>
                <b>Parar de repetir</b>
                <small>Mantém este lançamento e remove as previsões dos próximos meses</small>
              </span>
            </button>
            <button type="button" className="scope-opt danger" disabled={pending} onClick={deleteFixed}>
              <span className="so-ic">
                <Icon name="trash-2" size={18} />
              </span>
              <span>
                <b>Apagar o lançamento</b>
                <small>Remove este lançamento e as previsões</small>
              </span>
            </button>
          </div>
          <div className="modal-foot">
            <DialogClose asChild>
              <button type="button" className="btn btn-ghost">
                Cancelar
              </button>
            </DialogClose>
          </div>
        </DialogModal>
      )}
    </Dialog>
  );
}
