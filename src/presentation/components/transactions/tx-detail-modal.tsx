"use client";

import type { CSSProperties } from "react";
import { deleteTransactionAction } from "@/app/_actions/finance";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { Dialog, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { useTxUIStore } from "@/presentation/stores/tx-ui-store";
import { toast } from "@/presentation/stores/ui-store";
import { relativeDateLabel } from "@/shared/formatting/dates";

const SHARE_PA: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
};

/** Detalhe da transação — ported 1:1 from the prototype (extras.jsx TxDetailModal). */
export function TxDetailModal({ today }: { today: string }) {
  const tx = useTxUIStore((s) => s.detail);
  const closeDetail = useTxUIStore((s) => s.closeDetail);
  const openEdit = useTxUIStore((s) => s.openEdit);
  const openDelete = useTxUIStore((s) => s.openDelete);

  async function removeDirect(item: TransactionListItem) {
    const result = await deleteTransactionAction({ id: item.id, scope: "one" });
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    const reverted = item.shares.length > 0 || item.kind === "income";
    toast(`Transação excluída${reverted ? " · saldos revertidos" : ""}`);
    closeDetail();
  }

  return (
    <Dialog open={tx !== null} onOpenChange={(v) => !v && closeDetail()}>
      {tx && (
        <DialogModal title="Detalhe da transação" maxWidth={480}>
          <div className="modal-body">
            <div style={{ textAlign: "center", marginBottom: 22 }}>
              <span
                className="tx-detail-ic"
                style={
                  tx.kind === "transfer"
                    ? { background: "var(--sky-soft)", color: "var(--sky-500)" }
                    : tx.category
                      ? { background: `${tx.category.color}22`, color: tx.category.color }
                      : { background: "var(--mint-soft)", color: "var(--mint-500)" }
                }
              >
                <Icon
                  name={
                    tx.kind === "transfer" ? "arrow-left-right" : (tx.category?.icon ?? "arrow-down-left")
                  }
                  size={26}
                />
              </span>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 20,
                  fontWeight: 600,
                  color: "var(--text-hi)",
                  marginTop: 12,
                }}
              >
                {tx.description || (tx.kind === "transfer" ? "Transferência" : "Lançamento")}
              </div>
              {tx.kind === "transfer" ? (
                <div className="balance-big" style={{ fontSize: 32, marginTop: 4, color: "var(--sky-500)" }}>
                  <Money cents={tx.transferValueCents ?? 0} withSign={false} />
                </div>
              ) : (
                <div
                  className={`balance-big ${tx.amountCents < 0 ? "neg" : "pos"}`}
                  style={{ fontSize: 32, marginTop: 4 }}
                >
                  <Money cents={tx.amountCents} />
                </div>
              )}
            </div>

            {tx.kind === "transfer" ? (
              <div className="summary-box" style={{ margin: 0 }}>
                <div className="sb-row">
                  <span className="k">De</span>
                  <span className="v">{tx.transferFromName ?? "—"}</span>
                </div>
                <div className="sb-row">
                  <span className="k">Para</span>
                  <span className="v">{tx.transferToName ?? "—"}</span>
                </div>
                <div className="sb-row">
                  <span className="k">Data</span>
                  <span className="v">{relativeDateLabel(tx.date, today)}</span>
                </div>
              </div>
            ) : (
              <div className="summary-box" style={{ margin: 0 }}>
                {tx.parcela && (
                  <div className="sb-row">
                    <span className="k">Parcela</span>
                    <span className="v">
                      <span
                        className={`parc-badge${tx.parcela.status === "paga" ? " paga" : tx.parcela.status === "futura" ? " futura" : ""}`}
                      >
                        {tx.parcela.number}/{tx.parcela.total} · {tx.parcela.status}
                      </span>
                    </span>
                  </div>
                )}
                <div className="sb-row">
                  <span className="k">Categoria</span>
                  <span className="v">{tx.category?.name ?? "Receita"}</span>
                </div>
                <div className="sb-row">
                  <span className="k">{tx.cardId ? "Cartão" : tx.accountId ? "Conta" : "Forma"}</span>
                  <span className="v">{tx.sourceLabel ?? (tx.kind === "income" ? "Receita" : "—")}</span>
                </div>
                <div className="sb-row">
                  <span className="k">Data</span>
                  <span className="v">{relativeDateLabel(tx.date, today)}</span>
                </div>
                {tx.note && (
                  <div className="sb-row">
                    <span className="k">Observação</span>
                    <span className="v" style={{ fontWeight: 500, color: "var(--text-mid)" }}>
                      {tx.note}
                    </span>
                  </div>
                )}
              </div>
            )}

            {tx.shares.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="kicker" style={{ marginBottom: 10 }}>
                  Rateio
                </div>
                <div className="summary-box" style={{ margin: 0, padding: "4px 16px" }}>
                  {tx.myShareCents !== null && (
                    <div className="split-row">
                      <div className="sr-name">
                        <span
                          className="pa"
                          style={{
                            ...SHARE_PA,
                            background: "linear-gradient(135deg,var(--purple-400),var(--purple-700))",
                          }}
                        >
                          EU
                        </span>
                        Você
                      </div>
                      <div
                        className="sr-share"
                        style={{ width: "auto", color: "var(--text-hi)", fontWeight: 700 }}
                      >
                        <Money cents={tx.myShareCents} withSign={false} />
                      </div>
                    </div>
                  )}
                  {tx.shares.map((p) => (
                    <div className="split-row" key={p.personId}>
                      <div className="sr-name">
                        <span className="pa" style={{ ...SHARE_PA, background: p.color }}>
                          {p.name[0]}
                        </span>
                        {p.name.split(" ")[0]}
                      </div>
                      <div
                        className="sr-share"
                        style={{ width: "auto", color: "var(--mint-500)", fontWeight: 700 }}
                      >
                        <Money cents={p.shareCents} withSign={false} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="modal-foot" style={{ justifyContent: "space-between" }}>
            <button
              type="button"
              className="btn btn-quiet"
              style={{ color: "var(--rose-500)" }}
              onClick={() => (tx.parcela ? openDelete(tx) : removeDirect(tx))}
            >
              <Icon name="trash-2" size={16} />
              Excluir
            </button>
            <div className="row gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => openEdit(tx)}>
                <Icon name="pencil" size={16} />
                Editar
              </button>
              <button type="button" className="btn btn-primary" onClick={closeDetail}>
                Fechar
              </button>
            </div>
          </div>
        </DialogModal>
      )}
    </Dialog>
  );
}
