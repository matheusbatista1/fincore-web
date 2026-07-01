"use client";

import { useEffect, useState } from "react";
import { payCardBillAction } from "@/app/_actions/finance";
import { Dialog, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { toast } from "@/presentation/stores/ui-store";

export interface PayFaturaTarget {
  readonly cardId: string;
  readonly competence: string;
  readonly competenceLabel: string;
  readonly amountCents: number;
}

export interface PayFaturaAccount {
  readonly id: string;
  readonly bank: string;
  readonly name: string;
}

/**
 * Pay a whole card fatura: pick the account the money leaves; the paid date defaults to today.
 * The bill total is fixed (computed server-side) — you pay the whole fatura. Debits the chosen
 * account on the paid date; the individual charges stay filed in their bill month.
 */
export function PayFaturaModal({
  target,
  accounts,
  today,
  onClose,
}: {
  target: PayFaturaTarget | null;
  accounts: PayFaturaAccount[];
  today: string;
  onClose: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [saving, setSaving] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when a new fatura opens.
  useEffect(() => {
    if (!target) return;
    setAccountId(accounts[0]?.id ?? "");
    setPaidAt(today);
  }, [target?.cardId, target?.competence]);

  async function submit() {
    if (!target || saving) return;
    if (!accountId) {
      toast("Escolha a conta de onde o dinheiro sai.", "error");
      return;
    }
    setSaving(true);
    const result = await payCardBillAction({
      cardId: target.cardId,
      competenceMonth: target.competence,
      paidAccountId: accountId,
      paidAt,
    });
    setSaving(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Fatura paga.");
    onClose();
  }

  return (
    <Dialog open={target !== null} onOpenChange={(v) => !v && onClose()}>
      {target && (
        <DialogModal title="Pagar fatura" maxWidth={460}>
          <div className="modal-body">
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 13.5, color: "var(--text-lo)" }}>Fatura · {target.competenceLabel}</div>
              <div className="balance-big neg" style={{ fontSize: 28, marginTop: 2 }}>
                <Money cents={-target.amountCents} />
              </div>
            </div>

            <div className="field">
              <label>De qual carteira sai o pagamento?</label>
              {accounts.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--rose-500)" }}>
                  Cadastre uma carteira antes de pagar.
                </div>
              ) : (
                <div className="chip-select">
                  {accounts.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      className={`person-chip${accountId === a.id ? " on" : ""}`}
                      onClick={() => setAccountId(a.id)}
                    >
                      <Icon
                        name="wallet"
                        size={15}
                        style={{ color: accountId === a.id ? "var(--purple-300)" : "var(--text-lo)" }}
                      />
                      {a.bank} · {a.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="field">
              <label>Data do pagamento</label>
              <input
                className="input"
                type="date"
                value={paidAt}
                max={today}
                onChange={(e) => setPaidAt(e.target.value || today)}
              />
            </div>
          </div>

          <div className="modal-foot" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={saving || accounts.length === 0}
            >
              <Icon name="check" size={16} />
              {saving ? "Pagando…" : "Confirmar pagamento"}
            </button>
          </div>
        </DialogModal>
      )}
    </Dialog>
  );
}
