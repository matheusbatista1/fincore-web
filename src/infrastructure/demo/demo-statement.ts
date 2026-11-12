import type { Workspace } from "@/application/ports/finance-repository";
import { forEachBalanceMovement } from "@/domain/services/balance.calculator";
import { addMonths, dateInMonth, type IsoDate, monthOf } from "@/domain/value-objects/competence-month";
import { DEMO_IDS, DEMO_TOLLS } from "./demo-workspace";

/**
 * The bank statement that goes with the demo: what really moved the demo's main account since
 * the start of last month, under the kind of names a bank uses — with a few differences left in
 * on purpose, so "Conferir extrato" has every kind of answer to give.
 */
export interface DemoStatement {
  readonly accountId: string;
  readonly fileName: string;
  /** Semicolon-separated, dd/mm/yyyy, comma decimals: the way a Brazilian bank exports it. */
  readonly csv: string;
  /** What the check should say of this file. */
  readonly expected: {
    /** Lines of the file with no entry in the app. */
    readonly bankOnly: number;
    /** Entries of the app the file does not have. */
    readonly bookOnly: number;
    /** Groups of lines that only match added up. */
    readonly joined: number;
    /** Bank lines that undo each other. */
    readonly cancelled: number;
  };
}

/** Names a bank would use — never the app's own descriptions. */
const INCOMING = ["PIX RECEBIDO", "TED RECEBIDA", "TRANSF RECEBIDA"] as const;
const OUTGOING = ["PIX ENVIADO", "COMPRA DEBITO", "PGTO BOLETO", "DEBITO AUTOMATICO"] as const;

const money = (cents: number): string => (cents / 100).toFixed(2).replace(".", ",");
const brDate = (date: IsoDate): string => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

export function demoStatement(workspace: Workspace, today: IsoDate): DemoStatement {
  const lastMonth = addMonths(monthOf(today), -1);
  const from = dateInMonth(lastMonth, 1);

  // What moved the main account in the period: one line per entry and day.
  const moved = new Map<string, { date: IsoDate; cents: number; description: string }>();
  forEachBalanceMovement(
    {
      transactions: workspace.transactions,
      settlements: workspace.settlements,
      cardBillPayments: workspace.cardBillPayments,
      lens: "general",
      upToDate: today,
    },
    (accountId) => accountId === DEMO_IDS.MAIN,
    (date, _accountId, delta, origin) => {
      if (date < from) return;
      const key =
        origin.kind === "transaction"
          ? `t:${origin.transaction.id}:${date}`
          : origin.kind === "settlement"
            ? `s:${origin.settlement.id}`
            : `p:${origin.payment.id}`;
      const line = moved.get(key) ?? {
        date,
        cents: 0,
        description: origin.kind === "transaction" ? origin.transaction.description : "",
      };
      line.cents += delta.cents;
      moved.set(key, line);
    },
  );

  const lines: { date: IsoDate; name: string; cents: number }[] = [];
  let fuelLeftOut = false;
  [...moved.values()]
    .filter((line) => line.cents !== 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .forEach((line, i) => {
      // The tolls: one entry in the app, each toll its own line at the bank.
      if (line.description === DEMO_TOLLS.description) {
        for (const [n, toll] of DEMO_TOLLS.lines.entries()) {
          lines.push({
            date: dateInMonth(lastMonth, toll.day),
            name: `PEDAGIO SEM PARAR 00${n + 1}`,
            cents: -toll.cents,
          });
        }
        return;
      }
      // One tank of last month's fuel was paid in cash: the app has it, the bank does not.
      if (!fuelLeftOut && line.description === "Combustível" && monthOf(line.date) === lastMonth) {
        fuelLeftOut = true;
        return;
      }
      const names = line.cents > 0 ? INCOMING : OUTGOING;
      lines.push({ date: line.date, name: names[i % names.length] ?? "LANCAMENTO", cents: line.cents });
    });

  // At the bank and not in the app: two fees, a yield, and a purchase with its refund.
  lines.push({ date: dateInMonth(lastMonth, 9), name: "TARIFA PACOTE SERVICOS", cents: -1_290 });
  lines.push({ date: dateInMonth(lastMonth, 16), name: "TARIFA PACOTE SERVICOS", cents: -1_290 });
  lines.push({ date: dateInMonth(lastMonth, 25), name: "RENDIMENTO CDB", cents: 321 });
  lines.push({ date: dateInMonth(lastMonth, 21), name: "COMPRA LOJA ONLINE", cents: -8_990 });
  lines.push({ date: dateInMonth(lastMonth, 23), name: "ESTORNO COMPRA LOJA ONLINE", cents: 8_990 });

  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    accountId: DEMO_IDS.MAIN,
    fileName: `extrato-demo-${today}.csv`,
    csv: ["Data;Descrição;Valor", ...lines.map((l) => `${brDate(l.date)};${l.name};${money(l.cents)}`)].join(
      "\r\n",
    ),
    expected: { bankOnly: 3, bookOnly: 1, joined: 1, cancelled: 2 },
  };
}
