/**
 * Pure renderer behind `scripts/diagnose-balances.ts`: turns a workspace into the lines the script
 * prints. No IO and no clock — "today" and the browsed month come in through the input, so the whole
 * report can be exercised with a synthetic workspace.
 *
 * Two questions, answered with the app's own calculators:
 *   1. why the dashboard's "fim do mês" differs between Geral and Apenas meu (explainMonthEndGap);
 *   2. why an account balance could differ from the bank (the rows that never debit an account, the
 *      paid faturas whose snapshot no longer matches their rows, and the account's full statement).
 */

import type { Workspace } from "@/application/ports/finance-repository";
import {
  type ExpenseTransaction,
  isExpense,
  isIncome,
  isPaid,
  isPayableObligation,
  isPendingReceivable,
  isRolled,
  isTransfer,
  type Transaction,
} from "@/domain/entities/transaction";
import { Money } from "@/domain/money/money";
import {
  accountDeltas,
  balanceEffectiveDate,
  computeAccountBalances,
} from "@/domain/services/balance.calculator";
import {
  billingCompetence,
  cardBillOverridesByCard,
  computeCardBillForMonth,
} from "@/domain/services/card-bill.calculator";
import {
  explainMonthEndGap,
  findPaidBillDrifts,
  type MonthEndGapItem,
} from "@/domain/services/month-end-gap.explainer";
import { computePersonBalances } from "@/domain/services/person-ledger.calculator";
import {
  type CompetenceMonth,
  compareMonths,
  dateInMonth,
  type IsoDate,
  monthOf,
} from "@/domain/value-objects/competence-month";

export interface DiagnosisInput {
  readonly ws: Workspace;
  readonly today: IsoDate;
  /** The browsed month whose "fim do mês" is explained. */
  readonly month: CompetenceMonth;
  /** Auto-payment settings from the profile, when available. */
  readonly autoPayments: {
    readonly enabled: boolean;
    readonly accountId: string | null;
    readonly since: string | null;
  } | null;
  /** Case-insensitive fragment of an account's "banco · nome": prints that account's statement. */
  readonly accountQuery: string | null;
  /** First day listed in the statement (earlier movements fold into a carried balance). */
  readonly since: IsoDate | null;
  /** Row history, when the source carries it (a snapshot does): what changed after a fatura was paid. */
  readonly audit?: DiagnosisAudit | null;
}

/** What the audit columns and the soft-deleted rows add to the workspace (ISO instants, UTC). */
export interface DiagnosisAudit {
  /** When each live transaction was created and last updated, by id. */
  readonly stamps: ReadonlyMap<string, { readonly createdAt: string; readonly updatedAt: string }>;
  /** Soft-deleted transactions, mapped like live ones. */
  readonly deleted: readonly {
    readonly tx: Transaction;
    readonly createdAt: string;
    readonly deletedAt: string;
  }[];
  /** When each fatura payment was recorded, by payment id. */
  readonly paymentRecordedAt: ReadonlyMap<string, string>;
  /** Labels of soft-deleted accounts, cards and people, by id. */
  readonly removedLabels: ReadonlyMap<string, string>;
}

/** A UTC instant as a São Paulo wall-clock label. */
const when = (iso: string): string =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });

const RULE = "=".repeat(96);

const amount = (cents: number): string =>
  (Math.abs(cents) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** `R$ 1.234,56`, with a leading minus when negative. */
const brl = (cents: number): string => `${cents < 0 ? "-" : ""}R$ ${amount(cents)}`;
/** Always signed: `+R$ 3,60` / `-R$ 6,00`. */
const signed = (cents: number): string => `${cents < 0 ? "-" : "+"}R$ ${amount(cents)}`;

const SOURCE_LABEL: Record<ExpenseTransaction["source"], string> = {
  card: "cartão",
  account: "conta",
  boleto: "boleto",
  loan: "empréstimo",
  financing: "financiamento",
  overdraft: "cheque especial",
};

const REASON_LABEL: Record<MonthEndGapItem["reason"], string> = {
  advance: "ACERTO ACIMA DA DÍVIDA (crédito da pessoa)",
  "overpaid-person": "DEVOLUÇÃO ACIMA DO DEVIDO",
  writeoff: "BAIXA SEM CONTA (perdão/desconto)",
  "settlement-direction": "ACERTO COM SENTIDO DIVERGENTE",
  "expected-reimbursement": "PAGAMENTO DE PESSOA AINDA A RECEBER (conta em dobro)",
  "unlinked-reimbursement": "REEMBOLSO QUE NÃO ABATE DÍVIDA DE NINGUÉM",
  "person-income-as-own": "RECEITA DE PESSOA CONTADA COMO SUA",
  "income-mismatch": "RECEITA: CAIXA × RAZÃO NÃO FECHAM",
  "paid-bill": "FATURA PAGA: FATIA DE TERCEIROS × PARTES COBRADAS",
  "share-without-cost": "PARTE COBRADA SEM CUSTO NO GERAL",
  "cost-without-share": "CUSTO DE TERCEIROS SEM NINGUÉM PARA COBRAR",
  "share-cost-mismatch": "PARTE COBRADA × CUSTO DE TERCEIROS DIFERENTES",
};

interface CashMove {
  readonly date: IsoDate;
  readonly label: string;
  readonly cents: number;
}

/** Render the whole diagnosis as printable lines. */
export function renderDiagnosis(input: DiagnosisInput): string[] {
  const { ws, today, month } = input;
  const currentMonth = monthOf(today);
  const competenceOf = billingCompetence(ws.creditCards, ws.cardBillDates);
  const out: string[] = [];
  const section = (title: string): void => {
    out.push("", RULE, title, RULE);
  };

  const knownAccounts = new Set(ws.accounts.map((a) => a.id));
  const accountLabels = new Map(ws.accounts.map((a) => [a.id, `${a.bank} · ${a.name}`] as const));
  const cardLabels = new Map(ws.creditCards.map((c) => [c.id, `${c.bank} · ${c.product}`] as const));
  const personNames = new Map(ws.people.map((p) => [p.id, p.name] as const));
  const removed = input.audit?.removedLabels;
  const accountLabel = (id: string | null | undefined): string =>
    id == null
      ? "sem conta"
      : (accountLabels.get(id) ?? removed?.get(id) ?? `conta inexistente (${id.slice(0, 8)})`);
  const cardLabel = (id: string | null): string =>
    id === null
      ? "cartão ?"
      : (cardLabels.get(id) ?? removed?.get(id) ?? `cartão inexistente (${id.slice(0, 8)})`);
  const personName = (id: string): string =>
    personNames.get(id) ?? removed?.get(id) ?? `pessoa removida (${id.slice(0, 8)})`;
  const peopleList = (ids: readonly string[]): string =>
    ids.length === 0 ? "ninguém" : ids.map(personName).join(", ");
  const paidBills = new Set(ws.cardBillPayments.map((p) => `${p.cardId}|${p.competence}`));
  const dueOverrides = cardBillOverridesByCard(ws.cardBillDates);

  /** One line of facts about an expense row. */
  const expenseFacts = (tx: ExpenseTransaction, projected: boolean): string => {
    const parts = [tx.date, tx.description || "(sem descrição)", SOURCE_LABEL[tx.source]];
    if (tx.source === "card") parts.push(cardLabel(tx.cardId), `fatura ${competenceOf(tx)}`);
    else if (tx.source === "account") parts.push(accountLabel(tx.accountId));
    if (tx.installment) {
      parts.push(`parcela ${tx.installment.number}/${tx.installment.total} (${tx.installment.status})`);
    }
    if (tx.recurrence) parts.push(`recorrente dia ${tx.recurrence.dayOfMonth}`);
    if (projected) parts.push("PREVISTO (não lançado)");
    if (isPaid(tx)) {
      parts.push(
        `pago em ${tx.paidAt} por ${brl(tx.paidAmountCents ?? Math.abs(tx.amountCents))} (${accountLabel(tx.paidAccountId)})`,
      );
    }
    return parts.join(" · ");
  };
  const splitFacts = (tx: ExpenseTransaction): string => {
    const splits = tx.splits.map((s) => `${personName(s.personId)} ${brl(s.shareCents)}`).join(", ");
    return `total ${brl(Math.abs(tx.amountCents))} · sua parte ${brl(tx.myShareCents)} · dividido com: ${splits || "ninguém"}`;
  };

  // ============================================================ header
  out.push(
    `Hoje: ${today} · mês atual: ${currentMonth} · mês analisado: ${month}`,
    `Contas: ${ws.accounts.length} · Cartões: ${ws.creditCards.length} · Pessoas: ${ws.people.length}` +
      ` · Lançamentos: ${ws.transactions.length} · Acertos: ${ws.settlements.length}` +
      ` · Faturas pagas: ${ws.cardBillPayments.length}`,
  );
  if (input.autoPayments) {
    const { enabled, accountId, since } = input.autoPayments;
    out.push(
      `Pagamento automático: ${enabled ? "LIGADO" : "desligado"} · conta padrão: ${accountLabel(accountId)}` +
        ` · desde: ${since ?? "—"}`,
    );
  }

  // ============================================================ 1. fim do mês
  const report = explainMonthEndGap({
    accounts: ws.accounts,
    people: ws.people,
    transactions: ws.transactions,
    settlements: ws.settlements,
    cardBillPayments: ws.cardBillPayments,
    month,
    currentMonth,
    competenceOf,
  });
  section(`1. "FIM DO MÊS" DE ${month} — GERAL × APENAS MEU`);
  const row = (label: string, general: string, personal: string): string =>
    `  ${label.padEnd(34)}${general.padStart(16)}${personal.padStart(16)}`;
  out.push(
    row("", "Geral", "Apenas meu"),
    row("Contas no fim do mês", brl(report.general.accountsCents), brl(report.personal.accountsCents)),
    row("- Obrigações a vencer", brl(report.general.obligationsCents), brl(report.personal.obligationsCents)),
    row("- Vencidas em aberto", brl(report.general.overdueCents), brl(report.personal.overdueCents)),
    row("+ Pessoas (a receber líquido)", brl(report.general.peopleCents), "—"),
    row("= Fim do mês", brl(report.general.totalCents), brl(report.personal.totalCents)),
    "",
    `  Diferença (Geral − Apenas meu): ${signed(report.gapCents)}`,
    "  Uma despesa dividida comum NÃO cria diferença: o Geral paga a parte da pessoa e a recebe de volta.",
    "  A diferença é a soma dos pontos abaixo, onde esse par não fecha.",
  );

  section(`2. O QUE CRIA A DIFERENÇA (${report.items.length} itens, maior primeiro)`);
  if (report.items.length === 0) out.push("  (nada — as duas visões fecham)");
  for (const item of report.items) {
    out.push("", `  [${signed(item.cents)}] ${REASON_LABEL[item.reason]} · ${peopleList(item.personIds)}`);
    if (item.subject === "settlement") {
      const s = item.settlement;
      out.push(
        `      acerto de ${s.date} · valor ${brl(s.amountCents)} · ${accountLabel(s.accountId)}` +
          `${s.note ? ` · nota: "${s.note}"` : ""}`,
        `      caixa no Geral ${signed(item.cashCents)} · dívida abatida no razão ${signed(item.appliedCents)}`,
      );
      if (item.reason === "advance") {
        out.push(
          `      -> entraram ${brl(item.cashCents)}, mas só ${brl(-item.appliedCents)} eram dívida:` +
            ` ${brl(item.cents)} ficam como crédito da pessoa (o Geral conta, o Apenas meu não).`,
        );
      } else if (item.reason === "writeoff") {
        out.push("      -> a dívida caiu sem entrar dinheiro: o Geral perde esse valor a receber.");
      }
    } else if (item.subject === "income") {
      const tx = item.transaction;
      // (not the isPendingReceivable guard: on an IncomeTransaction its false branch narrows to never)
      const pendingReceipt = tx.cardId === null && tx.receivedAt === null;
      const state = item.projected
        ? "PREVISTA (recorrência não lançada)"
        : pendingReceipt
          ? "A RECEBER (não marcada como recebida)"
          : `recebida em ${tx.receivedAt ?? tx.date}`;
      out.push(
        `      receita de ${tx.date} · ${tx.description || "(sem descrição)"} · ${brl(tx.amountCents)}` +
          ` · ${accountLabel(tx.receivedAccountId ?? tx.accountId)} · ${state}` +
          ` · reembolso: ${tx.isReimbursement ? "sim" : "não"}`,
        `      caixa só no Geral ${signed(item.cashCents)} · abatido no razão ${signed(item.ledgerCents)}`,
      );
      if (item.reason === "expected-reimbursement") {
        out.push(
          '      -> o Geral já conta esse dinheiro como caixa do mês E a dívida segue no "a receber":',
          "         conta duas vezes até a receita ser marcada como recebida.",
        );
      }
    } else if (item.subject === "expense") {
      const tx = item.transaction;
      out.push(
        `      ${expenseFacts(tx, item.projected)}`,
        `      ${splitFacts(tx)}`,
        `      custo de terceiros no Geral ${brl(item.costCents)} · cobrado das pessoas ${brl(item.ledgerCents)}`,
      );
      const old = compareMonths(item.competence, currentMonth) < 0;
      if (item.reason === "share-without-cost") {
        if (tx.source === "card" && old && !paidBills.has(`${tx.cardId}|${item.competence}`)) {
          out.push(
            `      -> a fatura ${item.competence} não tem registro de pagamento: o app a presume paga e`,
            "         nunca debitou conta nenhuma por ela, mas a parte da pessoa é cobrada.",
          );
        } else if (item.projected && old) {
          out.push(
            "      -> ocorrência prevista de mês passado que nunca virou lançamento: o razão cobra a",
            "         parte, a projeção de caixa só começa no mês atual.",
          );
        } else if (tx.source === "account" && tx.accountId !== null && !knownAccounts.has(tx.accountId)) {
          out.push("      -> a conta desse lançamento não existe mais: nada é debitado.");
        } else if (tx.installment && tx.installment.status !== "atual" && tx.source !== "card") {
          out.push(
            `      -> parcela "${tx.installment.status}": nunca debita o saldo, mas a parte é cobrada.`,
          );
        }
      } else if (item.reason === "cost-without-share" && tx.splits.length === 0) {
        out.push("      -> sua parte é menor que o total e não há divisão registrada para cobrar.");
      }
    } else {
      const billNow = item.chargesCents - item.creditsCents;
      out.push(
        `      ${cardLabel(item.cardId)} · fatura ${item.competence} · paga em ${item.date}` +
          ` por ${brl(item.paidCents)}${item.accountKnown ? "" : " · CONTA INEXISTENTE"}`,
        `      compras hoje ${brl(item.chargesCents)} − estornos ${brl(item.creditsCents)} = ${brl(billNow)}` +
          ` · sua parte nas compras ${brl(item.mineCents)}`,
        `      fatia de terceiros descontada no Apenas meu ${brl(item.costCents)}` +
          ` · partes cobradas das pessoas ${brl(item.ledgerCents)}`,
      );
      if (item.paidCents !== billNow) {
        out.push(
          `      -> valor pago ≠ soma atual das linhas (${signed(item.paidCents - billNow)}): linhas mudaram`,
          "         depois do pagamento, ou a fatura foi paga por outro valor.",
        );
      }
      if (item.creditsCents !== 0) {
        out.push("      -> estornos da fatura (abatem só a sua parte; sozinhos não criam diferença):");
        for (const tx of ws.transactions) {
          if (!isIncome(tx) || tx.cardId !== item.cardId || competenceOf(tx) !== item.competence) continue;
          out.push(
            `         estorno: ${tx.date} ${tx.description || "(sem descrição)"} ${brl(tx.amountCents)}`,
          );
        }
      }
      if (compareMonths(item.competence, month) > 0) {
        out.push("      -> fatura paga antes do mês dela: as partes ainda não foram cobradas.");
      }
    }
  }
  out.push(
    "",
    `  Soma dos itens: ${signed(report.explainedCents)} · não explicado: ${brl(report.unexplainedCents)}`,
  );

  section(`3. PESSOAS — razão até ${month}`);
  out.push(
    `  ${"pessoa".padEnd(22)}${"compras".padStart(14)}${"pagamentos".padStart(14)}${"acertos".padStart(14)}` +
      `${"saldo".padStart(14)}${"crédito".padStart(12)}`,
  );
  for (const person of report.people) {
    if (
      person.sharesCents === 0 &&
      person.paymentsCents === 0 &&
      person.settledCents === 0 &&
      person.advanceCents === 0
    ) {
      continue;
    }
    out.push(
      `  ${personName(person.personId).slice(0, 21).padEnd(22)}${brl(person.sharesCents).padStart(14)}` +
        `${brl(person.paymentsCents).padStart(14)}${brl(person.settledCents).padStart(14)}` +
        `${brl(person.balanceCents).padStart(14)}${brl(person.advanceCents).padStart(12)}`,
    );
  }
  out.push("  (saldo > 0: a pessoa deve · crédito: dinheiro dela parado com você)");

  // ============================================================ 2. accounts
  section("4. SALDO DAS CONTAS HOJE (compare cada uma com o app do banco)");
  const general = computeAccountBalances(
    ws.accounts,
    ws.transactions,
    today,
    "general",
    ws.settlements,
    ws.cardBillPayments,
    competenceOf,
  );
  const personal = computeAccountBalances(
    ws.accounts,
    ws.transactions,
    today,
    "personal",
    ws.settlements,
    ws.cardBillPayments,
    competenceOf,
  );
  let generalTotal = 0;
  let personalTotal = 0;
  for (const account of ws.accounts) {
    const g = general.get(account.id)?.cents ?? 0;
    const p = personal.get(account.id)?.cents ?? 0;
    generalTotal += g;
    personalTotal += p;
    out.push(`  ${accountLabel(account.id).padEnd(34)}${brl(g).padStart(16)}${brl(p).padStart(16)}`);
  }
  out.push(
    `  ${"TOTAL (Saldo total disponível)".padEnd(34)}${brl(generalTotal).padStart(16)}${brl(personalTotal).padStart(16)}`,
    `  ${"".padEnd(34)}${"Geral".padStart(16)}${"Apenas meu".padStart(16)}`,
  );

  section("5. ONDE O SALDO DO APP PODE DESCOLAR DO BANCO");

  out.push("", "  5.1 Faturas pagas cujo valor não bate com a soma atual das linhas");
  out.push("      (pagar uma fatura debita o total que o APP calculou naquele momento; nada é digitado)");
  const audit = input.audit ?? null;
  /** What a row weighs in its card bill: a charge adds, an estorno subtracts; null = not a bill row. */
  const billWeight = (tx: Transaction): number | null => {
    if (isExpense(tx) && tx.source === "card" && tx.cardId !== null) return Math.abs(tx.amountCents);
    if (isIncome(tx) && tx.cardId !== null) return -tx.amountCents;
    return null;
  };
  const rowLabel = (tx: Transaction): string => `${tx.date} ${tx.description || "(sem descrição)"}`;
  const drifts = findPaidBillDrifts(ws.cardBillPayments, ws.transactions, competenceOf);
  if (drifts.length === 0) out.push("      nenhuma: todo pagamento é igual à soma das linhas da fatura.");
  for (const drift of drifts) {
    const p = drift.payment;
    out.push(
      `      ${cardLabel(p.cardId)} [${p.competence}] paga em ${p.date} de ${accountLabel(p.accountId)}:` +
        ` debitou ${brl(p.amountCents)} · linhas hoje ${brl(drift.currentBillCents)}` +
        ` · diferença ${signed(drift.driftCents)}`,
    );
    const recordedAt = audit?.paymentRecordedAt.get(p.id);
    if (!audit || recordedAt === undefined) continue;
    // With the row history at hand: which rows of this bill changed after the payment was recorded.
    out.push(`        pagamento registrado em ${when(recordedAt)}; o que mudou nessa fatura depois:`);
    const onThisBill = (tx: Transaction): boolean =>
      (isExpense(tx) || isIncome(tx)) && tx.cardId === p.cardId && competenceOf(tx) === p.competence;
    let moved = 0;
    let found = 0;
    for (const tx of ws.transactions) {
      const weight = billWeight(tx);
      const stamp = audit.stamps.get(tx.id);
      if (weight === null || stamp === undefined || !onThisBill(tx)) continue;
      if (isExpense(tx) && isRolled(tx)) {
        // A rolled row no longer counts on the bill; it did when the payment was taken before it.
        if ((tx.rolledAt ?? "") >= recordedAt.slice(0, 10) && stamp.createdAt <= recordedAt) {
          found += 1;
          moved -= weight;
          out.push(`          - abatida (rolada) em ${tx.rolledAt}: ${rowLabel(tx)} ${signed(-weight)}`);
        }
      } else if (stamp.createdAt > recordedAt) {
        found += 1;
        moved += weight;
        out.push(`          + criada em ${when(stamp.createdAt)}: ${rowLabel(tx)} ${signed(weight)}`);
      } else if (stamp.updatedAt > recordedAt) {
        found += 1;
        out.push(
          `          ~ editada em ${when(stamp.updatedAt)}: ${rowLabel(tx)} · hoje ${signed(weight)}` +
            " (o valor anterior não fica gravado)",
        );
      }
    }
    for (const gone of audit.deleted) {
      const weight = billWeight(gone.tx);
      if (weight === null || !onThisBill(gone.tx) || (isExpense(gone.tx) && isRolled(gone.tx))) continue;
      if (gone.deletedAt <= recordedAt || gone.createdAt > recordedAt) continue;
      found += 1;
      moved -= weight;
      out.push(`          - apagada em ${when(gone.deletedAt)}: ${rowLabel(gone.tx)} ${signed(-weight)}`);
    }
    const toExplain = drift.currentBillCents - p.amountCents;
    out.push(
      found === 0
        ? "          nada: nenhuma linha dessa fatura foi criada, editada ou apagada depois."
        : `          criadas/apagadas somam ${signed(moved)} de ${signed(toExplain)} a explicar` +
            (moved === toExplain ? " (fecha)." : " (o resto: linhas editadas ou movidas de fatura)."),
    );
  }

  out.push("", "      Todos os pagamentos de fatura (confira o valor de cada um com a fatura do banco):");
  const paymentsByDate = [...ws.cardBillPayments].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
  for (const p of paymentsByDate) {
    const recordedAt = audit?.paymentRecordedAt.get(p.id);
    out.push(
      `      ${p.date} ${cardLabel(p.cardId)} [${p.competence}] ${brl(p.amountCents)} de ${accountLabel(p.accountId)}` +
        `${recordedAt ? ` · registrado em ${when(recordedAt)}` : ""}${p.note ? ` · "${p.note}"` : ""}`,
    );
  }
  if (paymentsByDate.length === 0) out.push("      (nenhum pagamento de fatura registrado)");

  out.push(
    "",
    "  5.2 Faturas já vencidas SEM registro de pagamento (o app presume pagas e não debita conta)",
  );
  let unpaidBills = 0;
  for (const card of ws.creditCards) {
    const months = new Set<CompetenceMonth>();
    for (const tx of ws.transactions) {
      if ((isExpense(tx) || isIncome(tx)) && tx.cardId === card.id) months.add(competenceOf(tx));
    }
    for (const m of [...months].sort()) {
      if (paidBills.has(`${card.id}|${m}`)) continue;
      const due = dateInMonth(m, dueOverrides.get(card.id)?.get(m)?.dueDay ?? card.dueDay);
      if (due > today) continue;
      const bill = computeCardBillForMonth(card.id, ws.transactions, m, competenceOf).cents;
      if (bill === 0) continue;
      unpaidBills += 1;
      out.push(`      ${cardLabel(card.id)} [${m}] venceu ${due}: ${brl(bill)}`);
    }
  }
  if (unpaidBills === 0) out.push("      nenhuma.");

  out.push("", "  5.3 Lançamentos que apontam para uma conta que não existe (não mexem em saldo nenhum)");
  const orphans: string[] = [];
  for (const tx of ws.transactions) {
    if (isTransfer(tx)) {
      if (!knownAccounts.has(tx.fromAccountId) || !knownAccounts.has(tx.toAccountId)) {
        orphans.push(`${tx.date} transferência ${brl(tx.valueCents)} · ${tx.description}`);
      }
    } else if (isIncome(tx)) {
      const landing = tx.receivedAccountId ?? tx.accountId;
      if (tx.cardId === null && landing !== null && !knownAccounts.has(landing)) {
        orphans.push(`${tx.date} receita ${brl(tx.amountCents)} · ${tx.description}`);
      }
    } else if (!isRolled(tx)) {
      const debited =
        tx.paidAccountId ??
        (tx.source === "account" ? tx.accountId : tx.source === "overdraft" ? tx.linkedAccountId : null);
      if (debited != null && !knownAccounts.has(debited)) {
        orphans.push(`${tx.date} despesa ${brl(Math.abs(tx.amountCents))} · ${tx.description}`);
      }
    }
  }
  for (const s of ws.settlements) {
    if (s.accountId !== null && !knownAccounts.has(s.accountId)) {
      orphans.push(`${s.date} acerto ${brl(s.amountCents)} · ${personName(s.personId)}`);
    }
  }
  for (const p of ws.cardBillPayments) {
    if (!knownAccounts.has(p.accountId)) {
      orphans.push(`${p.date} fatura ${cardLabel(p.cardId)} [${p.competence}] ${brl(p.amountCents)}`);
    }
  }
  out.push(...(orphans.length === 0 ? ["      nenhum."] : orphans.map((line) => `      ${line}`)));

  out.push("", '  5.4 Parcelas em conta/cheque especial que NÃO debitam o saldo (status ≠ "atual")');
  out.push(
    '      (o status é gravado na criação e não avança: uma "futura" segue sem debitar quando a data chega)',
  );
  let frozen = 0;
  for (const tx of ws.transactions) {
    if (!isExpense(tx) || isRolled(tx) || isPaid(tx) || tx.installment === null) continue;
    if (tx.source !== "account" && tx.source !== "overdraft") continue;
    if (tx.installment.status === "atual" || tx.date > today) continue;
    frozen += 1;
    out.push(`      ${expenseFacts(tx, false)} · ${brl(Math.abs(tx.amountCents))}`);
  }
  if (frozen === 0) out.push("      nenhuma.");

  out.push("", "  5.5 Receitas com data vencida ainda marcadas como A RECEBER (fora do saldo)");
  let pending = 0;
  for (const tx of ws.transactions) {
    if (!isPendingReceivable(tx) || tx.date > today) continue;
    pending += 1;
    out.push(
      `      ${tx.date} ${tx.description || "(sem descrição)"} · ${brl(tx.amountCents)} · ${accountLabel(tx.accountId)}` +
        `${tx.fromPersonId ? ` · de ${personName(tx.fromPersonId)}` : ""}`,
    );
  }
  if (pending === 0) out.push("      nenhuma.");

  out.push("", "  5.6 Boletos/empréstimos/financiamentos vencidos e não pagos (fora do saldo)");
  let overdue = 0;
  for (const tx of ws.transactions) {
    if (!isPayableObligation(tx) || isPaid(tx) || isRolled(tx) || tx.date >= today) continue;
    overdue += 1;
    out.push(`      ${expenseFacts(tx, false)} · ${brl(Math.abs(tx.amountCents))}`);
  }
  if (overdue === 0) out.push("      nenhum.");

  out.push("", "  5.7 Compras parceladas no cartão com centavos desiguais entre as parcelas");
  out.push(
    "      (o app dá +1 centavo às primeiras parcelas; se o banco pôs tudo na 1ª, as faturas diferem)",
  );
  const groups = new Map<string, ExpenseTransaction[]>();
  for (const tx of ws.transactions) {
    if (!isExpense(tx) || isRolled(tx) || tx.source !== "card" || tx.installment === null) continue;
    const list = groups.get(tx.installment.groupId) ?? [];
    list.push(tx);
    groups.set(tx.installment.groupId, list);
  }
  let uneven = 0;
  for (const rows of groups.values()) {
    const values = new Set(rows.map((tx) => Math.abs(tx.amountCents)));
    if (values.size < 2) continue;
    rows.sort((a, b) => (a.installment?.number ?? 0) - (b.installment?.number ?? 0));
    const first = rows[0];
    if (!first?.installment) continue;
    const count = first.installment.total;
    const total = rows.reduce((sum, tx) => sum + Math.abs(tx.amountCents), 0);
    uneven += 1;
    const parcels = rows
      .map((tx) => {
        const paid = paidBills.has(`${tx.cardId}|${competenceOf(tx)}`);
        return `${tx.installment?.number}:${amount(Math.abs(tx.amountCents))}${paid ? "*" : ""}`;
      })
      .join(" ");
    let note = "";
    if (rows.length === count) {
      // Had the bank put every leftover cent on the first parcela (floor on the others), the bills
      // already paid would differ from the app's by this much.
      const floor = Math.floor(total / count);
      const leftover = total - floor * count;
      let ahead = 0;
      for (const tx of rows) {
        if (!paidBills.has(`${tx.cardId}|${competenceOf(tx)}`)) continue;
        const bank = tx.installment?.number === 1 ? floor + leftover : floor;
        ahead += bank - Math.abs(tx.amountCents);
      }
      note =
        ahead === 0
          ? " · sem diferença acumulada nas faturas pagas"
          : ` · se o banco pôs os ${leftover} centavo(s) na 1ª: faturas pagas ${signed(ahead)} vs. app`;
    }
    out.push(
      `      ${first.description} · ${cardLabel(first.cardId)} · ${count}x · soma ${brl(total)}`,
      `        parcelas (* = fatura paga): ${parcels}${note}`,
    );
  }
  if (uneven === 0) out.push("      nenhuma.");

  // ============================================================ statement
  if (input.accountQuery !== null) {
    const query = input.accountQuery.toLowerCase();
    const matches = ws.accounts.filter((a) => accountLabel(a.id).toLowerCase().includes(query));
    section(`6. EXTRATO — contas que contêm "${input.accountQuery}"`);
    if (matches.length === 0) {
      out.push(`  nenhuma conta encontrada. Contas: ${[...accountLabels.values()].join(" | ")}`);
    }
    // The same direction rule computeAccountBalances applies to an acerto that names an account.
    const rawBalances = computePersonBalances([], ws.transactions, []);
    const moveLabel = (tx: Transaction, accountId: string): string => {
      if (isTransfer(tx)) {
        const outgoing = tx.fromAccountId === accountId;
        const other = accountLabel(outgoing ? tx.toAccountId : tx.fromAccountId);
        return `transf. ${outgoing ? "para" : "de"} ${other}${tx.description ? ` (${tx.description})` : ""}`;
      }
      const description = tx.description || "(sem descrição)";
      if (isIncome(tx)) {
        return `receita: ${description}${tx.date !== balanceEffectiveDate(tx) ? ` [de ${tx.date}]` : ""}`;
      }
      if (isPaid(tx)) return `${SOURCE_LABEL[tx.source]} pago: ${description} [venc. ${tx.date}]`;
      return `${tx.source === "overdraft" ? "cheque especial" : "despesa"}: ${description}`;
    };

    for (const account of matches) {
      // Every cash movement computeAccountBalances applies to this account (general lens).
      const moves: CashMove[] = [];
      for (const tx of ws.transactions) {
        const date = balanceEffectiveDate(tx);
        if (date > today) continue;
        const delta = accountDeltas(tx, "general").get(account.id);
        if (delta === undefined || delta.isZero()) continue;
        moves.push({ date, label: moveLabel(tx, account.id), cents: delta.cents });
      }
      for (const s of ws.settlements) {
        if (s.accountId !== account.id || s.date > today) continue;
        const owedToYou = !(rawBalances.get(s.personId) ?? Money.zero()).isNegative();
        moves.push({
          date: s.date,
          label: `acerto ${owedToYou ? "recebido de" : "pago a"} ${personName(s.personId)}`,
          cents: owedToYou ? s.amountCents : -s.amountCents,
        });
      }
      for (const p of ws.cardBillPayments) {
        if (p.accountId !== account.id || p.date > today) continue;
        moves.push({
          date: p.date,
          label: `fatura ${cardLabel(p.cardId)} [${p.competence}]`,
          cents: -p.amountCents,
        });
      }
      moves.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      const statementRow = (label: string, delta: string, balance: number): string =>
        `    ${label.slice(0, 60).padEnd(61)}${delta.padStart(15)}${brl(balance).padStart(15)}`;
      let running = account.openingBalanceCents;
      out.push("", `  > ${accountLabel(account.id)}`, statementRow("saldo inicial da conta", "", running));
      let folded = 0;
      for (const move of moves) {
        if (input.since !== null && move.date < input.since) {
          running += move.cents;
          folded += 1;
          continue;
        }
        if (folded > 0) {
          out.push(statementRow(`(${folded} movimentos antes de ${input.since})`, "", running));
          folded = 0;
        }
        running += move.cents;
        out.push(statementRow(`${move.date} ${move.label}`, signed(move.cents), running));
      }
      if (folded > 0) out.push(statementRow(`(${folded} movimentos antes de ${input.since})`, "", running));
      const appBalance = general.get(account.id)?.cents ?? 0;
      out.push(
        statementRow("saldo final", "", running),
        running === appBalance
          ? "    confere com o saldo que o app mostra."
          : `    DIFERE do saldo do app (${brl(appBalance)}) em ${signed(appBalance - running)}.`,
      );
    }
  }

  return out;
}
