"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  Info,
  Layers,
  Repeat,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { createTransactionAction } from "@/app/_actions/finance";
import type { ExpenseSource } from "@/domain/entities/transaction";
import { Money } from "@/domain/money/money";
import { calculateSplit } from "@/domain/services/split.calculator";
import { Button } from "@/presentation/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/presentation/components/ui/dialog";
import { cn } from "@/presentation/lib/cn";
import { formatBRL } from "@/shared/formatting/currency";
import { createTransactionSchema } from "@/shared/schemas/transaction";

export interface TxFormAccount {
  readonly id: string;
  readonly bank: string;
  readonly name: string;
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
const initial = (full: string): string => full.charAt(0).toUpperCase();

// ---- small presentational helpers -------------------------------------------------

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-pill border px-3 py-2 text-sm font-medium transition",
        active
          ? "border-purple-400 bg-purple-soft text-text-hi"
          : "border-line bg-surface-2 text-text-mid hover:border-line-2 hover:text-text-hi",
      )}
    >
      {children}
    </button>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-pill transition",
        on ? "bg-purple-500" : "bg-surface-3",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-white transition",
          on ? "left-[22px]" : "left-0.5",
        )}
      />
    </span>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-text-lo">{children}</span>
  );
}

function Avatar({ color, className, children }: { color?: string; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "grid size-6 place-items-center rounded-full text-[11px] font-bold text-white",
        className,
      )}
      style={color ? { background: color } : undefined}
    >
      {children}
    </span>
  );
}

function SummaryRow({
  label,
  value,
  tone,
  total,
}: {
  label: string;
  value: ReactNode;
  tone?: "mint" | "purple" | "sky" | "rose";
  total?: boolean;
}) {
  const toneClass =
    tone === "mint"
      ? "text-mint-500"
      : tone === "purple"
        ? "text-purple-300"
        : tone === "sky"
          ? "text-sky-500"
          : tone === "rose"
            ? "text-rose-500"
            : "text-text-hi";
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-2 text-sm",
        total && "mt-1 border-t border-line pt-3 font-semibold",
      )}
    >
      <span className="text-text-mid">{label}</span>
      <span className={cn("tnum font-semibold", toneClass)}>{value}</span>
    </div>
  );
}

// ---- the dialog --------------------------------------------------------------------

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
      <DialogContent title="Novo lançamento">
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
      </DialogContent>
    </Dialog>
  );
}

function TransactionForm({
  accounts,
  cards,
  people,
  categories,
  defaultTab,
  onDone,
}: {
  accounts: TxFormAccount[];
  cards: TxFormCard[];
  people: TxFormPerson[];
  categories: TxFormCategory[];
  defaultTab: Tab;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [cents, setCents] = useState(0);
  const [desc, setDesc] = useState("");
  const [ymd, setYmd] = useState(todayIso());
  const [fixed, setFixed] = useState(false);

  // expense
  const [catId, setCatId] = useState<string | null>(categories[0]?.id ?? null);
  const [srcType, setSrcType] = useState<ExpenseSource>("card");
  const [cardId, setCardId] = useState<string | null>(cards[0]?.id ?? null);
  const [acctId, setAcctId] = useState<string | null>(accounts[0]?.id ?? null);
  const [linkedAccount, setLinkedAccount] = useState<string | null>(null);
  const [parcelado, setParcelado] = useState(false);
  const [parcN, setParcN] = useState("2");
  const [parcCur, setParcCur] = useState("1");
  const [parcNext, setParcNext] = useState(true);
  const [parcPrev, setParcPrev] = useState(false);
  const [method, setMethod] = useState<"equal" | "custom">("equal");
  const [meIn, setMeIn] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState<Record<string, string>>({});

  // income
  const [fromPerson, setFromPerson] = useState<string | null>(null);

  // transfer
  const [fromAcct, setFromAcct] = useState<string | null>(accounts[0]?.id ?? null);
  const [toAcct, setToAcct] = useState<string | null>(accounts[1]?.id ?? accounts[0]?.id ?? null);

  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canParcel = tab === "expense" && !fixed && PARCELABLE.has(srcType);
  const n = parcelado && canParcel ? Math.max(2, Number.parseInt(parcN, 10) || 2) : 1;
  const cur = Math.min(n, Math.max(1, Number.parseInt(parcCur, 10) || 1));
  const totalMoney = Money.fromCents(cents);
  const unitMoney = parcelado && canParcel ? totalMoney.divide(n) : totalMoney;
  const fixedDay = Number.parseInt(ymd.split("-")[2] ?? "1", 10);

  const customMap = new Map<string, Money>(
    method === "custom" ? selected.map((id) => [id, Money.fromCents(reaisToCents(custom[id] ?? ""))]) : [],
  );
  // Pure, cheap, single source of truth for the live preview — the server recomputes on submit.
  const split = calculateSplit({ unit: unitMoney.abs(), method, meIn, selected, custom: customMap });

  function toggleSelected(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  const srcOk = srcType === "card" ? Boolean(cardId) : srcType === "account" ? Boolean(acctId) : true;
  const canSubmit =
    cents > 0 &&
    (tab === "expense"
      ? split.valid && srcOk
      : tab === "income"
        ? Boolean(acctId)
        : Boolean(fromAcct) && Boolean(toAcct) && fromAcct !== toAcct);

  function buildPayload(): unknown {
    if (tab === "transfer") {
      return {
        kind: "transfer",
        description: desc || "Transferência",
        date: ymd,
        fromAccountId: fromAcct,
        toAccountId: toAcct,
        valueCents: cents,
      };
    }
    if (tab === "income") {
      return {
        kind: "income",
        description: desc,
        date: ymd,
        amountCents: cents,
        accountId: acctId,
        fromPersonId: fromPerson,
        fixed,
      };
    }
    const customCents: Record<string, number> = {};
    if (method === "custom") {
      for (const id of selected) customCents[id] = reaisToCents(custom[id] ?? "");
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
    const parsed = createTransactionSchema.safeParse(buildPayload());
    if (!parsed.success) {
      setServerError("Revise os campos do lançamento.");
      return;
    }
    setSubmitting(true);
    const result = await createTransactionAction(parsed.data);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    onDone();
  }

  const amountColor =
    tab === "income" ? "text-mint-500" : tab === "transfer" ? "text-sky-500" : "text-text-hi";

  const createdCount = (parcPrev ? cur - 1 : 0) + 1 + (parcNext ? n - cur : 0);

  return (
    <div className="flex flex-col gap-4">
      {/* intent */}
      <div className="grid grid-cols-3 gap-1 rounded-pill bg-surface-2 p-1">
        {(
          [
            { id: "expense", label: "Despesa", icon: ArrowUpRight },
            { id: "income", label: "Receita", icon: ArrowDownLeft },
            { id: "transfer", label: "Transferência", icon: ArrowLeftRight },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-pill py-2 text-sm font-semibold transition",
              tab === t.id ? "bg-surface-3 text-text-hi shadow-1" : "text-text-lo hover:text-text-hi",
            )}
          >
            <t.icon size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {/* amount */}
      <label className="block">
        <span className="sr-only">Valor</span>
        <input
          value={formatBRL(cents, { withSign: false })}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            setCents(digits ? Number.parseInt(digits, 10) : 0);
          }}
          inputMode="numeric"
          // biome-ignore lint/a11y/noAutofocus: amount is the first and primary field of the modal.
          autoFocus
          className={cn(
            "w-full bg-transparent text-center font-display text-4xl font-semibold tabular-nums outline-none",
            amountColor,
          )}
        />
      </label>

      {/* description */}
      <label className="block">
        <FieldLabel>Descrição</FieldLabel>
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={
            tab === "income"
              ? "Ex.: Salário, freela, reembolso…"
              : tab === "transfer"
                ? "Ex.: Cobrir fatura, mover saldo…"
                : "Ex.: Pizza, viagem, mercado…"
          }
          className="h-11 w-full rounded-sm border border-line bg-surface-3 px-3 text-text-hi outline-none transition placeholder:text-text-faint focus:border-purple-400"
        />
      </label>

      {/* date */}
      <label className="block">
        <FieldLabel>Data{fixed ? " da 1ª ocorrência" : ""}</FieldLabel>
        <input
          type="date"
          value={ymd}
          onChange={(e) => setYmd(e.target.value || todayIso())}
          className="h-11 w-full rounded-sm border border-line bg-surface-3 px-3 text-text-hi outline-none transition focus:border-purple-400"
        />
      </label>

      {/* fixed toggle */}
      <button
        type="button"
        onClick={() => {
          setFixed((v) => !v);
          if (!fixed) setParcelado(false);
        }}
        className="flex items-center justify-between gap-3 text-sm"
      >
        <span className="flex items-center gap-2 text-text-mid">
          <Repeat size={15} className="text-purple-300" />
          Lançamento fixo (todo mês)
        </span>
        <Toggle on={fixed} />
      </button>
      {fixed && (
        <p className="-mt-1 flex items-start gap-2 text-xs leading-relaxed text-text-lo">
          <Info size={14} className="mt-0.5 shrink-0 text-purple-300" />
          <span>
            Repete automaticamente <b className="text-text-hi">todo dia {fixedDay}</b> nos próximos meses.
          </span>
        </p>
      )}

      {/* ---------------- TRANSFER ---------------- */}
      {tab === "transfer" && (
        <>
          <div>
            <FieldLabel>De qual carteira sai?</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {accounts.map((a) => (
                <Chip
                  key={a.id}
                  active={fromAcct === a.id}
                  onClick={() => {
                    setFromAcct(a.id);
                    if (toAcct === a.id) setToAcct(accounts.find((x) => x.id !== a.id)?.id ?? null);
                  }}
                >
                  {a.bank} · {a.name}
                </Chip>
              ))}
            </div>
          </div>
          <div className="flex justify-center text-text-lo">
            <ArrowDown size={18} />
          </div>
          <div>
            <FieldLabel>Para qual carteira vai?</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {accounts
                .filter((a) => a.id !== fromAcct)
                .map((a) => (
                  <Chip key={a.id} active={toAcct === a.id} onClick={() => setToAcct(a.id)}>
                    {a.bank} · {a.name}
                  </Chip>
                ))}
            </div>
          </div>
          <div className="rounded-lg border border-line bg-surface-2 px-4">
            <SummaryRow
              label="Transferência"
              value={formatBRL(cents, { withSign: false })}
              tone="sky"
              total
            />
          </div>
        </>
      )}

      {/* ---------------- INCOME ---------------- */}
      {tab === "income" && (
        <>
          <div>
            <FieldLabel>Cai em qual carteira?</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {accounts.map((a) => (
                <Chip key={a.id} active={acctId === a.id} onClick={() => setAcctId(a.id)}>
                  {a.bank} · {a.name}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel>
              É pagamento de alguém? <span className="font-normal text-text-lo">· opcional</span>
            </FieldLabel>
            <div className="flex flex-wrap gap-2">
              <Chip active={!fromPerson} onClick={() => setFromPerson(null)}>
                Ganho próprio
              </Chip>
              {people.map((p) => (
                <Chip key={p.id} active={fromPerson === p.id} onClick={() => setFromPerson(p.id)}>
                  <Avatar color={p.color}>{initial(p.name)}</Avatar>
                  {firstName(p.name)}
                </Chip>
              ))}
            </div>
            {fromPerson && (
              <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-text-lo">
                <Info size={14} className="mt-0.5 shrink-0 text-mint-500" />
                <span>Abate da dívida desta pessoa e não conta como sua renda no modo Pessoal.</span>
              </p>
            )}
          </div>
          <div className="rounded-lg border border-line bg-surface-2 px-4">
            <SummaryRow
              label="Entrada na carteira"
              value={`+ ${formatBRL(cents, { withSign: false })}`}
              tone="mint"
              total
            />
          </div>
        </>
      )}

      {/* ---------------- EXPENSE ---------------- */}
      {tab === "expense" && (
        <>
          <div>
            <FieldLabel>Categoria</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <Chip key={c.id} active={catId === c.id} onClick={() => setCatId(c.id)}>
                  <span className="size-3 rounded-full" style={{ background: c.color }} />
                  {c.name}
                </Chip>
              ))}
            </div>
          </div>

          <label className="block">
            <FieldLabel>Forma de pagamento</FieldLabel>
            <select
              value={srcType}
              onChange={(e) => setSrcType(e.target.value as ExpenseSource)}
              className="h-11 w-full rounded-sm border border-line bg-surface-3 px-3 text-text-hi outline-none transition focus:border-purple-400"
            >
              {SOURCES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          {srcType === "card" && (
            <div>
              <FieldLabel>Qual cartão?</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {cards.map((c) => (
                  <Chip key={c.id} active={cardId === c.id} onClick={() => setCardId(c.id)}>
                    {c.bank}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {srcType === "account" && (
            <div>
              <FieldLabel>
                De qual carteira? <span className="font-normal text-text-lo">· debita o saldo</span>
              </FieldLabel>
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => (
                  <Chip key={a.id} active={acctId === a.id} onClick={() => setAcctId(a.id)}>
                    {a.bank} · {a.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {LINKABLE.has(srcType) && (
            <div>
              <FieldLabel>
                Vincular a um banco <span className="font-normal text-text-lo">· opcional</span>
              </FieldLabel>
              <div className="flex flex-wrap gap-2">
                <Chip active={!linkedAccount} onClick={() => setLinkedAccount(null)}>
                  Sem vínculo
                </Chip>
                {accounts.map((a) => (
                  <Chip key={a.id} active={linkedAccount === a.id} onClick={() => setLinkedAccount(a.id)}>
                    {a.bank} · {a.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {/* installments */}
          {canParcel && (
            <div>
              <button
                type="button"
                onClick={() => setParcelado((v) => !v)}
                className="flex w-full items-center justify-between gap-3 text-sm"
              >
                <span className="flex items-center gap-2 text-text-mid">
                  <Layers size={15} className="text-purple-300" />
                  Compra parcelada
                </span>
                <Toggle on={parcelado} />
              </button>
              {parcelado && (
                <div className="mt-3 rounded-lg border border-line bg-surface-2 p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <FieldLabel>Total de parcelas</FieldLabel>
                      <input
                        inputMode="numeric"
                        value={parcN}
                        onChange={(e) => setParcN(e.target.value.replace(/\D/g, ""))}
                        placeholder="10"
                        className="h-11 w-full rounded-sm border border-line bg-surface-3 px-3 text-text-hi tabular-nums outline-none focus:border-purple-400"
                      />
                    </label>
                    <label className="block">
                      <FieldLabel>Parcela atual</FieldLabel>
                      <input
                        inputMode="numeric"
                        value={parcCur}
                        onChange={(e) => setParcCur(e.target.value.replace(/\D/g, ""))}
                        placeholder="1"
                        className="h-11 w-full rounded-sm border border-line bg-surface-3 px-3 text-text-hi tabular-nums outline-none focus:border-purple-400"
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-text-mid">
                      Parcela <b className="text-text-hi">{cur}</b> de <b className="text-text-hi">{n}</b>
                    </span>
                    <span className="tnum font-bold text-text-hi">
                      {n}× {formatBRL(unitMoney.abs().cents, { withSign: false })}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setParcNext((v) => !v)}
                    className="mt-3 flex w-full items-center justify-between gap-3 border-t border-line pt-3 text-left text-sm"
                  >
                    <span>
                      <b className="text-text-hi">Auto-preencher próximas</b>
                      <small className="block text-text-lo">
                        {cur < n ? `Lança ${cur + 1} até ${n} (${n - cur} futuras)` : "Lança as seguintes"}
                      </small>
                    </span>
                    <Toggle on={parcNext} />
                  </button>
                  {cur > 1 && (
                    <button
                      type="button"
                      onClick={() => setParcPrev((v) => !v)}
                      className="mt-2 flex w-full items-center justify-between gap-3 text-left text-sm"
                    >
                      <span>
                        <b className="text-text-hi">Lançar anteriores</b>
                        <small className="block text-text-lo">
                          Registra 1 até {cur - 1} ({cur - 1} já pagas) para histórico
                        </small>
                      </span>
                      <Toggle on={parcPrev} />
                    </button>
                  )}
                  <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-text-lo">
                    <Info size={14} className="mt-0.5 shrink-0 text-purple-300" />
                    <span>
                      Serão criados <b className="text-text-hi">{createdCount}</b> lançamentos. Apenas a
                      parcela atual ({cur}) afeta a fatura/saldo agora.
                    </span>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* split method */}
          <div>
            <FieldLabel>Método de divisão</FieldLabel>
            <div className="grid grid-cols-2 gap-1 rounded-pill bg-surface-2 p-1">
              {(
                [
                  { id: "equal", label: "Dividir igual" },
                  { id: "custom", label: "Personalizado" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={cn(
                    "rounded-pill py-2 text-sm font-semibold transition",
                    method === m.id
                      ? "bg-surface-3 text-text-hi shadow-1"
                      : "text-text-lo hover:text-text-hi",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* participants */}
          <div>
            <FieldLabel>Quem entra no rateio?</FieldLabel>
            <div className="flex flex-wrap gap-2">
              <Chip active={meIn} onClick={() => setMeIn((v) => !v)}>
                <Avatar className="bg-gradient-to-br from-purple-400 to-purple-700">EU</Avatar>
                Você
                {meIn && <Check size={14} className="text-purple-300" />}
              </Chip>
              {people.map((p) => (
                <Chip key={p.id} active={selected.includes(p.id)} onClick={() => toggleSelected(p.id)}>
                  <Avatar color={p.color}>{initial(p.name)}</Avatar>
                  {firstName(p.name)}
                  {selected.includes(p.id) && <Check size={14} className="text-purple-300" />}
                </Chip>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-text-faint">Atalhos</span>
              <button
                type="button"
                onClick={() => {
                  setMethod("equal");
                  setMeIn(true);
                  setSelected([]);
                }}
                className="rounded-sm px-2.5 py-1 text-sm text-text-mid transition hover:bg-surface-2 hover:text-text-hi"
              >
                Só eu
              </button>
              <button
                type="button"
                onClick={() => {
                  setMethod("equal");
                  setMeIn(true);
                  setSelected(people.map((p) => p.id));
                }}
                className="rounded-sm px-2.5 py-1 text-sm text-text-mid transition hover:bg-surface-2 hover:text-text-hi"
              >
                Todos
              </button>
            </div>
          </div>

          {/* split breakdown */}
          {(meIn || selected.length > 0) && (
            <div>
              <FieldLabel>{parcelado && canParcel ? "Divisão por parcela" : "Divisão"}</FieldLabel>
              <div className="rounded-lg border border-line bg-surface-2 px-4">
                <div
                  className={cn(
                    "flex items-center justify-between gap-3 border-b border-line py-2.5",
                    !meIn && "opacity-50",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm text-text-hi">
                    <Avatar className="bg-gradient-to-br from-purple-400 to-purple-700">EU</Avatar>
                    Você {!meIn && <span className="text-xs text-text-lo">· fora</span>}
                  </span>
                  <span
                    className={cn(
                      "tnum text-sm font-bold",
                      split.myShare.isNegative() ? "text-rose-500" : "text-text-hi",
                    )}
                  >
                    {formatBRL((meIn ? split.myShare : Money.zero()).cents, { withSign: false })}
                  </span>
                </div>
                {selected.map((id) => {
                  const p = people.find((x) => x.id === id);
                  if (!p) return null;
                  const shareCents = split.shares.get(id)?.cents ?? 0;
                  return (
                    <div
                      key={id}
                      className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-0"
                    >
                      <span className="flex items-center gap-2 text-sm text-text-hi">
                        <Avatar color={p.color}>{initial(p.name)}</Avatar>
                        {firstName(p.name)}
                      </span>
                      {method === "custom" ? (
                        <input
                          inputMode="decimal"
                          placeholder="0,00"
                          value={custom[id] ?? ""}
                          onChange={(e) => setCustom((c) => ({ ...c, [id]: e.target.value }))}
                          className="h-9 w-28 rounded-sm border border-line bg-surface-3 px-2 text-right text-sm text-text-hi tabular-nums outline-none focus:border-purple-400"
                        />
                      ) : (
                        <span className="tnum text-sm font-bold text-text-hi">
                          {formatBRL(shareCents, { withSign: false })}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* summary */}
          <div className="rounded-lg border border-line bg-surface-2 px-4">
            <SummaryRow
              label={`Sua parte${parcelado && canParcel ? " (por parcela)" : ""}`}
              value={formatBRL(Math.max(0, split.myShare.cents), { withSign: false })}
            />
            <SummaryRow
              label={`${meIn ? "Pendente de terceiros" : "A receber das pessoas"}${
                parcelado && canParcel ? " (por parcela)" : ""
              }`}
              value={formatBRL(split.othersTotal.cents, { withSign: false })}
              tone="mint"
            />
            <SummaryRow label="Total da despesa" value={formatBRL(cents, { withSign: false })} total />
            {split.warning && (
              <p className="flex items-center gap-2 pb-3 text-sm text-rose-500">
                <AlertTriangle size={14} />
                {split.warning}
              </p>
            )}
          </div>
        </>
      )}

      {serverError && <p className="text-sm text-rose-500">{serverError}</p>}

      <div className="mt-1 flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="ghost">Cancelar</Button>
        </DialogClose>
        <Button onClick={submit} disabled={!canSubmit || submitting}>
          <Check size={17} />
          {submitting
            ? "Salvando…"
            : tab === "income"
              ? "Adicionar receita"
              : tab === "transfer"
                ? "Transferir"
                : "Adicionar despesa"}
        </Button>
      </div>
    </div>
  );
}
