interface AreaPoint {
  readonly label: string;
  readonly valueCents: number;
}

const W = 720;
const H = 220;
const P = 8;

/** Smooth area sparkline (net worth over months). Pure SVG, ported from the prototype. */
export function AreaChart({ data }: { data: AreaPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="grid h-full min-h-32 place-items-center text-sm text-text-lo">Sem histórico ainda.</div>
    );
  }

  const values = data.map((d) => d.valueCents);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const min = rawMin === rawMax ? rawMin - 1 : rawMin * (rawMin < 0 ? 1.04 : 0.96);
  const max = rawMin === rawMax ? rawMax + 1 : rawMax * (rawMax < 0 ? 0.96 : 1.02);

  const x = (i: number) => P + (i * (W - P * 2)) / (data.length - 1);
  const y = (v: number) => H - 28 - ((v - min) / (max - min)) * (H - 48);
  const pts = data.map((d, i) => [x(i), y(d.valueCents)] as const);

  const line = pts
    .map((p, i) => {
      if (i === 0) return `M ${p[0]} ${p[1]}`;
      const prev = pts[i - 1] ?? p;
      const cx = (prev[0] + p[0]) / 2;
      return `C ${cx} ${prev[1]} ${cx} ${p[1]} ${p[0]} ${p[1]}`;
    })
    .join(" ");
  const last = pts[pts.length - 1] ?? [0, 0];
  const area = `${line} L ${x(data.length - 1)} ${H - 8} L ${x(0)} ${H - 8} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="fc-area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7C5CFF" stopOpacity="0.42" />
          <stop offset="1" stopColor="#7C5CFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fc-area-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#9B79FF" />
          <stop offset="1" stopColor="#7C5CFF" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1="0"
          x2={W}
          y1={28 + f * (H - 48)}
          y2={28 + f * (H - 48)}
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="1"
        />
      ))}
      <path d={area} fill="url(#fc-area-fill)" />
      <path d={line} fill="none" stroke="url(#fc-area-line)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="5" fill="#9B79FF" stroke="#0C0A12" strokeWidth="3" />
      {data.map((d, i) => (
        <text key={d.label} x={x(i)} y={H - 4} fontSize="12" fill="#6F6985" textAnchor="middle">
          {d.label}
        </text>
      ))}
    </svg>
  );
}
