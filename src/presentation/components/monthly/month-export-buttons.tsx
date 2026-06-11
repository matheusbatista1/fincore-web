"use client";

import { Icon } from "@/presentation/components/ui/icon";
import { useUIStore } from "@/presentation/stores/ui-store";

/** CSV/PDF export actions for the monthly statement (toast only, like the prototype). */
export function MonthExportButtons({ monthLabel }: { monthLabel: string }) {
  const toast = useUIStore((s) => s.toast);
  return (
    <div
      className="row gap-2 month-export"
      style={{
        marginTop: 18,
        paddingTop: 16,
        borderTop: "1px solid var(--line)",
        justifyContent: "flex-end",
      }}
    >
      <span
        style={{
          flex: 1,
          fontSize: 12.5,
          color: "var(--text-lo)",
          display: "flex",
          alignItems: "center",
          gap: 7,
        }}
      >
        <Icon name="file-down" size={14} />
        Exportar o extrato de {monthLabel} agrupado por origem
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => toast(`Extrato de ${monthLabel} exportado em CSV`)}
      >
        <Icon name="file-spreadsheet" size={16} />
        CSV
      </button>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => toast(`Extrato de ${monthLabel} exportado em PDF`)}
      >
        <Icon name="file-down" size={16} />
        Exportar PDF
      </button>
    </div>
  );
}
