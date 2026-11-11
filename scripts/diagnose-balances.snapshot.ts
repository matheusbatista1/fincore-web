/**
 * Loads a workspace from a snapshot produced by `diagnose-balances.snapshot.sql` — the way to run
 * the diagnosis without database credentials.
 *
 * The rows go through the SAME mappers the repository uses and the same filters as
 * `DrizzleFinanceRepository.loadWorkspace` (soft-deleted rows dropped; a fatura payment whose
 * account is gone dropped), so the workspace is the one the app computes with. What the app never
 * loads — the audit columns and the soft-deleted rows — is kept aside as {@link DiagnosisAudit}.
 *
 * Accepted files: the JSON itself, the SQL Editor's "Copy as JSON" (`[{"snapshot": …}]`), or its
 * "Download CSV" (a header line and one quoted cell).
 */

import { readFileSync } from "node:fs";
import type { Workspace } from "@/application/ports/finance-repository";
import {
  toAccount,
  toCardBillDate,
  toCardBillPayment,
  toCreditCard,
  toPerson,
  toSettlement,
  toTransaction,
} from "@/infrastructure/db/mappers";
import type { DiagnosisAudit, DiagnosisInput } from "./diagnose-balances.report";

type Row = Record<string, unknown>;

export interface Snapshot {
  readonly ws: Workspace;
  readonly autoPayments: DiagnosisInput["autoPayments"];
  readonly audit: DiagnosisAudit;
  /** When the snapshot was taken (ISO instant), if the file says so. */
  readonly exportedAt: string | null;
}

const TABLES = [
  "accounts",
  "credit_cards",
  "card_bill_dates",
  "people",
  "transactions",
  "transaction_splits",
  "settlements",
  "card_bill_payments",
] as const;

const TIMESTAMP_COLUMNS = new Set(["created_at", "updated_at", "deleted_at", "rolled_at"]);
/** Integer columns: a JSON export may hand a bigint over as a string. */
const INTEGER_COLUMN = /(_cents|_day|_no|_total|_count|_day_of_month)$/;

/** The JSON document inside whatever the SQL Editor exported. */
function parseSnapshotText(text: string): Row {
  const trimmed = text.replace(/^﻿/, "").trim();
  let value: unknown;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    value = JSON.parse(trimmed);
  } else {
    // "Download CSV": a header line, then one cell — quoted, with its quotes doubled.
    const cell = trimmed.slice(trimmed.indexOf("\n") + 1).trim();
    const quoted = cell.startsWith('"') && cell.endsWith('"');
    value = JSON.parse(quoted ? cell.slice(1, -1).replace(/""/g, '"') : cell);
  }
  if (Array.isArray(value)) value = value[0];
  if (isRow(value) && "snapshot" in value) value = value.snapshot;
  if (typeof value === "string") value = JSON.parse(value);
  if (!isRow(value)) throw new Error("o arquivo não contém o JSON do snapshot.");
  return value;
}

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A database row (snake_case, JSON types) in the shape Drizzle hands to the mappers. */
function toDrizzleRow(raw: Row): Row {
  const row: Row = {};
  for (const [column, value] of Object.entries(raw)) {
    const key = column.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
    if (TIMESTAMP_COLUMNS.has(column) && typeof value === "string") row[key] = new Date(value);
    else if (INTEGER_COLUMN.test(column) && typeof value === "string") row[key] = Number(value);
    else row[key] = value;
  }
  return row;
}

const instant = (value: unknown): string => (value instanceof Date ? value.toISOString() : "");

/** Build the workspace (as the app loads it) and the audit trail from a snapshot file. */
export function loadSnapshot(path: string): Snapshot {
  const raw = parseSnapshotText(readFileSync(path, "utf8"));
  const table = (name: (typeof TABLES)[number]): Row[] => {
    const rows = raw[name];
    if (!Array.isArray(rows)) throw new Error(`snapshot sem a tabela "${name}".`);
    return rows.filter(isRow).map(toDrizzleRow);
  };
  const live = (rows: Row[]): Row[] => rows.filter((row) => row.deletedAt == null);
  // The mappers take Drizzle's inferred row types; a snapshot row has the same fields by name.
  const as = <F extends (row: never, ...rest: never[]) => unknown>(row: Row) => row as Parameters<F>[0];

  const accountRows = table("accounts");
  const cardRows = table("credit_cards");
  const peopleRows = table("people");
  const txRows = table("transactions");
  const paymentRows = table("card_bill_payments");
  if (isRow(raw.profile) === false && accountRows.length === 0 && txRows.length === 0) {
    throw new Error("snapshot vazio: nenhum usuário com o e-mail usado na consulta.");
  }

  type SplitRow = Parameters<typeof toTransaction>[1] extends readonly (infer S)[] | undefined ? S : never;
  const splitsByTx = new Map<string, SplitRow[]>();
  for (const split of table("transaction_splits")) {
    const list = splitsByTx.get(String(split.transactionId)) ?? [];
    list.push(split as SplitRow);
    splitsByTx.set(String(split.transactionId), list);
  }
  const mapTx = (row: Row) =>
    toTransaction(as<typeof toTransaction>(row), splitsByTx.get(String(row.id)) ?? []);

  // Mirrors DrizzleFinanceRepository.loadWorkspace: live rows only, and a fatura payment whose
  // paying account is gone reverts to unpaid.
  const liveAccountIds = new Set(live(accountRows).map((row) => String(row.id)));
  const ws: Workspace = {
    accounts: live(accountRows).map((row) => toAccount(as<typeof toAccount>(row))),
    creditCards: live(cardRows).map((row) => toCreditCard(as<typeof toCreditCard>(row))),
    people: live(peopleRows).map((row) => toPerson(as<typeof toPerson>(row))),
    categories: [],
    transactions: live(txRows).map(mapTx),
    settlements: live(table("settlements")).map((row) => toSettlement(as<typeof toSettlement>(row))),
    budgets: [],
    goals: [],
    cardBillDates: table("card_bill_dates").map((row) => toCardBillDate(as<typeof toCardBillDate>(row))),
    cardBillPayments: live(paymentRows)
      .map((row) => toCardBillPayment(as<typeof toCardBillPayment>(row)))
      .filter((p): p is NonNullable<typeof p> => p !== null && liveAccountIds.has(p.accountId)),
  };

  const deleted: DiagnosisAudit["deleted"][number][] = [];
  for (const row of txRows) {
    if (row.deletedAt == null) continue;
    try {
      deleted.push({ tx: mapTx(row), createdAt: instant(row.createdAt), deletedAt: instant(row.deletedAt) });
    } catch {
      // an inconsistent deleted row cannot be mapped — it cannot be on a bill either
    }
  }
  const removedLabels = new Map<string, string>();
  for (const row of accountRows) {
    if (row.deletedAt != null) removedLabels.set(String(row.id), `${row.bank} · ${row.name} (conta apagada)`);
  }
  for (const row of cardRows) {
    if (row.deletedAt != null) {
      removedLabels.set(String(row.id), `${row.bank} · ${row.product} (cartão apagado)`);
    }
  }
  for (const row of peopleRows) {
    if (row.deletedAt != null) removedLabels.set(String(row.id), `${row.name} (pessoa removida)`);
  }

  const profile = isRow(raw.profile) ? raw.profile : null;
  return {
    ws,
    autoPayments: profile
      ? {
          enabled: profile.auto_payments_enabled === true,
          accountId:
            typeof profile.default_pay_account_id === "string" ? profile.default_pay_account_id : null,
          since: typeof profile.auto_payments_since === "string" ? profile.auto_payments_since : null,
        }
      : null,
    audit: {
      stamps: new Map(
        live(txRows).map((row) => [
          String(row.id),
          { createdAt: instant(row.createdAt), updatedAt: instant(row.updatedAt) },
        ]),
      ),
      deleted,
      paymentRecordedAt: new Map(live(paymentRows).map((row) => [String(row.id), instant(row.createdAt)])),
      removedLabels,
    },
    exportedAt: typeof raw.exported_at === "string" ? raw.exported_at : null,
  };
}
