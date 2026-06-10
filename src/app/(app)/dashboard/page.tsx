import { redirect } from "next/navigation";
import { getDashboard } from "@/application/use-cases/get-dashboard";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { formatBRL } from "@/shared/formatting/currency";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const month = new Date().toISOString().slice(0, 7);
  const dash = await getDashboard(financeRepository, user.id, month);
  const isEmpty = dash.accounts.length === 0 && dash.cards.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-3xl font-semibold text-text-hi">Olá 👋</h1>
        <p className="mt-1 text-text-mid">Aqui está o resumo da sua vida financeira.</p>
      </header>

      {/* Hero + KPIs */}
      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-lg border border-line bg-gradient-to-br from-surface-2 to-surface-1 p-6 shadow-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-faint">Saldo total</p>
          <p className="tnum mt-2 font-display text-3xl font-semibold text-text-hi">
            {formatBRL(dash.totalBalanceCents)}
          </p>
        </article>
        <article className="rounded-lg border border-line bg-surface-1 p-6 shadow-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-faint">Receitas no mês</p>
          <p className="tnum mt-2 font-display text-2xl font-semibold text-mint-500">
            {formatBRL(dash.general.incomeCents)}
          </p>
        </article>
        <article className="rounded-lg border border-line bg-surface-1 p-6 shadow-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-faint">Despesas no mês</p>
          <p className="tnum mt-2 font-display text-2xl font-semibold text-rose-500">
            {formatBRL(dash.general.expenseCents)}
          </p>
        </article>
      </section>

      {isEmpty ? (
        <p className="rounded-lg border border-dashed border-line-2 bg-surface-1 p-8 text-center text-text-mid">
          Você ainda não tem contas ou cartões. Em breve você poderá adicioná-los por aqui.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Carteiras">
            {dash.accounts.map((account) => (
              <Row
                key={account.id}
                title={account.bank}
                subtitle={account.name}
                value={formatBRL(account.balanceCents)}
              />
            ))}
          </Panel>

          <Panel title="Cartões">
            {dash.cards.map((card) => (
              <Row
                key={card.id}
                title={card.bank}
                subtitle={`${card.product} · ${Math.round(card.utilization * 100)}% do limite`}
                value={formatBRL(card.billCents)}
              />
            ))}
          </Panel>

          {dash.people.length > 0 && (
            <Panel title="Pessoas">
              {dash.people.map((person) => (
                <Row
                  key={person.id}
                  title={person.name}
                  subtitle={person.balanceCents > 0 ? "te deve" : "você deve"}
                  value={formatBRL(Math.abs(person.balanceCents))}
                  tone={person.balanceCents > 0 ? "mint" : "rose"}
                />
              ))}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface-1 p-5 shadow-2">
      <h2 className="font-display text-lg font-semibold text-text-hi">{title}</h2>
      <div className="mt-3 flex flex-col divide-y divide-line">{children}</div>
    </section>
  );
}

function Row({
  title,
  subtitle,
  value,
  tone = "default",
}: {
  title: string;
  subtitle: string;
  value: string;
  tone?: "default" | "mint" | "rose";
}) {
  const toneClass = tone === "mint" ? "text-mint-500" : tone === "rose" ? "text-rose-500" : "text-text-hi";
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="font-medium text-text-hi">{title}</p>
        <p className="text-sm text-text-lo">{subtitle}</p>
      </div>
      <span className={`tnum font-semibold ${toneClass}`}>{value}</span>
    </div>
  );
}
