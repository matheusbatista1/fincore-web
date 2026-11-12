"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { assumePersonDebtAction } from "@/app/_actions/finance";
import { DialogClose, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { monthLabel } from "@/shared/formatting/dates";
import { assumeDebtSchema } from "@/shared/schemas/transaction";

/**
 * The person + pending amounts "Assumir dívida" acts on — both are what the profile shows:
 * `monthPendingCents` is the browsed month's net, `totalPendingCents` the accumulated total through
 * it (> 0 they owe you). The server re-validates against the BOOKED pending, so a forecast can't be
 * assumed even when the screen counts it.
 */
export interface AssumeTarget {
  readonly id: string;
  readonly name: string;
  readonly monthPendingCents: number;
  readonly totalPendingCents: number;
}

type Scope = "month" | "all";

const firstName = (full: string): string => full.split(" ")[0] ?? full;

/**
 * Take over what a person still owes: their shares on the open expenses move onto the user (the
 * person's balance drops, the user's own spending rises), with no cash moving and no acerto. Sits
 * next to "Registrar pagamento" (they paid) and "Rolar dívida" (the debt changes shape).
 */
export function AssumeDebtBody({
  target,
  month,
  onDone,
}: {
  target: AssumeTarget;
  month: string;
  onDone: () => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const router = useRouter();
  const first = firstName(target.name);
  const monthMax = Math.max(0, target.monthPendingCents);
  const totalMax = Math.max(0, target.totalPendingCents);
  // Default to the browsed month (what the user is looking at); fall back to the total when the
  // month itself has nothing pending but earlier months do.
  const [scope, setScope] = useState<Scope>(monthMax > 0 ? "month" : "all");
  const max = scope === "month" ? monthMax : totalMax;
  const [cents, setCents] = useState(monthMax > 0 ? monthMax : totalMax);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const applied = Math.min(cents, max);
  const restante = Math.max(0, max - applied);
  const valid = applied > 0;
  const where = scope === "month" ? `em ${monthLabel(month)}` : `até ${monthLabel(month)}`;

  function pick(next: Scope) {
    setScope(next);
    setCents(next === "month" ? monthMax : totalMax);
  }

  async function confirm() {
    if (!valid || submitting) return;
    setError(null);
    const parsed = assumeDebtSchema.safeParse({ personId: target.id, month, amountCents: applied, scope });
    if (!parsed.success) {
      setError("Revise o valor a assumir.");
      return;
    }
    setSubmitting(true);
    const res = await assumePersonDebtAction(parsed.data);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast(`Dívida assumida: ${formatBRLAbsolute(applied)} de ${first} agora é despesa sua.`);
    router.refresh();
    onDone();
  }

  return (
    <DialogModal title="Assumir dívida" maxWidth={440}>
      <div className="modal-body">
        <div style={{ textAlign: "center", marginBottom: 6, fontSize: 13.5, color: "var(--text-lo)" }}>
          <b style={{ color: "var(--text-hi)" }}>{first}</b> te deve {formatBRLAbsolute(max)} {where}. Quanto
          você assume?
        </div>
        <input
          className="amount-input"
          value={formatBRLAbsolute(cents)}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            setCents(digits ? Number.parseInt(digits, 10) : 0);
          }}
          inputMode="numeric"
          // biome-ignore lint/a11y/noAutofocus: amount is the primary field of the assume modal.
          autoFocus
          aria-label="Valor a assumir"
          style={{ marginBottom: 14, color: "var(--rose-500)" }}
        />
        <div className="chip-select" style={{ justifyContent: "center", marginBottom: 12 }}>
          <button type="button" className="person-chip" onClick={() => setCents(Math.round(max / 2))}>
            Metade
          </button>
          <button type="button" className="person-chip" onClick={() => setCents(max)}>
            Tudo ({formatBRLAbsolute(max)})
          </button>
        </div>
        <div className="chip-select" style={{ justifyContent: "center", marginBottom: 16 }}>
          <button
            type="button"
            className={`person-chip${scope === "month" ? " on" : ""}`}
            disabled={monthMax === 0}
            onClick={() => pick("month")}
          >
            Só {monthLabel(month)}
          </button>
          <button
            type="button"
            className={`person-chip${scope === "all" ? " on" : ""}`}
            disabled={totalMax === 0}
            onClick={() => pick("all")}
          >
            Tudo até {monthLabel(month)}
          </button>
        </div>
        <div className="summary-box">
          <div className="sb-row">
            <span className="k">Vira despesa sua</span>
            <span className="v" style={{ color: "var(--rose-500)" }}>
              {formatBRLAbsolute(applied)}
            </span>
          </div>
          <div className="sb-row total">
            <span className="k">{first} continua devendo</span>
            <span className="v">{formatBRLAbsolute(restante)}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-lo)", marginTop: 8, lineHeight: 1.45 }}>
            Nenhum dinheiro se move: a cota sai do saldo de {first} e entra no seu gasto. Cada despesa afetada
            ganha a nota "Assumido de {first}".
          </div>
          {restante === 0 && valid && (
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
              Zera o que {first} te deve {where}.
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
          <Icon name="handshake" size={17} />
          Assumir
        </button>
      </div>
    </DialogModal>
  );
}
