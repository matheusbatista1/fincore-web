/**
 * READ-ONLY diagnostic (QA utility — no writes). Answers, with the app's own calculators:
 *
 *   1. Why does the dashboard's "fim do mês" differ between Geral and Apenas meu? Lists every row,
 *      acerto and paid fatura that moves one lens away from the other.
 *   2. Why would an account balance differ from the bank? Lists the usual suspects and, with
 *      `--conta`, the account's full statement to compare against the bank's, line by line.
 *
 * Two sources:
 *   - the database: everything runs inside ONE `READ ONLY` transaction, so Postgres itself refuses
 *     any write. The connection string comes from the environment — `.env.local` through Node's
 *     built-in loader (the script never prints it), or variables already set by the caller;
 *   - `--snapshot <file>`: no credentials at all. The file comes from running
 *     `scripts/diagnose-balances.snapshot.sql` in the Supabase SQL Editor; it also carries the row
 *     history, so the report can say which rows changed after a fatura was paid.
 *
 * Run:
 *   pnpm exec tsx scripts/diagnose-balances.ts [--mes 2026-11] [--conta c6] [--desde 2026-10-01]
 *   pnpm exec tsx scripts/diagnose-balances.ts --snapshot ./snapshot.csv [--hoje 2026-11-10] …
 *
 * Do NOT wrap it in `vercel env run -- node …`: the Vercel CLI's native binary resolves the child
 * `node` to itself and deploys the path instead of running it.
 *
 *   --mes       month whose "fim do mês" is explained (default: the current month)
 *   --conta     fragment of an account's "banco · nome": prints that account's statement
 *   --desde     first day listed in the statement (earlier movements fold into one line)
 *   --hoje      the day to compute as of (default: now, or the day the snapshot was taken)
 *   --email     which user, when the database holds more than one
 *   --snapshot  read the workspace from a snapshot file instead of the database
 */
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";

// Load env BEFORE anything that touches the validated env/client is imported (see fromDatabase()).
try {
  loadEnvFile(".env.local");
} catch {
  // rely on the ambient env (CI, shell)
}
// Only DATABASE_URL matters here — don't fail on unrelated missing public vars.
process.env.SKIP_ENV_VALIDATION = "1";

import {
  type IsoDate,
  isValidCompetenceMonth,
  isValidIsoDate,
  monthOf,
} from "@/domain/value-objects/competence-month";
import type { Database } from "@/infrastructure/db/client";
import { todayInBrazil } from "@/shared/formatting/now";
import { type DiagnosisInput, renderDiagnosis } from "./diagnose-balances.report";
import { loadSnapshot } from "./diagnose-balances.snapshot";

type Source = Pick<DiagnosisInput, "ws" | "autoPayments" | "audit">;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The calendar day of an instant in São Paulo, as `YYYY-MM-DD`. */
const dayInBrazil = (iso: string): IsoDate =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/** Load the workspace from the database, inside one READ ONLY transaction. */
async function fromDatabase(email: string | undefined): Promise<Source> {
  if (!process.env.DATABASE_URL) {
    fail(
      "DATABASE_URL ausente. Sem a credencial do banco, use --snapshot com o arquivo gerado por " +
        "scripts/diagnose-balances.snapshot.sql (SQL Editor do Supabase).",
    );
  }
  const { db } = await import("@/infrastructure/db/client");
  const { DrizzleFinanceRepository } = await import(
    "@/infrastructure/repositories/drizzle-finance-repository"
  );
  const { sql } = await import("drizzle-orm");

  return db.transaction(
    async (tx) => {
      // Before any role switch: the connection's own role sees every user (RLS applies below).
      const users = (await tx.execute(
        sql`select id, email from public.users where deactivated_at is null order by created_at`,
      )) as unknown as Array<{ id: string; email: string }>;
      const user = email ? users.find((u) => u.email === email) : users[0];
      if (!user) fail(email ? "Nenhum usuário ativo com esse e-mail." : "Nenhum usuário ativo.");
      if (!email && users.length > 1) {
        fail(`O banco tem ${users.length} usuários ativos: escolha um com --email.`);
      }

      // The repository opens its RLS-scoped transaction on whatever it is given; handing it this
      // transaction nests it as a savepoint, so its reads stay inside the READ ONLY boundary.
      const repo = new DrizzleFinanceRepository(tx as unknown as Database);
      const ws = await repo.loadWorkspace(user.id);
      const profile = await repo.getProfile(user.id);
      return {
        ws,
        autoPayments: {
          enabled: profile.autoPaymentsEnabled,
          accountId: profile.defaultPayAccountId,
          since: profile.autoPaymentsSince,
        },
      };
    },
    { accessMode: "read only" },
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      mes: { type: "string" },
      conta: { type: "string" },
      desde: { type: "string" },
      hoje: { type: "string" },
      email: { type: "string" },
      snapshot: { type: "string" },
    },
  });
  if (values.hoje !== undefined && !isValidIsoDate(values.hoje)) {
    fail(`--hoje inválido: "${values.hoje}" (use AAAA-MM-DD).`);
  }
  const since = values.desde ?? null;
  if (since !== null && !isValidIsoDate(since)) fail(`--desde inválido: "${since}" (use AAAA-MM-DD).`);

  let source: Source;
  let today = values.hoje ?? todayInBrazil();
  const notes: string[] = [];
  if (values.snapshot !== undefined) {
    const snapshot = loadSnapshot(values.snapshot);
    source = snapshot;
    // A snapshot is a picture of one moment: compute as of the day it was taken unless told otherwise.
    if (values.hoje === undefined && snapshot.exportedAt !== null) today = dayInBrazil(snapshot.exportedAt);
    notes.push(
      `Fonte: snapshot${snapshot.exportedAt ? ` tirado em ${dayInBrazil(snapshot.exportedAt)}` : ""}` +
        ` · ${snapshot.audit.deleted.length} lançamentos apagados guardados para o histórico`,
    );
  } else {
    source = await fromDatabase(values.email);
    notes.push("Fonte: banco de dados (transação READ ONLY)");
  }

  const month = values.mes ?? monthOf(today);
  if (!isValidCompetenceMonth(month)) fail(`--mes inválido: "${month}" (use AAAA-MM).`);

  const lines = renderDiagnosis({ ...source, today, month, accountQuery: values.conta ?? null, since });
  for (const line of [...notes, ...lines]) console.log(line);
  process.exit(0);
}

main().catch((error: unknown) => {
  // Never echo the error object: a connection failure can carry the connection string.
  console.error(`Falhou: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  process.exit(1);
});
