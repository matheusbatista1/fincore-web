"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type ReconcileActionState, reconcileStatementAction } from "@/app/_actions/finance";
import type {
  ReconcileMatch,
  ReconcileResult,
  ReconcileRow,
} from "@/application/use-cases/reconcile-statement";
import { addMonths } from "@/domain/value-objects/competence-month";
import { Icon } from "@/presentation/components/ui/icon";
import { openTxDetail, type TxDraft, useTxUIStore } from "@/presentation/stores/tx-ui-store";
import { formatBRL } from "@/shared/formatting/currency";
import { monthLabel } from "@/shared/formatting/dates";
import {
  detectFormat,
  type ParsedEntry,
  parseAmountToCents,
  parseClosingBalance,
  parseStatement,
} from "@/shared/import/parse-statement";

interface ViewAccount {
  readonly id: string;
  readonly bank: string;
  readonly name: string;
}
interface ViewCard {
  readonly id: string;
  readonly bank: string;
  readonly product: string;
}

type Mode = "account" | "card";

/** A statement file once read: its lines and, when it states one, the balance it closes on. */
interface Loaded {
  readonly name: string;
  readonly lines: readonly ParsedEntry[];
  readonly closing: { readonly cents: number; readonly date: string | null } | null;
}

/** What is being compared — everything a check depends on besides the file. */
interface Asked {
  readonly mode: Mode;
  readonly accountId: string;
  readonly cardId: string;
  /** A fatura (its due month), or "auto" to find the one the file belongs to. */
  readonly month: string;
}

const MAX_LINES = 2000;
/** Faturas offered by hand: a couple still to come, and the past months. */
const MONTHS_AHEAD = 2;
const MONTHS_BACK = 9;

const dayMonth = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const total = (rows: readonly ReconcileRow[]): number => rows.reduce((sum, row) => sum + row.amountCents, 0);
const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);
/** What a bank calls a line, without the numbers that change from one line to the next. */
const nameOf = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[\d\W_]+/g, " ")
    .trim();

/**
 * "Conferir extrato": pick an account (or a card) and its statement file; the screen says what
 * matches, what the app is missing and what the app has that the bank does not. Lines are compared
 * by amount and date, never by name. Nothing is created or changed here: a missing line opens the
 * usual "Novo lançamento" form, already filled, and an extra entry opens its own detail.
 */
export function ReconcileView({
  accounts,
  cards,
  currentMonth,
  initialAccountId,
  initialCardId,
  ask = reconcileStatementAction,
}: {
  accounts: readonly ViewAccount[];
  cards: readonly ViewCard[];
  currentMonth: string;
  initialAccountId?: string;
  initialCardId?: string;
  /** Who answers the check: the app's server action, unless a preview or a test supplies its own. */
  ask?: (input: unknown) => Promise<ReconcileActionState>;
}) {
  const [mode, setMode] = useState<Mode>(
    initialCardId !== undefined || accounts.length === 0 ? "card" : "account",
  );
  const [accountId, setAccountId] = useState(initialAccountId ?? accounts[0]?.id ?? "");
  const [cardId, setCardId] = useState(initialCardId ?? cards[0]?.id ?? "");
  const [month, setMonth] = useState("auto");
  const [file, setFile] = useState<Loaded | null>(null);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [bankBalance, setBankBalance] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());

  const targetId = mode === "account" ? accountId : cardId;

  // Each question gets a ticket: the answer to an older one is dropped.
  const ticket = useRef(0);
  const check = useCallback(
    async (lines: readonly ParsedEntry[], asked: Asked) => {
      ticket.current += 1;
      const mine = ticket.current;
      setChecking(true);
      setError(null);
      // A request that fails outright (offline, no answer) is an answer too: say so, never hang.
      const state = await ask({
        target:
          asked.mode === "account"
            ? { type: "account", accountId: asked.accountId }
            : { type: "card", cardId: asked.cardId, month: asked.month === "auto" ? null : asked.month },
        lines: lines.map((line) => ({
          date: line.date,
          description: line.description.slice(0, 200),
          amountCents: line.amountCents,
        })),
      }).catch(
        (): ReconcileActionState => ({ ok: false, error: "Não consegui conferir agora. Tente de novo." }),
      );
      if (mine !== ticket.current) return;
      setChecking(false);
      if (!state.ok) {
        // The last answer, if there is one, stays on screen: only the message is new.
        setError(state.error);
        return;
      }
      setResult(state.result);
      setPicked(new Set());
    },
    [ask],
  );

  // Ask again whenever what is being compared changes.
  useEffect(() => {
    if (file === null || targetId === "") return;
    void check(file.lines, { mode, accountId, cardId, month });
  }, [file, targetId, mode, accountId, cardId, month, check]);

  // …and when an entry's form closes: something may have been booked, changed or deleted.
  const formOpen = useTxUIStore(
    (s) =>
      s.creating !== null ||
      s.detail !== null ||
      s.editing !== null ||
      s.deleting !== null ||
      s.paying !== null ||
      s.receiving !== null,
  );
  const again = useRef<() => void>(() => {});
  again.current = () => {
    if (file !== null && targetId !== "") void check(file.lines, { mode, accountId, cardId, month });
  };
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !formOpen) again.current();
    wasOpen.current = formOpen;
  }, [formOpen]);

  async function onFile(chosen: File) {
    setError(null);
    const content = await chosen.text();
    const format = detectFormat(chosen.name, content);
    const lines = parseStatement(content, format);
    if (lines.length === 0) {
      setError(
        format === "ofx"
          ? "Não encontrei lançamentos neste arquivo OFX."
          : "Não encontrei lançamentos neste CSV. Confira se ele tem colunas de data e valor.",
      );
      return;
    }
    if (lines.length > MAX_LINES) {
      setError(
        `Este arquivo tem ${lines.length} linhas. Confira até ${MAX_LINES} por vez: exporte um período menor.`,
      );
      return;
    }
    const closing = parseClosingBalance(content, format);
    setResult(null);
    setBankBalance(closing ? (closing.cents / 100).toFixed(2).replace(".", ",") : "");
    setFile({ name: chosen.name, lines, closing });
  }

  /** Open "Novo lançamento" filled from bank lines: one, or several booked as one entry. */
  const launch = (rows: readonly ReconcileRow[]): void => {
    if (result === null || rows.length === 0) return;
    const amountCents = total(rows);
    const names = new Set(rows.map((row) => nameOf(row.label)));
    const draft: TxDraft = {
      // The day of the last one: by then all of them had happened.
      date: rows.map((row) => row.date).sort()[rows.length - 1] ?? "",
      amountCents,
      // One line keeps the bank's words; several, only when the bank calls them all the same.
      description: names.size === 1 ? (rows[0]?.label ?? "").replace(/\s+/g, " ").trim().slice(0, 120) : "",
      ...(result.target.type === "account" ? { accountId: result.target.id } : { cardId: result.target.id }),
    };
    useTxUIStore.getState().openCreate(amountCents < 0 ? "expense" : "income", undefined, draft);
  };

  if (accounts.length === 0 && cards.length === 0) {
    return (
      <div className="coming">
        <div className="ci">
          <Icon name="wallet" size={32} />
        </div>
        <h3>Crie uma carteira ou cartão primeiro</h3>
        <p>
          Você precisa de uma{" "}
          <Link href="/wallets" className="card-link">
            carteira
          </Link>{" "}
          ou de um{" "}
          <Link href="/cards" className="card-link">
            cartão
          </Link>{" "}
          para conferir um extrato.
        </p>
      </div>
    );
  }

  const months = Array.from({ length: MONTHS_AHEAD + MONTHS_BACK + 1 }, (_, i) =>
    addMonths(currentMonth, MONTHS_AHEAD - i),
  );
  const groups = result?.matches.filter((m) => m.kind === "bank-group" || m.kind === "book-group") ?? [];
  const cancelled = result?.matches.filter((m) => m.kind === "bank-cancel") ?? [];
  const exact = result?.matches.filter((m) => m.kind === "exact") ?? [];
  const pickedRows = result?.bankOnly.filter((row) => picked.has(row.id)) ?? [];
  const pickedOneWay =
    pickedRows.every((row) => row.amountCents < 0) || pickedRows.every((row) => row.amountCents > 0);
  const togglePicked = (id: string): void =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="col gap-4">
      <div className="card">
        <div className="card-pad col gap-3">
          <div className="field" style={{ marginBottom: 0 }}>
            <label>O que você quer conferir</label>
            <div className="chip-select">
              {accounts.length > 0 && (
                <button
                  type="button"
                  className={`person-chip${mode === "account" ? " on" : ""}`}
                  onClick={() => setMode("account")}
                >
                  <Icon name="wallet" size={15} />
                  Carteira (extrato)
                </button>
              )}
              {cards.length > 0 && (
                <button
                  type="button"
                  className={`person-chip${mode === "card" ? " on" : ""}`}
                  onClick={() => setMode("card")}
                >
                  <Icon name="credit-card" size={15} />
                  Cartão (fatura)
                </button>
              )}
            </div>
          </div>

          {mode === "account" ? (
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="rc-account">Carteira</label>
              <select
                id="rc-account"
                className="input"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bank} · {account.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="rc-card">Cartão</label>
                <select
                  id="rc-card"
                  className="input"
                  value={cardId}
                  onChange={(e) => setCardId(e.target.value)}
                >
                  {cards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.bank} · {card.product}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="rc-month">Fatura</label>
                <select
                  id="rc-month"
                  className="input"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                >
                  <option value="auto">Descobrir pelos lançamentos do arquivo</option>
                  {months.map((option) => (
                    <option key={option} value={option}>
                      {monthLabel(option, { long: true })}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <label className="rc-drop">
            <span className="kpi-ic purple" style={{ width: 44, height: 44 }}>
              <Icon name="file-up" size={22} />
            </span>
            <span className="rc-drop-title">{file?.name ?? "Escolher arquivo CSV ou OFX"}</span>
            <span className="rc-drop-sub">
              {file === null
                ? "O extrato da conta ou a fatura do cartão, baixado do app do banco."
                : `${file.lines.length} ${plural(file.lines.length, "linha", "linhas")} · toque para trocar de arquivo`}
            </span>
            <input
              type="file"
              accept=".csv,.ofx,.txt,text/csv,application/csv,application/vnd.ms-excel,text/plain"
              style={{ display: "none" }}
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                if (chosen) void onFile(chosen);
                e.target.value = "";
              }}
            />
          </label>
          <p className="rc-note">
            Nada é criado nem alterado aqui: é só uma conferência. A comparação é pelo valor e pela data — o
            nome que o banco usa não precisa ser o seu.
          </p>
        </div>
      </div>

      {error && (
        <div className="warn-text" role="alert">
          <Icon name="alert-triangle" size={14} />
          {error}
        </div>
      )}
      {checking && result === null && <div className="rc-note">Conferindo…</div>}

      {result !== null && (
        <>
          <Verdict
            result={result}
            groups={groups.length}
            checking={checking}
            found={mode === "card" && month === "auto"}
            bankBalance={bankBalance}
            onBankBalance={setBankBalance}
            statedOn={file?.closing?.date ?? null}
            onAgain={() => again.current()}
          />

          {result.bankOnly.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h3>Falta lançar no app</h3>
                  <div className="ch-sub">
                    {result.bankOnly.length} {plural(result.bankOnly.length, "linha", "linhas")} do banco ·{" "}
                    {formatBRL(total(result.bankOnly))}
                  </div>
                </div>
                <Link className="card-link" href="/import">
                  Importar o arquivo
                </Link>
              </div>
              <div className="card-pad rc-list">
                {result.bankOnly.length > 1 && (
                  <p className="rc-note" style={{ marginBottom: 6 }}>
                    Várias linhas são um lançamento só (pedágios, tarifas)? Marque-as e junte.
                  </p>
                )}
                {pickedRows.length > 1 && (
                  <div className="rc-join">
                    {pickedOneWay ? (
                      <>
                        <span>
                          {pickedRows.length} linhas ·{" "}
                          <strong className="tnum">{formatBRL(total(pickedRows))}</strong>
                        </span>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => launch(pickedRows)}
                        >
                          Juntar em 1 lançamento
                        </button>
                      </>
                    ) : (
                      <span>Para juntar, marque só saídas ou só entradas.</span>
                    )}
                  </div>
                )}
                {result.bankOnly.map((row) => (
                  <Line
                    key={row.id}
                    row={row}
                    lead={
                      result.bankOnly.length > 1 ? (
                        <input
                          type="checkbox"
                          className="rc-check"
                          aria-label={`Marcar ${row.label || "linha"} de ${dayMonth(row.date)} para juntar`}
                          checked={picked.has(row.id)}
                          onChange={() => togglePicked(row.id)}
                        />
                      ) : undefined
                    }
                    action={
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => launch([row])}>
                        Lançar
                      </button>
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {result.bookOnly.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h3>
                    {result.target.type === "card"
                      ? "No app, mas não na fatura"
                      : "No app, mas não no extrato"}
                  </h3>
                  <div className="ch-sub">
                    {result.bookOnly.length}{" "}
                    {plural(result.bookOnly.length, "lançamento seu", "lançamentos seus")} ·{" "}
                    {formatBRL(total(result.bookOnly))}
                  </div>
                </div>
              </div>
              <div className="card-pad rc-list">
                <p className="rc-note" style={{ marginBottom: 6 }}>
                  Pode ser a data, o valor ou a conta de um lançamento — ou um que foi lançado duas vezes.
                </p>
                {result.bookOnly.map((row) => (
                  <Line
                    key={row.id}
                    row={row}
                    action={
                      row.transaction ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => row.transaction && openTxDetail(row.transaction)}
                        >
                          Abrir
                        </button>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {cancelled.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h3>Linhas do banco que se anulam</h3>
                  <div className="ch-sub">
                    Uma cobrança e o estorno dela, que você não lançou: não há o que fazer. Se não for isso,
                    lance cada uma.
                  </div>
                </div>
              </div>
              <div className="card-pad rc-list">
                {cancelled.flatMap((match) =>
                  match.bank.map((row) => (
                    <Line
                      key={row.id}
                      row={row}
                      action={
                        <button type="button" className="btn btn-quiet btn-sm" onClick={() => launch([row])}>
                          Lançar
                        </button>
                      }
                    />
                  )),
                )}
              </div>
            </div>
          )}

          {groups.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h3>Juntei para você</h3>
                  <div className="ch-sub">
                    Linhas que só batem somadas. Dê uma olhada: se uma junção não fizer sentido, o lançamento
                    está com outro valor.
                  </div>
                </div>
              </div>
              <div className="card-pad rc-list">
                {groups.map((match) => (
                  <Group key={(match.bank[0] ?? match.book[0])?.id} match={match} />
                ))}
              </div>
            </div>
          )}

          {exact.length > 0 && (
            <details className="card rc-details">
              <summary>
                <span>
                  <strong>Conferem</strong> · {exact.length} {plural(exact.length, "linha", "linhas")}
                </span>
                <Icon name="chevron-right" size={16} />
              </summary>
              <div className="card-pad rc-list">
                {exact.map((match) => {
                  const bank = match.bank[0];
                  const book = match.book[0];
                  if (!bank || !book) return null;
                  return (
                    <div key={bank.id} className="rc-row">
                      <div className="rc-main">
                        <div className="rc-label">{book.label || "Sem descrição"}</div>
                        <div className="rc-sub">
                          {dayMonth(bank.date)} no banco: {bank.label || "sem descrição"}
                          {book.date === bank.date ? "" : ` · lançado em ${dayMonth(book.date)}`}
                        </div>
                      </div>
                      <div className="rc-side">
                        <span className={`rc-amount tnum ${bank.amountCents < 0 ? "out" : "in"}`}>
                          {formatBRL(bank.amountCents)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

/** The answer in one card: what did not match, both sides' totals and, for an account, the balance. */
function Verdict({
  result,
  groups,
  checking,
  found,
  bankBalance,
  onBankBalance,
  statedOn,
  onAgain,
}: {
  result: ReconcileResult;
  /** How many group matches were made — worth a look even when everything matches. */
  groups: number;
  checking: boolean;
  /** The fatura was found from the file rather than chosen. */
  found: boolean;
  bankBalance: string;
  onBankBalance: (value: string) => void;
  /** The day the file says its closing balance is of, when it states one. */
  statedOn: string | null;
  onAgain: () => void;
}) {
  const missing = result.bankOnly.length;
  const extra = result.bookOnly.length;
  const clean = missing === 0 && extra === 0;
  const isCard = result.target.type === "card";
  const headline = clean
    ? "Tudo confere"
    : [
        missing > 0
          ? `${missing} ${plural(missing, "linha do banco não está", "linhas do banco não estão")} no app`
          : "",
        extra > 0
          ? `${extra} ${plural(extra, "lançamento seu não está", "lançamentos seus não estão")} ${
              isCard ? "na fatura" : "no extrato"
            }`
          : "",
      ]
        .filter((part) => part !== "")
        .join(" · ");
  const period =
    result.period.from === result.period.to
      ? dayMonth(result.period.from)
      : `${dayMonth(result.period.from)} a ${dayMonth(result.period.to)}`;

  return (
    <div className="card">
      <div className="card-pad col gap-3">
        <div className="rc-verdict">
          <span className={`rc-verdict-ic ${clean ? "ok" : "todo"}`}>
            <Icon name={clean ? "check-circle" : "alert-triangle"} size={22} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h3>{headline}</h3>
            <div className="rc-sub">
              {result.target.label}
              {result.target.type === "card"
                ? ` · fatura de ${monthLabel(result.target.month, { long: true }).toLowerCase()}${
                    found ? " (descoberta pelos lançamentos)" : ""
                  }`
                : ` · ${period}`}
            </div>
          </div>
        </div>

        <div className="rc-figures">
          <span className="k">{isCard ? "Na fatura (arquivo)" : "No extrato"}</span>
          <span className="n">
            {result.bankCount} {plural(result.bankCount, "linha", "linhas")}
          </span>
          <span className="v tnum">{formatBRL(result.bankTotalCents)}</span>
          <span className="k">No app</span>
          <span className="n">
            {result.bookCount} {plural(result.bookCount, "lançamento", "lançamentos")}
          </span>
          <span className="v tnum">{formatBRL(result.bookTotalCents)}</span>
          <span className="k strong">Diferença</span>
          <span className="n" />
          <span className="v tnum strong">{formatBRL(result.bankTotalCents - result.bookTotalCents)}</span>
        </div>

        {clean && groups > 0 && (
          <p className="rc-note">
            {groups} {plural(groups, "junção foi feita", "junções foram feitas")} para chegar aqui — estão
            logo abaixo.
          </p>
        )}

        {result.closingBalanceCents !== null && (
          <Balance
            result={result}
            closingCents={result.closingBalanceCents}
            value={bankBalance}
            onChange={onBankBalance}
            statedOn={statedOn}
          />
        )}

        <div>
          <button type="button" className="btn btn-quiet btn-sm" onClick={onAgain} disabled={checking}>
            <Icon name="refresh-cw" size={14} />
            {checking ? "Conferindo…" : "Conferir de novo"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The account's balance: the bank's (typed, or read from an OFX file) against the app's at the end
 * of the statement's last day — and whether what did not match explains the difference.
 */
function Balance({
  result,
  closingCents,
  value,
  onChange,
  statedOn,
}: {
  result: ReconcileResult;
  closingCents: number;
  value: string;
  onChange: (value: string) => void;
  statedOn: string | null;
}) {
  const day = dayMonth(result.period.to);
  const bankCents = value.trim() === "" ? null : parseAmountToCents(value);
  const difference = bankCents === null ? null : bankCents - closingCents;
  // What the bank has and the app (at that day) does not, less what the app has and the bank does not.
  const explained = total(result.bankOnly) - total(result.bookOnly) + result.bookedAfterPeriodCents;

  return (
    <div className="rc-balance">
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="rc-balance">Saldo que o banco mostra no fim do dia {day} (opcional)</label>
        <input
          id="rc-balance"
          className="input tnum"
          inputMode="decimal"
          placeholder="Ex.: 1.234,56 ou -656,09"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <div className="rc-sub">
        No app, o saldo no fim do dia {day} é <strong className="tnum">{formatBRL(closingCents)}</strong>.
        {statedOn !== null && statedOn !== result.period.to
          ? ` O saldo do arquivo é do dia ${dayMonth(statedOn)}.`
          : ""}
      </div>
      {value.trim() !== "" && bankCents === null && (
        <div className="warn-text">
          <Icon name="alert-triangle" size={14} />
          Não entendi esse valor.
        </div>
      )}
      {difference !== null &&
        (difference === 0 ? (
          <div className="rc-balance-say ok">O saldo bate com o do banco.</div>
        ) : difference === explained ? (
          <div className="rc-balance-say">
            A diferença de <strong className="tnum">{formatBRL(difference)}</strong> é exatamente o que não
            bateu neste extrato: resolvendo a lista abaixo, o saldo fecha.
          </div>
        ) : (
          <div className="rc-balance-say todo">
            Diferença de <strong className="tnum">{formatBRL(difference)}</strong>. O que não bateu neste
            extrato explica <strong className="tnum">{formatBRL(explained)}</strong>; os outros{" "}
            <strong className="tnum">{formatBRL(difference - explained)}</strong> vêm de antes do dia{" "}
            {dayMonth(result.period.from)} — confira o extrato de um período anterior.
          </div>
        ))}
    </div>
  );
}

/** One line of either side: what it is called, its day and its amount. */
function Line({ row, lead, action }: { row: ReconcileRow; lead?: ReactNode; action?: ReactNode }) {
  const kind =
    row.origin === "settlement" ? " · acerto" : row.origin === "bill-payment" ? " · pagamento de fatura" : "";
  return (
    <div className={lead ? "rc-row has-lead" : "rc-row"}>
      {lead}
      <div className="rc-main">
        <div className="rc-label">{row.label || "Sem descrição"}</div>
        <div className="rc-sub">
          {dayMonth(row.date)}
          {kind}
        </div>
      </div>
      <div className="rc-side">
        <span className={`rc-amount tnum ${row.amountCents < 0 ? "out" : "in"}`}>
          {formatBRL(row.amountCents)}
        </span>
        {action}
      </div>
    </div>
  );
}

/** Lines that only match added up: several of the bank's for one entry, or the other way round. */
function Group({ match }: { match: ReconcileMatch }) {
  const many = match.kind === "bank-group" ? match.bank : match.book;
  const one = match.kind === "bank-group" ? match.book[0] : match.bank[0];
  if (!one) return null;
  return (
    <div className="rc-group">
      <div className="rc-group-title">
        {match.kind === "bank-group"
          ? `${many.length} linhas do banco = 1 lançamento seu`
          : `1 linha do banco = ${many.length} lançamentos seus`}
      </div>
      <Line row={one} />
      <div className="rc-group-parts">
        {many.map((row) => (
          <Line key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}
