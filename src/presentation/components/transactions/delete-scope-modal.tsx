"use client";

import { useState } from "react";
import { deleteTransactionAction } from "@/app/_actions/finance";
import { Dialog, DialogClose, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { useTxUIStore } from "@/presentation/stores/tx-ui-store";
import { toast } from "@/presentation/stores/ui-store";

type Scope = "one" | "forward" | "all";

/** Excluir parcela (escopo one/forward/all) — ported 1:1 from the prototype (extras.jsx DeleteScopeModal). */
export function DeleteScopeModal() {
  const tx = useTxUIStore((s) => s.deleting);
  const closeDelete = useTxUIStore((s) => s.closeDelete);
  const [pending, setPending] = useState(false);

  if (tx && !tx.parcela) return null;
  const parcela = tx?.parcela ?? null;
  const forwardCount = parcela ? parcela.total - parcela.number + 1 : 0;

  async function choose(scope: Scope) {
    if (!tx || pending) return;
    setPending(true);
    const result = await deleteTransactionAction({ id: tx.id, scope });
    setPending(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(scope === "one" ? "Parcela excluída" : "Lançamentos excluídos");
    closeDelete();
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
                  Remove o parcelamento inteiro ({parcela.total}{" "}
                  {parcela.total === 1 ? "lançamento" : "lançamentos"})
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
    </Dialog>
  );
}
