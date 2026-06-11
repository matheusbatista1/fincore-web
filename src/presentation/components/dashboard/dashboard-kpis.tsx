"use client";

import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";
import { KpiCard } from "@/presentation/components/ui/kpi-card";
import { Money } from "@/presentation/components/ui/money";
import { useUIStore } from "@/presentation/stores/ui-store";

interface Totals {
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly netCents: number;
}

/** Month KPIs that switch between the general and personal lens (topbar toggle). */
export function DashboardKpis({ general, personal }: { general: Totals; personal: Totals }) {
  const view = useUIStore((s) => s.view);
  const t = view === "personal" ? personal : general;

  return (
    <section className="grid gap-4 sm:grid-cols-3">
      <KpiCard label="Receitas no mês" tone="mint" icon={<ArrowDownLeft size={18} />}>
        <Money cents={t.incomeCents} withSign={false} className="text-mint-500" />
      </KpiCard>
      <KpiCard label="Despesas no mês" tone="rose" icon={<ArrowUpRight size={18} />}>
        <Money cents={t.expenseCents} withSign={false} className="text-rose-500" />
      </KpiCard>
      <KpiCard
        label="Resultado"
        tone="purple"
        icon={<Scale size={18} />}
        sub={view === "personal" ? "Só a sua parte" : "Tudo no mês"}
      >
        <Money cents={t.netCents} className={t.netCents < 0 ? "text-rose-500" : "text-text-hi"} />
      </KpiCard>
    </section>
  );
}
