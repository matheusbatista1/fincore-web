"use client";

import { CheckCircle2, FileUp, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { importTransactionsAction } from "@/app/_actions/finance";
import { Button } from "@/presentation/components/ui/button";
import { Select } from "@/presentation/components/ui/field";
import { cn } from "@/presentation/lib/cn";
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

const fieldClass =
  "h-10 rounded-sm border border-line bg-surface-3 px-2 text-sm text-text-hi outline-none focus:border-purple-400";

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
    setImportedCount(rows.length);
    setRows([]);
    setFileName("");
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line-2 bg-surface-1 p-10 text-center">
        <p className="text-text-mid">
          Crie uma carteira em{" "}
          <Link href="/wallets" className="text-purple-300 hover:underline">
            Carteiras
          </Link>{" "}
          antes de importar um extrato.
        </p>
      </div>
    );
  }

  if (importedCount !== null) {
    return (
      <div className="rounded-lg border border-line bg-surface-1 p-10 text-center shadow-2">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-mint-soft text-mint-500">
          <CheckCircle2 size={26} />
        </div>
        <h2 className="font-display text-xl font-semibold text-text-hi">
          {importedCount} {importedCount === 1 ? "lançamento importado" : "lançamentos importados"}
        </h2>
        <div className="mt-4 flex justify-center gap-2">
          <Link href="/transactions">
            <Button>Ver lançamentos</Button>
          </Link>
          <Button variant="ghost" onClick={() => setImportedCount(null)}>
            Importar outro
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-line-2 bg-surface-1 p-8 text-center transition hover:border-purple-400">
        <span className="grid size-12 place-items-center rounded-full bg-purple-soft text-purple-300">
          <FileUp size={24} />
        </span>
        <span className="font-medium text-text-hi">{fileName || "Escolher arquivo CSV ou OFX"}</span>
        <span className="text-sm text-text-lo">
          Extrato do seu banco. Detectamos o formato automaticamente.
        </span>
        <input
          type="file"
          accept=".csv,.ofx,.txt,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
      </label>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-text-lo">
                Carteira de destino
              </span>
              <Select
                aria-label="Carteira de destino"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bank} · {account.name}
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-sm text-text-lo">
              {rows.length} {rows.length === 1 ? "lançamento" : "lançamentos"} encontrados
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-line bg-surface-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-text-faint">
                  <th className="p-3 font-semibold">Data</th>
                  <th className="p-3 font-semibold">Descrição</th>
                  <th className="p-3 text-right font-semibold">Valor</th>
                  <th className="p-3 font-semibold">Categoria</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap p-3 text-text-mid tabular-nums">{row.date}</td>
                    <td className="max-w-[18rem] truncate p-3 text-text-hi">{row.description}</td>
                    <td
                      className={cn(
                        "p-3 text-right font-semibold tabular-nums",
                        row.amountCents < 0 ? "text-text-hi" : "text-mint-500",
                      )}
                    >
                      {formatBRL(row.amountCents)}
                    </td>
                    <td className="p-3">
                      {row.amountCents < 0 ? (
                        <select
                          aria-label="Categoria"
                          value={row.categoryId ?? ""}
                          onChange={(e) => setRowCategory(index, e.target.value || null)}
                          className={fieldClass}
                        >
                          <option value="">Sem categoria</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-text-lo">Receita</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <Button onClick={confirm} disabled={submitting || !accountId}>
              <Upload size={17} />
              {submitting ? "Importando…" : `Importar ${rows.length}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
