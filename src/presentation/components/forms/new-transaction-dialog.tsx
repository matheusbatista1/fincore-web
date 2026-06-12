"use client";

import { type CSSProperties, type ReactNode, useId, useState } from "react";
import { createTransactionAction, updateTransactionAction } from "@/app/_actions/finance";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import type { ExpenseSource } from "@/domain/entities/transaction";
import { Money } from "@/domain/money/money";
import { calculateSplit } from "@/domain/services/split.calculator";
import { Dialog, DialogClose, DialogModal, DialogTrigger } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { useTxUIStore } from "@/presentation/stores/tx-ui-store";
import { toast } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { createTransactionSchema, updateTransactionSchema } from "@/shared/schemas/transaction";
import { resolveBankTheme } from "@/shared/theme/bank-themes";

export interface TxFormAccount {
  readonly id: string;
  readonly bank: string;
  readonly name: string;
  readonly themeKey: string;
  readonly balanceCents: number;
}
export interface TxFormCard {
  readonly id: string;
  readonly bank: string;
}
export interface TxFormPerson {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}
export interface TxFormCategory {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly icon: string;
}

type Tab = "expense" | "income" | "transfer";

const SOURCES: ReadonlyArray<{ id: ExpenseSource; label: string }> = [
  { id: "card", label: "Cartão de crédito" },
  { id: "account", label: "Conta / Pix / débito" },
  { id: "boleto", label: "Boleto" },
  { id: "loan", label: "Empréstimo" },
  { id: "financing", label: "Financiamento" },
  { id: "overdraft", label: "Cheque especial" },
];

const PARCELABLE: ReadonlySet<ExpenseSource> = new Set(["card", "loan", "financing", "boleto"]);
const LINKABLE: ReadonlySet<ExpenseSource> = new Set(["boleto", "loan", "financing", "overdraft"]);

const INFO_STYLE: CSSProperties = {
  fontSize: 12.5,
  color: "var(--text-lo)",
  marginTop: 10,
  display: "flex",
  alignItems: "flex-start",
  gap: 7,
  lineHeight: 1.45,
};

function reaisToCents(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const firstName = (full: string): string => full.split(" ")[0] ?? full;
const accentOf = (a: TxFormAccount): string => resolveBankTheme(a.themeKey, a.bank).accent;

/** A clickable row carrying an `.fc-switch` toggle — keyboard accessible. */
function SwitchRow({
  on,
  onToggle,
  className = "row",
  style,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={className}
      style={{ cursor: "pointer", ...style }}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {children}
      <span className={`fc-switch${on ? " on" : ""}`}>
        <span />
      </span>
    </div>
  );
}

export function NewTransactionDialog({
  accounts,
  cards,
  people,
  categories,
  trigger,
  defaultTab = "expense",
}: {
  accounts: TxFormAccount[];
  cards: TxFormCard[];
  people: TxFormPerson[];
  categories: TxFormCategory[];
  trigger: ReactNode;
  defaultTab?: Tab;
}) {
  const [open, setOpen] = useState(false);
  const formId = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogModal title="Novo lançamento">
        {/* Remount the form each time the dialog opens so state always starts fresh. */}
        {open && (
          <TransactionForm
            key={formId}
            accounts={accounts}
            cards={cards}
            people={people}
            categories={categories}
            defaultTab={defaultTab}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogModal>
    </Dialog>
  );
}

/**
 * Editar lançamento — the prototype reuses NovaTransacao with `initial` (split.jsx):
 * no intent tabs, no fixed/installment toggles, prefilled state, "Salvar" submit.
 * Controlled by the tx-ui-store (opened from the transaction-detail modal).
 */
export function EditTransactionModal({
  accounts,
  cards,
  people,
  categories,
}: {
  accounts: TxFormAccount[];
  cards: TxFormCard[];
  people: TxFormPerson[];
  categories: TxFormCategory[];
}) {
  const editing = useTxUIStore((s) => s.editing);
  const closeEdit = useTxUIStore((s) => s.closeEdit);

  return (
    <Dialog open={editing !== null} onOpenChange={(v) => !v && closeEdit()}>
      {editing && (
        <DialogModal title="Editar lançamento">
          <TransactionForm
            key={editing.id}
            accounts={accounts}
            cards={cards}
            people={people}
            categories={categories}
            defaultTab={editing.kind}
            initial={editing}
            onDone={closeEdit}
          />
        </DialogModal>
      )}
    </Dialog>
  );
}

function TransactionForm({
  accounts,
  cards,
  people,
  categories,
  defaultTab,
  initial,
  onDone,
}: {
  accounts: TxFormAccount[];
  cards: TxFormCard[];
  people: TxFormPerson[];
  categories: TxFormCategory[];
  defaultTab: Tab;
  /** Edit mode (prototype: NovaTransacao with `initial`) — kind locked, no fixed/installment. */
  initial?: TransactionListItem;
  onDone: () => void;
}) {
  const editing = initial !== undefined;
  const initialShares = initial?.shares ?? [];
  // "Equal" only when the person shares match each other AND my share fits the
  // same even division (within rounding remainders) — otherwise saving an
  // untouched form would silently re-equalize a custom split.
  const firstShare = initialShares[0]?.shareCents ?? 0;
  const sharesEqual =
    initialShares.length === 0 ||
    (initialShares.every((s) => s.shareCents === firstShare) &&
      (initial?.myShareCents == null ||
        initial.myShareCents === 0 ||
        Math.abs(initial.myShareCents - firstShare) <= initialShares.length + 1));

  const [tab, setTab] = useState<Tab>(defaultTab);
  const [cents, setCents] = useState(
    initial
      ? Math.abs(initial.kind === "transfer" ? (initial.transferValueCents ?? 0) : initial.amountCents)
      : 0,
  );
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [ymd, setYmd] = useState(initial?.date ?? todayIso());
  const [fixed, setFixed] = useState(false);

  // expense — when editing, a null category stays null (no silent assignment on save).
  const [catId, setCatId] = useState<string | null>(
    editing ? (initial?.categoryId ?? null) : (categories[0]?.id ?? null),
  );
  const [srcType, setSrcType] = useState<ExpenseSource>(initial?.source ?? "card");
  const [cardId, setCardId] = useState<string | null>(initial?.cardId ?? cards[0]?.id ?? null);
  const [acctId, setAcctId] = useState<string | null>(initial?.accountId ?? accounts[0]?.id ?? null);
  const [linkedAccount, setLinkedAccount] = useState<string | null>(initial?.linkedAccountId ?? null);
  const [parcelado, setParcelado] = useState(false);
  const [parcN, setParcN] = useState("2");
  const [parcCur, setParcCur] = useState("1");
  const [parcNext, setParcNext] = useState(true);
  const [parcPrev, setParcPrev] = useState(false);
  const [method, setMethod] = useState<"equal" | "custom">(editing && !sharesEqual ? "custom" : "equal");
  const [meIn, setMeIn] = useState(
    initial ? initial.myShareCents === null || initial.myShareCents > 0 || initialShares.length === 0 : true,
  );
  const [selected, setSelected] = useState<string[]>(initialShares.map((s) => s.personId));
  const [custom, setCustom] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const share of initialShares) {
      map[share.personId] = (share.shareCents / 100).toFixed(2).replace(".", ",");
    }
    return map;
  });

  // income
  const [fromPerson, setFromPerson] = useState<string | null>(initial?.fromPersonId ?? null);

  // transfer
  const [fromAcct, setFromAcct] = useState<string | null>(
    initial?.transferFromAccountId ?? accounts[0]?.id ?? null,
  );
  const [toAcct, setToAcct] = useState<string | null>(
    initial?.transferToAccountId ?? accounts[1]?.id ?? accounts[0]?.id ?? null,
  );

  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canParcel = tab === "expense" && !editing && !fixed && PARCELABLE.has(srcType);
  const n = parcelado && canParcel ? Math.max(2, Number.parseInt(parcN, 10) || 2) : 1;
  const cur = Math.min(n, Math.max(1, Number.parseInt(parcCur, 10) || 1));
  const totalMoney = Money.fromCents(cents);
  const unitMoney = parcelado && canParcel ? totalMoney.divide(n) : totalMoney;
  const unitCents = unitMoney.abs().cents;
  const fixedDay = Number.parseInt(ymd.split("-")[2] ?? "1", 10);

  const customMap = new Map<string, Money>(
    method === "custom" ? selected.map((id) => [id, Money.fromCents(reaisToCents(custom[id] ?? ""))]) : [],
  );
  // Pure, cheap, single source of truth for the live preview — the server recomputes on submit.
  const split = calculateSplit({ unit: unitMoney.abs(), method, meIn, selected, custom: customMap });
  const meShareCents = meIn ? split.myShare.cents : 0;
  const pct = (value: number): number => (unitCents > 0 ? Math.round((value / unitCents) * 100) : 0);

  function toggleSelected(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  const accountName = (id: string | null): string => accounts.find((a) => a.id === id)?.bank ?? "";
  const personFirst = (id: string | null): string => {
    const p = people.find((x) => x.id === id);
    return p ? firstName(p.name) : "";
  };

  const srcOk = srcType === "card" ? Boolean(cardId) : srcType === "account" ? Boolean(acctId) : true;
  const canSubmit =
    cents > 0 &&
    (tab === "expense"
      ? split.valid && srcOk
      : tab === "income"
        ? Boolean(acctId)
        : Boolean(fromAcct) && Boolean(toAcct) && fromAcct !== toAcct);

  function buildPayload(): unknown {
    // Preserve an existing note on edit (the form has no note field).
    const noteField = editing && initial?.note ? { note: initial.note } : {};
    if (tab === "transfer") {
      return {
        kind: "transfer",
        ...(editing && initial ? { id: initial.id } : {}),
        description: desc || "Transferência",
        date: ymd,
        ...noteField,
        fromAccountId: fromAcct,
        toAccountId: toAcct,
        valueCents: cents,
      };
    }
    if (tab === "income") {
      return {
        kind: "income",
        ...(editing && initial ? { id: initial.id } : {}),
        description: desc,
        date: ymd,
        ...noteField,
        amountCents: cents,
        accountId: acctId,
        fromPersonId: fromPerson,
        ...(editing ? {} : { fixed }),
      };
    }
    const customCents: Record<string, number> = {};
    if (method === "custom") {
      for (const id of selected) customCents[id] = reaisToCents(custom[id] ?? "");
    }
    if (editing && initial) {
      return {
        kind: "expense",
        id: initial.id,
        description: desc,
        date: ymd,
        ...noteField,
        amountCents: cents,
        categoryId: catId,
        source: srcType,
        cardId: srcType === "card" ? cardId : null,
        accountId: srcType === "account" ? acctId : null,
        linkedAccountId: LINKABLE.has(srcType) ? linkedAccount : null,
        split: { method, meIn, selected, custom: customCents },
      };
    }
    return {
      kind: "expense",
      description: desc,
      date: ymd,
      totalAmountCents: cents,
      categoryId: catId,
      source: srcType,
      cardId: srcType === "card" ? cardId : null,
      accountId: srcType === "account" ? acctId : null,
      linkedAccountId: LINKABLE.has(srcType) ? linkedAccount : null,
      fixed,
      split: { method, meIn, selected, custom: customCents },
      installment:
        parcelado && canParcel
          ? { total: n, current: cur, includePrevious: parcPrev, includeNext: parcNext }
          : null,
    };
  }

  async function submit() {
    if (!canSubmit || submitting) return;
    setServerError(null);
    const schema = editing ? updateTransactionSchema : createTransactionSchema;
    const parsed = schema.safeParse(buildPayload());
    if (!parsed.success) {
      setServerError("Revise os campos do lançamento.");
      return;
    }
    setSubmitting(true);
    const result = editing
      ? await updateTransactionAction(parsed.data)
      : await createTransactionAction(parsed.data);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast(
      editing
        ? "Lançamento atualizado."
        : tab === "income"
          ? "Receita adicionada."
          : tab === "transfer"
            ? "Transferência feita."
            : "Despesa adicionada.",
    );
    onDone();
  }

  const amountColor =
    tab === "income" ? "var(--mint-500)" : tab === "transfer" ? "var(--sky-500)" : "var(--text-hi)";
  const createdCount = (parcPrev ? cur - 1 : 0) + 1 + (parcNext ? n - cur : 0);

  return (
    <>
      <div className="modal-body">
        {/* despesa / receita / transferência (locked while editing, like the prototype) */}
        {!editing && (
          <div className="seg intent" style={{ marginBottom: 18 }}>
            <button
              type="button"
              className={tab === "expense" ? "on exp" : ""}
              onClick={() => setTab("expense")}
            >
              <Icon name="arrow-up-right" size={15} style={{ marginRight: 6 }} />
              Despesa
            </button>
            <button
              type="button"
              className={tab === "income" ? "on inc" : ""}
              onClick={() => setTab("income")}
            >
              <Icon name="arrow-down-left" size={15} style={{ marginRight: 6 }} />
              Receita
            </button>
            <button
              type="button"
              className={tab === "transfer" ? "on" : ""}
              onClick={() => setTab("transfer")}
            >
              <Icon name="arrow-left-right" size={15} style={{ marginRight: 6 }} />
              Transferência
            </button>
          </div>
        )}

        {/* valor */}
        <input
          className="amount-input"
          value={formatBRLAbsolute(cents)}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            setCents(digits ? Number.parseInt(digits, 10) : 0);
          }}
          inputMode="numeric"
          // biome-ignore lint/a11y/noAutofocus: amount is the first and primary field of the modal.
          autoFocus
          aria-label="Valor"
          style={{ marginBottom: 18, color: amountColor }}
        />

        {/* descrição */}
        <div className="field">
          <label>Descrição</label>
          <input
            className="input"
            placeholder={
              tab === "income"
                ? "Ex.: Salário, freela, reembolso…"
                : tab === "transfer"
                  ? "Ex.: Cobrir fatura, mover saldo…"
                  : "Ex.: Pizza, viagem, mercado…"
            }
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </div>

        {/* data */}
        <div className="field">
          <label>Data{fixed ? " da 1ª ocorrência" : ""}</label>
          <input
            className="input"
            type="date"
            value={ymd}
            onChange={(e) => setYmd(e.target.value || todayIso())}
          />
        </div>

        {/* recorrência (hidden while editing, like the prototype) */}
        {!editing && (
          <div className="field">
            <SwitchRow
              on={fixed}
              onToggle={() => {
                setFixed((v) => !v);
                if (!fixed) setParcelado(false);
              }}
              style={{ justifyContent: "space-between" }}
            >
              <span className="row gap-2">
                <Icon name="repeat" size={15} style={{ color: "var(--purple-300)" }} />
                Lançamento fixo (todo mês)
              </span>
            </SwitchRow>
            {fixed && (
              <div style={INFO_STYLE}>
                <Icon
                  name="info"
                  size={14}
                  style={{ marginTop: 1, color: "var(--purple-300)", flex: "none" }}
                />
                <span>
                  Repete automaticamente <b style={{ color: "var(--text-hi)" }}>todo dia {fixedDay}</b> nos
                  próximos meses. Ideal para salário, aluguel, assinaturas e contas fixas.
                </span>
              </div>
            )}
          </div>
        )}

        {/* TRANSFERÊNCIA */}
        {tab === "transfer" && (
          <div className="xfer-body">
            <div className="field">
              <label>De qual carteira sai?</label>
              <div className="chip-select">
                {accounts.map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    className={`person-chip${fromAcct === a.id ? " on" : ""}`}
                    onClick={() => {
                      setFromAcct(a.id);
                      if (toAcct === a.id) setToAcct(accounts.find((x) => x.id !== a.id)?.id ?? null);
                    }}
                  >
                    <span className="pa" style={{ background: accentOf(a), fontSize: 10 }}>
                      {a.bank.slice(0, 2).toUpperCase()}
                    </span>
                    {a.bank} · {a.name}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center", margin: "-4px 0 6px" }}>
              <span className="xfer-arrow">
                <Icon name="arrow-down" size={18} />
              </span>
            </div>
            <div className="field">
              <label>Para qual carteira vai?</label>
              <div className="chip-select">
                {accounts
                  .filter((a) => a.id !== fromAcct)
                  .map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      className={`person-chip${toAcct === a.id ? " on" : ""}`}
                      onClick={() => setToAcct(a.id)}
                    >
                      <span className="pa" style={{ background: accentOf(a), fontSize: 10 }}>
                        {a.bank.slice(0, 2).toUpperCase()}
                      </span>
                      {a.bank} · {a.name}
                      {a.balanceCents < 0 && (
                        <span
                          className="parc-badge"
                          style={{ marginLeft: 4, background: "var(--rose-soft)", color: "var(--rose-500)" }}
                        >
                          negativada
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            </div>
            <div className="summary-box">
              {fromAcct && (
                <div className="sb-row">
                  <span className="k">Sai de {accountName(fromAcct)}</span>
                  <span className="v" style={{ color: "var(--rose-500)" }}>
                    - {formatBRLAbsolute(cents)}
                  </span>
                </div>
              )}
              {toAcct && fromAcct !== toAcct && (
                <div className="sb-row">
                  <span className="k">Entra em {accountName(toAcct)}</span>
                  <span className="v" style={{ color: "var(--mint-500)" }}>
                    + {formatBRLAbsolute(cents)}
                  </span>
                </div>
              )}
              <div className="sb-row total">
                <span className="k">Transferência</span>
                <span className="v" style={{ color: "var(--sky-500)" }}>
                  {formatBRLAbsolute(cents)}
                </span>
              </div>
              {fromAcct === toAcct && (
                <div className="warn-text">
                  <Icon name="alert-triangle" size={14} />
                  Escolha carteiras diferentes.
                </div>
              )}
            </div>
          </div>
        )}

        {/* RECEITA */}
        {tab === "income" && (
          <>
            <div className="field">
              <label>Cai em qual carteira?</label>
              <div className="chip-select">
                {accounts.map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    className={`person-chip${acctId === a.id ? " on" : ""}`}
                    onClick={() => setAcctId(a.id)}
                  >
                    <Icon
                      name="wallet"
                      size={15}
                      style={{ color: acctId === a.id ? "var(--purple-300)" : "var(--text-lo)" }}
                    />
                    {a.bank} · {a.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>
                É pagamento de alguém?{" "}
                <span style={{ color: "var(--text-lo)", fontWeight: 400 }}>· opcional</span>
              </label>
              <div className="chip-select">
                <button
                  type="button"
                  className={`person-chip${!fromPerson ? " on" : ""}`}
                  onClick={() => setFromPerson(null)}
                >
                  <Icon
                    name="briefcase"
                    size={15}
                    style={{ color: !fromPerson ? "var(--purple-300)" : "var(--text-lo)" }}
                  />
                  Ganho próprio
                </button>
                {people.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className={`person-chip${fromPerson === p.id ? " on" : ""}`}
                    onClick={() => setFromPerson(p.id)}
                  >
                    <span className="pa" style={{ background: p.color }}>
                      {p.name[0]}
                    </span>
                    {firstName(p.name)}
                  </button>
                ))}
              </div>
              {fromPerson && (
                <div style={INFO_STYLE}>
                  <Icon
                    name="info"
                    size={14}
                    style={{ marginTop: 1, color: "var(--mint-500)", flex: "none" }}
                  />
                  <span>
                    Abate <b style={{ color: "var(--text-hi)" }}>{formatBRLAbsolute(cents)}</b> da dívida de{" "}
                    {personFirst(fromPerson)}. Não conta como sua renda no modo Pessoal.
                  </span>
                </div>
              )}
            </div>
            <div className="summary-box">
              <div className="sb-row">
                <span className="k">Entrada na carteira</span>
                <span className="v" style={{ color: "var(--mint-500)" }}>
                  + {formatBRLAbsolute(cents)}
                </span>
              </div>
              {fromPerson && (
                <div className="sb-row">
                  <span className="k">Abate da dívida de {personFirst(fromPerson)}</span>
                  <span className="v" style={{ color: "var(--purple-300)" }}>
                    - {formatBRLAbsolute(cents)}
                  </span>
                </div>
              )}
              <div className="sb-row total">
                <span className="k">{fromPerson ? "Pagamento recebido" : "Receita registrada"}</span>
                <span className="v">{formatBRLAbsolute(cents)}</span>
              </div>
            </div>
          </>
        )}

        {/* DESPESA */}
        {tab === "expense" && (
          <div className="exp-body">
            <div className="field">
              <label>Categoria</label>
              <div className="chip-select">
                {categories.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    className={`person-chip${catId === c.id ? " on" : ""}`}
                    onClick={() => setCatId(c.id)}
                  >
                    <span className="pa" style={{ background: c.color, width: 24, height: 24 }}>
                      <Icon name={c.icon} size={13} />
                    </span>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Forma de pagamento</label>
              <select
                className="input"
                value={srcType}
                onChange={(e) => setSrcType(e.target.value as ExpenseSource)}
              >
                {SOURCES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {srcType === "card" && (
              <div className="field">
                <label>Qual cartão?</label>
                <div className="chip-select">
                  {cards.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      className={`person-chip${cardId === c.id ? " on" : ""}`}
                      onClick={() => setCardId(c.id)}
                    >
                      <Icon
                        name="credit-card"
                        size={15}
                        style={{ color: cardId === c.id ? "var(--purple-300)" : "var(--text-lo)" }}
                      />
                      {c.bank}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {srcType === "account" && (
              <div className="field">
                <label>
                  De qual carteira?{" "}
                  <span style={{ color: "var(--text-lo)", fontWeight: 400 }}>· debita o saldo</span>
                </label>
                <div className="chip-select">
                  {accounts.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      className={`person-chip${acctId === a.id ? " on" : ""}`}
                      onClick={() => setAcctId(a.id)}
                    >
                      <Icon
                        name="wallet"
                        size={15}
                        style={{ color: acctId === a.id ? "var(--purple-300)" : "var(--text-lo)" }}
                      />
                      {a.bank} · {a.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {LINKABLE.has(srcType) && (
              <div className="field">
                <label>
                  Vincular a um banco{" "}
                  <span style={{ color: "var(--text-lo)", fontWeight: 400 }}>
                    · opcional{srcType === "overdraft" ? " · conta do cheque especial" : ""}
                  </span>
                </label>
                <div className="chip-select">
                  <button
                    type="button"
                    className={`person-chip${!linkedAccount ? " on" : ""}`}
                    onClick={() => setLinkedAccount(null)}
                  >
                    <Icon
                      name="ban"
                      size={15}
                      style={{ color: !linkedAccount ? "var(--purple-300)" : "var(--text-lo)" }}
                    />
                    Sem vínculo
                  </button>
                  {accounts.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      className={`person-chip${linkedAccount === a.id ? " on" : ""}`}
                      onClick={() => setLinkedAccount(a.id)}
                    >
                      <Icon
                        name="landmark"
                        size={15}
                        style={{ color: linkedAccount === a.id ? "var(--purple-300)" : "var(--text-lo)" }}
                      />
                      {a.bank} · {a.name}
                    </button>
                  ))}
                </div>
                <div style={INFO_STYLE}>
                  <Icon
                    name="info"
                    size={14}
                    style={{ marginTop: 1, color: "var(--purple-300)", flex: "none" }}
                  />
                  <span>
                    Lançado como{" "}
                    <b style={{ color: "var(--text-hi)" }}>{SOURCES.find((s) => s.id === srcType)?.label}</b>.
                    Entra nos relatórios e pode ser parcelado/rateado; o vínculo é só para organização e não
                    debita o saldo.
                  </span>
                </div>
              </div>
            )}

            {/* PARCELAMENTO */}
            {canParcel && (
              <div className="field">
                <SwitchRow
                  on={parcelado}
                  onToggle={() => setParcelado((v) => !v)}
                  style={{ justifyContent: "space-between" }}
                >
                  <span className="row gap-2">
                    <Icon name="layers" size={15} style={{ color: "var(--purple-300)" }} />
                    Compra parcelada
                  </span>
                </SwitchRow>
                {parcelado && (
                  <div
                    style={{
                      marginTop: 12,
                      background: "var(--surface-2)",
                      border: "1px solid var(--line)",
                      borderRadius: "var(--r-md)",
                      padding: 16,
                    }}
                  >
                    <div className="form-grid-2" style={{ marginBottom: 14 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Total de parcelas</label>
                        <input
                          className="input tnum"
                          inputMode="numeric"
                          value={parcN}
                          onChange={(e) => setParcN(e.target.value.replace(/\D/g, ""))}
                          placeholder="10"
                        />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Parcela atual</label>
                        <input
                          className="input tnum"
                          inputMode="numeric"
                          value={parcCur}
                          onChange={(e) => setParcCur(e.target.value.replace(/\D/g, ""))}
                          placeholder="1"
                        />
                      </div>
                    </div>
                    <div className="parc-readout">
                      <span className="row gap-2">
                        <Icon name="calendar-clock" size={15} style={{ color: "var(--purple-300)" }} />
                        Parcela <b style={{ color: "var(--text-hi)", margin: "0 3px" }}>{cur}</b> de{" "}
                        <b style={{ color: "var(--text-hi)", margin: "0 3px" }}>{n}</b>
                      </span>
                      <span className="tnum" style={{ color: "var(--text-hi)", fontWeight: 700 }}>
                        {n}× {formatBRLAbsolute(unitCents)}
                      </span>
                    </div>
                    <SwitchRow on={parcNext} onToggle={() => setParcNext((v) => !v)} className="parc-toggle">
                      <span>
                        <b>Auto-preencher próximas</b>
                        <small>
                          {cur < n
                            ? `Lança ${cur + 1} até ${n} (${n - cur} futuras)`
                            : "Lança as parcelas seguintes"}
                        </small>
                      </span>
                    </SwitchRow>
                    {cur > 1 && (
                      <SwitchRow
                        on={parcPrev}
                        onToggle={() => setParcPrev((v) => !v)}
                        className="parc-toggle"
                      >
                        <span>
                          <b>Lançar anteriores</b>
                          <small>
                            Registra 1 até {cur - 1} ({cur - 1} já pagas) para histórico
                          </small>
                        </span>
                      </SwitchRow>
                    )}
                    <div style={{ ...INFO_STYLE, marginTop: 12 }}>
                      <Icon
                        name="info"
                        size={14}
                        style={{ marginTop: 1, color: "var(--purple-300)", flex: "none" }}
                      />
                      <span>
                        Serão criados <b style={{ color: "var(--text-hi)" }}>{createdCount}</b> lançamentos.
                        Apenas a parcela atual ({cur}) afeta a fatura/saldo agora.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* método */}
            <div className="field">
              <label>Método de divisão</label>
              <div className="seg">
                <button
                  type="button"
                  className={method === "equal" ? "on" : ""}
                  onClick={() => setMethod("equal")}
                >
                  Dividir igual
                </button>
                <button
                  type="button"
                  className={method === "custom" ? "on" : ""}
                  onClick={() => setMethod("custom")}
                >
                  Personalizado
                </button>
              </div>
            </div>

            {/* participantes */}
            <div className="field">
              <label>Quem entra no rateio?</label>
              <div className="chip-select">
                <button
                  type="button"
                  className={`person-chip${meIn ? " on" : ""}`}
                  onClick={() => setMeIn((v) => !v)}
                >
                  <span
                    className="pa"
                    style={{ background: "linear-gradient(135deg,var(--purple-400),var(--purple-700))" }}
                  >
                    EU
                  </span>
                  Você
                  <span className="check">
                    <Icon name="check" size={14} />
                  </span>
                </button>
                {people.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className={`person-chip${selected.includes(p.id) ? " on" : ""}`}
                    onClick={() => toggleSelected(p.id)}
                  >
                    <span className="pa" style={{ background: p.color }}>
                      {p.name[0]}
                    </span>
                    {firstName(p.name)}
                    <span className="check">
                      <Icon name="check" size={14} />
                    </span>
                  </button>
                ))}
              </div>
              <div style={INFO_STYLE}>
                <Icon
                  name="info"
                  size={14}
                  style={{ marginTop: 1, color: "var(--purple-300)", flex: "none" }}
                />
                <span>
                  {meIn
                    ? "Você está incluído. Remova “Você” se pagou no seu cartão mas a despesa é só de outras pessoas."
                    : "Você está fora (paga R$ 0,00). O valor divide entre as pessoas selecionadas."}
                </span>
              </div>
              <div className="row gap-2" style={{ marginTop: 12 }}>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text-faint)",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  Atalhos
                </span>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  style={{ height: 30 }}
                  onClick={() => {
                    setMethod("equal");
                    setMeIn(true);
                    setSelected([]);
                  }}
                >
                  Só eu
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  style={{ height: 30 }}
                  onClick={() => {
                    setMethod("equal");
                    setMeIn(true);
                    setSelected(people.map((p) => p.id));
                  }}
                >
                  Todos
                </button>
              </div>
            </div>

            {/* divisão */}
            {(meIn || selected.length > 0) && (
              <div className="field">
                <label>{parcelado && canParcel ? "Divisão por parcela" : "Divisão"}</label>
                <div
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--r-md)",
                    padding: "4px 16px",
                  }}
                >
                  <div className="split-row" style={{ opacity: meIn ? 1 : 0.5 }}>
                    <div className="sr-name">
                      <span
                        className="pa"
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: "50%",
                          display: "grid",
                          placeItems: "center",
                          background: "linear-gradient(135deg,var(--purple-400),var(--purple-700))",
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        EU
                      </span>
                      Você{" "}
                      {!meIn && (
                        <span style={{ fontSize: 11.5, color: "var(--text-lo)", fontWeight: 500 }}>
                          · fora
                        </span>
                      )}
                    </div>
                    <div className="sr-amt">
                      <div
                        className="input"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          background: "transparent",
                          border: 0,
                          height: 40,
                          fontWeight: 700,
                          color: meShareCents < 0 ? "var(--rose-500)" : "var(--text-hi)",
                        }}
                      >
                        {formatBRLAbsolute(meShareCents)}
                      </div>
                    </div>
                    <div className="sr-share">{pct(meShareCents)}%</div>
                  </div>
                  {selected.map((id) => {
                    const p = people.find((x) => x.id === id);
                    if (!p) return null;
                    const shareCents = split.shares.get(id)?.cents ?? 0;
                    return (
                      <div className="split-row" key={id}>
                        <div className="sr-name">
                          <span
                            className="pa"
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: "50%",
                              display: "grid",
                              placeItems: "center",
                              background: p.color,
                              color: "#fff",
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            {p.name[0]}
                          </span>
                          {firstName(p.name)}
                        </div>
                        <div className="sr-amt">
                          {method === "custom" ? (
                            <input
                              className="input"
                              inputMode="decimal"
                              placeholder="0,00"
                              value={custom[id] ?? ""}
                              onChange={(e) =>
                                // Keep the raw pt-BR text; reaisToCents treats "," as the decimal mark.
                                setCustom((c) => ({ ...c, [id]: e.target.value }))
                              }
                            />
                          ) : (
                            <div
                              className="input"
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "flex-end",
                                background: "transparent",
                                border: 0,
                                height: 40,
                                fontWeight: 700,
                                color: "var(--text-hi)",
                              }}
                            >
                              {formatBRLAbsolute(shareCents)}
                            </div>
                          )}
                        </div>
                        <div className="sr-share">{pct(shareCents)}%</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* resumo */}
            <div className="summary-box">
              <div className="sb-row">
                <span className="k">Sua parte{parcelado && canParcel ? " (por parcela)" : ""}</span>
                <span className="v">{formatBRLAbsolute(Math.max(0, meShareCents))}</span>
              </div>
              <div className="sb-row">
                <span className="k">
                  {meIn ? "Pendente de terceiros" : "A receber das pessoas"}
                  {parcelado && canParcel ? " (por parcela)" : ""}
                </span>
                <span className="v" style={{ color: "var(--mint-500)" }}>
                  {formatBRLAbsolute(split.othersTotal.cents)}
                </span>
              </div>
              {parcelado && canParcel && (
                <div className="sb-row">
                  <span className="k">Valor da parcela</span>
                  <span className="v">
                    {n}× {formatBRLAbsolute(unitCents)}
                  </span>
                </div>
              )}
              <div className="sb-row total">
                <span className="k">Total da despesa</span>
                <span className="v">{formatBRLAbsolute(cents)}</span>
              </div>
              {split.warning && (
                <div className="warn-text">
                  <Icon name="alert-triangle" size={14} />
                  {split.warning}
                </div>
              )}
            </div>
          </div>
        )}

        {serverError && (
          <div className="warn-text" style={{ marginTop: 4 }}>
            <Icon name="alert-triangle" size={14} />
            {serverError}
          </div>
        )}
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
          disabled={!canSubmit || submitting}
          style={{
            opacity: canSubmit && !submitting ? 1 : 0.45,
            pointerEvents: canSubmit && !submitting ? "auto" : "none",
          }}
          onClick={submit}
        >
          <Icon name="check" size={17} />
          {submitting
            ? "Salvando…"
            : editing
              ? "Salvar"
              : tab === "income"
                ? "Adicionar receita"
                : tab === "transfer"
                  ? "Transferir"
                  : "Adicionar despesa"}
        </button>
      </div>
    </>
  );
}
