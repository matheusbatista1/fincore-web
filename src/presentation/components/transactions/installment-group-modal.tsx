"use client";

import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { Dialog, DialogClose, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { useTxUIStore } from "@/presentation/stores/tx-ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { relativeDateLabel } from "@/shared/formatting/dates";

/**
 * Lists every parcela of an installment group (opened from a collapsed row in the
 * transactions list / recent activity). Clicking a parcela opens its detail.
 */
export function InstallmentGroupModal({
  transactions,
  today,
}: {
  /** Full transaction list — the group's parcelas are filtered out of it. */
  transactions: TransactionListItem[];
  today: string;
}) {
  const groupId = useTxUIStore((s) => s.installmentGroupId);
  const close = useTxUIStore((s) => s.closeInstallmentGroup);
  const openDetail = useTxUIStore((s) => s.openDetail);

  const parcelas = groupId
    ? transactions
        .filter((t) => t.installmentGroupId === groupId)
        .sort((a, b) => (a.parcela?.number ?? 0) - (b.parcela?.number ?? 0))
    : [];
  const first = parcelas[0];
  const total = first?.parcela?.total ?? parcelas.length;
  const sumCents = parcelas.reduce((s, p) => s + Math.abs(p.amountCents), 0);

  return (
    <Dialog open={groupId !== null} onOpenChange={(v) => !v && close()}>
      {groupId && first && (
        <DialogModal title={`Parcelamento · ${total}x`} maxWidth={480}>
          <div className="modal-body">
            <p style={{ margin: "0 0 16px", color: "var(--text-mid)", fontSize: 14, lineHeight: 1.5 }}>
              <b style={{ color: "var(--text-hi)" }}>{first.description || "Lançamento"}</b> em {total}{" "}
              parcelas · total {formatBRLAbsolute(sumCents)}
            </p>
            {parcelas.map((p) => {
              const status = p.parcela?.status;
              const cat = p.category;
              return (
                <button
                  type="button"
                  key={p.id}
                  className="lrow"
                  style={{ width: "100%", textAlign: "left", background: "none", cursor: "pointer" }}
                  onClick={() => openDetail(p)}
                >
                  <span
                    className="l-ic"
                    style={cat ? { background: `${cat.color}22`, color: cat.color } : {}}
                  >
                    <Icon name={cat ? cat.icon : "layers"} size={18} />
                  </span>
                  <div className="l-main">
                    <div className="l-title">
                      Parcela {p.parcela?.number}/{p.parcela?.total}
                      <span
                        className={`parc-badge${status === "paga" ? " paga" : status === "futura" ? " futura" : ""}`}
                        style={{ marginLeft: 8 }}
                      >
                        {status}
                      </span>
                    </div>
                    <div className="l-sub">{relativeDateLabel(p.date, today)}</div>
                  </div>
                  <div className="l-amt neg">
                    <Money cents={p.amountCents} />
                  </div>
                </button>
              );
            })}
          </div>
          <div className="modal-foot">
            <DialogClose asChild>
              <button type="button" className="btn btn-ghost">
                Fechar
              </button>
            </DialogClose>
          </div>
        </DialogModal>
      )}
    </Dialog>
  );
}
