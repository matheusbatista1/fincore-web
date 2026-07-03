"use client";

import { useEffect, useState } from "react";
import { receiveIncomeAction } from "@/app/_actions/finance";
import type { TxFormAccount } from "@/presentation/components/forms/new-transaction-dialog";
import { Dialog, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { useTxUIStore } from "@/presentation/stores/tx-ui-store";
import { toast } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { relativeDateLabel } from "@/shared/formatting/dates";

/**
 * Receive a normal income (the income-side mirror of the Pay modal): choose the account the money
 * landed in, the receipt date (defaults to today) and a custom received amount (a person may pay you
 * back a different value than expected). The original booked date and amount are kept intact for
 * history; the receipt credits the chosen account on the receipt date. When the income is a payment
 * from a person, receiving abates that person's debt by the amount received.
 */
export function ReceiveModal({ accounts, today }: { accounts: TxFormAccount[]; today: string }) {
  const tx = useTxUIStore((s) => s.receiving);
  const closeReceive = useTxUIStore((s) => s.closeReceive);

  const [accountId, setAccountId] = useState("");
  const [receivedAt, setReceivedAt] = useState(today);
  const [cents, setCents] = useState(0);
  const [saving, setSaving] = useState(false);

  const originalCents = tx ? tx.amountCents : 0;
  const fromPerson = tx?.fromPersonName ?? null;

  // Reset the form each time a different income opens the modal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the target row changes.
  useEffect(() => {
    if (!tx) return;
    const preferred =
      tx.accountId && accounts.some((a) => a.id === tx.accountId) ? tx.accountId : (accounts[0]?.id ?? "");
    setAccountId(preferred);
    setReceivedAt(today);
    setCents(tx.amountCents);
  }, [tx?.id]);

  async function submit() {
    if (!tx || saving) return;
    if (!accountId) {
      toast("Escolha a conta onde o dinheiro entrou.", "error");
      return;
    }
    if (cents <= 0) {
      toast("Informe um valor maior que zero.", "error");
      return;
    }
    setSaving(true);
    const result = await receiveIncomeAction({
      id: tx.id,
      receivedAccountId: accountId,
      receivedAt,
      receivedAmountCents: cents,
    });
    setSaving(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Recebimento registrado.");
    closeReceive();
  }

  return (
    <Dialog open={tx !== null} onOpenChange={(v) => !v && closeReceive()}>
      {tx && (
        <DialogModal title="Receber lançamento" maxWidth={460}>
          <div className="modal-body">
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 13.5, color: "var(--text-lo)" }}>{tx.description || "Receita"}</div>
              <div className="balance-big pos" style={{ fontSize: 28, marginTop: 2 }}>
                <Money cents={originalCents} />
              </div>
            </div>

            {/* Tracking: the original income is preserved unchanged. */}
            <div className="summary-box" style={{ margin: 0, marginBottom: 16 }}>
              <div className="sb-row">
                <span className="k">Previsto para</span>
                <span className="v">{relativeDateLabel(tx.date, today)}</span>
              </div>
              <div className="sb-row">
                <span className="k">Valor previsto</span>
                <span className="v">
                  <Money cents={originalCents} withSign={false} />
                </span>
              </div>
              {fromPerson && (
                <div className="sb-row">
                  <span className="k">De</span>
                  <span className="v">{fromPerson}</span>
                </div>
              )}
            </div>

            <div className="field">
              <label>Em qual carteira o dinheiro entrou?</label>
              {accounts.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--rose-500)" }}>
                  Cadastre uma carteira antes de receber.
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
              <label>Data do recebimento</label>
              <input
                className="input"
                type="date"
                value={receivedAt}
                max={today}
                onChange={(e) => setReceivedAt(e.target.value || today)}
              />
            </div>

            <div className="field">
              <label>
                Valor recebido{" "}
                <span style={{ color: "var(--text-lo)", fontWeight: 400 }}>
                  · recebimento parcial ou diferente
                </span>
              </label>
              <input
                className="input"
                value={formatBRLAbsolute(cents)}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "");
                  setCents(digits ? Number.parseInt(digits, 10) : 0);
                }}
                inputMode="numeric"
                aria-label="Valor recebido"
              />
              {cents !== originalCents && (
                <div style={{ fontSize: 12.5, color: "var(--text-lo)", marginTop: 8 }}>
                  <Icon name="info" size={13} style={{ color: "var(--purple-300)" }} /> Previsto de{" "}
                  {formatBRLAbsolute(originalCents)} mantido para histórico.
                </div>
              )}
              {fromPerson && (
                <div style={{ fontSize: 12.5, color: "var(--text-lo)", marginTop: 8 }}>
                  <Icon name="users" size={13} style={{ color: "var(--mint-500)" }} /> Atualiza o que{" "}
                  {fromPerson} te deve pelo valor recebido.
                </div>
              )}
            </div>
          </div>

          <div className="modal-foot" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost" onClick={closeReceive} disabled={saving}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={saving || accounts.length === 0}
            >
              <Icon name="check" size={16} />
              {saving ? "Recebendo…" : "Confirmar recebimento"}
            </button>
          </div>
        </DialogModal>
      )}
    </Dialog>
  );
}
