"use client";

import { useRouter } from "next/navigation";
import { addMonths, type CompetenceMonth, monthsBetween } from "@/domain/value-objects/competence-month";
import { Icon } from "@/presentation/components/ui/icon";
import { useModuleEnabled } from "@/presentation/providers/modules-provider";
import { useUIStore } from "@/presentation/stores/ui-store";
import { monthLabel } from "@/shared/formatting/dates";

const PRESETS = [3, 6, 12] as const;
const OPTION_MONTHS = 24;

/**
 * Reports header controls: the Geral / Apenas meu lens toggle (when the People
 * module is on) and the period picker — quick presets (3/6/12 months) plus a
 * custom start→end month range. Navigation drives a server re-render via `?…`.
 */
export function ReportControls({
  from,
  to,
  current,
}: {
  from: CompetenceMonth;
  to: CompetenceMonth;
  current: CompetenceMonth;
}) {
  const router = useRouter();
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const peopleOn = useModuleEnabled("people");
  const isPersonal = peopleOn && view === "personal";

  // Last OPTION_MONTHS months ending at `current`, newest first.
  const options: CompetenceMonth[] = [];
  for (let i = 0; i < OPTION_MONTHS; i++) options.push(addMonths(current, -i));

  const span = monthsBetween(from, to) + 1;
  const isPreset = (n: number): boolean => to === current && from !== to && span === n;
  const usingCustom = !PRESETS.some((n) => isPreset(n));

  const goPreset = (n: number) => router.push(`/reports?range=${n}`);
  const goRange = (nextFrom: CompetenceMonth, nextTo: CompetenceMonth) => {
    const [f, t] = monthsBetween(nextFrom, nextTo) < 0 ? [nextTo, nextFrom] : [nextFrom, nextTo];
    router.push(`/reports?from=${f}&to=${t}`);
  };

  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div
        className="row"
        style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}
      >
        {peopleOn && (
          <div className="view-toggle">
            <button type="button" className={!isPersonal ? "on" : ""} onClick={() => setView("general")}>
              <Icon name="users" size={15} />
              Geral
            </button>
            <button type="button" className={isPersonal ? "on" : ""} onClick={() => setView("personal")}>
              <Icon name="user" size={15} />
              Apenas meu
            </button>
          </div>
        )}

        <div className="row" style={{ gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="seg" style={{ background: "var(--surface-3)" }}>
            {PRESETS.map((n) => (
              <button key={n} type="button" className={isPreset(n) ? "on" : ""} onClick={() => goPreset(n)}>
                {n} meses
              </button>
            ))}
            <button type="button" className={usingCustom ? "on" : ""} onClick={() => goRange(from, to)}>
              Personalizado
            </button>
          </div>

          <div className="row gap-2" style={{ alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--text-lo)" }}>De</span>
            <select
              className="input"
              style={{ width: "auto" }}
              value={from}
              onChange={(e) => goRange(e.target.value, to)}
              aria-label="Mês inicial"
            >
              {options.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m, { long: true })}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 13, color: "var(--text-lo)" }}>até</span>
            <select
              className="input"
              style={{ width: "auto" }}
              value={to}
              onChange={(e) => goRange(from, e.target.value)}
              aria-label="Mês final"
            >
              {options.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m, { long: true })}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
