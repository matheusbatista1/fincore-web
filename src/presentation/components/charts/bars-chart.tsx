interface MonthBar {
  readonly label: string;
  readonly incomeCents: number;
  readonly expenseCents: number;
}

/** Grouped income/expense bars per month — prototype classes (.bars/.bargrp/.bar). */
export function BarsChart({ months }: { months: MonthBar[] }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.incomeCents, m.expenseCents]));
  return (
    <div>
      <div className="bars">
        {months.map((m) => (
          <div className="bargrp" key={m.label}>
            <div className="barpair">
              <div
                className="bar inc"
                style={{ height: `${(m.incomeCents / max) * 100}%` }}
                title={`Receitas ${m.label}`}
              />
              <div
                className="bar exp"
                style={{ height: `${(m.expenseCents / max) * 100}%` }}
                title={`Despesas ${m.label}`}
              />
            </div>
            <div className="blabel">{m.label}</div>
          </div>
        ))}
      </div>
      <div className="legend" style={{ marginTop: 16 }}>
        <div className="lg">
          <span className="sw" style={{ background: "linear-gradient(180deg,#34E1A8,#1FC591)" }} />
          Receitas
        </div>
        <div className="lg">
          <span className="sw" style={{ background: "linear-gradient(180deg,#9B79FF,#6A45F0)" }} />
          Despesas
        </div>
      </div>
    </div>
  );
}
