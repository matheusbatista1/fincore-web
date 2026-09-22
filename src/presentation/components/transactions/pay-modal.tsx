"use client";

import { useEffect, useState } from "react";
import { payTransactionAction } from "@/app/_actions/finance";
import type { TxFormAccount } from "@/presentation/components/forms/new-transaction-dialog";
import { Dialog, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { useTxUIStore } from "@/presentation/stores/tx-ui-store";
import { toast } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { relativeDateLabel } from "@/shared/formatting/dates";

/**
 * Pay a deferred obligation (boleto/loan/financing): choose the account the money leaves, the paid
 * date (defaults to today) and a custom final amount (any obligation can be settled for a different
 * value — an early payoff with a discount, a boleto paid with interest, etc.). The original due date
 * and amount are kept intact for history; the payment debits the chosen account on the paid date.
 */
export function PayModal({ accounts, today }: { accounts: TxFormAccount[]; today: string }) {
  const tx = useTxUIStore((s) => s.paying);
  const closePay = useTxUIStore((s) => s.closePay);

  const [accountId, setAccountId] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [cents, setCents] = useState(0);
  const [saving, setSaving] = useState(false);

  const originalCents = tx ? Math.abs(tx.amountCents) : 0;
  // Every payable obligation the modal opens for can take a custom paid amount.
  const editableAmount = tx !== null;

  // Reset the form each time a different obligation opens the modal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the target row changes.
  useEffect(() => {
    if (!tx) return;
    // Offer the account this bill actually comes out of: the one that settled its last occurrence,
    // then its linked bank, then whatever exists. Falling straight to the first account silently
    // moved a monthly bill to another wallet whenever it was re-paid.
    const known = [tx.usualPayAccountId, tx.linkedAccountId, tx.accountId];
    const preferred = known.find((id) => id != null && accounts.some((a) => a.id === id));
    setAccountId(preferred ?? accounts[0]?.id ?? "");
    setPaidAt(today);
    setCents(Math.abs(tx.amountCents));
  }, [tx?.id]);

  async function submit() {
    if (!tx || saving) return;
    if (!accountId) {
      toast("Escolha a conta de onde o dinheiro sai.", "error");
      return;
    }
    if (cents <= 0) {
      toast("Informe um valor maior que zero.", "error");
      return;
    }
    setSaving(true);
    const result = await payTransactionAction({
      id: tx.id,
      paidAccountId: accountId,
      paidAt,
      ...(editableAmount ? { paidAmountCents: cents } : {}),
    });
    setSaving(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Pagamento registrado.");
    closePay();
  }

  return (
    <Dialog open={tx !== null} onOpenChange={(v) => !v && closePay()}>
      {tx && (
        <DialogModal title="Pagar lançamento" maxWidth={460}>
          <div className="modal-body">
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 13.5, color: "var(--text-lo)" }}>{tx.description || "Lançamento"}</div>
              <div className="balance-big neg" style={{ fontSize: 28, marginTop: 2 }}>
                <Money cents={-originalCents} />
              </div>
            </div>

            {/* Tracking: the original obligation is preserved unchanged. */}
            <div className="summary-box" style={{ margin: 0, marginBottom: 16 }}>
              <div className="sb-row">
                <span className="k">Vencimento</span>
                <span className="v">{relativeDateLabel(tx.date, today)}</span>
              </div>
              <div className="sb-row">
                <span className="k">Valor original</span>
                <span className="v">
                  <Money cents={originalCents} withSign={false} />
                </span>
              </div>
              {tx.sourceLabel && (
                <div className="sb-row">
                  <span className="k">Origem</span>
                  <span className="v">{tx.sourceLabel}</span>
                </div>
              )}
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

            {editableAmount && (
              <div className="field">
                <label>
                  Valor pago{" "}
                  <span style={{ color: "var(--text-lo)", fontWeight: 400 }}>· quitação com desconto</span>
                </label>
                <input
                  className="input"
                  value={formatBRLAbsolute(cents)}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    setCents(digits ? Number.parseInt(digits, 10) : 0);
                  }}
                  inputMode="numeric"
                  aria-label="Valor pago"
                />
                {cents !== originalCents && (
                  <div style={{ fontSize: 12.5, color: "var(--text-lo)", marginTop: 8 }}>
                    <Icon name="info" size={13} style={{ color: "var(--purple-300)" }} /> Original de{" "}
                    {formatBRLAbsolute(originalCents)} mantido para histórico.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="modal-foot" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost" onClick={closePay} disabled={saving}>
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
