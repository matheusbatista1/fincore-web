"use client";

import type { CategorySlice, MonthBar } from "@/application/use-cases/get-reports";
import { BarList } from "@/presentation/components/charts/bar-list";
import { BarsChart } from "@/presentation/components/charts/bars-chart";
import { DonutChart } from "@/presentation/components/charts/donut-chart";
import { useModuleEnabled } from "@/presentation/providers/modules-provider";
import { useUIStore } from "@/presentation/stores/ui-store";

interface CardSpend {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly valueCents: number;
}

/**
 * The reports visual area (cash-flow bars, category donut, spend-by-card and
 * top categories). Bars/donut/top-categories follow the active lens
 * (Geral / Apenas meu); spend-by-card has no personal share and stays general.
 */
export function ReportCharts({
  months,
  monthsPersonal,
  categories,
  categoriesPersonal,
  totalExpenseCents,
  totalExpensePersonalCents,
  byCard,
}: {
  months: MonthBar[];
  monthsPersonal: MonthBar[];
  categories: CategorySlice[];
  categoriesPersonal: CategorySlice[];
  totalExpenseCents: number;
  totalExpensePersonalCents: number;
  byCard: CardSpend[];
}) {
  const view = useUIStore((s) => s.view);
  const peopleOn = useModuleEnabled("people");
  const isPersonal = peopleOn && view === "personal";

  const chartMonths = isPersonal ? monthsPersonal : months;
  const chartCategories = isPersonal ? categoriesPersonal : categories;
  const chartTotal = isPersonal ? totalExpensePersonalCents : totalExpenseCents;
  const topCategories = chartCategories.slice(0, 5);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Fluxo de caixa</h3>
              <div className="ch-sub">Receitas x despesas {isPersonal ? "· só o que é seu" : ""}</div>
            </div>
            <div className="legend">
              <div className="lg">
                <span className="sw" style={{ background: "#34E1A8" }} />
                Receitas
              </div>
              <div className="lg">
                <span className="sw" style={{ background: "#9B79FF" }} />
                Despesas
              </div>
            </div>
          </div>
          <div className="card-pad">
            <BarsChart months={chartMonths} />
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Por categoria</h3>
            </div>
          </div>
          <div className="card-pad">
            {chartTotal > 0 ? (
              <DonutChart slices={chartCategories} totalCents={chartTotal} />
            ) : (
              <div style={{ color: "var(--text-lo)", fontSize: 14, padding: "14px 0" }}>
                Sem gastos no período.
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ fontSize: 16, marginBottom: 18 }}>Gasto por cartão</h3>
          <BarList items={byCard} />
        </div>
        <div className="card card-pad">
          <h3 style={{ fontSize: 16, marginBottom: 18 }}>Top categorias</h3>
          <BarList items={topCategories} />
        </div>
      </div>
    </>
  );
}
