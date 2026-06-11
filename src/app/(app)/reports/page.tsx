import { ChartPie, TrendingUp } from "lucide-react";
import { redirect } from "next/navigation";
import { getReports } from "@/application/use-cases/get-reports";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { BarsChart } from "@/presentation/components/charts/bars-chart";
import { DonutChart } from "@/presentation/components/charts/donut-chart";
import { Money } from "@/presentation/components/ui/money";

function currentMonthInBrazil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);
}

export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const data = await getReports(financeRepository, user.id, currentMonthInBrazil());

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mt-1 text-text-mid">Tendência de receitas e despesas e gastos por categoria.</p>
      </div>

      <section className="rounded-lg border border-line bg-surface-1 p-6 shadow-2">
        <h2 className="mb-5 flex items-center gap-2 font-display text-lg font-semibold text-text-hi">
          <TrendingUp size={18} className="text-purple-300" />
          Receitas × Despesas
          <span className="text-sm font-normal text-text-lo">· últimos 6 meses</span>
        </h2>
        <BarsChart months={data.months} />
      </section>

      <section className="rounded-lg border border-line bg-surface-1 p-6 shadow-2">
        <h2 className="mb-5 flex items-center gap-2 font-display text-lg font-semibold text-text-hi">
          <ChartPie size={18} className="text-purple-300" />
          Gastos por categoria
          <span className="text-sm font-normal text-text-lo">· {data.monthLabel}</span>
        </h2>

        {data.totalExpenseCents === 0 ? (
          <p className="py-6 text-center text-text-mid">Nenhuma despesa registrada em {data.monthLabel}.</p>
        ) : (
          <div className="flex flex-col gap-6">
            <DonutChart slices={data.categories} totalCents={data.totalExpenseCents} />
            <ul className="flex flex-col divide-y divide-line border-t border-line">
              {data.categories.map((category) => (
                <li key={category.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-3 shrink-0 rounded-full" style={{ background: category.color }} />
                    <span className="truncate text-text-mid">{category.name}</span>
                  </span>
                  <Money cents={category.valueCents} withSign={false} className="font-medium text-text-hi" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
