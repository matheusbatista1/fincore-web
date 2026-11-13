import { afterEach, describe, expect, it, vi } from "vitest";
import { getDashboard } from "@/application/use-cases/get-dashboard";
import { getMonthly } from "@/application/use-cases/get-monthly";
import { getReports } from "@/application/use-cases/get-reports";
import { getStatement } from "@/application/use-cases/get-statement";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { reconcileWithStatement } from "@/application/use-cases/reconcile-statement";
import { getTransactionHistory } from "@/application/use-cases/transaction-history";
import { addDays, addMonths, isValidIsoDate, monthOf } from "@/domain/value-objects/competence-month";
import { parseStatement } from "@/shared/import/parse-statement";
import { demoHistory } from "./demo-history";
import { DEMO_USER_ID, demoRepository } from "./demo-repository";
import { demoStatement } from "./demo-statement";
import { DEMO_IDS, demoWorkspace } from "./demo-workspace";

/** Days worth trying: the start, the middle and the end of months, a new year and a leap day. */
const DAYS = [
  "2026-11-12",
  "2026-11-01",
  "2026-11-30",
  "2026-12-31",
  "2027-01-01",
  "2027-01-05",
  "2027-03-31",
  "2028-02-29",
  "2028-03-01",
];
/** …and every third day of a year, for the checks that are cheap. */
const A_YEAR = Array.from({ length: 122 }, (_, i) => addDays("2026-07-01", i * 3));

describe("demoWorkspace", () => {
  it("is the same every time it is built for a day", () => {
    expect(demoWorkspace("2026-11-12")).toEqual(demoWorkspace("2026-11-12"));
  });

  it("is made of invented names and well-formed rows, whatever the day", () => {
    for (const today of A_YEAR) {
      const ws = demoWorkspace(today);
      expect(ws.people.every((p) => p.name.endsWith("Demo"))).toBe(true);
      expect(ws.transactions.every((t) => isValidIsoDate(t.date))).toBe(true);
      const ids = ws.transactions.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
      // A share never exceeds what was spent, and what is left is the user's.
      for (const tx of ws.transactions) {
        if (tx.kind !== "expense") continue;
        const shared = tx.splits.reduce((sum, s) => sum + s.shareCents, 0);
        expect(shared + tx.myShareCents).toBe(Math.abs(tx.amountCents));
      }
      // History behind, and something still to come.
      expect(ws.transactions.some((t) => monthOf(t.date) === addMonths(monthOf(today), -5))).toBe(true);
      expect(ws.transactions.some((t) => t.date > today)).toBe(true);
      // Every fatura due by today was paid; none is paid ahead.
      expect(ws.cardBillPayments.length).toBeGreaterThan(0);
      expect(ws.cardBillPayments.every((p) => p.date <= today && p.amountCents > 0)).toBe(true);
    }
  });

  // The use cases read the clock themselves: each day is tried with the clock on that day (noon
  // in Brazil), the way the demo runs — built for today, read today.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives every screen something to show, and nothing absurd", async () => {
    for (const today of DAYS) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(`${today}T15:00:00Z`));
      const repo = demoRepository(today);
      const month = monthOf(today);
      const [dash, view, transactions, reports, statement, monthly] = await Promise.all([
        getDashboard(repo, DEMO_USER_ID, month),
        getWorkspaceView(repo, DEMO_USER_ID),
        getTransactions(repo, DEMO_USER_ID),
        getReports(repo, DEMO_USER_ID, { from: month, to: addMonths(month, 5) }),
        getStatement(repo, DEMO_USER_ID),
        getMonthly(repo, DEMO_USER_ID, month),
      ]);
      // A household that lives within its means: money in every account, no runaway figure.
      for (const account of view.accounts) {
        expect(account.balanceCents).toBeGreaterThan(0);
        expect(account.balanceCents).toBeLessThan(5_000_000);
      }
      // The reserve account is set aside: out of the available balance, counted as invested.
      const sum = (reserve: boolean): number =>
        view.accounts.reduce((total, a) => (a.isReserve === reserve ? total + a.balanceCents : total), 0);
      expect(dash.totalBalanceCents).toBe(sum(false));
      expect(dash.investedCents).toBe(sum(true));
      expect(dash.investedCents).toBeGreaterThan(0);
      expect(Number.isFinite(dash.projectedBalanceCents)).toBe(true);
      // The chart has a history and a forecast.
      expect(dash.netWorthDaily.valuesCents.length).toBeGreaterThan(120);
      expect(dash.netWorthForecast.valuesCents.length).toBeGreaterThan(27);
      expect(view.cards).toHaveLength(2);
      expect(view.people).toHaveLength(2);
      // Five months behind and a month partly lived: a few dozen entries at the very least.
      expect(transactions.length).toBeGreaterThan(60);
      expect(reports.months).toHaveLength(6);
      expect(statement.executed.length).toBeGreaterThan(20);
      expect(monthly.items.length).toBeGreaterThan(0);
    }
  });
});

describe("demoHistory", () => {
  it("gives every transaction a creation and one correction, never dated after today", async () => {
    const today = "2026-11-12";
    const repo = demoRepository(today);
    const workspace = demoWorkspace(today);
    for (const tx of workspace.transactions) {
      const events = demoHistory(workspace, tx.id, today);
      expect(events.map((event) => event.kind)).toEqual(["updated", "created"]);
      const [edited, created] = events;
      // The correction ends on the row as the screens show it; nothing happens in the future.
      expect(edited?.after).toEqual(tx);
      expect(created?.after).toEqual(edited?.before);
      expect(edited?.at.getTime()).toBeGreaterThan(created?.at.getTime() ?? Number.POSITIVE_INFINITY);
      expect((edited?.at.toISOString() ?? "9999").slice(0, 10) <= today).toBe(true);

      // …and reads, through the real use case, as "created, then the value changed".
      const history = await getTransactionHistory(repo, DEMO_USER_ID, tx.id);
      expect(history.map((entry) => entry.kind)).toEqual(["updated", "created"]);
      expect(history[0]?.changes.map((change) => change.field)).toContain("amount");
    }
  });

  it("has nothing to say about a transaction the demo does not have", () => {
    expect(demoHistory(demoWorkspace("2026-11-12"), "nope", "2026-11-12")).toEqual([]);
  });
});

describe("demoStatement", () => {
  it("is a file the statement parser reads, line for line", () => {
    const today = "2026-11-12";
    const statement = demoStatement(demoWorkspace(today), today);
    const lines = parseStatement(statement.csv, "csv");
    expect(lines).toHaveLength(statement.csv.split("\r\n").length - 1);
    expect(statement.accountId).toBe(DEMO_IDS.MAIN);
    expect(statement.fileName).toBe("extrato-demo-2026-11-12.csv");
    // The bank's names, never the app's.
    expect(statement.csv).not.toContain("Salário");
    expect(statement.csv).not.toContain("Aluguel");
  });

  it("checks against the demo exactly as it says it will, whatever the day", async () => {
    for (const today of [...DAYS, ...A_YEAR]) {
      const repo = demoRepository(today);
      const statement = demoStatement(demoWorkspace(today), today);
      const result = await reconcileWithStatement(repo, DEMO_USER_ID, {
        target: { type: "account", accountId: statement.accountId },
        lines: parseStatement(statement.csv, "csv"),
      });
      if (!result.ok) throw new Error(result.error.message);
      const { matches, bankOnly, bookOnly } = result.value;
      const told = {
        bankOnly: bankOnly.length,
        bookOnly: bookOnly.length,
        joined: matches.filter((m) => m.kind === "bank-group" || m.kind === "book-group").length,
        cancelled: matches.filter((m) => m.kind === "bank-cancel").flatMap((m) => m.bank).length,
      };
      expect({ today, ...told }).toEqual({ today, ...statement.expected });
      expect(bankOnly.map((row) => row.label).sort()).toEqual([
        "RENDIMENTO CDB",
        "TARIFA PACOTE SERVICOS",
        "TARIFA PACOTE SERVICOS",
      ]);
      expect(bookOnly.map((row) => row.label)).toEqual(["Combustível"]);
      const joined = matches.find((m) => m.kind === "bank-group");
      expect(joined?.bank).toHaveLength(3);
      expect(joined?.book.map((row) => row.label)).toEqual(["Pedágios do mês"]);
    }
  });
});
