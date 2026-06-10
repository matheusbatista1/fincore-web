interface MonthBar {
  readonly label: string;
  readonly incomeCents: number;
  readonly expenseCents: number;
}

/** Grouped income/expense bars per month. Heights are data-driven (inline %). */
export function BarsChart({ months }: { months: MonthBar[] }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.incomeCents, m.expenseCents]));

  return (
    <div>
      <div className="flex h-44 items-end justify-between gap-3">
        {months.map((m) => (
          <div key={m.label} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex h-36 w-full items-end justify-center gap-1">
              <div
                className="w-1/2 max-w-5 rounded-t-sm bg-gradient-to-b from-mint-500 to-mint-600"
                style={{ height: `${(m.incomeCents / max) * 100}%` }}
                title={`Receitas ${m.label}`}
              />
              <div
                className="w-1/2 max-w-5 rounded-t-sm bg-gradient-to-b from-purple-400 to-purple-700"
                style={{ height: `${(m.expenseCents / max) * 100}%` }}
                title={`Despesas ${m.label}`}
              />
            </div>
            <span className="text-xs text-text-lo">{m.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-4 text-sm text-text-mid">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-gradient-to-b from-mint-500 to-mint-600" />
          Receitas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-gradient-to-b from-purple-400 to-purple-700" />
          Despesas
        </span>
      </div>
    </div>
  );
}
