import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  Layers,
  Repeat,
  Scale,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getMonthly, type MonthlyItem } from "@/application/use-cases/get-monthly";
import { addMonths, isValidCompetenceMonth } from "@/domain/value-objects/competence-month";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { DeleteTransactionButton } from "@/presentation/components/forms/delete-transaction-button";
import { Money } from "@/presentation/components/ui/money";
import { monthLabel } from "@/shared/formatting/dates";

function currentMonthInBrazil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);
}

type StmtAccent = "mint" | "sky" | "purple";
interface StmtGroup {
  readonly key: string;
  readonly name: string;
  readonly accent: StmtAccent;
  readonly rank: number;
  readonly items: MonthlyItem[];
  readonly totalCents: number;
}

const STMT_TONE: Record<StmtAccent, string> = {
  mint: "bg-mint-soft text-mint-500",
  sky: "bg-sky-soft text-sky-500",
  purple: "bg-purple-soft text-purple-300",
};

function groupTotal(items: MonthlyItem[]): number {
  return items.reduce(
    (sum, i) => sum + (i.kind === "transfer" ? (i.transferValueCents ?? 0) : Math.abs(i.amountCents)),
    0,
  );
}

/** Group a month's rows by origin (receitas / each card·conta·compromisso / transferências). */
function buildStatementGroups(items: MonthlyItem[]): StmtGroup[] {
  const income = items.filter((i) => i.kind === "income");
  const transfers = items.filter((i) => i.kind === "transfer");
  const expenses = items.filter((i) => i.kind === "expense");

  const byOrigin = new Map<string, MonthlyItem[]>();
  for (const e of expenses) {
    const key = e.sourceLabel ?? "Outros";
    const arr = byOrigin.get(key);
    if (arr) arr.push(e);
    else byOrigin.set(key, [e]);
  }

  const groups: StmtGroup[] = [];
  if (income.length > 0) {
    groups.push({
      key: "income",
      name: "Receitas",
      accent: "mint",
      rank: 0,
      items: income,
      totalCents: groupTotal(income),
    });
  }
  for (const [name, arr] of byOrigin) {
    const rank = name.startsWith("Cartão") ? 1 : name.includes(" · ") ? 2 : 3;
    groups.push({
      key: `exp:${name}`,
      name,
      accent: "purple",
      rank,
      items: arr,
      totalCents: groupTotal(arr),
    });
  }
  if (transfers.length > 0) {
    groups.push({
      key: "transfer",
      name: "Transferências",
      accent: "sky",
      rank: 9,
      items: transfers,
      totalCents: groupTotal(transfers),
    });
  }
  return groups.sort((a, b) => a.rank - b.rank || b.totalCents - a.totalCents);
}

function StatementIcon({ group }: { group: StmtGroup }) {
  if (group.key === "income") return <ArrowDownLeft size={18} />;
  if (group.key === "transfer") return <ArrowLeftRight size={18} />;
  if (group.name.startsWith("Cartão")) return <CreditCard size={18} />;
  if (group.name.includes(" · ")) return <Wallet size={18} />;
  return <FileText size={18} />;
}

function StatementCard({ group }: { group: StmtGroup }) {
  const totalTone =
    group.accent === "mint" ? "text-mint-500" : group.accent === "sky" ? "text-sky-500" : "text-text-hi";
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface-1 shadow-2">
      <div className="flex items-center gap-3 border-b border-line p-4">
        <span className={`grid size-10 shrink-0 place-items-center rounded-md ${STMT_TONE[group.accent]}`}>
          <StatementIcon group={group} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-text-hi">{group.name}</p>
          <p className="text-xs text-text-lo">
            {group.items.length} {group.items.length === 1 ? "lançamento" : "lançamentos"}
          </p>
        </div>
        <Money cents={group.totalCents} withSign={false} className={`shrink-0 font-semibold ${totalTone}`} />
      </div>
      <div className="divide-y divide-line">
        {group.items.map((item) => (
          <MonthlyRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function KindIcon({ kind }: { kind: MonthlyItem["kind"] }) {
  const base = "grid size-10 shrink-0 place-items-center rounded-md";
  if (kind === "income")
    return (
      <span className={`${base} bg-mint-soft text-mint-500`}>
        <ArrowDownLeft size={18} />
      </span>
    );
  if (kind === "transfer")
    return (
      <span className={`${base} bg-sky-soft text-sky-500`}>
        <ArrowLeftRight size={18} />
      </span>
    );
  return (
    <span className={`${base} bg-rose-soft text-rose-500`}>
      <ArrowUpRight size={18} />
    </span>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "purple" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs ${
        tone === "purple" ? "bg-purple-soft text-purple-300" : "bg-surface-3 text-text-lo"
      }`}
    >
      {children}
    </span>
  );
}

function Kpi({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-text-faint">
        {icon}
        {label}
      </span>
      <Money cents={value} withSign={false} className={`font-display text-2xl font-semibold ${tone}`} />
    </div>
  );
}

function MonthlyRow({ item }: { item: MonthlyItem }) {
  const sub: React.ReactNode[] = [];
  if (item.sourceLabel) sub.push(<span key="src">{item.sourceLabel}</span>);
  if (item.transferFromName && item.transferToName) {
    sub.push(
      <span key="x">
        {item.transferFromName} → {item.transferToName}
      </span>,
    );
  }
  if (item.fromPersonName) sub.push(<span key="from">Pagamento de {item.fromPersonName}</span>);

  return (
    <div className={`flex items-center justify-between gap-3 p-4 ${item.projected ? "opacity-70" : ""}`}>
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
            {sub.length > 0 && <span className="truncate">{sub[0]}</span>}
            {item.projected && <Badge tone="purple">Previsto</Badge>}
            {item.isFixed && (
              <Badge>
                <Repeat size={12} />
                Fixo
              </Badge>
            )}
            {item.parcela && (
              <Badge>
                <Layers size={12} />
                {item.parcela.number}/{item.parcela.total}
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
        {item.projected ? (
          <span className="w-9" />
        ) : (
          <DeleteTransactionButton
            id={item.id}
            isInstallment={item.parcela !== null}
            description={item.description || "lançamento"}
          />
        )}
      </div>
    </div>
  );
}

export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { m } = await searchParams;
  const raw = Array.isArray(m) ? m[0] : m;
  const current = currentMonthInBrazil();
  const month = raw && isValidCompetenceMonth(raw) ? raw : current;
  const isCurrent = month === current;

  const data = await getMonthly(financeRepository, user.id, month);
  const hasProjections = data.items.some((i) => i.projected);
  const statementGroups = buildStatementGroups(data.items);
  const net = data.projectedTotals.netCents;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-line bg-surface-1 p-5 shadow-2">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/monthly?m=${addMonths(month, -1)}`}
            className="grid size-10 place-items-center rounded-sm text-text-mid transition hover:bg-surface-2 hover:text-text-hi"
            aria-label="Mês anterior"
          >
            <ChevronLeft size={20} />
          </Link>
          <div className="flex flex-col items-center gap-1">
            <span className="font-display text-lg font-semibold text-text-hi">
              {monthLabel(month, { long: true })}
            </span>
            {isCurrent ? (
              <span className="rounded-pill bg-purple-soft px-2.5 py-0.5 text-xs font-semibold text-purple-300">
                Mês atual
              </span>
            ) : (
              <Link href="/monthly" className="text-xs font-medium text-purple-300 hover:underline">
                Voltar para hoje
              </Link>
            )}
          </div>
          <Link
            href={`/monthly?m=${addMonths(month, 1)}`}
            className="grid size-10 place-items-center rounded-sm text-text-mid transition hover:bg-surface-2 hover:text-text-hi"
            aria-label="Próximo mês"
          >
            <ChevronRight size={20} />
          </Link>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-5">
          <Kpi
            label="Entradas"
            value={data.projectedTotals.incomeCents}
            tone="text-mint-500"
            icon={<ArrowDownLeft size={13} />}
          />
          <Kpi
            label="Saídas"
            value={data.projectedTotals.expenseCents}
            tone="text-rose-500"
            icon={<ArrowUpRight size={13} />}
          />
          <Kpi
            label="Resultado"
            value={net}
            tone={net >= 0 ? "text-text-hi" : "text-rose-500"}
            icon={<Scale size={13} />}
          />
        </div>
        {hasProjections && (
          <p className="mt-3 text-xs text-text-lo">Inclui lançamentos fixos previstos para este mês.</p>
        )}
      </div>

      {data.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-2 bg-surface-1 p-10 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-surface-2 text-text-lo">
            <CalendarX size={24} />
          </div>
          <h3 className="font-medium text-text-hi">Nenhum lançamento</h3>
          <p className="mt-1 text-text-mid">
            Não há lançamentos em {monthLabel(month, { long: true })}. Lançamentos fixos aparecem
            automaticamente nos próximos meses.
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {statementGroups.map((group) => (
            <StatementCard key={group.key} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}
