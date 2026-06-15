"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { importTransactionsAction } from "@/app/_actions/finance";
import { Icon } from "@/presentation/components/ui/icon";
import { useIsMobile } from "@/presentation/lib/use-is-mobile";
import { toast } from "@/presentation/stores/ui-store";
import { formatBRL } from "@/shared/formatting/currency";
import { partitionCardLines } from "@/shared/import/card-lines";
import {
  detectFormat,
  type ParsedEntry,
  parseStatement,
  type StatementFormat,
} from "@/shared/import/parse-statement";

interface WizardAccount {
  readonly id: string;
  readonly bank: string;
  readonly name: string;
}
interface WizardCard {
  readonly id: string;
  readonly bank: string;
  readonly product: string;
}
interface WizardCategory {
  readonly id: string;
  readonly name: string;
}

type Mode = "account" | "card";
type Row = ParsedEntry & {
  id: string;
  categoryId: string | null;
  /** Recurring ("fixed"); mutually exclusive with installment. */
  fixed: boolean;
  /** Number of installments (card charges only); null = not an installment. */
  installmentTotal: number | null;
  installmentCurrent: number;
};
/** How a reviewed row will be imported (drives its color, category cell and inclusion). */
type RowState = "expense" | "income" | "charge" | "credit";

/** Parse a digits-only field to an int no smaller than `min`. */
function toIntAtLeast(value: string, min: number): number {
  const n = Number.parseInt(value.replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n >= min ? n : min;
}

/**
 * Import CSV/OFX wizard — bank statement (into a wallet) or card bill (into a
 * card). For a card the purchases are detected by the dominant amount sign
 * (OFX files carry them negative, CSV positive); the minority sign is a
 * credit/refund, which can't be represented as a card transaction and is
 * excluded. Each line's description, category and fixed/installment options are
 * editable before importing. Prototype visual language (.card/.field/.input/.tbl/.btn).
 */
export function ImportWizard({
  accounts,
  cards,
  categories,
}: {
  accounts: WizardAccount[];
  cards: WizardCard[];
  categories: WizardCategory[];
}) {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<Mode>(accounts.length > 0 ? "account" : "card");
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  // For a card bill, charges are the dominant-sign lines; credits (the minority) are excluded.
  const { charges, credits } =
    mode === "card" ? partitionCardLines(rows) : { charges: rows, credits: [] as Row[] };
  const creditIds = new Set(credits.map((row) => row.id));
  const importable = mode === "card" ? charges : rows;
  const excludedCredits = credits.length;
  const destinationReady = mode === "card" ? cardId !== "" : accountId !== "";
  const canImport = destinationReady && importable.length > 0 && !submitting;

  function rowState(row: Row): RowState {
    if (mode === "card") return creditIds.has(row.id) ? "credit" : "charge";
    return row.amountCents < 0 ? "expense" : "income";
  }

  async function onFile(file: File) {
    setError(null);
    const content = await file.text();
    const format: StatementFormat = detectFormat(file.name, content);
    const parsed = parseStatement(content, format);
    if (parsed.length === 0) {
      setError(
        format === "ofx"
          ? "Não encontramos lançamentos neste arquivo OFX."
          : "Não encontramos lançamentos neste CSV. Confira se há colunas de data e valor (ex.: Data e Valor).",
      );
      return;
    }
    setFileName(file.name);
    setRows(
      parsed.map((entry, index) => ({
        ...entry,
        id: String(index),
        categoryId: null,
        fixed: false,
        installmentTotal: null,
        installmentCurrent: 1,
      })),
    );
  }

  function patchRow(id: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }
  const setRowDescription = (id: string, description: string) => patchRow(id, { description });
  const setRowCategory = (id: string, categoryId: string | null) => patchRow(id, { categoryId });
  // Fixed and installment are mutually exclusive (mirrors the manual form).
  const setRowFixed = (id: string, fixed: boolean) =>
    patchRow(id, fixed ? { fixed: true, installmentTotal: null } : { fixed: false });
  const setRowInstallment = (id: string, total: number | null) =>
    patchRow(id, total === null ? { installmentTotal: null } : { installmentTotal: total, fixed: false });
  const setRowInstallmentCurrent = (id: string, current: number) =>
    patchRow(id, { installmentCurrent: current });
  const removeRow = (id: string) => setRows((current) => current.filter((row) => row.id !== id));

  async function confirm() {
    if (!canImport) return;
    setError(null);
    setSubmitting(true);
    const entries = importable.map((row) => ({
      date: row.date,
      description: row.description,
      amountCents: row.amountCents,
      // A category only applies to expense-like rows (account debits / card charges).
      categoryId: mode === "card" || row.amountCents < 0 ? row.categoryId : null,
      fixed: row.fixed,
      // Installments are only meaningful on a card bill.
      installment:
        mode === "card" && row.installmentTotal !== null && row.installmentTotal >= 2
          ? {
              total: row.installmentTotal,
              current: Math.min(row.installmentCurrent, row.installmentTotal),
              includePrevious: false,
              includeNext: true,
            }
          : null,
    }));
    const result = await importTransactionsAction({
      target: mode === "card" ? { type: "card", cardId } : { type: "account", accountId },
      entries,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const n = importable.length;
    toast(`${n} ${n === 1 ? "lançamento importado" : "lançamentos importados"}`);
    setImportedCount(n);
    setRows([]);
    setFileName("");
  }

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
          ou{" "}
          <Link href="/cards" className="card-link">
            cartão
          </Link>{" "}
          antes de importar.
        </p>
      </div>
    );
  }

  if (importedCount !== null) {
    return (
      <div className="coming">
        <div className="ci" style={{ background: "var(--mint-soft)", color: "var(--mint-500)" }}>
          <Icon name="check-circle" size={32} />
        </div>
        <h3>
          {importedCount} {importedCount === 1 ? "lançamento importado" : "lançamentos importados"}
        </h3>
        <p>Os lançamentos já aparecem no seu histórico e nos saldos.</p>
        <div className="row gap-3" style={{ justifyContent: "center", marginTop: 20 }}>
          <Link className="btn btn-primary" href="/transactions">
            Ver lançamentos
          </Link>
          <button type="button" className="btn btn-ghost" onClick={() => setImportedCount(null)}>
            Importar outro
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="col gap-4">
      <label
        className="card"
        style={{
          border: "1.5px dashed var(--line-3)",
          background: "transparent",
          padding: "32px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          textAlign: "center",
          cursor: "pointer",
        }}
      >
        <span className="kpi-ic purple" style={{ width: 48, height: 48 }}>
          <Icon name="file-up" size={24} />
        </span>
        <span style={{ fontWeight: 600, color: "var(--text-hi)" }}>
          {fileName || "Escolher arquivo CSV ou OFX"}
        </span>
        <span style={{ fontSize: 13.5, color: "var(--text-lo)" }}>
          Extrato (carteira) ou fatura (cartão). Detectamos o formato automaticamente.
        </span>
        <input
          type="file"
          accept=".csv,.ofx,.txt,text/csv,application/csv,application/vnd.ms-excel,text/plain"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
      </label>

      {error && (
        <div className="warn-text">
          <Icon name="alert-triangle" size={14} />
          {error}
        </div>
      )}

      {rows.length > 0 && (
        <div className="card">
          <div className="card-head" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Destino</label>
              <div className="chip-select">
                <button
                  type="button"
                  className={`person-chip${mode === "account" ? " on" : ""}`}
                  onClick={() => setMode("account")}
                >
                  <Icon name="wallet" size={15} />
                  Carteira (extrato)
                </button>
                <button
                  type="button"
                  className={`person-chip${mode === "card" ? " on" : ""}`}
                  onClick={() => setMode("card")}
                >
                  <Icon name="credit-card" size={15} />
                  Cartão (fatura)
                </button>
              </div>
            </div>

            {mode === "account" ? (
              accounts.length > 0 ? (
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Carteira de destino</label>
                  <select
                    className="input"
                    aria-label="Carteira de destino"
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
                <div className="warn-text">
                  <Icon name="alert-triangle" size={14} />
                  Você não tem carteiras.{" "}
                  <Link href="/wallets" className="card-link">
                    Crie uma
                  </Link>{" "}
                  para importar um extrato.
                </div>
              )
            ) : cards.length > 0 ? (
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Cartão de destino</label>
                <select
                  className="input"
                  aria-label="Cartão de destino"
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
            ) : (
              <div className="warn-text">
                <Icon name="alert-triangle" size={14} />
                Você não tem cartões.{" "}
                <Link href="/cards" className="card-link">
                  Crie um
                </Link>{" "}
                para importar uma fatura.
              </div>
            )}

            <div className="ch-sub">
              {importable.length} {importable.length === 1 ? "lançamento" : "lançamentos"} a importar
              {excludedCredits > 0
                ? ` · ${excludedCredits} ${excludedCredits === 1 ? "crédito ignorado" : "créditos ignorados"}`
                : ""}
            </div>
          </div>

          {isMobile ? (
            <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 8 }}>
              {rows.map((row) => (
                <ImportRowMobile
                  key={row.id}
                  row={row}
                  state={rowState(row)}
                  categories={categories}
                  expanded={expandedId === row.id}
                  onToggleExpand={() => setExpandedId(expandedId === row.id ? null : row.id)}
                  onDescription={setRowDescription}
                  onCategory={setRowCategory}
                  onFixed={setRowFixed}
                  onInstallment={setRowInstallment}
                  onInstallmentCurrent={setRowInstallmentCurrent}
                  onRemove={removeRow}
                />
              ))}
            </div>
          ) : (
            <div style={{ padding: "8px 12px 12px" }}>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Descrição</th>
                      <th className="r">Valor</th>
                      <th>Categoria</th>
                      <th aria-label="Opções" />
                      <th aria-label="Remover" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const state = rowState(row);
                      const expenseLike = state === "expense" || state === "charge";
                      const credit = state === "credit";
                      const expanded = expandedId === row.id;
                      return (
                        <Fragment key={row.id}>
                          <tr style={{ opacity: credit ? 0.55 : 1 }}>
                            <td className="tnum" style={{ color: "var(--text-lo)", whiteSpace: "nowrap" }}>
                              {row.date}
                            </td>
                            <td style={{ minWidth: 200 }}>
                              <input
                                className="input"
                                aria-label="Descrição"
                                style={{ height: 34, fontSize: 13.5 }}
                                value={row.description}
                                onChange={(e) => setRowDescription(row.id, e.target.value)}
                              />
                            </td>
                            <td className="r">
                              <span className="tnum t-strong" style={{ color: amountColor(state) }}>
                                {formatBRL(row.amountCents)}
                              </span>
                            </td>
                            <td>
                              {credit ? (
                                <span className="pill neutral">Crédito</span>
                              ) : expenseLike ? (
                                <CategorySelect
                                  row={row}
                                  categories={categories}
                                  onCategory={setRowCategory}
                                />
                              ) : (
                                <span className="pill mint">Receita</span>
                              )}
                            </td>
                            <td>
                              {!credit && (
                                <button
                                  type="button"
                                  className={`btn btn-ghost btn-sm${expanded ? " on" : ""}`}
                                  onClick={() => setExpandedId(expanded ? null : row.id)}
                                >
                                  <Icon name={expanded ? "chevron-up" : "sliders-horizontal"} size={14} />
                                  {rowSummary(row)}
                                </button>
                              )}
                            </td>
                            <td className="r">
                              <button
                                type="button"
                                className="icon-btn btn-sm"
                                style={{ width: 32, height: 32 }}
                                title="Remover"
                                onClick={() => removeRow(row.id)}
                              >
                                <Icon name="x" size={15} />
                              </button>
                            </td>
                          </tr>
                          {expanded && !credit && (
                            <tr>
                              <td
                                colSpan={6}
                                style={{ background: "var(--surface-2)", padding: "10px 14px" }}
                              >
                                <RowOptions
                                  row={row}
                                  canInstallment={state === "charge"}
                                  onFixed={setRowFixed}
                                  onInstallment={setRowInstallment}
                                  onInstallmentCurrent={setRowInstallmentCurrent}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="modal-foot" style={{ borderTop: "1px solid var(--line)" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canImport}
              style={{
                opacity: canImport ? 1 : 0.45,
                pointerEvents: canImport ? "auto" : "none",
              }}
              onClick={confirm}
            >
              <Icon name="file-up" size={17} />
              {submitting ? "Importando…" : `Importar ${importable.length}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Amount color by row state: expense/charge red, income green, credit muted. */
function amountColor(state: RowState): string {
  if (state === "expense" || state === "charge") return "var(--rose-500)";
  if (state === "income") return "var(--mint-500)";
  return "var(--text-lo)";
}

/** Short label for the per-row options button (reflects the current choice). */
function rowSummary(row: Row): string {
  if (row.fixed) return "Fixo";
  if (row.installmentTotal !== null) return `${row.installmentTotal}×`;
  return "Opções";
}

/** Category dropdown for an importable expense/charge row. */
function CategorySelect({
  row,
  categories,
  onCategory,
}: {
  row: Row;
  categories: WizardCategory[];
  onCategory: (id: string, categoryId: string | null) => void;
}) {
  return (
    <select
      className="input"
      aria-label="Categoria"
      style={{ height: 38, fontSize: 13.5 }}
      value={row.categoryId ?? ""}
      onChange={(e) => onCategory(row.id, e.target.value || null)}
    >
      <option value="">Sem categoria</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </select>
  );
}

/** Per-row "fixed" / "installment" controls (shared by desktop and mobile). */
function RowOptions({
  row,
  canInstallment,
  onFixed,
  onInstallment,
  onInstallmentCurrent,
}: {
  row: Row;
  canInstallment: boolean;
  onFixed: (id: string, fixed: boolean) => void;
  onInstallment: (id: string, total: number | null) => void;
  onInstallmentCurrent: (id: string, current: number) => void;
}) {
  return (
    <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
      <button
        type="button"
        className={`person-chip${row.fixed ? " on" : ""}`}
        onClick={() => onFixed(row.id, !row.fixed)}
      >
        <Icon name="repeat" size={14} />
        Fixo (todo mês)
      </button>
      {canInstallment && (
        <button
          type="button"
          className={`person-chip${row.installmentTotal !== null ? " on" : ""}`}
          onClick={() => onInstallment(row.id, row.installmentTotal !== null ? null : 2)}
        >
          <Icon name="layers" size={14} />
          Parcelado
        </button>
      )}
      {canInstallment && row.installmentTotal !== null && (
        <span className="row gap-2" style={{ alignItems: "center", color: "var(--text-lo)", fontSize: 13 }}>
          <input
            className="input tnum"
            aria-label="Total de parcelas"
            inputMode="numeric"
            style={{ width: 58, height: 34 }}
            value={String(row.installmentTotal)}
            onChange={(e) => onInstallment(row.id, toIntAtLeast(e.target.value, 2))}
          />
          parcelas, atual
          <input
            className="input tnum"
            aria-label="Parcela atual"
            inputMode="numeric"
            style={{ width: 54, height: 34 }}
            value={String(row.installmentCurrent)}
            onChange={(e) => onInstallmentCurrent(row.id, toIntAtLeast(e.target.value, 1))}
          />
        </span>
      )}
    </div>
  );
}

/** Stacked row for the mobile preview (the desktop table overflows on narrow screens). */
function ImportRowMobile({
  row,
  state,
  categories,
  expanded,
  onToggleExpand,
  onDescription,
  onCategory,
  onFixed,
  onInstallment,
  onInstallmentCurrent,
  onRemove,
}: {
  row: Row;
  state: RowState;
  categories: WizardCategory[];
  expanded: boolean;
  onToggleExpand: () => void;
  onDescription: (id: string, description: string) => void;
  onCategory: (id: string, categoryId: string | null) => void;
  onFixed: (id: string, fixed: boolean) => void;
  onInstallment: (id: string, total: number | null) => void;
  onInstallmentCurrent: (id: string, current: number) => void;
  onRemove: (id: string) => void;
}) {
  const expenseLike = state === "expense" || state === "charge";
  const credit = state === "credit";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 0",
        borderBottom: "1px solid var(--line)",
        opacity: credit ? 0.55 : 1,
      }}
    >
      <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {credit ? (
            <div className="t-strong" style={{ overflowWrap: "anywhere" }}>
              {row.description}
            </div>
          ) : (
            <input
              className="input"
              aria-label="Descrição"
              style={{ height: 34, fontSize: 13.5 }}
              value={row.description}
              onChange={(e) => onDescription(row.id, e.target.value)}
            />
          )}
          <div style={{ fontSize: 12.5, color: "var(--text-lo)", marginTop: 4 }}>{row.date}</div>
        </div>
        <span className="tnum t-strong" style={{ color: amountColor(state), whiteSpace: "nowrap" }}>
          {formatBRL(row.amountCents)}
        </span>
        <button
          type="button"
          className="icon-btn btn-sm"
          style={{ width: 32, height: 32, flex: "none" }}
          title="Remover"
          onClick={() => onRemove(row.id)}
        >
          <Icon name="x" size={15} />
        </button>
      </div>
      {credit ? (
        <span className="pill neutral">Crédito — não importado</span>
      ) : expenseLike ? (
        <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <CategorySelect row={row} categories={categories} onCategory={onCategory} />
          <button
            type="button"
            className={`btn btn-ghost btn-sm${expanded ? " on" : ""}`}
            onClick={onToggleExpand}
          >
            <Icon name={expanded ? "chevron-up" : "sliders-horizontal"} size={14} />
            {rowSummary(row)}
          </button>
        </div>
      ) : (
        <span className="pill mint">Receita</span>
      )}
      {expanded && !credit && (
        <RowOptions
          row={row}
          canInstallment={state === "charge"}
          onFixed={onFixed}
          onInstallment={onInstallment}
          onInstallmentCurrent={onInstallmentCurrent}
        />
      )}
    </div>
  );
}
