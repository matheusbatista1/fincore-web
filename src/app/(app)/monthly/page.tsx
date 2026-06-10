import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Layers,
  Repeat,
  Scale,
  Users,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getMonthly, type MonthlyItem } from "@/application/use-cases/get-monthly";
import { addMonths, isValidCompetenceMonth } from "@/domain/value-objects/competence-month";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { DeleteTransactionButton } from "@/presentation/components/forms/delete-transaction-button";
import { Money } from "@/presentation/components/ui/money";
import { monthLabel, relativeDateLabel } from "@/shared/formatting/dates";

function currentMonthInBrazil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);
}
function todayInBrazil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
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
  const today = todayInBrazil();
  const hasProjections = data.items.some((i) => i.projected);

  const groups: { date: string; items: MonthlyItem[] }[] = [];
  for (const item of data.items) {
    const last = groups.at(-1);
    if (last && last.date === item.date) last.items.push(item);
    else groups.push({ date: item.date, items: [item] });
  }

  const net = data.projectedTotals.netCents;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-text-hi">Visão mensal</h1>
        <p className="mt-1 text-text-mid">Extrato do mês com lançamentos fixos projetados.</p>
      </div>

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
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.date}>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-text-faint">
                {relativeDateLabel(group.date, today)}
              </h2>
              <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface-1">
                {group.items.map((item) => (
                  <MonthlyRow key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
