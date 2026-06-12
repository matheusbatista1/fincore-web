"use client";

import Link from "next/link";
import { useState } from "react";
import { importTransactionsAction } from "@/app/_actions/finance";
import { Icon } from "@/presentation/components/ui/icon";
import { toast } from "@/presentation/stores/ui-store";
import { formatBRL } from "@/shared/formatting/currency";
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
interface WizardCategory {
  readonly id: string;
  readonly name: string;
}

type Row = ParsedEntry & { id: string; categoryId: string | null };

/** Import CSV/OFX wizard — prototype visual language (.card/.field/.input/.tbl/.btn). */
export function ImportWizard({
  accounts,
  categories,
}: {
  accounts: WizardAccount[];
  categories: WizardCategory[];
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  async function onFile(file: File) {
    setError(null);
    const content = await file.text();
    const format: StatementFormat = detectFormat(file.name, content);
    const parsed = parseStatement(content, format);
    if (parsed.length === 0) {
      setError("Não foi possível ler lançamentos deste arquivo. Verifique o formato (CSV ou OFX).");
      return;
    }
    setFileName(file.name);
    setRows(parsed.map((entry, index) => ({ ...entry, id: String(index), categoryId: null })));
  }

  function setRowCategory(index: number, categoryId: string | null) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, categoryId } : row)));
  }

  async function confirm() {
    if (!accountId || rows.length === 0 || submitting) return;
    setError(null);
    setSubmitting(true);
    const result = await importTransactionsAction({
      accountId,
      entries: rows.map((row) => ({
        date: row.date,
        description: row.description,
        amountCents: row.amountCents,
        categoryId: row.amountCents < 0 ? row.categoryId : null,
      })),
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast(`${rows.length} ${rows.length === 1 ? "lançamento importado" : "lançamentos importados"}`);
    setImportedCount(rows.length);
    setRows([]);
    setFileName("");
  }

  if (accounts.length === 0) {
    return (
      <div className="coming">
        <div className="ci">
          <Icon name="wallet" size={32} />
        </div>
        <h3>Crie uma carteira primeiro</h3>
        <p>
          Você precisa de uma{" "}
          <Link href="/wallets" className="card-link">
            carteira
          </Link>{" "}
          antes de importar um extrato.
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
          Extrato do seu banco. Detectamos o formato automaticamente.
        </span>
        <input
          type="file"
          accept=".csv,.ofx,.txt,text/csv"
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
          <div className="card-head">
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
            <div className="ch-sub">
              {rows.length} {rows.length === 1 ? "lançamento encontrado" : "lançamentos encontrados"}
            </div>
          </div>
          <div style={{ padding: "8px 12px 12px" }}>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th className="r">Valor</th>
                    <th>Categoria</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.id}>
                      <td className="tnum" style={{ color: "var(--text-lo)", whiteSpace: "nowrap" }}>
                        {row.date}
                      </td>
                      <td>
                        <span className="t-strong">{row.description}</span>
                      </td>
                      <td className="r">
                        <span
                          className="tnum t-strong"
                          style={{ color: row.amountCents < 0 ? "var(--rose-500)" : "var(--mint-500)" }}
                        >
                          {formatBRL(row.amountCents)}
                        </span>
                      </td>
                      <td>
                        {row.amountCents < 0 ? (
                          <select
                            className="input"
                            aria-label="Categoria"
                            style={{ height: 38, fontSize: 13.5 }}
                            value={row.categoryId ?? ""}
                            onChange={(e) => setRowCategory(index, e.target.value || null)}
                          >
                            <option value="">Sem categoria</option>
                            {categories.map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="pill mint">Receita</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="modal-foot" style={{ borderTop: "1px solid var(--line)" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={submitting || !accountId}
              style={{
                opacity: submitting || !accountId ? 0.45 : 1,
                pointerEvents: submitting || !accountId ? "none" : "auto",
              }}
              onClick={confirm}
            >
              <Icon name="file-up" size={17} />
              {submitting ? "Importando…" : `Importar ${rows.length}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
