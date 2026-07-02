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

import { isExpense, isIncome, isPaid, isTransfer } from "@/domain/entities/transaction";
import { Money } from "@/domain/money/money";
import { computeAccountBalances } from "@/domain/services/balance.calculator";
import {
  billingCompetence,
  computeCardBill,
  computeCardBillForMonth,
  computeCardOutstanding,
} from "@/domain/services/card-bill.calculator";
import {
  computePersonBalances,
  computePersonBalancesForMonth,
  computePersonMonthNets,
} from "@/domain/services/person-ledger.calculator";
import { computeViewTotals } from "@/domain/services/personal-vs-general";
import { obligationsDueThrough, projectedMonthEndBalances } from "@/domain/services/projected-balance";
import { projectRecurring, transactionsForMonth } from "@/domain/services/recurring.projection";
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

  const acctName = new Map(ws.accounts.map((a) => [a.id, `${a.bank} · ${a.name}`]));

  // ------------------------------------------------ auto-payments configuration
  hr("AUTO-PAGAMENTO — configuração + o que foi debitado de cada conta");
  const profile = await repo.getProfile(user.id);
  console.log(
    `  autoPaymentsEnabled=${profile.autoPaymentsEnabled} · defaultPayAccount=${profile.defaultPayAccountId ? (acctName.get(profile.defaultPayAccountId) ?? profile.defaultPayAccountId) : "—"} · since=${profile.autoPaymentsSince ?? "—"}`,
  );
  const paidByAcct = new Map<string, { n: number; cents: number }>();
  for (const tx of ws.transactions) {
    if (isExpense(tx) && isPaid(tx) && tx.paidAccountId) {
      const cur = paidByAcct.get(tx.paidAccountId) ?? { n: 0, cents: 0 };
      cur.n += 1;
      cur.cents += tx.paidAmountCents ?? Math.abs(tx.amountCents);
      paidByAcct.set(tx.paidAccountId, cur);
    }
  }
  const faturaByAcct = new Map<string, { n: number; cents: number }>();
  for (const p of ws.cardBillPayments) {
    const cur = faturaByAcct.get(p.accountId) ?? { n: 0, cents: 0 };
    cur.n += 1;
    cur.cents += p.amountCents;
    faturaByAcct.set(p.accountId, cur);
  }
  console.log("  Obrigações pagas por conta (paidAccountId):");
  for (const [id, v] of paidByAcct) console.log(`    ${acctName.get(id) ?? id}: ${v.n}× = ${brl(v.cents)}`);
  console.log("  Faturas pagas por conta (accountId):");
  for (const [id, v] of faturaByAcct) console.log(`    ${acctName.get(id) ?? id}: ${v.n}× = ${brl(v.cents)}`);

  // --------------------------------------- per-account "movimento" of the month
  hr(`MOVIMENTO POR CONTA (${currentMonth}) — entradas / saídas / TRANSFERÊNCIAS separadas`);
  console.log("  (mostra como transferências inflam o movimento hoje — devem ficar à parte)");
  type Flow = { inc: number; exp: number; tIn: number; tOut: number };
  const flow = new Map<string, Flow>();
  const bump = (id: string | null, k: keyof Flow, cents: number) => {
    if (!id) return;
    const f = flow.get(id) ?? { inc: 0, exp: 0, tIn: 0, tOut: 0 };
    f[k] += cents;
    flow.set(id, f);
  };
  for (const tx of ws.transactions) {
    if (isTransfer(tx)) {
      if (tx.date.slice(0, 7) !== currentMonth) continue;
      bump(tx.fromAccountId, "tOut", tx.valueCents);
      bump(tx.toAccountId, "tIn", tx.valueCents);
    } else if (isIncome(tx) && tx.accountId && tx.cardId === null && tx.date.slice(0, 7) === currentMonth) {
      bump(tx.accountId, "inc", tx.amountCents);
    } else if (isExpense(tx) && (tx.source === "account" || tx.source === "overdraft")) {
      const id = tx.source === "account" ? tx.accountId : tx.linkedAccountId;
      if (tx.date.slice(0, 7) === currentMonth) bump(id, "exp", Math.abs(tx.amountCents));
    }
  }
  for (const tx of ws.transactions) {
    if (isExpense(tx) && isPaid(tx) && tx.paidAt?.slice(0, 7) === currentMonth) {
      bump(tx.paidAccountId ?? null, "exp", tx.paidAmountCents ?? Math.abs(tx.amountCents));
    }
  }
  for (const p of ws.cardBillPayments)
    if (p.date.slice(0, 7) === currentMonth) bump(p.accountId, "exp", p.amountCents);
  for (const a of ws.accounts) {
    const f = flow.get(a.id) ?? { inc: 0, exp: 0, tIn: 0, tOut: 0 };
    console.log(
      `  ${(acctName.get(a.id) ?? a.id).padEnd(22)} entradas ${brl(f.inc).padStart(12)} · saídas ${brl(f.exp).padStart(12)} · transf +${brl(f.tIn)}/−${brl(f.tOut)}`,
    );
  }

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
      ws.settlements,
      ws.cardBillPayments,
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
      ws.cardBillPayments,
    ).cents;
    let peopleNet = 0;
    if (lens === "general") {
      // Single pass (horizon = browsed month) so a pre-payment re-buckets onto its debt
      // month — mirrors get-dashboard (a per-month re-call would miss it).
      const nets = computePersonMonthNets(ws.people, ws.transactions, ws.settlements, month, competenceOf);
      for (let m = currentMonth; compareMonths(m, month) <= 0; m = addMonths(m, 1)) {
        for (const person of ws.people) peopleNet += nets.get(person.id)?.get(m) ?? 0;
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

  // ----------------------------------------------- sobra real / resultado
  hr(`"SOBRA REAL" (dashboard) = "RESULTADO" (visão mensal) — month flow, both lenses`);
  console.log("  These are income − expense FOR THE MONTH (a flow), NOT the projected balance.");
  console.log("  month     |  Economia (geral)  |  Sobra real (pessoal)");
  // Gross (transaction-derived) person balances give each settlement its direction (owed to you?).
  const grossPersonBalances = computePersonBalances([], ws.transactions, []);
  for (let i = 0; i <= 6; i++) {
    const month = addMonths(currentMonth, i) as CompetenceMonth;
    const { real, projected } = transactionsForMonth(ws.transactions, month, competenceOf);
    const monthSet =
      compareMonths(month, currentMonth) <= 0 ? real : [...real, ...projected.map((p) => p.source)];
    const general = computeViewTotals(monthSet, "general");
    const personal = computeViewTotals(monthSet, "personal");
    const ledgerMonth = computePersonBalancesForMonth(
      ws.people,
      ws.transactions,
      ws.settlements,
      month,
      competenceOf,
      currentMonth,
    );
    let aReceber = 0;
    for (const v of ledgerMonth.values()) if (v.cents > 0) aReceber += v.cents;
    // Account-backed settlements dated this month: entrada (+) when they owed you, saída (−) when
    // you owed them — credited in the general economia (same as the monthly view / get-dashboard).
    let settlementNet = 0;
    for (const s of ws.settlements) {
      if (s.accountId === null || s.date.slice(0, 7) !== month) continue;
      const owedToYou = !(grossPersonBalances.get(s.personId) ?? Money.zero()).isNegative();
      settlementNet += owedToYou ? s.amountCents : -s.amountCents;
    }
    const economiaGeneral = general.net.cents + aReceber + settlementNet; // dashboard "Economia do mês"
    const sobraPersonal = personal.net.cents; // dashboard "Sobra real" / monthly "Resultado" (personal)
    const flag =
      Math.abs(economiaGeneral) === 13358 || Math.abs(sobraPersonal) === 13358 ? "  <<< 133,58!" : "";
    console.log(
      `  ${month} | ${brl(economiaGeneral).padStart(17)}  | ${brl(sobraPersonal).padStart(17)}${flag}`,
    );
  }

  // ------------------------------------------- discounts on paid obligations
  hr("DESCONTOS — obrigações pagas por valor ≠ do original (paidAmountCents vs |amountCents|)");
  console.log("  (o 'gasto/economia' agora conta o valor PAGO; aqui está a diferença nos seus dados)");
  const discByMonth = new Map<string, { count: number; original: number; paid: number }>();
  let discOriginal = 0;
  let discPaid = 0;
  let discCount = 0;
  for (const tx of ws.transactions) {
    if (!(isExpense(tx) && isPaid(tx))) continue;
    const original = Math.abs(tx.amountCents);
    const paid = tx.paidAmountCents ?? original;
    if (paid === original) continue;
    const comp = competenceOf(tx);
    const cur = discByMonth.get(comp) ?? { count: 0, original: 0, paid: 0 };
    cur.count += 1;
    cur.original += original;
    cur.paid += paid;
    discByMonth.set(comp, cur);
    discOriginal += original;
    discPaid += paid;
    discCount += 1;
    const delta = original - paid;
    console.log(
      `    [${comp}] ${tx.description} · ${tx.source}: original ${brl(original)} → pago ${brl(paid)}` +
        ` · ${delta >= 0 ? "desconto" : "acréscimo"} ${brl(Math.abs(delta))} (pago em ${tx.paidAt})`,
    );
  }
  if (discCount === 0) {
    console.log("    Nenhuma obrigação paga com valor diferente do original (sem descontos registrados).");
  } else {
    console.log(
      `\n  Σ ${discCount} pagamento(s) com diferença · original ${brl(discOriginal)} → pago ${brl(discPaid)}` +
        ` · desconto líquido ${brl(discOriginal - discPaid)}`,
    );
    console.log("  Por mês de competência (a economia daquele mês melhora nesse valor):");
    for (const m of [...discByMonth.keys()].sort()) {
      const d = discByMonth.get(m);
      if (!d) continue;
      console.log(
        `    ${m}: ${d.count}× · gasto ${brl(d.original)} → ${brl(d.paid)} (Δ +${brl(d.original - d.paid)})`,
      );
    }
  }

  // Itemize the cumulative window [currentMonth..target] that feeds a future month's
  // "fim do mês" — to show what is really driving the number (and whether the loan nets out).
  const target = addMonths(currentMonth, 1) as CompetenceMonth; // July
  hr(`Breakdown of "FIM DO MÊS" for month=${target} (cumulative window ${currentMonth}..${target})`);
  let realOblig = 0;
  console.log("  Obrigações REAIS a vencer (B) — despesas não-conta no período:");
  for (const tx of ws.transactions) {
    if (!isExpense(tx) || tx.source === "account") continue;
    const c = competenceOf(tx);
    if (compareMonths(c, currentMonth) < 0 || compareMonths(c, target) > 0) continue;
    realOblig += Math.abs(tx.amountCents);
    console.log(
      `    [${c}] ${tx.description} · ${tx.source}${tx.cardId ? " (card)" : ""}: full ${brl(Math.abs(tx.amountCents))} · sua parte ${brl(tx.myShareCents)}`,
    );
  }
  const bTotal = obligationsDueThrough(
    ws.transactions,
    currentMonth,
    target,
    competenceOf,
    "general",
    currentMonth,
  ).cents;
  console.log(
    `    Σ obrigações reais = ${brl(realOblig)} · B total (com recorrências projetadas) = ${brl(bTotal)} · projetado = ${brl(bTotal - realOblig)}`,
  );

  console.log("\n  Pessoas (C) — líquido acumulado no período (compensa as partes de terceiros):");
  let cTotal = 0;
  for (let m = currentMonth; compareMonths(m, target) <= 0; m = addMonths(m, 1)) {
    const lg = computePersonBalancesForMonth(
      ws.people,
      ws.transactions,
      ws.settlements,
      m,
      competenceOf,
      currentMonth,
    );
    for (const [pid, v] of lg.entries()) {
      if (v.cents === 0) continue;
      cTotal += v.cents;
      const person = ws.people.find((p) => p.id === pid);
      console.log(`    [${m}] ${person?.name ?? pid}: ${brl(v.cents)}`);
    }
  }
  const aTotal = (() => {
    const eom = projectedMonthEndBalances(ws.accounts, ws.transactions, target, competenceOf, currentMonth);
    let s = 0;
    for (const v of eom.values()) s += v.cents;
    return s;
  })();
  console.log(
    `\n  => (A) contas ${brl(aTotal)} − (B) ${brl(bTotal)} + (C) ${brl(cTotal)} = ${brl(aTotal - bTotal + cTotal)}`,
  );

  // -- Reconcile "Meu gasto real" (gasto pessoal do mês) vs as obrigações do fim do mês.
  hr(`RECONCILE "Meu gasto real" vs obrigações do fim do mês (personal, ${target})`);
  const { real: rJ, projected: pJ } = transactionsForMonth(ws.transactions, target, competenceOf);
  const monthSetJ = [...rJ, ...pJ.map((p) => p.source)];
  let acct = 0;
  let nonAcct = 0;
  let projShare = 0;
  for (const tx of monthSetJ) {
    if (!isExpense(tx)) continue;
    if (tx.source === "account") acct += tx.myShareCents;
    else nonAcct += tx.myShareCents;
  }
  for (const p of pJ) {
    const s = p.source;
    if (isExpense(s) && s.source !== "account") projShare += s.myShareCents;
  }
  const gastoReal = computeViewTotals(monthSetJ, "personal").expense.cents;
  const oblCumul = obligationsDueThrough(
    ws.transactions,
    currentMonth,
    target,
    competenceOf,
    "personal",
    currentMonth,
  ).cents;
  const oblJulyOnly = obligationsDueThrough(
    ws.transactions,
    target,
    target,
    competenceOf,
    "personal",
    target,
  ).cents;
  console.log(`  "Meu gasto real" (${target}, sua parte, todas as fontes) = ${brl(gastoReal)}`);
  console.log(`    · destes, fonte=conta (não são obrigação) = ${brl(acct)}`);
  console.log(`    · não-conta (elegíveis a obrigação)        = ${brl(nonAcct)}`);
  console.log(`    · (incluídos acima) recorrências previstas de ${target} = ${brl(projShare)}`);
  console.log(`  Obrigações fim do mês (só ${target}, projeta de ${target}) = ${brl(oblJulyOnly)}`);
  console.log(
    `  Obrigações fim do mês (acumulado ${currentMonth}..${target}) = ${brl(oblCumul)}  ← usado no dash`,
  );
  console.log(`  Diferença (acumulado − gasto real)         = ${brl(oblCumul - gastoReal)}`);
  console.log(
    `  Diferença (só-${target} − gasto real não-conta) = ${brl(oblJulyOnly - nonAcct)}  (≠0 indica inconsistência dentro do mês)`,
  );

  // -- Replicate obligationsDueThrough's counted items for the window and flag duplicates.
  hr(`DOUBLE-COUNT CHECK — items obligationsDueThrough counts for ${currentMonth}..${target}`);
  const counted: Array<{ tag: string; desc: string; comp: string; cents: number }> = [];
  for (const tx of ws.transactions) {
    if (!isExpense(tx) || tx.source === "account") continue;
    const c = competenceOf(tx);
    if (compareMonths(c, currentMonth) < 0 || compareMonths(c, target) > 0) continue;
    counted.push({ tag: "REAL", desc: tx.description, comp: c, cents: Math.abs(tx.amountCents) });
  }
  for (let m = currentMonth; compareMonths(m, target) <= 0; m = addMonths(m, 1)) {
    for (const occ of projectRecurring(ws.transactions, m)) {
      const s = occ.source;
      if (!isExpense(s) || s.source === "account") continue;
      const redated = { ...s, date: occ.date };
      const c = competenceOf(redated);
      if (compareMonths(c, currentMonth) < 0 || compareMonths(c, target) > 0) continue;
      counted.push({ tag: "PROJ", desc: s.description, comp: c, cents: Math.abs(s.amountCents) });
    }
  }
  const byDesc = new Map<string, typeof counted>();
  for (const it of counted) {
    const k = `${it.desc}|${it.cents}`;
    const arr = byDesc.get(k) ?? [];
    arr.push(it);
    byDesc.set(k, arr);
  }
  console.log("  Itens contados mais de uma vez (possível duplo-count):");
  let dupTotal = 0;
  for (const [, arr] of byDesc) {
    if (arr.length < 2) continue;
    const tags = arr.map((a) => `${a.tag}@${a.comp}`).join(" + ");
    console.log(`    ${arr[0]?.desc} (${brl(arr[0]?.cents ?? 0)}): ${arr.length}× → ${tags}`);
    dupTotal += (arr.length - 1) * (arr[0]?.cents ?? 0);
  }
  console.log(`  Total duplicado (excesso) ≈ ${brl(dupTotal)}`);

  // ----------------------------------------------- reports validation
  const last = addMonths(currentMonth, 5) as CompetenceMonth;
  hr(`REPORTS — forward window ${currentMonth}..${last} (cash flow + gasto por cartão)`);
  const setForMonth = (month: CompetenceMonth) => {
    const { real, projected } = transactionsForMonth(ws.transactions, month, competenceOf);
    return compareMonths(month, currentMonth) <= 0 ? real : [...real, ...projected.map((p) => p.source)];
  };
  const cardSpend = new Map<string, number>();
  console.log("  Fluxo de caixa (geral): mês       receita        despesa      resultado");
  for (let i = 0; i <= 5; i++) {
    const month = addMonths(currentMonth, i) as CompetenceMonth;
    const set = setForMonth(month);
    const t = computeViewTotals(set, "general");
    console.log(
      `    ${month}  +${brl(t.income.cents).padStart(12)}  −${brl(t.expense.cents).padStart(12)}  = ${brl(t.net.cents).padStart(12)}`,
    );
    for (const tx of set) {
      if (isExpense(tx) && tx.source === "card" && tx.cardId !== null) {
        cardSpend.set(tx.cardId, (cardSpend.get(tx.cardId) ?? 0) + Math.abs(tx.amountCents));
      } else if (isIncome(tx) && tx.cardId !== null) {
        cardSpend.set(tx.cardId, (cardSpend.get(tx.cardId) ?? 0) - tx.amountCents);
      }
    }
  }
  console.log("\n  Gasto por cartão no período (o que a tela de Relatórios deve mostrar):");
  const cardById2 = new Map(ws.creditCards.map((c) => [c.id, c]));
  for (const [id, v] of [...cardSpend.entries()].sort((a, b) => b[1] - a[1])) {
    if (v <= 0) continue;
    const c = cardById2.get(id);
    console.log(`    ${c ? `${c.bank} · ${c.product}` : id}: ${brl(v)}`);
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

  // ------------------------------------------- person month-net breakdown (bug)
  hr("PESSOAS — de onde vem o saldo de cada mês (real vs projetado vs acerto)");
  const horizon = addMonths(currentMonth, 2) as CompetenceMonth;
  const nets = computePersonMonthNets(ws.people, ws.transactions, ws.settlements, horizon, competenceOf);
  for (const person of ws.people) {
    const perMonth = nets.get(person.id);
    if (!perMonth) continue;
    const active = [...perMonth.entries()].filter(([, c]) => c !== 0);
    if (active.length === 0) continue;
    console.log(`\n  ▸ ${person.name}`);
    for (const m of [currentMonth, addMonths(currentMonth, 1) as CompetenceMonth, horizon]) {
      const net = perMonth.get(m) ?? 0;
      console.log(`    ${m}: net = ${brl(net)}`);
      // Real split shares whose competence is this month.
      for (const tx of ws.transactions) {
        if (!isExpense(tx) || competenceOf(tx) !== m) continue;
        const sh = tx.splits.find((s) => s.personId === person.id);
        if (sh)
          console.log(
            `        REAL   ${tx.date} ${tx.description} (${tx.source}${tx.cardId ? " card" : ""}) → ${brl(sh.shareCents)}`,
          );
      }
      // Projected recurring shares landing in this month.
      for (let mm = currentMonth; compareMonths(mm, m) <= 0; mm = addMonths(mm, 1)) {
        for (const occ of projectRecurring(ws.transactions, mm)) {
          const s = occ.source;
          if (!isExpense(s)) continue;
          const redated = { ...s, date: occ.date };
          if (competenceOf(redated) !== m) continue;
          const sh = s.splits.find((x) => x.personId === person.id);
          if (sh)
            console.log(
              `        PROJ   ${occ.date} ${s.description} → ${brl(sh.shareCents)}  <<< projetado (não é real do mês)`,
            );
        }
      }
      // Settlements dated in this month for this person.
      for (const st of ws.settlements) {
        if (st.personId === person.id && st.date.slice(0, 7) === m) {
          console.log(
            `        ACERTO ${st.date} → ${brl(st.amountCents)} (conta: ${st.accountId ? (acctName.get(st.accountId) ?? st.accountId) : "sem conta"})`,
          );
        }
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("VALIDATION FAILED:", err);
    process.exit(1);
  });
