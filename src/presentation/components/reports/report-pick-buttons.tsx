"use client";

import { Icon } from "@/presentation/components/ui/icon";
import { useUIStore } from "@/presentation/stores/ui-store";

const PICKS = [
  {
    key: "month",
    tone: "sky",
    icon: "calendar-range",
    title: "Geral do mês",
    sub: "Receitas, despesas, categorias e cartões",
  },
  {
    key: "mine",
    tone: "mint",
    icon: "user",
    title: "Meu relatório",
    sub: "Só o que é seu, sem partes de terceiros",
  },
  {
    key: "person",
    tone: "amber",
    icon: "users",
    title: "Por pessoa",
    sub: "Gastos de cada um, agrupados por origem",
  },
] as const;

/** The three report-export pickers (toast only, like the prototype's onReport). */
export function ReportPickButtons() {
  const toast = useUIStore((s) => s.toast);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
      {PICKS.map((p) => (
        <button
          type="button"
          key={p.key}
          className="report-pick-btn"
          onClick={() => toast(`Relatório "${p.title}" sendo gerado…`)}
        >
          <span className={`kpi-ic ${p.tone}`}>
            <Icon name={p.icon} size={19} />
          </span>
          <b>{p.title}</b>
          <small>{p.sub}</small>
        </button>
      ))}
    </div>
  );
}
