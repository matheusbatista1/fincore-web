import { formatBRL } from "@/shared/formatting/currency";

interface DonutSlice {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly valueCents: number;
}

const R = 70;
const CIRCUMFERENCE = 2 * Math.PI * R;
const CENTER = 84;
const STROKE = 20;

/** Pure-SVG category donut with a center total and a top-5 legend. Ported from the prototype. */
export function DonutChart({ slices, totalCents }: { slices: DonutSlice[]; totalCents: number }) {
  let offset = 0;
  const total = totalCents || 1; // avoid division by zero when empty

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative shrink-0">
        <svg width="168" height="168" viewBox="0 0 168 168" className="-rotate-90" aria-hidden="true">
          <circle
            cx={CENTER}
            cy={CENTER}
            r={R}
            fill="none"
            stroke="var(--color-surface-3)"
            strokeWidth={STROKE}
          />
          {slices.map((slice) => {
            const dash = (slice.valueCents / total) * CIRCUMFERENCE;
            const seg = (
              <circle
                key={slice.id}
                cx={CENTER}
                cy={CENTER}
                r={R}
                fill="none"
                stroke={slice.color}
                strokeWidth={STROKE}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return seg;
          })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="tnum font-display text-xl font-semibold text-text-hi">
              {formatBRL(totalCents, { withSign: false })}
            </div>
            <div className="text-xs text-text-lo">gasto no mês</div>
          </div>
        </div>
      </div>

      <ul className="flex w-full flex-col gap-2">
        {slices.slice(0, 5).map((slice) => (
          <li key={slice.id} className="flex items-center gap-2 text-sm">
            <span className="size-3 shrink-0 rounded-full" style={{ background: slice.color }} />
            <span className="min-w-0 flex-1 truncate text-text-mid">{slice.name}</span>
            <span className="tnum text-text-lo">{Math.round((slice.valueCents / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
