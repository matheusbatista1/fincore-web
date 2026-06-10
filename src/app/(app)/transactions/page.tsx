import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Layers, Plus, Repeat, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { getTransactions, type TransactionListItem } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { DeleteTransactionButton } from "@/presentation/components/forms/delete-transaction-button";
import { NewTransactionDialog } from "@/presentation/components/forms/new-transaction-dialog";
import { Button } from "@/presentation/components/ui/button";
import { Money } from "@/presentation/components/ui/money";
import { relativeDateLabel } from "@/shared/formatting/dates";

/** Today in the user's (Brazilian) timezone, as `YYYY-MM-DD`, for relative date labels. */
function todayInBrazil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function KindIcon({ kind }: { kind: TransactionListItem["kind"] }) {
  const base = "grid size-10 shrink-0 place-items-center rounded-md";
  if (kind === "income") {
    return (
      <span className={`${base} bg-mint-soft text-mint-500`}>
        <ArrowDownLeft size={18} />
      </span>
    );
  }
  if (kind === "transfer") {
    return (
      <span className={`${base} bg-sky-soft text-sky-500`}>
        <ArrowLeftRight size={18} />
      </span>
    );
  }
  return (
    <span className={`${base} bg-rose-soft text-rose-500`}>
      <ArrowUpRight size={18} />
    </span>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-surface-3 px-2 py-0.5 text-xs text-text-lo">
      {children}
    </span>
  );
}

function TransactionRow({ item }: { item: TransactionListItem }) {
  const meta: React.ReactNode[] = [];
  if (item.sourceLabel) meta.push(<span key="src">{item.sourceLabel}</span>);
  if (item.transferFromName && item.transferToName) {
    meta.push(
      <span key="xfer">
        {item.transferFromName} → {item.transferToName}
      </span>,
    );
  }
  if (item.fromPersonName) meta.push(<span key="from">Pagamento de {item.fromPersonName}</span>);

  return (
    <div className="flex items-center justify-between gap-3 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <KindIcon kind={item.kind} />
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate font-medium text-text-hi">
            {item.description || (item.kind === "transfer" ? "Transferência" : "Lançamento")}
            {item.category && (
              <span className="size-2 shrink-0 rounded-full" style={{ background: item.category.color }} />
            )}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-lo">
            {meta.length > 0 && <span className="truncate">{meta[0]}</span>}
            {item.parcela && (
              <Badge>
                <Layers size={12} />
                {item.parcela.number}/{item.parcela.total}
              </Badge>
            )}
            {item.isFixed && (
              <Badge>
                <Repeat size={12} />
                Fixo
              </Badge>
            )}
            {item.shares.length > 0 && (
              <Badge>
                <Users size={12} />
                {item.shares.length === 1 ? "1 pessoa" : `${item.shares.length} pessoas`}
              </Badge>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {item.kind === "transfer" ? (
          <Money
            cents={item.transferValueCents ?? 0}
            withSign={false}
            className="mr-1 font-semibold text-sky-500"
          />
        ) : (
          <Money
            cents={item.amountCents}
            className={`mr-1 font-semibold ${item.kind === "income" ? "text-mint-500" : "text-text-hi"}`}
          />
        )}
        <DeleteTransactionButton
          id={item.id}
          isInstallment={item.parcela !== null}
          description={item.description || "lançamento"}
        />
      </div>
    </div>
  );
}

export default async function TransactionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [workspace, transactions] = await Promise.all([
    getWorkspaceView(financeRepository, user.id),
    getTransactions(financeRepository, user.id),
  ]);

  const formData = {
    accounts: workspace.accounts.map((a) => ({ id: a.id, bank: a.bank, name: a.name })),
    cards: workspace.cards.map((c) => ({ id: c.id, bank: c.bank })),
    people: workspace.people.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    categories: workspace.categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
  };

  const today = todayInBrazil();

  // Group consecutive rows by date (the list is already sorted newest-first).
  const groups: { date: string; items: TransactionListItem[] }[] = [];
  for (const item of transactions) {
    const last = groups.at(-1);
    if (last && last.date === item.date) last.items.push(item);
    else groups.push({ date: item.date, items: [item] });
  }

  const newButton = (
    <NewTransactionDialog
      {...formData}
      trigger={
        <Button>
          <Plus size={18} />
          Novo lançamento
        </Button>
      }
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-text-hi">Lançamentos</h1>
          <p className="mt-1 text-text-mid">Despesas, receitas e transferências do seu histórico.</p>
        </div>
        {newButton}
      </header>

      {transactions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-2 bg-surface-1 p-10 text-center">
          <p className="text-text-mid">Você ainda não registrou lançamentos.</p>
          <div className="mt-4 flex justify-center">{newButton}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.date}>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-text-faint">
                {relativeDateLabel(group.date, today)}
              </h2>
              <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface-1">
                {group.items.map((item) => (
                  <TransactionRow key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
