"use client";

import { useState } from "react";
import { settlePersonAction } from "@/app/_actions/finance";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import type { PersonView } from "@/application/use-cases/get-workspace-view";
import { PersonFormDialog } from "@/presentation/components/forms/person-form-dialog";
import { Avatar } from "@/presentation/components/ui/avatar";
import { Dialog, DialogClose, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { relativeDateLabel } from "@/shared/formatting/dates";
import { settlementInputSchema } from "@/shared/schemas/transaction";

const firstName = (full: string): string => full.split(" ")[0] ?? full;

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Pessoas — ported 1:1 from the prototype (people.jsx). */
export function PeopleView({
  people,
  transactions,
  today,
}: {
  people: PersonView[];
  transactions: TransactionListItem[];
  today: string;
}) {
  const toast = useUIStore((s) => s.toast);
  const [openId, setOpenId] = useState<string | null>(null);
  const [settleId, setSettleId] = useState<string | null>(null);

  const totalReceber = people.filter((p) => p.balanceCents > 0).reduce((s, p) => s + p.balanceCents, 0);
  const totalPagar = people
    .filter((p) => p.balanceCents < 0)
    .reduce((s, p) => s + Math.abs(p.balanceCents), 0);
  const withPending = people.filter((p) => p.balanceCents !== 0).length;

  const open = people.find((p) => p.id === openId) ?? null;
  const settle = people.find((p) => p.id === settleId) ?? null;

  return (
    <div className="people-page">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 22 }}>
        <div className="card card-pad" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span className="kpi-ic mint" style={{ width: 46, height: 46 }}>
            <Icon name="hand-coins" size={22} />
          </span>
          <div>
            <div className="kpi-label" style={{ marginTop: 0 }}>
              Total a receber
            </div>
            <div
              className="tnum"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 26,
                fontWeight: 600,
                color: "var(--mint-500)",
              }}
            >
              <Money cents={totalReceber} withSign={false} />
            </div>
          </div>
        </div>
        <div className="card card-pad" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span className="kpi-ic rose" style={{ width: 46, height: 46 }}>
            <Icon name="send" size={22} />
          </span>
          <div>
            <div className="kpi-label" style={{ marginTop: 0 }}>
              Você deve
            </div>
            <div
              className="tnum"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 26,
                fontWeight: 600,
                color: "var(--rose-500)",
              }}
            >
              <Money cents={totalPagar} withSign={false} />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Pessoas</h3>
            <div className="ch-sub">
              {people.length} {people.length === 1 ? "contato" : "contatos"} · {withPending} com pendências
            </div>
          </div>
          <PersonFormDialog
            trigger={
              <button type="button" className="btn btn-ghost btn-sm">
                <Icon name="user-plus" size={16} />
                Adicionar pessoa
              </button>
            }
          />
        </div>
        <div className="card-pad" style={{ paddingTop: 6, paddingBottom: 8 }}>
          {people.length === 0 && (
            <div style={{ color: "var(--text-lo)", padding: "16px 0" }}>Nenhuma pessoa cadastrada ainda.</div>
          )}
          {people.map((p) => {
            const owes = p.balanceCents > 0;
            const owed = p.balanceCents < 0;
            const settled = p.balanceCents === 0;
            return (
              <div
                role="button"
                tabIndex={0}
                className="lrow"
                key={p.id}
                style={{ cursor: "pointer" }}
                onClick={() => setOpenId(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenId(p.id);
                  }
                }}
              >
                <Avatar name={p.name} color={p.color} size={44} radius={14} />
                <div className="l-main">
                  <div className="l-title">{p.name}</div>
                  <div className="l-sub">{p.relationship}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className={`l-amt ${owes ? "pos" : owed ? "neg" : ""}`}>
                    {settled ? "—" : <Money cents={Math.abs(p.balanceCents)} withSign={false} />}
                  </div>
                  <div className="l-sub">{owes ? "te deve" : owed ? "você deve" : "em dia"}</div>
                </div>
                <Icon name="chevron-right" size={18} style={{ color: "var(--text-faint)", marginLeft: 6 }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Perfil */}
      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        {open && (
          <DialogModal
            title="Perfil"
            maxWidth={520}
            actions={
              <>
                <PersonFormDialog
                  person={open}
                  trigger={
                    <button
                      type="button"
                      className="icon-btn btn-sm"
                      style={{ width: 36, height: 36 }}
                      title="Editar"
                    >
                      <Icon name="pencil" size={16} />
                    </button>
                  }
                />
                <button
                  type="button"
                  className="icon-btn btn-sm"
                  style={{ width: 36, height: 36 }}
                  title="Exportar relatório"
                  onClick={() => toast(`Relatório de ${firstName(open.name)} exportado em PDF`)}
                >
                  <Icon name="file-down" size={16} />
                </button>
              </>
            }
          >
            <ProfileBody
              person={open}
              transactions={transactions}
              today={today}
              onSettle={() => {
                setOpenId(null);
                setSettleId(open.id);
              }}
              onRemind={() => toast(`Lembrete enviado para ${firstName(open.name)} via WhatsApp`, "info")}
            />
          </DialogModal>
        )}
      </Dialog>

      {/* Acerto */}
      <Dialog open={settle !== null} onOpenChange={(v) => !v && setSettleId(null)}>
        {settle && <SettleBody person={settle} onDone={() => setSettleId(null)} />}
      </Dialog>
    </div>
  );
}

function ProfileBody({
  person,
  transactions,
  today,
  onSettle,
  onRemind,
}: {
  person: PersonView;
  transactions: TransactionListItem[];
  today: string;
  onSettle: () => void;
  onRemind: () => void;
}) {
  const owes = person.balanceCents > 0;
  const owed = person.balanceCents < 0;
  const involved = transactions.filter((t) => t.shares.some((s) => s.personId === person.id));
  const first = firstName(person.name);

  return (
    <div className="modal-body">
      <div className="profile-head" style={{ marginBottom: 22 }}>
        <span className="pava" style={{ background: person.color }}>
          {person.name
            .split(" ")
            .slice(0, 2)
            .map((w) => w[0])
            .join("")}
        </span>
        <div>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600 }}>{person.name}</h3>
          <div style={{ color: "var(--text-lo)", marginTop: 2 }}>{person.relationship}</div>
        </div>
      </div>

      <div className="summary-box" style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: "var(--text-lo)", marginBottom: 4 }}>
          {person.balanceCents === 0 ? "Tudo certo" : owes ? `${first} te deve` : `Você deve a ${first}`}
        </div>
        <div className={`balance-big ${owes ? "pos" : owed ? "neg" : ""}`}>
          {person.balanceCents === 0 ? (
            "R$ 0,00"
          ) : (
            <Money cents={Math.abs(person.balanceCents)} withSign={false} />
          )}
        </div>
        {person.balanceCents !== 0 && (
          <div className="row gap-3" style={{ justifyContent: "center", marginTop: 16 }}>
            {owes && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRemind}>
                <Icon name="bell" size={16} />
                Cobrar
              </button>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={onSettle}>
              <Icon name="check-circle" size={16} />
              {owes ? "Registrar pagamento" : "Marcar como pago"}
            </button>
          </div>
        )}
      </div>

      <div
        className="kicker"
        style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        Histórico
      </div>
      {involved.length === 0 && (
        <div style={{ color: "var(--text-lo)", fontSize: 14, padding: "10px 0" }}>
          Nenhuma despesa compartilhada ainda.
        </div>
      )}
      {involved.map((t) => {
        const share = t.shares.find((s) => s.personId === person.id)?.shareCents ?? Math.abs(t.amountCents);
        return (
          <div className="lrow" key={t.id}>
            <span className="l-ic">
              <Icon name="receipt" size={18} />
            </span>
            <div className="l-main">
              <div className="l-title">{t.description}</div>
              <div className="l-sub">
                {relativeDateLabel(t.date, today)}
                {t.note ? ` · ${t.note}` : ""}
              </div>
            </div>
            <div className="l-amt">
              <Money cents={share} withSign={false} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SettleBody({ person, onDone }: { person: PersonView; onDone: () => void }) {
  const toast = useUIStore((s) => s.toast);
  const owes = person.balanceCents > 0;
  const max = Math.abs(person.balanceCents);
  const first = firstName(person.name);
  const [cents, setCents] = useState(max);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const applied = Math.min(cents, max);
  const restante = Math.max(0, max - applied);
  const valid = cents > 0;

  async function confirm() {
    if (!valid || submitting) return;
    setError(null);
    const parsed = settlementInputSchema.safeParse({
      personId: person.id,
      amountCents: applied,
      date: todayIso(),
      accountId: null,
    });
    if (!parsed.success) {
      setError("Revise o valor do acerto.");
      return;
    }
    setSubmitting(true);
    const res = await settlePersonAction(parsed.data);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast("Acerto registrado.");
    onDone();
  }

  return (
    <DialogModal title={owes ? "Registrar pagamento" : "Marcar como pago"} maxWidth={440}>
      <div className="modal-body">
        <div style={{ textAlign: "center", marginBottom: 6, fontSize: 13.5, color: "var(--text-lo)" }}>
          {owes ? (
            <span>
              <b style={{ color: "var(--text-hi)" }}>{first}</b> te deve {formatBRLAbsolute(max)}. Quanto
              recebeu?
            </span>
          ) : (
            <span>
              Você deve {formatBRLAbsolute(max)} a <b style={{ color: "var(--text-hi)" }}>{first}</b>. Quanto
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
        <div className="chip-select" style={{ justifyContent: "center", marginBottom: 16 }}>
          <button type="button" className="person-chip" onClick={() => setCents(Math.round(max / 2))}>
            Metade
          </button>
          <button type="button" className="person-chip" onClick={() => setCents(max)}>
            Tudo ({formatBRLAbsolute(max)})
          </button>
        </div>
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
