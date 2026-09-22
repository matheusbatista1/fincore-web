"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { settlePersonAction, updateSettlementAction } from "@/app/_actions/finance";
import type { SettlementView } from "@/application/use-cases/get-settlements";
import { DialogClose, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { settlementInputSchema } from "@/shared/schemas/transaction";

/** A wallet/account option for the settle account picker. */
export interface AccountOption {
  readonly id: string;
  readonly label: string;
}

/**
 * The person + amounts a settle ("Acerto") targets. A light shape (no full PersonMonthView) so the
 * modal can be opened from anywhere — the person profile OR the Visão mensal "a receber" rows.
 *  - `capCents`: signed outstanding the settle applies against (> 0 they owe you, < 0 you owe them).
 *    This is the HARD cap and drives the direction. Callers pass the balance the screen shows (the
 *    profile passes the through-month total; a monthly receivable passes the month's amount), so the
 *    modal always agrees with the figure the user just clicked.
 *  - `prefillCents`: signed amount to prefill (typically the browsed-month net), clamped to the cap.
 */
export interface SettleTarget {
  readonly id: string;
  readonly name: string;
  readonly prefillCents: number;
  readonly capCents: number;
}

const firstName = (full: string): string => full.split(" ")[0] ?? full;

/** Settle account picker sentinel for "no account" (a baixa/perdão with no cash movement). */
const ACCOUNT_NONE = "__none__";

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Register (or edit) an acerto — a person paying you back, or you paying them. Reused by the People
 * profile and the Visão mensal "a receber" rows. Settle against `target.capCents` (the outstanding the
 * screen shows), prefilling `target.prefillCents` (what the user clicked) clamped to the cap.
 */
export function SettleBody({
  target,
  accounts,
  editing,
  onDone,
}: {
  target: SettleTarget;
  accounts: AccountOption[];
  editing: SettlementView | null;
  onDone: () => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const router = useRouter();
  const owes = target.capCents > 0;
  const max = Math.abs(target.capCents);
  const monthAmount = Math.abs(target.prefillCents);
  const owed = monthAmount > 0 ? Math.min(monthAmount, max) : max;
  const first = firstName(target.name);
  const [cents, setCents] = useState(editing ? editing.amountCents : owed);
  // The account the money moved through. A NEW acerto starts unchosen ("" = placeholder) so
  // the user consciously picks where the cash landed (no silent default to the first wallet).
  // ACCOUNT_NONE = "sem conta" (baixa/perdão, no cash movement).
  const [accountSel, setAccountSel] = useState<string>(editing ? (editing.accountId ?? ACCOUNT_NONE) : "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // When editing, the amount is free (the booked balance already reflects this acerto).
  const applied = editing ? cents : Math.min(cents, max);
  const restante = Math.max(0, max - applied);
  const valid = cents > 0;

  async function confirm() {
    if (!valid || submitting) return;
    if (accountSel === "") {
      setError(owes ? "Escolha a conta que recebeu o pagamento." : "Escolha a conta de onde saiu.");
      return;
    }
    setError(null);
    const accountId = accountSel === ACCOUNT_NONE ? null : accountSel;
    const parsed = settlementInputSchema.safeParse({
      personId: target.id,
      amountCents: applied,
      date: editing ? editing.date : todayIso(),
      accountId,
    });
    if (!parsed.success) {
      setError("Revise o valor do acerto.");
      return;
    }
    setSubmitting(true);
    const res = editing
      ? await updateSettlementAction(editing.id, parsed.data)
      : await settlePersonAction(parsed.data);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast(editing ? "Acerto atualizado." : "Acerto registrado.");
    router.refresh();
    onDone();
  }

  return (
    <DialogModal
      title={editing ? "Editar acerto" : owes ? "Registrar pagamento" : "Marcar como pago"}
      maxWidth={440}
    >
      <div className="modal-body">
        <div style={{ textAlign: "center", marginBottom: 6, fontSize: 13.5, color: "var(--text-lo)" }}>
          {owes ? (
            <span>
              <b style={{ color: "var(--text-hi)" }}>{first}</b> te deve {formatBRLAbsolute(owed)}. Quanto
              recebeu?
            </span>
          ) : (
            <span>
              Você deve {formatBRLAbsolute(owed)} a <b style={{ color: "var(--text-hi)" }}>{first}</b>. Quanto
              pagou?
            </span>
          )}
        </div>
        <input
          className="amount-input"
          value={formatBRLAbsolute(cents)}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            setCents(digits ? Number.parseInt(digits, 10) : 0);
          }}
          inputMode="numeric"
          // biome-ignore lint/a11y/noAutofocus: amount is the primary field of the settle modal.
          autoFocus
          aria-label="Valor do acerto"
          style={{ marginBottom: 14, color: owes ? "var(--mint-500)" : "var(--rose-500)" }}
        />
        {!editing && (
          <div className="chip-select" style={{ justifyContent: "center", marginBottom: 16 }}>
            <button type="button" className="person-chip" onClick={() => setCents(Math.round(max / 2))}>
              Metade
            </button>
            <button type="button" className="person-chip" onClick={() => setCents(max)}>
              Tudo ({formatBRLAbsolute(max)})
            </button>
          </div>
        )}
        <label
          htmlFor="settle-account"
          style={{ display: "block", fontSize: 12.5, color: "var(--text-lo)", marginBottom: 6 }}
        >
          {owes ? "Entrou em qual conta?" : "Saiu de qual conta?"}
        </label>
        <select
          id="settle-account"
          className="input"
          value={accountSel}
          onChange={(e) => setAccountSel(e.target.value)}
          style={{ width: "100%", marginBottom: 16 }}
        >
          <option value="" disabled>
            Selecione a conta…
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
          <option value={ACCOUNT_NONE}>Sem conta (só baixa / perdão)</option>
        </select>
        <div className="summary-box">
          <div className="sb-row">
            <span className="k">{owes ? "Recebendo agora" : "Pagando agora"}</span>
            <span className="v" style={{ color: owes ? "var(--mint-500)" : "var(--rose-500)" }}>
              {formatBRLAbsolute(applied)}
            </span>
          </div>
          <div className="sb-row total">
            <span className="k">Continua pendente</span>
            <span className="v">{formatBRLAbsolute(restante)}</span>
          </div>
          {restante === 0 && cents > 0 && (
            <div
              style={{
                fontSize: 12.5,
                color: "var(--mint-500)",
                fontWeight: 600,
                marginTop: 8,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon name="check-circle" size={14} />
              Quita tudo com {first}.
            </div>
          )}
          {error && (
            <div className="warn-text">
              <Icon name="alert-triangle" size={14} />
              {error}
            </div>
          )}
        </div>
      </div>
      <div className="modal-foot">
        <DialogClose asChild>
          <button type="button" className="btn btn-ghost">
            Cancelar
          </button>
        </DialogClose>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!valid || submitting}
          style={{
            opacity: valid && !submitting ? 1 : 0.45,
            pointerEvents: valid && !submitting ? "auto" : "none",
          }}
          onClick={confirm}
        >
          <Icon name="check" size={17} />
          Confirmar
        </button>
      </div>
    </DialogModal>
  );
}
