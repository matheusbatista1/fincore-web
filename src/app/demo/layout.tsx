import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { demoTransactionHistoryAction } from "@/app/demo/actions";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { requireDemo } from "@/infrastructure/demo/demo-flag";
import { DEMO_USER_ID, demoRepository } from "@/infrastructure/demo/demo-repository";
import { TxModalsHost } from "@/presentation/components/transactions/tx-modals-host";
import { CategoryHintsProvider } from "@/presentation/providers/category-hints-provider";
import { ModulesProvider } from "@/presentation/providers/modules-provider";
import { todayInBrazil } from "@/shared/formatting/now";
import { ALL_MODULE_KEYS } from "@/shared/modules";
import { buildCategoryHints } from "@/shared/suggestions/category-hints";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Demonstração", robots: { index: false, follow: false } };

/**
 * The demo area: the app's real screens over a made-up household (see `infrastructure/demo`),
 * with no sign-in and nothing to write to. It exists for the browser tests and to show the app
 * without anyone's data; unless `FINCORE_DEMO=1` it is simply not there.
 */
export default async function DemoLayout({ children }: { children: ReactNode }) {
  requireDemo();

  const today = todayInBrazil();
  const repo = demoRepository(today);
  const [workspace, transactions] = await Promise.all([
    getWorkspaceView(repo, DEMO_USER_ID),
    getTransactions(repo, DEMO_USER_ID),
  ]);
  const formData = {
    accounts: workspace.accounts.map((a) => ({
      id: a.id,
      bank: a.bank,
      name: a.name,
      themeKey: a.themeKey,
      balanceCents: a.balanceCents,
    })),
    cards: workspace.cards.map((c) => ({
      id: c.id,
      bank: c.bank,
      billing: {
        closingDay: c.closingDay,
        dueDay: c.dueDay,
        overrides: workspace.cardBillDates
          .filter((d) => d.cardId === c.id)
          .map((d) => ({ month: d.month, closingDay: d.closingDay, dueDay: d.dueDay })),
        paid: workspace.cardBillPayments
          .filter((p) => p.cardId === c.id)
          .map((p) => ({ competence: p.competence, amountCents: p.amountCents, paidOn: p.date })),
      },
    })),
    people: workspace.people.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    categories: workspace.categories.map((c) => ({ id: c.id, name: c.name, color: c.color, icon: c.icon })),
  };

  return (
    <ModulesProvider value={[...ALL_MODULE_KEYS]}>
      <CategoryHintsProvider
        value={buildCategoryHints(transactions.filter((t) => !t.rolled && !t.ledgerOnly))}
      >
        <div className="shell">
          <aside className="sidebar" aria-hidden="true" />
          <main className="main">
            <div className="demo-bar">
              <span>
                <strong>Demonstração.</strong> Dados inventados; nada aqui é salvo.
              </span>
              <nav aria-label="Telas da demonstração">
                <Link href="/demo/dashboard">Início</Link>
                <Link href="/demo/wallets">Carteiras</Link>
                <Link href="/demo/reconcile">Conferir extrato</Link>
              </nav>
            </div>
            <div className="page">{children}</div>
          </main>
          <TxModalsHost
            {...formData}
            transactions={transactions}
            today={today}
            loadHistory={demoTransactionHistoryAction}
          />
        </div>
      </CategoryHintsProvider>
    </ModulesProvider>
  );
}
