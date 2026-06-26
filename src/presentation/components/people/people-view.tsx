"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  deleteSettlementAction,
  rollPersonDebtAction,
  settlePersonAction,
  updateSettlementAction,
} from "@/app/_actions/finance";
import type { PersonMonthView } from "@/application/use-cases/get-people";
import type { RollableDebt } from "@/application/use-cases/get-rollable-debts";
import type { SettlementView } from "@/application/use-cases/get-settlements";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { PersonFormDialog } from "@/presentation/components/forms/person-form-dialog";
import { type ReportData, ReportModal } from "@/presentation/components/reports/report-modal";
import {
  MonthNavButton,
  MonthNavPending,
  MonthTransition,
} from "@/presentation/components/shell/month-transition";
import { Avatar } from "@/presentation/components/ui/avatar";
import { Dialog, DialogClose, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { monthLabel, relativeDateLabel } from "@/shared/formatting/dates";
import { settlementInputSchema } from "@/shared/schemas/transaction";

/** A wallet/account option for the settle account picker. */
interface AccountOption {
  readonly id: string;
  readonly label: string;
}

/** One open debt of a person (a shared expense not yet rolled) — the target of "Rolar dívida". */
interface DebtOption {
  readonly id: string;
  readonly label: string;
  readonly shareCents: number;
}

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
  accounts,
  cards,
  rollableDebts,
  settlements,
  today,
  month,
  isCurrent,
  prevHref,
  nextHref,
  reportData,
}: {
  people: PersonMonthView[];
  transactions: TransactionListItem[];
  accounts: AccountOption[];
  cards: AccountOption[];
  rollableDebts: RollableDebt[];
  settlements: SettlementView[];
  today: string;
  month: string;
  isCurrent: boolean;
  prevHref: string;
  nextHref: string;
  reportData: ReportData;
}) {
  const toast = useUIStore((s) => s.toast);
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [settleId, setSettleId] = useState<string | null>(null);
  const [editSettlement, setEditSettlement] = useState<SettlementView | null>(null);
  const [rollId, setRollId] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  // List + totals are the browsed month's nets (projection-aware for future months).
  const totalReceber = people.reduce((s, p) => (p.monthBalanceCents > 0 ? s + p.monthBalanceCents : s), 0);
  const totalPagar = people.reduce((s, p) => (p.monthBalanceCents < 0 ? s - p.monthBalanceCents : s), 0);
  const withPending = people.filter((p) => p.monthBalanceCents !== 0).length;

  const open = people.find((p) => p.id === openId) ?? null;
  const roll = people.find((p) => p.id === rollId) ?? null;
  // The person's open debts in the BROWSED MONTH (their share of a shared expense whose
  // competence is this month and is not yet rolled) — what "Rolar dívida" acts on. Scoping
  // to the month means rolling abates the parcela that actually weighs on the month's
  // balance; a parcela number disambiguates installment siblings in the picker.
  const rollDebts: DebtOption[] = roll
    ? rollableDebts
        .filter((d) => d.personId === roll.id)
        .map((d) => ({
          id: d.id,
          label: `${d.description}${d.parcela ? ` (${d.parcela.number}/${d.parcela.total})` : ""} · ${formatBRLAbsolute(d.shareCents)}`,
          shareCents: d.shareCents,
        }))
    : [];
  // The settle dialog opens to register a new payment (settleId) or to edit one (editSettlement).
  const settleTarget =
    people.find((p) => p.id === settleId) ??
    (editSettlement ? (people.find((p) => p.id === editSettlement.personId) ?? null) : null);
  const closeSettle = () => {
    setSettleId(null);
    setEditSettlement(null);
  };
  async function handleDeleteSettlement(id: string) {
    const res = await deleteSettlementAction(id);
    if (res.ok) {
      toast("Acerto desfeito.");
      router.refresh();
    } else {
      toast(res.error, "info");
    }
  }

  return (
    <MonthTransition prevHref={prevHref} nextHref={nextHref}>
      <div className="people-page">
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div className="month-nav">
            <MonthNavButton href={prevHref} dir="prev" title="Mês anterior">
              <Icon name="chevron-left" size={19} />
            </MonthNavButton>
            <div className="mn-label">
              <span className="mn-month">{monthLabel(month, { long: true })}</span>
              <MonthNavPending />
              {isCurrent ? (
                <span className="pill purple" style={{ height: 22 }}>
                  Mês atual
                </span>
              ) : (
                <Link className="card-link" href="/people">
                  Voltar para hoje
                </Link>
              )}
            </div>
            <MonthNavButton href={nextHref} dir="next" title="Próximo mês">
              <Icon name="chevron-right" size={19} />
            </MonthNavButton>
          </div>
        </div>
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
              <div style={{ color: "var(--text-lo)", padding: "16px 0" }}>
                Nenhuma pessoa cadastrada ainda.
              </div>
            )}
            {people.map((p) => {
              const bal = p.monthBalanceCents;
              const owes = bal > 0;
              const owed = bal < 0;
              const settled = bal === 0;
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
                      {settled ? "—" : <Money cents={Math.abs(bal)} withSign={false} />}
                    </div>
                    <div className="l-sub">{owes ? "te deve" : owed ? "você deve" : "em dia"}</div>
                  </div>
                  <Icon
                    name="chevron-right"
                    size={18}
                    style={{ color: "var(--text-faint)", marginLeft: 6 }}
                  />
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
                    onClick={() => {
                      setOpenId(null);
                      setReportId(open.id);
                    }}
                  >
                    <Icon name="file-down" size={16} />
                  </button>
                </>
              }
            >
              <ProfileBody
                person={open}
                month={month}
                transactions={transactions}
                today={today}
                settlements={settlements.filter((s) => s.personId === open.id)}
                onSettle={() => {
                  setOpenId(null);
                  setSettleId(open.id);
                }}
                onRoll={() => {
                  setOpenId(null);
                  setRollId(open.id);
                }}
                onEditSettlement={(s) => {
                  setOpenId(null);
                  setEditSettlement(s);
                }}
                onDeleteSettlement={handleDeleteSettlement}
                onRemind={() => toast(`Lembrete enviado para ${firstName(open.name)} via WhatsApp`, "info")}
                onReport={() => {
                  setOpenId(null);
                  setReportId(open.id);
                }}
              />
            </DialogModal>
          )}
        </Dialog>

        {/* Acerto (registrar ou editar) */}
        <Dialog open={settleTarget !== null} onOpenChange={(v) => !v && closeSettle()}>
          {settleTarget && (
            <SettleBody
              person={settleTarget}
              accounts={accounts}
              editing={editSettlement}
              onDone={closeSettle}
            />
          )}
        </Dialog>

        {/* Rolar dívida */}
        <Dialog open={roll !== null} onOpenChange={(v) => !v && setRollId(null)}>
          {roll && (
            <RollDebtBody
              person={roll}
              accounts={accounts}
              cards={cards}
              debts={rollDebts}
              onDone={() => setRollId(null)}
            />
          )}
        </Dialog>

        {/* Relatório por pessoa */}
        {reportId && (
          <ReportModal
            data={reportData}
            initialMode="person"
            initialPersonId={reportId}
            onClose={() => setReportId(null)}
          />
        )}
      </div>
    </MonthTransition>
  );
}

function ProfileBody({
  person,
  month,
  transactions,
  today,
  settlements,
  onSettle,
  onRoll,
  onEditSettlement,
  onDeleteSettlement,
  onRemind,
  onReport,
}: {
  person: PersonMonthView;
  month: string;
  transactions: TransactionListItem[];
  today: string;
  settlements: SettlementView[];
  onSettle: () => void;
  onRoll: () => void;
  onEditSettlement: (s: SettlementView) => void;
  onDeleteSettlement: (id: string) => void;
  onRemind: () => void;
  onReport: () => void;
}) {
  const monthBalanceCents = person.monthBalanceCents;
  const monthOwes = monthBalanceCents > 0;
  const monthOwed = monthBalanceCents < 0;
  // Accumulated total (incl. projected) is the displayed "no total"; settling acts on the
  // REAL booked debt only.
  const totalCents = person.totalBalanceCents;
  const totalOwes = totalCents > 0;
  const canSettle = person.realBalanceCents !== 0;
  const realOwes = person.realBalanceCents > 0;
  const involved = transactions.filter(
    (t) => t.shares.some((s) => s.personId === person.id) && t.date.slice(0, 7) === month,
  );
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
          {monthBalanceCents === 0
            ? `Sem pendências em ${monthLabel(month)}`
            : monthOwes
              ? `${first} te deve em ${monthLabel(month)}`
              : `Você deve a ${first} em ${monthLabel(month)}`}
        </div>
        <div className={`balance-big ${monthOwes ? "pos" : monthOwed ? "neg" : ""}`}>
          {monthBalanceCents === 0 ? (
            "R$ 0,00"
          ) : (
            <Money cents={Math.abs(monthBalanceCents)} withSign={false} />
          )}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-lo)", marginTop: 8 }}>
          {totalCents === 0 ? (
            "Saldo total quitado"
          ) : (
            <>
              {totalOwes ? `No total, ${first} te deve ` : "No total, você deve "}
              <b style={{ color: totalOwes ? "var(--mint-500)" : "var(--rose-500)" }}>
                <Money cents={Math.abs(totalCents)} withSign={false} />
              </b>
            </>
          )}
        </div>
        {canSettle && (
          <div className="row gap-3" style={{ justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
            {realOwes && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRemind}>
                <Icon name="bell" size={16} />
                Cobrar
              </button>
            )}
            {realOwes && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRoll}>
                <Icon name="repeat" size={16} />
                Rolar dívida
              </button>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={onSettle}>
              <Icon name="check-circle" size={16} />
              {realOwes ? "Registrar pagamento" : "Marcar como pago"}
            </button>
          </div>
        )}
      </div>

      <div
        className="kicker"
        style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        Movimentações de {monthLabel(month)}
        <button type="button" className="card-link" onClick={onReport}>
          Relatório completo
          <Icon name="arrow-right" size={14} />
        </button>
      </div>
      {involved.length === 0 && (
        <div style={{ color: "var(--text-lo)", fontSize: 14, padding: "10px 0" }}>
          Nenhuma despesa compartilhada em {monthLabel(month)}.
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
              <div className="l-title">
                {t.description}
                {t.rolled && (
                  <span className="parc-badge" style={{ marginLeft: 8 }}>
                    Rolada
                  </span>
                )}
              </div>
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

      {settlements.length > 0 && (
        <>
          <div className="kicker" style={{ margin: "18px 0 8px" }}>
            Acertos registrados
          </div>
          {settlements.map((s) => (
            <div className="lrow" key={s.id}>
              <span className="l-ic" style={{ background: "var(--mint-soft)", color: "var(--mint-500)" }}>
                <Icon name="check-circle" size={18} />
              </span>
              <div className="l-main">
                <div className="l-title">
                  <Money cents={s.amountCents} withSign={false} />
                </div>
                <div className="l-sub">
                  {relativeDateLabel(s.date, today)} · {s.accountLabel ?? "sem conta"}
                </div>
              </div>
              <div className="row gap-2">
                <button
                  type="button"
                  className="icon-btn btn-sm"
                  title="Editar acerto"
                  onClick={() => onEditSettlement(s)}
                >
                  <Icon name="pencil" size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn btn-sm"
                  title="Desfazer acerto"
                  onClick={() => onDeleteSettlement(s.id)}
                >
                  <Icon name="trash-2" size={15} />
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

type Instrument = "card" | "loan" | "overdraft" | "account";
const INSTRUMENTS: ReadonlyArray<{ id: Instrument; label: string }> = [
  { id: "card", label: "Cartão de crédito" },
  { id: "loan", label: "Empréstimo" },
  { id: "overdraft", label: "Cheque especial" },
  { id: "account", label: "Meu próprio dinheiro" },
];

/** "Rolar dívida": front the person's current debt via an instrument; they owe you the new total. */
function RollDebtBody({
  person,
  accounts,
  cards,
  debts,
  onDone,
}: {
  person: PersonMonthView;
  accounts: AccountOption[];
  cards: AccountOption[];
  debts: DebtOption[];
  onDone: () => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const router = useRouter();
  const first = firstName(person.name);
  const [debtId, setDebtId] = useState<string | null>(debts[0]?.id ?? null);
  const [principal, setPrincipal] = useState(debts[0]?.shareCents ?? 0);
  const [juros, setJuros] = useState(0);
  const [instrument, setInstrument] = useState<Instrument>("account");
  const [cardId, setCardId] = useState<string | null>(cards[0]?.id ?? null);
  const [acctId, setAcctId] = useState<string | null>(accounts[0]?.id ?? null);
  const [installments, setInstallments] = useState(1);
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canInstallment = instrument === "card" || instrument === "loan";
  const usesCard = instrument === "card";
  const usesAccount = !usesCard; // loan/overdraft/account all reference an account (loan's is optional)
  const total = principal + juros;
  const valid =
    debtId !== null &&
    principal > 0 &&
    (usesCard ? cardId !== null : instrument === "loan" ? true : acctId !== null);

  // Picking a different debt prefills the principal with that debt's share.
  const pickDebt = (id: string) => {
    setDebtId(id);
    const debt = debts.find((d) => d.id === id);
    if (debt) setPrincipal(debt.shareCents);
  };

  async function confirm() {
    if (!valid || submitting || debtId === null) return;
    setError(null);
    setSubmitting(true);
    const res = await rollPersonDebtAction({
      personId: person.id,
      originalTransactionId: debtId,
      principalCents: principal,
      jurosCents: juros,
      date,
      source: instrument,
      cardId: usesCard ? cardId : null,
      accountId: instrument === "account" ? acctId : null,
      linkedAccountId: instrument === "overdraft" || instrument === "loan" ? acctId : null,
      installments: canInstallment ? installments : 1,
      description: `Dívida de ${first}`,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast("Dívida rolada.");
    router.refresh();
    onDone();
  }

  const moneyField = (value: number, onChange: (cents: number) => void, label: string, id: string) => (
    <div style={{ marginBottom: 12 }}>
      <label
        htmlFor={id}
        style={{ display: "block", fontSize: 12.5, color: "var(--text-lo)", marginBottom: 6 }}
      >
        {label}
      </label>
      <input
        id={id}
        className="input"
        value={formatBRLAbsolute(value)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          onChange(digits ? Number.parseInt(digits, 10) : 0);
        }}
        inputMode="numeric"
        style={{ width: "100%" }}
      />
    </div>
  );

  return (
    <DialogModal title="Rolar dívida" maxWidth={460}>
      <div className="modal-body">
        <div style={{ textAlign: "center", marginBottom: 14, fontSize: 13.5, color: "var(--text-lo)" }}>
          Você quita uma dívida de <b style={{ color: "var(--text-hi)" }}>{first}</b> e ela passa a te dever o
          novo valor — a original fica marcada como rolada (mantida no histórico).
        </div>

        {debts.length === 0 ? (
          <div style={{ color: "var(--text-lo)", fontSize: 13.5, padding: "8px 0 12px" }}>
            {first} não tem dívidas em aberto para rolar.
          </div>
        ) : (
          <>
            <label
              htmlFor="roll-debt"
              style={{ display: "block", fontSize: 12.5, color: "var(--text-lo)", marginBottom: 6 }}
            >
              Qual dívida você quitou?
            </label>
            <select
              id="roll-debt"
              className="input"
              value={debtId ?? ""}
              onChange={(e) => pickDebt(e.target.value)}
              style={{ width: "100%", marginBottom: 12 }}
            >
              {debts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </>
        )}

        {moneyField(principal, setPrincipal, "Valor abatido (dívida original)", "roll-principal")}
        {moneyField(juros, setJuros, "Juros / acréscimo (a pessoa paga)", "roll-juros")}

        <label
          htmlFor="roll-instrument"
          style={{ display: "block", fontSize: 12.5, color: "var(--text-lo)", marginBottom: 6 }}
        >
          Como você está pagando?
        </label>
        <select
          id="roll-instrument"
          className="input"
          value={instrument}
          onChange={(e) => setInstrument(e.target.value as Instrument)}
          style={{ width: "100%", marginBottom: 12 }}
        >
          {INSTRUMENTS.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>

        {usesCard ? (
          <select
            aria-label="Cartão"
            className="input"
            value={cardId ?? ""}
            onChange={(e) => setCardId(e.target.value || null)}
            style={{ width: "100%", marginBottom: 12 }}
          >
            {cards.length === 0 && <option value="">Nenhum cartão</option>}
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        ) : (
          usesAccount && (
            <select
              aria-label="Conta"
              className="input"
              value={acctId ?? ""}
              onChange={(e) => setAcctId(e.target.value || null)}
              style={{ width: "100%", marginBottom: 12 }}
            >
              {instrument === "loan" && <option value="">Sem conta vinculada</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          )
        )}

        <div className="row gap-3" style={{ marginBottom: 12 }}>
          {canInstallment && (
            <div style={{ flex: 1 }}>
              <label
                htmlFor="roll-parcelas"
                style={{ display: "block", fontSize: 12.5, color: "var(--text-lo)", marginBottom: 6 }}
              >
                Parcelas
              </label>
              <input
                id="roll-parcelas"
                className="input"
                type="number"
                min={1}
                max={420}
                value={installments}
                onChange={(e) => setInstallments(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                style={{ width: "100%" }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <label
              htmlFor="roll-date"
              style={{ display: "block", fontSize: 12.5, color: "var(--text-lo)", marginBottom: 6 }}
            >
              Vencimento
            </label>
            <input
              id="roll-date"
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div className="summary-box">
          <div className="sb-row total">
            <span className="k">{first} passa a te dever</span>
            <span className="v" style={{ color: "var(--mint-500)" }}>
              {formatBRLAbsolute(total)}
              {canInstallment && installments > 1 ? ` em ${installments}x` : ""}
            </span>
          </div>
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
          <Icon name="repeat" size={17} />
          Rolar dívida
        </button>
      </div>
    </DialogModal>
  );
}

function SettleBody({
  person,
  accounts,
  editing,
  onDone,
}: {
  person: PersonMonthView;
  accounts: AccountOption[];
  editing: SettlementView | null;
  onDone: () => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const router = useRouter();
  // Settle against the REAL booked balance (projected occurrences aren't settleable yet).
  const owes = person.realBalanceCents > 0;
  const max = Math.abs(person.realBalanceCents);
  const first = firstName(person.name);
  const [cents, setCents] = useState(editing ? editing.amountCents : max);
  // The account the money moved through; default to the first wallet for a new acerto so
  // the cash lands in the balance (keeps "fim do mês" consistent). "" = sem conta (perdão).
  const [accountId, setAccountId] = useState<string | null>(
    editing ? editing.accountId : (accounts[0]?.id ?? null),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // When editing, the amount is free (the booked balance already reflects this acerto).
  const applied = editing ? cents : Math.min(cents, max);
  const restante = Math.max(0, max - applied);
  const valid = cents > 0;

  async function confirm() {
    if (!valid || submitting) return;
    setError(null);
    const parsed = settlementInputSchema.safeParse({
      personId: person.id,
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
          value={accountId ?? ""}
          onChange={(e) => setAccountId(e.target.value === "" ? null : e.target.value)}
          style={{ width: "100%", marginBottom: 16 }}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
          <option value="">Sem conta (só baixa / perdão)</option>
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
