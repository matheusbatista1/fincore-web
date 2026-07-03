"use client";

import type { CSSProperties } from "react";
import type { MonthlyItem, PaidObligationFlow } from "@/application/use-cases/get-monthly";
import type { AccountView } from "@/application/use-cases/get-workspace-view";
import { AccountFormDialog } from "@/presentation/components/forms/account-form-dialog";
import { Dialog, DialogClose, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { monthLabel, relativeDateLabel } from "@/shared/formatting/dates";

/** One movement line inside a section. */
function Line({
  icon,
  tone,
  title,
  sub,
  cents,
  signed,
}: {
  icon: string;
  tone: CSSProperties;
  title: string;
  sub: string;
  cents: number;
  signed?: boolean;
}) {
  return (
    <div className="lrow">
      <span className="l-ic" style={tone}>
        <Icon name={icon} size={18} />
      </span>
      <div className="l-main">
        <div className="l-title">{title}</div>
        <div className="l-sub">{sub}</div>
      </div>
      <div className={`l-amt ${cents < 0 ? "neg" : "pos"}`}>
        <Money cents={cents} withSign={signed ?? false} />
      </div>
    </div>
  );
}

function SectionHead({ label, cents }: { label: string; cents: number }) {
  return (
    <div
      className="kicker"
      style={{ display: "flex", justifyContent: "space-between", margin: "14px 0 6px" }}
    >
      <span>{label}</span>
      <Money cents={cents} withSign={false} />
    </div>
  );
}

/**
 * Account detail modal: the browsed month's money IN (income + settlements received), money OUT
 * (account debits, paid boletos/loans/financings and card faturas paid from here) and transfers to/
 * from the account — with an "Editar" button that opens the existing account edit form. Opened by
 * tapping an account row in Carteiras (instead of jumping straight to the edit form).
 */
export function AccountDetailModal({
  account,
  items,
  paidFlows,
  month,
  today,
  onClose,
}: {
  account: AccountView | null;
  items: MonthlyItem[];
  paidFlows: PaidObligationFlow[];
  month: string;
  today: string;
  onClose: () => void;
}) {
  const a = account;
  const entradas = a
    ? items.filter((i) => i.accountId === a.id && i.kind !== "transfer" && i.amountCents > 0)
    : [];
  const saidasItems = a
    ? items.filter((i) => i.accountId === a.id && i.kind !== "transfer" && i.amountCents < 0)
    : [];
  const paid = a ? paidFlows.filter((p) => p.accountId === a.id) : [];
  const transfers = a
    ? items.filter(
        (i) => i.kind === "transfer" && (i.transferFromAccountId === a.id || i.transferToAccountId === a.id),
      )
    : [];

  const inCents = entradas.reduce((s, i) => s + i.amountCents, 0);
  const outCents =
    saidasItems.reduce((s, i) => s + Math.abs(i.amountCents), 0) + paid.reduce((s, p) => s + p.outCents, 0);
  const mint: CSSProperties = { background: "var(--mint-soft)", color: "var(--mint-500)" };
  const rose: CSSProperties = { background: "var(--rose-soft)", color: "var(--rose-500)" };
  const sky: CSSProperties = { background: "var(--sky-soft)", color: "var(--sky-500)" };
  const hasNone =
    entradas.length === 0 && saidasItems.length === 0 && paid.length === 0 && transfers.length === 0;

  return (
    <Dialog open={a !== null} onOpenChange={(v) => !v && onClose()}>
      {a && (
        <DialogModal title={`${a.bank} · ${a.name}`} maxWidth={520}>
          <div className="modal-body">
            <div style={{ textAlign: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 13, color: "var(--text-lo)" }}>Saldo atual</div>
              <div className="balance-big" style={{ fontSize: 26 }}>
                <Money cents={a.balanceCents} />
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-lo)", marginTop: 2 }}>
                Movimento de {monthLabel(month, { long: true })}
              </div>
            </div>

            {entradas.length > 0 && (
              <>
                <SectionHead label="Entradas" cents={inCents} />
                {entradas.map((i) => (
                  <Line
                    key={i.id}
                    icon={i.category?.icon ?? "arrow-down-left"}
                    tone={mint}
                    title={i.description || "Receita"}
                    sub={`${relativeDateLabel(i.date, today)}${i.fromPersonName ? ` · de ${i.fromPersonName}` : i.sourceLabel ? ` · ${i.sourceLabel}` : ""}`}
                    cents={i.amountCents}
                  />
                ))}
              </>
            )}

            {(saidasItems.length > 0 || paid.length > 0) && (
              <>
                <SectionHead label="Saídas" cents={-outCents} />
                {saidasItems.map((i) => (
                  <Line
                    key={i.id}
                    icon={i.category?.icon ?? "arrow-up-right"}
                    tone={rose}
                    title={i.description || "Despesa"}
                    sub={`${relativeDateLabel(i.date, today)}${i.category ? ` · ${i.category.name}` : ""}`}
                    cents={i.amountCents}
                  />
                ))}
                {paid.map((p) => (
                  <Line
                    key={p.id}
                    icon="file-text"
                    tone={rose}
                    title={p.label}
                    sub={`${relativeDateLabel(p.date, today)} · pagamento`}
                    cents={-p.outCents}
                  />
                ))}
              </>
            )}

            {transfers.length > 0 && (
              <>
                <div className="kicker" style={{ margin: "14px 0 6px" }}>
                  Transferências
                </div>
                {transfers.map((t) => {
                  const incoming = t.transferToAccountId === a.id;
                  return (
                    <Line
                      key={t.id}
                      icon="arrow-left-right"
                      tone={sky}
                      title={
                        incoming
                          ? `De ${t.transferFromName ?? "conta"}`
                          : `Para ${t.transferToName ?? "conta"}`
                      }
                      sub={relativeDateLabel(t.date, today)}
                      cents={incoming ? (t.transferValueCents ?? 0) : -(t.transferValueCents ?? 0)}
                      signed
                    />
                  );
                })}
              </>
            )}

            {hasNone && (
              <div style={{ color: "var(--text-lo)", fontSize: 14, padding: "10px 0", textAlign: "center" }}>
                Nenhuma movimentação em {monthLabel(month, { long: true })}.
              </div>
            )}
          </div>
          <div className="modal-foot" style={{ justifyContent: "space-between" }}>
            <AccountFormDialog
              account={a}
              trigger={
                <button type="button" className="btn btn-ghost">
                  <Icon name="pencil" size={16} />
                  Editar carteira
                </button>
              }
            />
            <DialogClose asChild>
              <button type="button" className="btn btn-primary">
                Fechar
              </button>
            </DialogClose>
          </div>
        </DialogModal>
      )}
    </Dialog>
  );
}
