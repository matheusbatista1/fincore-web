import { Money } from "@/presentation/components/ui/money";

export interface BarItem {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly valueCents: number;
}

/** Horizontal value bars with a label and meter — ported 1:1 from the prototype (more.jsx BarList). */
export function BarList({ items }: { items: BarItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.valueCents));
  if (items.length === 0) {
    return <div style={{ color: "var(--text-lo)", fontSize: 14 }}>Sem dados ainda.</div>;
  }
  return (
    <div className="col gap-4">
      {items.map((it) => (
        <div key={it.id}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 7 }}>
            <span className="row gap-2" style={{ fontSize: 14, color: "var(--text-hi)", fontWeight: 600 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: it.color }} />
              {it.name}
            </span>
            <span className="tnum" style={{ fontWeight: 700, color: "var(--text-hi)" }}>
              <Money cents={it.valueCents} withSign={false} />
            </span>
          </div>
          <div className="meter" style={{ height: 10 }}>
            <span style={{ width: `${(it.valueCents / max) * 100}%`, background: it.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
