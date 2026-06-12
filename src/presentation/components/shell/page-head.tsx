"use client";

import { usePathname } from "next/navigation";
import { Icon } from "@/presentation/components/ui/icon";
import { useUIStore } from "@/presentation/stores/ui-store";

const GREETS: Record<string, { g: string; s: string }> = {
  "/wallets": { g: "Suas carteiras", s: "Saldos consolidados de todas as suas contas." },
  "/cards": { g: "Seus cartões", s: "Faturas, limites e parcelamentos em um só lugar." },
  "/transactions": { g: "Transações", s: "Todo o histórico de entradas e saídas." },
  "/monthly": {
    g: "Visão mensal",
    s: "Seus lançamentos do mês, agrupados por cartão, conta e compromissos.",
  },
  "/people": { g: "Pessoas", s: "Quem te deve, quem você deve e despesas compartilhadas." },
  "/reports": { g: "Relatórios", s: "Análises e tendências dos seus gastos." },
  "/settings": { g: "Configurações", s: "Conta, preferências e segurança." },
  "/budgets": { g: "Orçamentos", s: "Limites mensais de gasto por categoria." },
  "/goals": { g: "Metas", s: "Objetivos de economia e seu progresso." },
  "/import": { g: "Importar extrato", s: "Traga lançamentos de um arquivo CSV ou OFX do seu banco." },
};

/**
 * Per-route greeting header — ported 1:1 from the prototype (app.jsx page-head).
 * The dashboard adds the month chip + privacy eye toggle.
 */
export function PageHead({
  firstName,
  todayLabel,
  monthChip,
}: {
  firstName: string;
  /** e.g. "11 de junho" — computed on the server (São Paulo) to avoid TZ drift. */
  todayLabel: string;
  /** e.g. "Junho 2026". */
  monthChip: string;
}) {
  const pathname = usePathname();
  const privacy = useUIStore((s) => s.privacy);
  const togglePrivacy = useUIStore((s) => s.togglePrivacy);
  const toast = useUIStore((s) => s.toast);

  const isDashboard = pathname.startsWith("/dashboard");
  const greet = isDashboard
    ? { g: `Olá, ${firstName} 👋`, s: `Aqui está o resumo da sua vida financeira hoje, ${todayLabel}.` }
    : (GREETS[Object.keys(GREETS).find((k) => pathname.startsWith(k)) ?? ""] ?? null);

  if (!greet) return null;

  return (
    <div className="page-head">
      <div>
        <div className="greet">{greet.g}</div>
        {greet.s && <div className="sub">{greet.s}</div>}
      </div>
      {isDashboard && (
        <div className="row gap-3">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => toast(`Período fixo em ${monthChip} nesta versão`, "info")}
          >
            <Icon name="calendar" size={17} />
            {monthChip}
          </button>
          <button type="button" className="btn btn-ghost" onClick={togglePrivacy}>
            <Icon name={privacy ? "eye-off" : "eye"} size={17} />
            {privacy ? "Mostrar" : "Ocultar"}
          </button>
        </div>
      )}
    </div>
  );
}
