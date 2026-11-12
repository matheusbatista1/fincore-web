"use client";

import { useState } from "react";
import { exportBackupAction, exportTransactionsAction } from "@/app/_actions/finance";
import { Icon } from "@/presentation/components/ui/icon";
import { downloadFile, exportCSV } from "@/presentation/lib/export";
import { TRANSACTIONS_EXPORT_HEADERS, transactionExportRow } from "@/presentation/lib/transactions-csv";
import { toast } from "@/presentation/stores/ui-store";

type Export = "backup" | "sheet";

/**
 * Settings card to take a copy of everything out of the app: a complete backup (one JSON
 * document) and the transactions as a spreadsheet. Nothing is changed; the files are built on
 * request and go straight to the device.
 */
export function ExportDataCard() {
  const [busy, setBusy] = useState<Export | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Runs one export; `work` answers with what went wrong, or `null` when the file was handed over. */
  async function run(which: Export, work: () => Promise<string | null>) {
    setBusy(which);
    setError(null);
    try {
      setError(await work());
    } catch {
      // The request itself failed: offline, or the server did not answer.
      setError("Não consegui gerar o arquivo agora. Tente de novo.");
    } finally {
      setBusy(null);
    }
  }

  const backup = () =>
    run("backup", async () => {
      const state = await exportBackupAction();
      if (!state.ok) return state.error;
      downloadFile(state.filename, state.content, "application/json;charset=utf-8");
      toast("Backup baixado");
      return null;
    });

  const sheet = () =>
    run("sheet", async () => {
      const state = await exportTransactionsAction();
      if (!state.ok) return state.error;
      exportCSV(state.filename, TRANSACTIONS_EXPORT_HEADERS, state.rows.map(transactionExportRow));
      const n = state.rows.length;
      toast(`${n} ${n === 1 ? "lançamento exportado" : "lançamentos exportados"}`);
      return null;
    });

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <div>
          <h3>Seus dados</h3>
          <div className="ch-sub">
            Baixe uma cópia de tudo o que você registrou. Guarde em um lugar seguro: os arquivos têm os seus
            valores e os nomes das pessoas.
          </div>
        </div>
      </div>
      <div
        className="card-pad"
        style={{ paddingTop: 6, paddingBottom: 14, display: "flex", gap: 10, flexWrap: "wrap" }}
      >
        <button type="button" className="btn btn-ghost btn-sm" onClick={backup} disabled={busy !== null}>
          <Icon name="file-down" size={15} />
          {busy === "backup" ? "Preparando…" : "Backup completo (.json)"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={sheet} disabled={busy !== null}>
          <Icon name="file-spreadsheet" size={15} />
          {busy === "sheet" ? "Preparando…" : "Lançamentos em planilha (.csv)"}
        </button>
        {error && (
          <div className="warn-text" role="alert" style={{ width: "100%", marginTop: 0 }}>
            <Icon name="alert-triangle" size={14} />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
