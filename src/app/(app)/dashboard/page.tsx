import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDashboard } from "@/application/use-cases/get-dashboard";
import { getTransactions, type TransactionListItem } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { AreaChart } from "@/presentation/components/charts/area-chart";
import { DashboardKpis } from "@/presentation/components/dashboard/dashboard-kpis";
import { Button } from "@/presentation/components/ui/button";
import { CreditCardWidget } from "@/presentation/components/ui/credit-card-widget";
import { Money } from "@/presentation/components/ui/money";

function currentMonthInBrazil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);
}

function RecentRow({ item }: { item: TransactionListItem }) {
  const base = "grid size-9 shrink-0 place-items-center rounded-md";
  const icon =
    item.kind === "income" ? (
      <span className={`${base} bg-mint-soft text-mint-500`}>
        <ArrowDownLeft size={16} />
      </span>
    ) : item.kind === "transfer" ? (
      <span className={`${base} bg-sky-soft text-sky-500`}>
        <ArrowLeftRight size={16} />
      </span>
    ) : (
      <span className={`${base} bg-rose-soft text-rose-500`}>
        <ArrowUpRight size={16} />
      </span>
    );

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-hi">
            {item.description || (item.kind === "transfer" ? "Transferência" : "Lançamento")}
          </p>
          <p className="truncate text-xs text-text-lo">{item.sourceLabel ?? item.transferFromName ?? "—"}</p>
        </div>
      </div>
      {item.kind === "transfer" ? (
        <Money
          cents={item.transferValueCents ?? 0}
          withSign={false}
          className="shrink-0 text-sm font-semibold text-sky-500"
        />
      ) : (
        <Money
          cents={item.amountCents}
          className={`shrink-0 text-sm font-semibold ${item.kind === "income" ? "text-mint-500" : "text-text-hi"}`}
        />
      )}
    </div>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface-1 p-5 shadow-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-text-hi">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const month = currentMonthInBrazil();
  const [dash, workspace, transactions] = await Promise.all([
    getDashboard(financeRepository, user.id, month),
    getWorkspaceView(financeRepository, user.id),
    getTransactions(financeRepository, user.id),
  ]);

  const isEmpty = dash.accounts.length === 0 && dash.cards.length === 0;
  const recent = transactions.slice(0, 6);

  if (isEmpty) {
    return (
      <div className="rounded-lg border border-dashed border-line-2 bg-surface-1 p-10 text-center">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-purple-soft text-purple-300">
          <Wallet size={24} />
        </div>
        <p className="text-text-mid">
          Comece criando uma carteira ou um cartão — depois seus lançamentos aparecem aqui.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href="/wallets">
            <Button>
              <Plus size={18} />
              Criar carteira
            </Button>
          </Link>
          <Link href="/cards">
            <Button variant="ghost">Adicionar cartão</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Hero: total balance + net-worth sparkline */}
      <section className="overflow-hidden rounded-lg border border-line bg-gradient-to-br from-surface-2 to-surface-1 shadow-2 lg:grid lg:grid-cols-2">
        <div className="p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-faint">Saldo total</p>
          <Money
            cents={dash.totalBalanceCents}
            className="mt-2 block font-display text-4xl font-semibold text-text-hi"
          />
          <p className="mt-1 text-sm text-text-lo">
            Em {dash.accounts.length} {dash.accounts.length === 1 ? "carteira" : "carteiras"}
          </p>
        </div>
        <div className="h-44 border-t border-line lg:border-l lg:border-t-0">
          <AreaChart data={dash.trend} />
        </div>
      </section>

      <DashboardKpis general={dash.general} personal={dash.personal} />

      {/* Cards */}
      {workspace.cards.length > 0 && (
        <div className="flex gap-4 overflow-x-auto pb-1">
          {workspace.cards.map((card) => (
            <div key={card.id} className="w-64 shrink-0">
              <CreditCardWidget
                bank={card.bank}
                product={card.product}
                flag={card.flag}
                themeKey={card.themeKey}
                maskedNumber={card.maskedNumber}
              />
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Atividade recente"
          action={
            <Link href="/transactions" className="text-sm font-medium text-purple-300 hover:underline">
              Ver tudo
            </Link>
          }
        >
          {recent.length === 0 ? (
            <p className="py-4 text-sm text-text-lo">Nenhum lançamento ainda.</p>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {recent.map((item) => (
                <RecentRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </Panel>

        {dash.people.length > 0 ? (
          <Panel
            title="Pessoas"
            action={
              <Link href="/people" className="text-sm font-medium text-purple-300 hover:underline">
                Ver tudo
              </Link>
            }
          >
            <div className="flex flex-col divide-y divide-line">
              {dash.people.map((person) => {
                const owesYou = person.balanceCents > 0;
                return (
                  <div key={person.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                        style={{ background: person.color || "#7c5cff" }}
                      >
                        {person.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text-hi">{person.name}</p>
                        <p className="text-xs text-text-lo">{owesYou ? "te deve" : "você deve"}</p>
                      </div>
                    </div>
                    <Money
                      cents={Math.abs(person.balanceCents)}
                      withSign={false}
                      className={`shrink-0 text-sm font-semibold ${owesYou ? "text-mint-500" : "text-rose-500"}`}
                    />
                  </div>
                );
              })}
            </div>
          </Panel>
        ) : (
          <Panel title="Carteiras">
            <div className="flex flex-col divide-y divide-line">
              {dash.accounts.map((account) => (
                <div key={account.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-hi">{account.bank}</p>
                    <p className="truncate text-xs text-text-lo">{account.name}</p>
                  </div>
                  <Money
                    cents={account.balanceCents}
                    className={`shrink-0 text-sm font-semibold ${account.balanceCents < 0 ? "text-rose-500" : "text-text-hi"}`}
                  />
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
