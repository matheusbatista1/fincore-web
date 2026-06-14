import { AnimatedMoney } from "@/presentation/components/ui/animated-money";

interface DonutSlice {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly valueCents: number;
}

const R = 70;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** Category donut — prototype classes (.donut-wrap/.donut/.center/.cat-legend). */
export function DonutChart({ slices, totalCents }: { slices: DonutSlice[]; totalCents: number }) {
  const total = totalCents || 1;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <div className="donut">
        <svg
          width="168"
          height="168"
          viewBox="0 0 168 168"
          style={{ transform: "rotate(-90deg)" }}
          aria-hidden="true"
        >
          <circle cx="84" cy="84" r={R} fill="none" stroke="#251F33" strokeWidth="20" />
          {slices.map((slice) => {
            const dash = (slice.valueCents / total) * CIRCUMFERENCE;
            const node = (
              <circle
                key={slice.id}
                className="donut-slice"
                cx="84"
                cy="84"
                r={R}
                fill="none"
                stroke={slice.color}
                strokeWidth="20"
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return node;
          })}
        </svg>
        <div className="center">
          <div>
            <AnimatedMoney cents={totalCents} withSign={false} className="big" />
            <div className="lbl">gasto no mês</div>
          </div>
        </div>
      </div>
      <div className="cat-legend">
        {slices.slice(0, 5).map((slice) => (
          <div className="cl" key={slice.id}>
            <span className="dot" style={{ background: slice.color }} />
            <span className="nm">{slice.name}</span>
            <span className="pc">{Math.round((slice.valueCents / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
