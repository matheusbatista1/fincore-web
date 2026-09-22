"use client";

import { useState, useTransition } from "react";
import { updatePreferencesAction } from "@/app/_actions/auth";
import { Icon } from "@/presentation/components/ui/icon";
import { toast } from "@/presentation/stores/ui-store";

export interface AutoPaymentsAccount {
  readonly id: string;
  readonly bank: string;
  readonly name: string;
}

/**
 * Settings card for automatic payments. When on, due obligations and card faturas are booked as
 * paid from the chosen default account on their due date. Turning it on requires picking an
 * account; turning it off keeps everything already booked (only stops future auto-booking).
 */
export function AutoPaymentsCard({
  enabled,
  defaultAccountId,
  accounts,
}: {
  enabled: boolean;
  defaultAccountId: string | null;
  accounts: AutoPaymentsAccount[];
}) {
  const [on, setOn] = useState(enabled);
  const [accountId, setAccountId] = useState<string | null>(defaultAccountId);
  const [, startTransition] = useTransition();

  function persist(nextOn: boolean, nextAccount: string | null, revert: () => void, okMsg: string) {
    startTransition(async () => {
      const result = await updatePreferencesAction({
        autoPaymentsEnabled: nextOn,
        defaultPayAccountId: nextAccount,
      });
      if (!result.ok) {
        revert();
        toast(result.error, "error");
        return;
      }
      toast(okMsg);
    });
  }

  function toggle() {
    if (!on) {
      // Turning ON requires a default account (auto-pick the first when none chosen yet).
      const chosen = accountId ?? accounts[0]?.id ?? null;
      if (chosen === null) {
        toast("Cadastre uma carteira antes de ativar os pagamentos automáticos.", "error");
        return;
      }
      setOn(true);
      setAccountId(chosen);
      persist(
        true,
        chosen,
        () => {
          setOn(false);
        },
        "Pagamentos automáticos ativados.",
      );
    } else {
      setOn(false);
      persist(false, accountId, () => setOn(true), "Pagamentos automáticos desativados.");
    }
  }

  function selectAccount(id: string) {
    const prev = accountId;
    setAccountId(id);
    persist(on, id, () => setAccountId(prev), "Conta padrão atualizada.");
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <div>
          <h3>Pagamentos automáticos</h3>
          <div className="ch-sub">
            Quite boletos, empréstimos, financiamentos e faturas na data de vencimento, sem confirmar um a um.
            Você ainda pode pagar adiantado pelo botão de sempre.
          </div>
        </div>
      </div>
      <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 8 }}>
        <div
          role="button"
          tabIndex={0}
          className="lrow"
          style={{ cursor: "pointer" }}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle();
            }
          }}
        >
          <span className="l-ic" style={{ background: "var(--purple-soft)", color: "var(--purple-300)" }}>
            <Icon name="calendar-clock" size={18} />
          </span>
          <div className="l-main">
            <div className="l-title">Pagar automaticamente no vencimento</div>
            <div className="l-sub" style={{ whiteSpace: "normal", lineHeight: 1.45 }}>
              Enquanto desligado, contas vencidas e não pagas aparecem como “atrasado”.
            </div>
          </div>
          <span className={`fc-switch${on ? " on" : ""}`}>
            <span />
          </span>
        </div>

        {on && (
          <div className="field" style={{ marginTop: 8 }}>
            <label>De qual carteira sai o pagamento automático?</label>
            {accounts.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--rose-500)" }}>Cadastre uma carteira.</div>
            ) : (
              <div className="chip-select">
                {accounts.map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    className={`person-chip${accountId === a.id ? " on" : ""}`}
                    onClick={() => selectAccount(a.id)}
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
        )}
      </div>
    </div>
  );
}
