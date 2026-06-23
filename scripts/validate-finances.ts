/**
 * READ-ONLY validation script (QA utility — no writes).
 *
 * Reconciles the values the UI shows (card "limite utilizado", "fatura atual",
 * dashboard "fim do mês") against the raw data, using the real domain calculators.
 * It loads `.env.local` via Node's built-in loader (the script itself never reads
 * the file) and only runs SELECTs.
 *
 * Run:  pnpm exec tsx scripts/validate-finances.ts
 */
import { loadEnvFile } from "node:process";

// Load env BEFORE importing anything that touches the validated env/client.
try {
  loadEnvFile(".env.local");
} catch {
  // rely on ambient env (CI / shell)
}
// Don't fail on unrelated missing public vars — we only need DATABASE_URL.
process.env.SKIP_ENV_VALIDATION = "1";

import { isExpense, isIncome } from "@/domain/entities/transaction";
import { Money } from "@/domain/money/money";
import { computeAccountBalances } from "@/domain/services/balance.calculator";
import {
  billingCompetence,
  computeCardBill,
  computeCardBillForMonth,
  computeCardOutstanding,
} from "@/domain/services/card-bill.calculator";
import { computePersonBalancesForMonth } from "@/domain/services/person-ledger.calculator";
import { obligationsDueThrough, projectedMonthEndBalances } from "@/domain/services/projected-balance";
import { addMonths, type CompetenceMonth, compareMonths } from "@/domain/value-objects/competence-month";
import { todayInBrazil } from "@/shared/formatting/now";

const KNOWN_EMAIL = "matheus.batista@zig.fun";

const brl = (cents: number) =>
  `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctOf = (cents: number, limit: number) => (limit > 0 ? `${Math.round((cents / limit) * 100)}%` : "—");
const hr = (s: string) => console.log(`\n${"=".repeat(72)}\n${s}\n${"=".repeat(72)}`);

async function main() {
  const { db } = await import("@/infrastructure/db/client");
  const { DrizzleFinanceRepository } = await import(
    "@/infrastructure/repositories/drizzle-finance-repository"
  );
  const { sql } = await import("drizzle-orm");

  // Discover the user (service/pooler role bypasses RLS for this lookup).
  const users = (await db.execute(
    sql`select id, email from public.users where deactivated_at is null order by created_at`,
  )) as unknown as Array<{ id: string; email: string }>;
  if (users.length === 0) {
    console.error("No users found (RLS may be blocking the lookup).");
    process.exit(1);
  }
  const user = users.find((u) => u.email === KNOWN_EMAIL) ?? users[0];
  if (!user) {
    console.error("No user selected.");
    process.exit(1);
  }
  console.log(`Validating user: ${user.email} (${user.id})`);
  if (users.length > 1) console.log(`(of ${users.length} users in DB)`);

  const repo = new DrizzleFinanceRepository(db);
  const ws = await repo.loadWorkspace(user.id);

  const today = todayInBrazil();
  const currentMonth = today.slice(0, 7) as CompetenceMonth;
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);

  console.log(
    `\nToday (BRT): ${today} · current competence month: ${currentMonth}` +
      `\nAccounts: ${ws.accounts.length} · Cards: ${ws.creditCards.length} · People: ${ws.people.length}` +
      ` · Transactions: ${ws.transactions.length} · Settlements: ${ws.settlements.length}`,
  );

  // ---------------------------------------------------------------- accounts
  hr("ACCOUNT BALANCES (live, as of today)");
  const balances = computeAccountBalances(ws.accounts, ws.transactions, today);
  let totalBalance = 0;
  for (const a of ws.accounts) {
    const c = (balances.get(a.id) ?? Money.zero()).cents;
    totalBalance += c;
    console.log(`  ${a.bank} · ${a.name}: ${brl(c)}`);
  }
  console.log(`  TOTAL saldo: ${brl(totalBalance)}`);

  // ------------------------------------------------------------------- cards
  hr("CARDS — fatura atual (hoje) vs. fatura do mês vs. total em aberto");
  for (const card of ws.creditCards) {
    const currentBill = computeCardBill(card.id, ws.transactions); // open-cycle bill (Cartões "Fatura atual")
    const monthBill = computeCardBillForMonth(card.id, ws.transactions, currentMonth, competenceOf); // dashboard fatura
    const open = computeCardOutstanding(card.id, ws.transactions, currentMonth, competenceOf); // "limite utilizado"

    console.log(`\n  ▸ ${card.bank} · ${card.product}  (limite ${brl(card.limitCents)})`);
    console.log(
      `    UI hoje      → fatura/utilizado = ${brl(currentBill.cents)}  (${pctOf(currentBill.cents, card.limitCents)} do limite)`,
    );
    console.log(`    Fatura ${currentMonth} (proposto) = ${brl(monthBill.cents)}`);
    console.log(
      `    Total em aberto (proposto, limite usado) = ${brl(open.cents)}  (${pctOf(open.cents, card.limitCents)} do limite)` +
        `  · disponível ${brl(card.limitCents - open.cents)}`,
    );

    // Per-competence breakdown so future installments are visible.
    const byMonth = new Map<string, number>();
    for (const tx of ws.transactions) {
      if (
        !(isExpense(tx) && tx.source === "card" && tx.cardId === card.id) &&
        !(isIncome(tx) && tx.cardId === card.id)
      )
        continue;
      const m = competenceOf(tx);
      const delta = isExpense(tx) ? Math.abs(tx.amountCents) : -tx.amountCents;
      byMonth.set(m, (byMonth.get(m) ?? 0) + delta);
    }
    const months = [...byMonth.keys()].sort();
    if (months.length) {
      console.log("    Por competência (fatura de cada mês):");
      for (const m of months) {
        const tag = compareMonths(m, currentMonth) < 0 ? "passada" : m === currentMonth ? "ATUAL" : "futura";
        console.log(`      ${m} [${tag}]: ${brl(byMonth.get(m) ?? 0)}`);
      }
    }
  }

  // ------------------------------------------------------------- fim do mês
  hr(`DASHBOARD "FIM DO MÊS" — sweep both lenses across months (current=${currentMonth})`);

  // Faithful replica of get-dashboard's projected-balance math for one (month, lens).
  function projectedFor(month: CompetenceMonth, lens: "general" | "personal") {
    const eom = projectedMonthEndBalances(
      ws.accounts,
      ws.transactions,
      month,
      competenceOf,
      currentMonth,
      lens,
    );
    let eomSum = 0;
    for (const v of eom.values()) eomSum += v.cents;
    const obligations = obligationsDueThrough(
      ws.transactions,
      currentMonth,
      month,
      competenceOf,
      lens,
      currentMonth,
    ).cents;
    let peopleNet = 0;
    if (lens === "general") {
      for (let m = currentMonth; compareMonths(m, month) <= 0; m = addMonths(m, 1)) {
        const ledgerM = computePersonBalancesForMonth(
          ws.people,
          ws.transactions,
          ws.settlements,
          m,
          competenceOf,
          currentMonth,
        );
        for (const v of ledgerM.values()) peopleNet += v.cents;
      }
    }
    return { eomSum, obligations, peopleNet, total: eomSum - obligations + peopleNet };
  }

  console.log("  month     | lens     |   (A) contas  −  (B) obrig.  +  (C) pessoas  =  FIM DO MÊS");
  for (let i = 0; i <= 6; i++) {
    const month = addMonths(currentMonth, i) as CompetenceMonth;
    for (const lens of ["general", "personal"] as const) {
      const r = projectedFor(month, lens);
      const flag =
        Math.abs(r.total) === 13358 || Math.abs(r.obligations) === 13358 || Math.abs(r.peopleNet) === 13358
          ? "  <<< 133,58!"
          : "";
      console.log(
        `  ${month} | ${lens.padEnd(8)} | ${brl(r.eomSum).padStart(13)}  ${brl(r.obligations).padStart(11)}  ${brl(r.peopleNet).padStart(12)}  = ${brl(r.total).padStart(12)}${flag}`,
      );
    }
  }

  // Itemize obligations + people for the CURRENT month, general lens, to explain the components.
  hr(`Breakdown for month=${currentMonth}`);
  console.log("  Obrigações a vencer (B) — despesas não-conta com competência neste mês:");
  for (const tx of ws.transactions) {
    if (!isExpense(tx) || tx.source === "account" || competenceOf(tx) !== currentMonth) continue;
    console.log(
      `    ${tx.date} · ${tx.description} · ${tx.source}${tx.cardId ? " (card)" : ""}: full ${brl(Math.abs(tx.amountCents))} · myShare ${brl(tx.myShareCents)}`,
    );
  }
  console.log("\n  Pessoas (C) — líquido por pessoa no mês:");
  const ledger = computePersonBalancesForMonth(
    ws.people,
    ws.transactions,
    ws.settlements,
    currentMonth,
    competenceOf,
    currentMonth,
  );
  for (const [pid, v] of ledger.entries()) {
    if (v.cents === 0) continue;
    const person = ws.people.find((p) => p.id === pid);
    console.log(`    ${person?.name ?? pid}: ${brl(v.cents)} ${v.cents > 0 ? "(te deve)" : "(você deve)"}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("VALIDATION FAILED:", err);
    process.exit(1);
  });
