"use client";

import { useState } from "react";
import { Icon } from "@/presentation/components/ui/icon";
import { type ReportData, ReportModal, type ReportMode } from "./report-modal";

const PICKS: ReadonlyArray<{
  key: ReportMode;
  tone: string;
  icon: string;
  title: string;
  sub: string;
}> = [
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
];

/** The three report pickers — open the full ReportModal (extras.jsx) with real data. */
export function ReportPickButtons({ data }: { data: ReportData }) {
  const [mode, setMode] = useState<ReportMode | null>(null);
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {PICKS.map((p) => (
          <button type="button" key={p.key} className="report-pick-btn" onClick={() => setMode(p.key)}>
            <span className={`kpi-ic ${p.tone}`}>
              <Icon name={p.icon} size={19} />
            </span>
            <b>{p.title}</b>
            <small>{p.sub}</small>
          </button>
        ))}
      </div>
      {mode && <ReportModal data={data} initialMode={mode} onClose={() => setMode(null)} />}
    </>
  );
}
