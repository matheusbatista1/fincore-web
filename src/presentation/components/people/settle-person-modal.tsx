"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type SettleActionState, settlePersonAction, updateSettlementAction } from "@/app/_actions/finance";
import type { SettlementView } from "@/application/use-cases/get-settlements";
import { DialogClose, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { settlementInputSchema, settlePersonSchema } from "@/shared/schemas/transaction";

/** A wallet/account option for the settle account picker. */
export interface AccountOption {
  readonly id: string;
  readonly label: string;
}

/**
 * The person + amounts a settle ("Acerto") targets. A light shape (no full PersonMonthView) so the
 * modal can be opened from anywhere — the person profile OR the Visão mensal "a receber" rows.
 *  - `capCents`: signed outstanding the settle applies against (> 0 they owe you, < 0 you owe them,
 *    0 nothing pending — then anything received is a sobra). It drives the direction and is the
 *    pending a payment is measured against: callers pass the person's total through today (the
 *    figure the People profile shows), so the modal and the server agree on what is "above".
 *  - `prefillCents`: signed amount to prefill (typically the browsed-month net), clamped to the cap.
 *  - `throughMonth`: the browsed competence month; the server measures the pending through it (or
 *    today, whichever is later), exactly like the profile's "no total".
 */
export interface SettleTarget {
  readonly id: string;
  readonly name: string;
  readonly prefillCents: number;
  readonly capCents: number;
  readonly throughMonth: string;
}

type Surplus = "tip" | "credit";

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
 * screen shows), prefilling `target.prefillCents` (what the user clicked) clamped to the cap. The
 * acerto carries the date it really happened (default today): a payment for August made in
 * September must be able to say so, since the ledger covers the oldest open months by date.
 *
 * A payment ABOVE the pending is never clipped silently: the modal asks what the sobra is — a
 * gorjeta (the user's own income, booked with the acerto) or the person's credit (kept in the acerto,
 * applied to their next share) — and the server re-checks the figures. A "sem conta" acerto
 * (baixa/perdão) has no cash behind it, so it stays capped at the pending.
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
  // Direction: a non-negative cap is "they pay" — zero means nothing pending, so whatever is
  // received is a sobra to decide on (not the "você deve R$ 0,00" dead end it used to be).
  const theyPay = target.capCents >= 0;
  const max = Math.abs(target.capCents);
  const monthAmount = Math.abs(target.prefillCents);
  const owed = monthAmount > 0 ? Math.min(monthAmount, max) : max;
  const first = firstName(target.name);
  const [cents, setCents] = useState(editing ? editing.amountCents : owed);
  // The account the money moved through. A NEW acerto starts unchosen ("" = placeholder) so
  // the user consciously picks where the cash landed (no silent default to the first wallet).
  // ACCOUNT_NONE = "sem conta" (baixa/perdão, no cash movement).
  const [accountSel, setAccountSel] = useState<string>(editing ? (editing.accountId ?? ACCOUNT_NONE) : "");
  const today = todayIso();
  const [date, setDate] = useState<string>(editing ? editing.date : today);
  const [surplus, setSurplus] = useState<Surplus | null>(null);
  // The pending the server measured when it refused to guess: it replaces the screen's figure, so
  // the question is asked with the numbers that will actually be written.
  const [serverOwed, setServerOwed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const owedShown = serverOwed ?? max;
  const noAccount = accountSel === ACCOUNT_NONE;
  const overCents = !editing && theyPay ? Math.max(0, cents - owedShown) : 0;
  // A sobra needs cash to exist: with "sem conta" the amount keeps today's cap.
  const surplusActive = overCents > 0 && !noAccount;
  // When editing, the amount is free (the booked balance already reflects this acerto).
  const applied = editing ? cents : Math.min(cents, owedShown);
  const submitAmount = editing || surplusActive ? cents : applied;
  const restante = Math.max(0, owedShown - applied);
  const valid = cents > 0 && (!surplusActive || surplus !== null);

  async function confirm() {
    if (!valid || submitting) return;
    if (accountSel === "") {
      setError(theyPay ? "Escolha a conta que recebeu o pagamento." : "Escolha a conta de onde saiu.");
      return;
    }
    setError(null);
    const accountId = noAccount ? null : accountSel;
    const parsed = editing
      ? settlementInputSchema.safeParse({ personId: target.id, amountCents: submitAmount, date, accountId })
      : settlePersonSchema.safeParse({
          personId: target.id,
          amountCents: submitAmount,
          date,
          accountId,
          throughMonth: target.throughMonth,
          ...(surplusActive && surplus ? { surplus } : {}),
        });
    if (!parsed.success) {
      setError("Revise o valor do acerto.");
      return;
    }
    setSubmitting(true);
    const res: SettleActionState = editing
      ? await updateSettlementAction(editing.id, parsed.data)
      : await settlePersonAction(parsed.data);
    setSubmitting(false);
    if (!res.ok) {
      if (res.surplus) {
        // The server measured a pending the screen did not know (a stale cap, or a month-only one):
        // ask the question with its figures instead of failing.
        setServerOwed(res.surplus.owedCents);
        setSurplus(null);
        return;
      }
      setError(res.error);
      return;
    }
    toast(
      editing
        ? "Acerto atualizado."
        : surplusActive && surplus === "tip"
          ? `Acerto registrado. Gorjeta de ${formatBRLAbsolute(overCents)} lançada como receita.`
          : surplusActive && surplus === "credit"
            ? `Acerto registrado. ${formatBRLAbsolute(overCents)} ficam como crédito de ${first}.`
            : "Acerto registrado.",
    );
    router.refresh();
    onDone();
  }

  return (
    <DialogModal
      title={editing ? "Editar acerto" : theyPay ? "Registrar pagamento" : "Marcar como pago"}
      maxWidth={440}
    >
      <div className="modal-body">
        <div style={{ textAlign: "center", marginBottom: 6, fontSize: 13.5, color: "var(--text-lo)" }}>
          {editing ? (
            <span>
              Editando o acerto de <b style={{ color: "var(--text-hi)" }}>{first}</b>.
            </span>
          ) : theyPay && max === 0 ? (
            <span>
              <b style={{ color: "var(--text-hi)" }}>{first}</b> não deve nada no momento. Quanto recebeu?
            </span>
          ) : theyPay ? (
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
          style={{ marginBottom: 14, color: theyPay ? "var(--mint-500)" : "var(--rose-500)" }}
        />
        {!editing && max > 0 && (
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
          {theyPay ? "Entrou em qual conta?" : "Saiu de qual conta?"}
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
        <label
          htmlFor="settle-date"
          style={{ display: "block", fontSize: 12.5, color: "var(--text-lo)", marginBottom: 6 }}
        >
          Quando foi?
        </label>
        <input
          id="settle-date"
          className="input"
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value || today)}
          style={{ width: "100%", marginBottom: 16 }}
        />
        {surplusActive && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                textAlign: "center",
                fontSize: 13,
                color: "var(--text-lo)",
                marginBottom: 8,
                lineHeight: 1.45,
              }}
            >
              Sobram <b style={{ color: "var(--text-hi)" }}>{formatBRLAbsolute(overCents)}</b> acima do que{" "}
              {first} deve ({formatBRLAbsolute(owedShown)}). O que fazer com a sobra?
            </div>
            <div className="chip-select" style={{ justifyContent: "center", marginBottom: 8 }}>
              <button
                type="button"
                className={`person-chip${surplus === "tip" ? " on" : ""}`}
                onClick={() => setSurplus("tip")}
              >
                Gorjeta
              </button>
              <button
                type="button"
                className={`person-chip${surplus === "credit" ? " on" : ""}`}
                onClick={() => setSurplus("credit")}
              >
                Crédito de {first}
              </button>
            </div>
            <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--text-lo)", lineHeight: 1.45 }}>
              {surplus === "tip"
                ? "A sobra é sua: vira uma receita na conta escolhida."
                : surplus === "credit"
                  ? `A sobra fica como crédito de ${first} e abate o que ainda deve ou vier a dever.`
                  : "Escolha uma opção para confirmar."}
            </div>
          </div>
        )}
        {overCents > 0 && noAccount && (
          <div style={{ fontSize: 12.5, color: "var(--text-lo)", marginTop: -8, marginBottom: 16 }}>
            Sem conta, o acerto fica limitado a {formatBRLAbsolute(owedShown)}.
          </div>
        )}
        <div className="summary-box">
          {surplusActive ? (
            <>
              <div className="sb-row">
                <span className="k">Abate da dívida</span>
                <span className="v" style={{ color: "var(--mint-500)" }}>
                  {formatBRLAbsolute(applied)}
                </span>
              </div>
              <div className="sb-row">
                <span className="k">
                  {surplus === "tip"
                    ? "Gorjeta (receita sua)"
                    : surplus === "credit"
                      ? "Fica como crédito"
                      : "Sobra"}
                </span>
                <span className="v" style={{ color: "var(--sky-500)" }}>
                  {formatBRLAbsolute(overCents)}
                </span>
              </div>
              <div className="sb-row total">
                <span className="k">Entra na conta</span>
                <span className="v">{formatBRLAbsolute(cents)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="sb-row">
                <span className="k">{theyPay ? "Recebendo agora" : "Pagando agora"}</span>
                <span className="v" style={{ color: theyPay ? "var(--mint-500)" : "var(--rose-500)" }}>
                  {formatBRLAbsolute(applied)}
                </span>
              </div>
              <div className="sb-row total">
                <span className="k">Continua pendente</span>
                <span className="v">{formatBRLAbsolute(restante)}</span>
              </div>
            </>
          )}
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
